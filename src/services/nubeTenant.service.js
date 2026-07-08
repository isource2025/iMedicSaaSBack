/**
 * Operaciones de tenant "NUBE": los datos de la clínica viven en Railway (MySQL),
 * en la base compartida multi-tenant por IDEMPRESA. Reemplaza al SQL Server on-premise
 * para empresas cuyo Empresas.TipoServidor = 'NUBE'.
 *
 * También implementa la importación snapshot FÍSICO → NUBE: copia las tablas que
 * ya existen en Railway desde el SQL Server on-premise de la empresa.
 */
const { getAuthCentralPool } = require('../config/authCentralDb');
const { getTenantPool } = require('../config/tenantDb');
const { convertirFechaAClarion } = require('../utils/dateUtils');

const COLLATE = 'utf8mb4_unicode_ci';

/**
 * Desfase de IDs por empresa al importar personal desde un SQL Server físico.
 * El físico numera su personal desde 1; para no pisar el de otras empresas ya
 * cargadas en Railway, cada empresa vive en su propia franja: id_nube = base + id_origen.
 * Determinístico ⇒ re-importar es idempotente (upsert sobre el mismo id remapeado).
 */
const OFFSET_EMPRESA = 10_000_000;
function offsetEmpresa(idEmpresa) {
	return Number(idEmpresa) * OFFSET_EMPRESA;
}

/**
 * Estrategias de importación FÍSICO → NUBE:
 *  - 'nube'   : catálogo GLOBAL de plataforma (roles/permisos/IVA). No se copia del físico:
 *               se usan siempre los de Railway (respuesta al punto 1: "lo que no esté en
 *               local se toma de la nube"). También cubre tablas que faltan en el físico.
 *  - 'tenant' : datos propios de la empresa. Se copian remapeando IDs y forzando IdEmpresa.
 *      · remapPersona : columnas con id de persona → se les suma offsetEmpresa().
 *      · forzarEmpresa: columnas que se setean SIEMPRE al IdEmpresa destino (aunque el
 *                       físico no las tenga), para etiquetar la fila con su empresa.
 */
const TABLAS_IMPORTABLES = [
	{ tabla: 'imRoles', label: 'Roles', estrategia: 'nube' },
	{ tabla: 'imPermisos', label: 'Permisos', estrategia: 'nube' },
	{ tabla: 'imRolPermisos', label: 'Permisos por rol', estrategia: 'nube' },
	{ tabla: 'imIVA', label: 'Condiciones de IVA', estrategia: 'nube' },
	{ tabla: 'imSectores', label: 'Sectores', estrategia: 'tenant', forzarEmpresa: ['IdEmpresa'] },
	{ tabla: 'imPersonal', label: 'Personal', estrategia: 'tenant', remapPersona: ['Valor'] },
	{ tabla: 'imPassword', label: 'Usuarios de acceso', estrategia: 'tenant', remapPersona: ['ValorPersonal', 'CodOperador'] },
	{ tabla: 'imPersonalSectores', label: 'Sectores por personal', estrategia: 'tenant', remapPersona: ['idPersonal'] },
	{ tabla: 'imPersonalEmpresas', label: 'Vínculo usuario-empresa', estrategia: 'tenant', remapPersona: ['IdPersonal'], forzarEmpresa: ['IdEmpresa'] },
];

function configTabla(tabla) {
	return TABLAS_IMPORTABLES.find((x) => x.tabla.toLowerCase() === String(tabla).toLowerCase());
}

async function mysqlQuery(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function mysqlExec(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [res] = await pool.query(sql, params);
	return res;
}

// ───────────────────────────── esquema (introspección) ─────────────────────────────

const NUMERIC_TYPES = new Set([
	'int', 'bigint', 'smallint', 'tinyint', 'mediumint', 'decimal', 'numeric', 'float', 'double',
]);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);

async function columnasMeta(tabla) {
	const rows = await mysqlQuery(
		`SELECT COLUMN_NAME AS col, DATA_TYPE AS tipo, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS def, EXTRA AS extra
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
		[tabla],
	);
	const map = new Map();
	for (const r of rows) {
		map.set(String(r.col), {
			nombre: String(r.col),
			tipo: String(r.tipo).toLowerCase(),
			nullable: String(r.nullable).toUpperCase() === 'YES',
			hasDefault: r.def != null,
			autoInc: String(r.extra || '').toLowerCase().includes('auto_increment'),
		});
	}
	return map;
}

function valorPorTipo(meta) {
	if (NUMERIC_TYPES.has(meta.tipo)) return 0;
	if (DATE_TYPES.has(meta.tipo)) return meta.tipo === 'date' ? '1900-01-01' : '1900-01-01 00:00:00';
	return '';
}

/** Completa columnas NOT NULL sin default con un valor seguro por tipo. */
function completarObligatorias(colMap, campos, valores) {
	const puestas = new Set(campos.map((c) => c.toLowerCase()));
	for (const meta of colMap.values()) {
		if (puestas.has(meta.nombre.toLowerCase())) continue;
		if (meta.nullable || meta.hasDefault || meta.autoInc) continue;
		campos.push(meta.nombre);
		valores.push(valorPorTipo(meta));
	}
}

function esNumerica(colMap, col) {
	return NUMERIC_TYPES.has(colMap.get(col)?.tipo);
}

function fechaClarionHoy() {
	const hoy = new Date();
	const s = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
	return convertirFechaAClarion(s);
}

// ───────────────────────────── sectores (NUBE) ─────────────────────────────

async function listarSectores(idEmpresa) {
	const rows = await mysqlQuery(
		`SELECT Valor, Descripcion, AmbInt FROM \`imSectores\` WHERE IdEmpresa = ? ORDER BY Descripcion`,
		[Number(idEmpresa)],
	);
	return rows.map((s) => ({
		id: String(s.Valor || '').trim(),
		descripcion: String(s.Descripcion || s.Valor || '').trim(),
		ambInt: s.AmbInt != null ? String(s.AmbInt).trim() : undefined,
	}));
}

async function crearSector(idEmpresa, { valor, descripcion, ambInt }) {
	const emp = Number(idEmpresa);
	const cod = String(valor || '').trim().toUpperCase().slice(0, 3);
	const desc = String(descripcion || '').trim();
	if (!cod || cod.length < 2) {
		const e = new Error('El código del sector es obligatorio (2-3 caracteres)');
		e.statusCode = 400;
		throw e;
	}
	if (!desc) {
		const e = new Error('La descripción del sector es obligatoria');
		e.statusCode = 400;
		throw e;
	}
	const dup = await mysqlQuery(
		`SELECT Valor FROM \`imSectores\` WHERE IdEmpresa = ? AND Valor = ? LIMIT 1`,
		[emp, cod],
	);
	if (dup.length) {
		const e = new Error('Ya existe un sector con ese código');
		e.statusCode = 409;
		throw e;
	}
	const amb = String(ambInt || 'A').trim().slice(0, 1) || 'A';
	const colMap = await columnasMeta('imSectores');
	const campos = ['IdEmpresa', 'Valor', 'Descripcion'];
	const valores = [emp, cod, desc];
	if (colMap.has('ValorServicio')) {
		campos.push('ValorServicio');
		valores.push(`${cod} `.slice(0, 4));
	}
	if (colMap.has('AmbInt')) {
		campos.push('AmbInt');
		valores.push(amb);
	}
	if (colMap.has('ProtocoloN')) {
		campos.push('ProtocoloN');
		valores.push(0);
	}
	completarObligatorias(colMap, campos, valores);
	await mysqlExec(
		`INSERT INTO \`imSectores\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${campos.map(() => '?').join(', ')})`,
		valores,
	);
	return { id: cod, descripcion: desc, ambInt: amb };
}

async function actualizarSector(idEmpresa, valor, { descripcion, ambInt }) {
	const emp = Number(idEmpresa);
	const id = String(valor || '').trim().toUpperCase();
	const desc = String(descripcion || '').trim();
	if (!desc) {
		const e = new Error('La descripción es obligatoria');
		e.statusCode = 400;
		throw e;
	}
	const amb = ambInt != null ? String(ambInt).trim().slice(0, 1) || 'A' : undefined;
	if (amb) {
		await mysqlExec(
			`UPDATE \`imSectores\` SET Descripcion = ?, AmbInt = ? WHERE IdEmpresa = ? AND Valor = ?`,
			[desc, amb, emp, id],
		);
	} else {
		await mysqlExec(
			`UPDATE \`imSectores\` SET Descripcion = ? WHERE IdEmpresa = ? AND Valor = ?`,
			[desc, emp, id],
		);
	}
	return { id, descripcion: desc, ambInt: amb || null };
}

async function eliminarSector(idEmpresa, valor) {
	const emp = Number(idEmpresa);
	const id = String(valor || '').trim().toUpperCase();
	const enUso = await mysqlQuery(
		`SELECT 1
     FROM \`imPersonalSectores\` ps
     INNER JOIN \`imPersonalEmpresas\` pe ON pe.IdPersonal = ps.idPersonal AND pe.IdEmpresa = ?
     WHERE ps.idSector = ? LIMIT 1`,
		[emp, id],
	);
	if (enUso.length) {
		const e = new Error('No se puede eliminar: el sector está asignado a personal');
		e.statusCode = 409;
		throw e;
	}
	await mysqlExec(`DELETE FROM \`imSectores\` WHERE IdEmpresa = ? AND Valor = ?`, [emp, id]);
	return { ok: true, id };
}

// ───────────────────────────── roles (NUBE) ─────────────────────────────

async function listarRoles() {
	const rows = await mysqlQuery(
		`SELECT IdRol, Nombre, Descripcion, Nivel FROM \`imRoles\` WHERE Activo = 1 ORDER BY Nivel DESC, Nombre`,
	);
	return rows
		.filter((r) => String(r.Nombre) !== 'SUPER_ADMIN')
		.map((r) => ({ idRol: r.IdRol, nombre: r.Nombre, descripcion: r.Descripcion, nivel: r.Nivel }));
}

// ───────────────────────────── usuarios (NUBE) ─────────────────────────────

async function listarUsuariosEmpresa(idEmpresa) {
	const id = Number(idEmpresa);
	const rows = await mysqlQuery(
		`
    SELECT
      pw.ValorPersonal AS IdPersonal, pw.NombreRed AS Usuario,
      pw.Nombres AS Nombre, pw.Apellido AS Apellido,
      pw.NumeroDocumento AS NumeroDocumento, pw.CodOperador AS CodOperador,
      r.IdRol AS IdRol, r.Nombre AS RolNombre
    FROM \`imPersonalEmpresas\` pe
    INNER JOIN \`imPassword\` pw ON pw.ValorPersonal = pe.IdPersonal
    LEFT JOIN \`imPersonal\` p ON p.Valor = pe.IdPersonal
    LEFT JOIN \`imRoles\` r
      ON CAST(r.IdRol AS CHAR) COLLATE ${COLLATE} = TRIM(p.Rol) COLLATE ${COLLATE} AND r.Activo = 1
    WHERE pe.IdEmpresa = ?
    ORDER BY pw.Apellido, pw.Nombres
    `,
		[id],
	);
	const usuarios = [];
	for (const r of rows) {
		const idPersonal = Number(r.IdPersonal);
		let sectores = [];
		try {
			const secRows = await mysqlQuery(
				`SELECT ps.idSector AS idSector, s.Descripcion AS descripcion
         FROM \`imPersonalSectores\` ps
         LEFT JOIN \`imSectores\` s
           ON s.Valor COLLATE ${COLLATE} = ps.idSector COLLATE ${COLLATE}
          AND s.IdEmpresa = ?
         WHERE ps.idPersonal = ?`,
				[id, idPersonal],
			);
			sectores = (secRows || []).map((s) => ({
				id: String(s.idSector || ''),
				descripcion: String(s.descripcion || s.idSector || ''),
			}));
		} catch {
			sectores = [];
		}
		usuarios.push({
			idPersonal,
			usuario: String(r.Usuario || '').trim(),
			nombre: String(r.Nombre || '').trim(),
			apellido: String(r.Apellido || '').trim(),
			numeroDocumento: String(r.NumeroDocumento || '').trim(),
			codOperador: r.CodOperador,
			idRol: r.IdRol != null ? Number(r.IdRol) : null,
			rol: r.RolNombre || null,
			activo: true,
			sectores,
		});
	}
	return usuarios;
}

async function siguienteValorPersonal() {
	const rows = await mysqlQuery(`SELECT COALESCE(MAX(ValorPersonal), 1000000) + 1 AS v FROM \`imPassword\``);
	return Number(rows[0]?.v) || 1000001;
}

async function asegurarFichaPersonal(valorPersonal, { apellido, nombres, numeroDocumento, idRol }) {
	const existe = await mysqlQuery(`SELECT Valor FROM \`imPersonal\` WHERE Valor = ? LIMIT 1`, [valorPersonal]);
	const colMap = await columnasMeta('imPersonal');
	const apellidoNombre = `${String(apellido || '').trim()}, ${String(nombres || '').trim()}`
		.replace(/^,\s*|,\s*$/g, '');

	if (existe.length) {
		if (idRol != null && colMap.has('Rol')) {
			await mysqlExec(`UPDATE \`imPersonal\` SET Rol = ? WHERE Valor = ?`, [String(idRol), valorPersonal]);
		}
		return;
	}

	const campos = ['Valor'];
	const valores = [valorPersonal];
	if (colMap.has('Rol')) { campos.push('Rol'); valores.push(idRol != null ? String(idRol) : ''); }
	if (colMap.has('Matricula')) { campos.push('Matricula'); valores.push(valorPersonal); }
	if (colMap.has('ApellidoNombre')) { campos.push('ApellidoNombre'); valores.push(apellidoNombre || `Usuario ${valorPersonal}`); }
	if (colMap.has('Numero')) {
		const num = numeroDocumento != null && String(numeroDocumento).trim() !== ''
			? Number(String(numeroDocumento).replace(/\D/g, '')) : null;
		campos.push('Numero');
		valores.push(esNumerica(colMap, 'Numero') ? (Number.isFinite(num) ? num : 0) : String(num || ''));
	}
	if (colMap.has('Estado')) { campos.push('Estado'); valores.push(1); }
	completarObligatorias(colMap, campos, valores);
	await mysqlExec(
		`INSERT INTO \`imPersonal\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${campos.map(() => '?').join(', ')})`,
		valores,
	);
}

async function vincularUsuarioEmpresa(idEmpresa, valorPersonal) {
	await mysqlExec(
		`INSERT INTO \`imPersonalEmpresas\` (IdPersonal, IdEmpresa)
     SELECT ?, ? FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM \`imPersonalEmpresas\` WHERE IdPersonal = ? AND IdEmpresa = ?)`,
		[valorPersonal, Number(idEmpresa), valorPersonal, Number(idEmpresa)],
	);
}

async function crearUsuarioEmpresa(idEmpresa, body) {
	const { nombreRed, password, apellido, nombres, numeroDocumento, legajo, codOperador, idRol, sectores } = body;
	if (!nombreRed?.trim() || !password?.trim()) {
		const e = new Error('Usuario de red y contraseña son obligatorios');
		e.statusCode = 400;
		throw e;
	}
	if (!apellido?.trim() || !nombres?.trim()) {
		const e = new Error('Apellido y nombres son obligatorios');
		e.statusCode = 400;
		throw e;
	}

	const dup = await mysqlQuery(
		`SELECT ValorPersonal FROM \`imPassword\` WHERE LOWER(TRIM(NombreRed)) = LOWER(TRIM(?)) LIMIT 1`,
		[nombreRed.trim()],
	);
	if (dup.length) {
		const e = new Error('Ya existe un usuario con ese nombre de acceso (NombreRed). Elegí otro.');
		e.statusCode = 409;
		throw e;
	}

	const valorPersonal = await siguienteValorPersonal();
	const colMap = await columnasMeta('imPassword');
	const campos = ['ValorPersonal', 'NombreRed', 'Password', 'Apellido', 'Nombres'];
	const valores = [valorPersonal, nombreRed.trim(), password.trim(), apellido.trim(), nombres.trim()];
	if (colMap.has('NumeroDocumento')) { campos.push('NumeroDocumento'); valores.push(numeroDocumento || ''); }
	if (colMap.has('Legajo')) { campos.push('Legajo'); valores.push(legajo || ''); }
	if (colMap.has('CodOperador')) {
		campos.push('CodOperador');
		valores.push(esNumerica(colMap, 'CodOperador') ? (Number(codOperador) || valorPersonal) : (codOperador || ''));
	}
	if (colMap.has('Grupo')) { campos.push('Grupo'); valores.push(0); }
	if (colMap.has('MarcadeBaja')) { campos.push('MarcadeBaja'); valores.push('0'); }
	if (colMap.has('FechaActual')) {
		campos.push('FechaActual');
		valores.push(esNumerica(colMap, 'FechaActual') ? fechaClarionHoy() : new Date());
	}
	completarObligatorias(colMap, campos, valores);
	await mysqlExec(
		`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${campos.map(() => '?').join(', ')})`,
		valores,
	);

	await asegurarFichaPersonal(valorPersonal, { apellido, nombres, numeroDocumento, idRol });
	await vincularUsuarioEmpresa(idEmpresa, valorPersonal);

	for (const idSector of sectores || []) {
		try {
			await mysqlExec(
				`INSERT INTO \`imPersonalSectores\` (idPersonal, idSector)
         SELECT ?, ? FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM \`imPersonalSectores\` WHERE idPersonal = ? AND idSector = ?)`,
				[valorPersonal, String(idSector), valorPersonal, String(idSector)],
			);
		} catch (e) {
			console.warn('[nube] asignar sector', idSector, e.message);
		}
	}

	const lista = await listarUsuariosEmpresa(idEmpresa);
	return lista.find((u) => u.idPersonal === valorPersonal) || lista[lista.length - 1];
}

async function actualizarUsuarioEmpresa(idEmpresa, idPersonal, body) {
	const id = Number(idPersonal);
	const vinc = await mysqlQuery(
		`SELECT 1 FROM \`imPersonalEmpresas\` WHERE IdEmpresa = ? AND IdPersonal = ? LIMIT 1`,
		[Number(idEmpresa), id],
	);
	if (!vinc.length) {
		const e = new Error('El usuario no está vinculado a esta empresa');
		e.statusCode = 404;
		throw e;
	}

	const colMap = await columnasMeta('imPassword');
	const sets = [];
	const params = [];
	const set = (col, v) => { if (colMap.has(col)) { sets.push(`\`${col}\` = ?`); params.push(v); } };
	if (body.nombreRed != null) set('NombreRed', String(body.nombreRed).trim());
	if (body.apellido != null) set('Apellido', String(body.apellido).trim());
	if (body.nombres != null) set('Nombres', String(body.nombres).trim());
	if (body.numeroDocumento != null) set('NumeroDocumento', String(body.numeroDocumento));
	if (body.password?.trim()) set('Password', body.password.trim());
	if (sets.length) {
		params.push(id);
		await mysqlExec(`UPDATE \`imPassword\` SET ${sets.join(', ')} WHERE ValorPersonal = ?`, params);
	}

	if (body.idRol != null && body.idRol !== '') {
		const pcols = await columnasMeta('imPersonal');
		if (pcols.has('Rol')) {
			await mysqlExec(`UPDATE \`imPersonal\` SET Rol = ? WHERE Valor = ?`, [String(body.idRol), id]);
		}
	}

	if (Array.isArray(body.sectores)) {
		await mysqlExec(`DELETE FROM \`imPersonalSectores\` WHERE idPersonal = ?`, [id]);
		for (const idSector of body.sectores) {
			try {
				await mysqlExec(`INSERT INTO \`imPersonalSectores\` (idPersonal, idSector) VALUES (?, ?)`, [id, String(idSector)]);
			} catch (e) {
				console.warn('[nube] reasignar sector', idSector, e.message);
			}
		}
	}

	const lista = await listarUsuariosEmpresa(idEmpresa);
	return lista.find((u) => u.idPersonal === id) || null;
}

async function desvincularUsuarioEmpresa(idEmpresa, idPersonal) {
	await mysqlExec(`DELETE FROM \`imPersonalEmpresas\` WHERE IdEmpresa = ? AND IdPersonal = ?`, [
		Number(idEmpresa),
		Number(idPersonal),
	]);
	return listarUsuariosEmpresa(idEmpresa);
}

// ───────────────────────────── importación FÍSICO → NUBE ─────────────────────────────

async function sqlServerColumnas(pool, tabla) {
	const r = await pool.request().input('t', tabla).query(
		`SELECT COLUMN_NAME AS col FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t`,
	);
	return (r.recordset || []).map((x) => String(x.col));
}

async function sqlServerContar(pool, tabla) {
	try {
		const r = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.[${tabla}]`);
		return Number(r.recordset?.[0]?.n) || 0;
	} catch {
		return null;
	}
}

/** Lista las tablas importables con conteo en origen (SQL Server) y si existen en destino (MySQL). */
async function listarTablasImportables(idEmpresa) {
	const pool = await getTenantPool(Number(idEmpresa));
	const destinoTablas = new Set(
		(await mysqlQuery(
			`SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
		)).map((r) => String(r.n).toLowerCase()),
	);

	const resultado = [];
	for (const t of TABLAS_IMPORTABLES) {
		const esNube = t.estrategia === 'nube';
		const cols = esNube ? [] : await sqlServerColumnas(pool, t.tabla).catch(() => []);
		const existeOrigen = cols.length > 0;
		resultado.push({
			tabla: t.tabla,
			label: t.label,
			estrategia: t.estrategia,
			existeOrigen,
			existeDestino: destinoTablas.has(t.tabla.toLowerCase()),
			filasOrigen: existeOrigen ? await sqlServerContar(pool, t.tabla) : 0,
			// Si es global de plataforma o no existe en el físico, se toma de Railway.
			desdeNube: esNube || (!existeOrigen && destinoTablas.has(t.tabla.toLowerCase())),
		});
	}
	return resultado;
}

function chunk(arr, size) {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/**
 * Copia (snapshot, re-ejecutable con upsert) las tablas seleccionadas de SQL Server → MySQL.
 * - Catálogos globales (roles/permisos/IVA) NO se copian: se usan los de Railway.
 * - Tablas que no existan en el físico se conservan desde la nube (no fallan).
 * - Datos de empresa: se remapean IDs de persona (offset por empresa) y se fuerza IdEmpresa,
 *   de modo que lo importado quede aislado y vinculado a la empresa destino.
 */
async function importarTablas(idEmpresa, tablas) {
	const emp = Number(idEmpresa);
	const offset = offsetEmpresa(emp);

	// Se agrega siempre el vínculo usuario-empresa para que el login funcione.
	const pedidas = (Array.isArray(tablas) ? tablas : []).map((t) => String(t));
	const seleccion = TABLAS_IMPORTABLES
		.map((x) => x.tabla)
		.filter((t) => pedidas.some((p) => p.toLowerCase() === t.toLowerCase()) || t === 'imPersonalEmpresas');
	if (!seleccion.length) {
		const e = new Error('No se seleccionaron tablas válidas para importar');
		e.statusCode = 400;
		throw e;
	}

	const pool = await getTenantPool(emp);
	const resultados = [];

	for (const tabla of seleccion) {
		const cfg = configTabla(tabla) || {};
		const res = { tabla, estrategia: cfg.estrategia, leidas: 0, escritas: 0, omitida: false, nota: null, error: null };

		// Catálogos globales de plataforma: siempre desde la nube.
		if (cfg.estrategia === 'nube') {
			res.omitida = true;
			res.nota = 'Catálogo de plataforma: se usan los datos de la nube (Railway)';
			resultados.push(res);
			continue;
		}

		try {
			const destinoMeta = await columnasMeta(tabla);
			if (!destinoMeta.size) throw new Error(`La tabla ${tabla} no existe en la nube (Railway)`);

			const origenCols = await sqlServerColumnas(pool, tabla).catch(() => []);
			if (!origenCols.length) {
				// Punto 1: si no está en el físico, se conserva lo de la nube.
				res.omitida = true;
				res.nota = 'No existe en el servidor físico: se conservan los datos de la nube';
				resultados.push(res);
				continue;
			}

			const destinoPorLower = new Map([...destinoMeta.keys()].map((c) => [c.toLowerCase(), c]));
			const comunes = [];
			for (const oc of origenCols) {
				const destCol = destinoPorLower.get(oc.toLowerCase());
				if (destCol) comunes.push({ origen: oc, destino: destCol });
			}

			const remap = new Set((cfg.remapPersona || []).map((c) => c.toLowerCase()));
			const forzar = (cfg.forzarEmpresa || []).filter((c) => destinoPorLower.has(c.toLowerCase()));
			const forzarReal = forzar.map((c) => destinoPorLower.get(c.toLowerCase()));
			// Columnas forzadas que no vienen del origen no deben duplicarse en la lista común.
			const comunesFiltradas = comunes.filter(
				(c) => !forzarReal.some((f) => f.toLowerCase() === c.destino.toLowerCase()),
			);

			if (!comunesFiltradas.length && !forzarReal.length) {
				throw new Error(`Sin columnas en común entre origen y nube para ${tabla}`);
			}

			const data = await pool.request().query(`SELECT * FROM dbo.[${tabla}]`);
			const filas = data.recordset || [];
			res.leidas = filas.length;
			if (!filas.length) { resultados.push(res); continue; }

			const colDest = [...comunesFiltradas.map((c) => c.destino), ...forzarReal];
			const placeholdersFila = `(${colDest.map(() => '?').join(', ')})`;
			const updates = colDest.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');
			const colList = colDest.map((c) => `\`${c}\``).join(', ');

			for (const lote of chunk(filas, 200)) {
				const flat = [];
				for (const fila of lote) {
					for (const c of comunesFiltradas) {
						let v = fila[c.origen];
						if (v === undefined) v = null;
						if (remap.has(c.destino.toLowerCase()) && v != null && Number.isFinite(Number(v))) {
							v = offset + Number(v);
						}
						flat.push(v);
					}
					for (let i = 0; i < forzarReal.length; i++) flat.push(emp);
				}
				const valuesSql = lote.map(() => placeholdersFila).join(', ');
				const r = await mysqlExec(
					`INSERT INTO \`${tabla}\` (${colList}) VALUES ${valuesSql}
           ON DUPLICATE KEY UPDATE ${updates}`,
					flat,
				);
				res.escritas += Number(r?.affectedRows) || lote.length;
			}
		} catch (e) {
			res.error = e.message;
		}
		resultados.push(res);
	}

	return { idEmpresa: emp, resultados };
}

module.exports = {
	TABLAS_IMPORTABLES,
	listarSectores,
	crearSector,
	actualizarSector,
	eliminarSector,
	listarRoles,
	listarUsuariosEmpresa,
	crearUsuarioEmpresa,
	actualizarUsuarioEmpresa,
	desvincularUsuarioEmpresa,
	vincularUsuarioEmpresa,
	listarTablasImportables,
	importarTablas,
};
