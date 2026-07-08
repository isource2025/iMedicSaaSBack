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
 * Estrategias de importación FÍSICO → NUBE:
 *  - 'nube'   : catálogo GLOBAL de plataforma (roles/permisos/IVA). No se copia del físico.
 *  - 'tenant' : datos propios de la empresa. Se copian con el mismo id del físico y IdEmpresa.
 *  - 'vinculo': imPersonalEmpresas generado desde el personal importado.
 */
const TABLAS_IMPORTABLES = [
	{ tabla: 'imRoles', label: 'Roles', estrategia: 'nube' },
	{ tabla: 'imPermisos', label: 'Permisos', estrategia: 'nube' },
	{ tabla: 'imRolPermisos', label: 'Permisos por rol', estrategia: 'nube' },
	{ tabla: 'imIVA', label: 'Condiciones de IVA', estrategia: 'nube' },
	{ tabla: 'imSectores', label: 'Sectores', estrategia: 'tenant', forzarEmpresa: ['IdEmpresa'] },
	{
		tabla: 'imPersonal',
		label: 'Personal',
		estrategia: 'tenant',
		forzarEmpresa: ['IdEmpresa'],
		// Solo campos de auth en Railway; lo clínico completo queda en el físico.
		soloColumnas: ['Valor', 'Rol', 'Matricula', 'Numero', 'ApellidoNombre', 'Estado', 'TipoDocumento'],
	},
	{ tabla: 'imPassword', label: 'Usuarios de acceso', estrategia: 'tenant', forzarEmpresa: ['IdEmpresa'] },
	{ tabla: 'imPersonalSectores', label: 'Sectores por personal', estrategia: 'tenant', forzarEmpresa: ['IdEmpresa'] },
	{ tabla: 'imPersonalEmpresas', label: 'Vínculo usuario-empresa', estrategia: 'vinculo' },
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
const BINARY_TYPES = new Set(['blob', 'mediumblob', 'longblob', 'tinyblob', 'binary', 'varbinary']);

/** Columnas que nunca se copian al importar (binarios / clínico pesado). */
const COLUMNAS_EXCLUIR_IMPORT = new Set(['firma', 'foto', 'imagen', 'observaciones']);

function sanitizarValorImport(v, meta) {
	if (v === undefined) return null;
	if (Buffer.isBuffer(v)) return null;
	if (v instanceof Date) return v;
	if (meta && BINARY_TYPES.has(meta.tipo)) return null;
	if (meta && NUMERIC_TYPES.has(meta.tipo)) {
		if (v === null || v === '') return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return v;
}

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

/** Convierte valores para UPDATE/INSERT según el tipo real de la columna en MySQL. */
function valorCampoSegunTipo(colMap, col, raw) {
	if (raw == null) return null;
	if (!colMap.has(col)) return raw;
	if (esNumerica(colMap, col)) {
		const s = String(raw).trim();
		if (s === '') return null;
		const n = Number(s.replace(/\D/g, ''));
		return Number.isFinite(n) ? n : null;
	}
	const s = String(raw).trim();
	return s === '' ? null : s;
}

async function esRolAdmin(idRol) {
	if (idRol == null || idRol === '' || Number(idRol) === 0) return false;
	if (Number(idRol) === 1) return true;
	const rows = await mysqlQuery(
		`SELECT Nombre FROM \`imRoles\` WHERE IdRol = ? AND Activo = 1 LIMIT 1`,
		[Number(idRol)],
	);
	return String(rows[0]?.Nombre || '').toUpperCase() === 'ADMIN';
}

/** ADMIN recibe todos los sectores de la empresa; el resto usa la lista enviada. */
async function resolverSectoresUsuario(idEmpresa, idRol, sectores) {
	if (await esRolAdmin(idRol)) {
		const todos = await listarSectores(idEmpresa);
		return todos.map((s) => s.id);
	}
	return Array.isArray(sectores) ? sectores.map(String) : null;
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
		`SELECT 1 FROM \`imPersonalSectores\` WHERE IdEmpresa = ? AND idSector = ? LIMIT 1`,
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
    INNER JOIN \`imPassword\` pw
      ON pw.ValorPersonal = pe.IdPersonal AND pw.IdEmpresa = pe.IdEmpresa
    LEFT JOIN \`imPersonal\` p
      ON p.Valor = pe.IdPersonal AND p.IdEmpresa = pe.IdEmpresa
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
          AND s.IdEmpresa = ps.IdEmpresa
         WHERE ps.IdEmpresa = ? AND ps.idPersonal = ?`,
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

async function siguienteValorPersonal(idEmpresa) {
	const rows = await mysqlQuery(
		`SELECT COALESCE(MAX(ValorPersonal), 1000000) + 1 AS v FROM \`imPassword\` WHERE IdEmpresa = ?`,
		[Number(idEmpresa)],
	);
	return Number(rows[0]?.v) || 1000001;
}

async function asegurarFichaPersonal(idEmpresa, valorPersonal, { apellido, nombres, numeroDocumento, idRol }) {
	const emp = Number(idEmpresa);
	const existe = await mysqlQuery(
		`SELECT Valor FROM \`imPersonal\` WHERE IdEmpresa = ? AND Valor = ? LIMIT 1`,
		[emp, valorPersonal],
	);
	const colMap = await columnasMeta('imPersonal');
	const apellidoNombre = `${String(apellido || '').trim()}, ${String(nombres || '').trim()}`
		.replace(/^,\s*|,\s*$/g, '');

	if (existe.length) {
		if (idRol != null && colMap.has('Rol')) {
			await mysqlExec(`UPDATE \`imPersonal\` SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?`, [
				String(idRol), emp, valorPersonal,
			]);
		}
		return;
	}

	const campos = ['IdEmpresa', 'Valor'];
	const valores = [emp, valorPersonal];
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
	const emp = Number(idEmpresa);
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
		`SELECT ValorPersonal FROM \`imPassword\`
     WHERE IdEmpresa = ? AND LOWER(TRIM(NombreRed)) = LOWER(TRIM(?)) LIMIT 1`,
		[emp, nombreRed.trim()],
	);
	if (dup.length) {
		const e = new Error('Ya existe un usuario con ese nombre de acceso en esta empresa. Elegí otro.');
		e.statusCode = 409;
		throw e;
	}

	const valorPersonal = await siguienteValorPersonal(emp);
	const colMap = await columnasMeta('imPassword');
	const campos = ['IdEmpresa', 'ValorPersonal', 'NombreRed', 'Password', 'Apellido', 'Nombres'];
	const valores = [emp, valorPersonal, nombreRed.trim(), password.trim(), apellido.trim(), nombres.trim()];
	if (colMap.has('NumeroDocumento')) {
		campos.push('NumeroDocumento');
		valores.push(valorCampoSegunTipo(colMap, 'NumeroDocumento', numeroDocumento));
	}
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

	await asegurarFichaPersonal(emp, valorPersonal, { apellido, nombres, numeroDocumento, idRol });
	await vincularUsuarioEmpresa(emp, valorPersonal);

	for (const idSector of (await resolverSectoresUsuario(emp, idRol, sectores)) || []) {
		try {
			await mysqlExec(
				`INSERT INTO \`imPersonalSectores\` (IdEmpresa, idPersonal, idSector)
         SELECT ?, ?, ? FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM \`imPersonalSectores\`
           WHERE IdEmpresa = ? AND idPersonal = ? AND idSector = ?
         )`,
				[emp, valorPersonal, String(idSector), emp, valorPersonal, String(idSector)],
			);
		} catch (e) {
			console.warn('[nube] asignar sector', idSector, e.message);
		}
	}

	const lista = await listarUsuariosEmpresa(idEmpresa);
	return lista.find((u) => u.idPersonal === valorPersonal) || lista[lista.length - 1];
}

async function actualizarUsuarioEmpresa(idEmpresa, idPersonal, body) {
	const emp = Number(idEmpresa);
	const id = Number(idPersonal);
	const vinc = await mysqlQuery(
		`SELECT 1 FROM \`imPersonalEmpresas\` WHERE IdEmpresa = ? AND IdPersonal = ? LIMIT 1`,
		[emp, id],
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
	if (body.nombreRed != null) set('NombreRed', valorCampoSegunTipo(colMap, 'NombreRed', body.nombreRed));
	if (body.apellido != null) set('Apellido', valorCampoSegunTipo(colMap, 'Apellido', body.apellido));
	if (body.nombres != null) set('Nombres', valorCampoSegunTipo(colMap, 'Nombres', body.nombres));
	if (body.numeroDocumento != null) {
		set('NumeroDocumento', valorCampoSegunTipo(colMap, 'NumeroDocumento', body.numeroDocumento));
	}
	if (body.password?.trim()) set('Password', body.password.trim());
	if (sets.length) {
		params.push(emp, id);
		await mysqlExec(`UPDATE \`imPassword\` SET ${sets.join(', ')} WHERE IdEmpresa = ? AND ValorPersonal = ?`, params);
	}

	if (body.idRol != null && body.idRol !== '') {
		const pcols = await columnasMeta('imPersonal');
		if (pcols.has('Rol')) {
			await mysqlExec(`UPDATE \`imPersonal\` SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?`, [
				String(body.idRol), emp, id,
			]);
		}
	}

	const sectoresAsignar = await resolverSectoresUsuario(emp, body.idRol, body.sectores);
	if (sectoresAsignar != null) {
		await mysqlExec(`DELETE FROM \`imPersonalSectores\` WHERE IdEmpresa = ? AND idPersonal = ?`, [emp, id]);
		for (const idSector of sectoresAsignar) {
			try {
				await mysqlExec(
					`INSERT INTO \`imPersonalSectores\` (IdEmpresa, idPersonal, idSector) VALUES (?, ?, ?)`,
					[emp, id, String(idSector)],
				);
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
		// Los catálogos globales de plataforma (roles/permisos/IVA) y el vínculo auto-generado
		// no se listan: se usan/arman desde la nube y no hay nada que buscar en el físico.
		if (t.estrategia !== 'tenant') continue;
		const cols = await sqlServerColumnas(pool, t.tabla).catch(() => []);
		const existeOrigen = cols.length > 0;
		resultado.push({
			tabla: t.tabla,
			label: t.label,
			estrategia: t.estrategia,
			existeOrigen,
			existeDestino: destinoTablas.has(t.tabla.toLowerCase()),
			filasOrigen: existeOrigen ? await sqlServerContar(pool, t.tabla) : 0,
			desdeNube: !existeOrigen && destinoTablas.has(t.tabla.toLowerCase()),
		});
	}
	return resultado;
}

function chunk(arr, size) {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/** Normaliza un valor de SQL Server a algo serializable/legible para el preview. */
function valorPreview(v) {
	if (v == null) return null;
	if (Buffer.isBuffer(v)) return `«binario ${v.length} bytes»`;
	if (v instanceof Date) return v.toISOString();
	if (typeof v === 'object') return JSON.stringify(v);
	return v;
}

/** Devuelve las primeras filas de una tabla del SQL Server físico para previsualizar. */
async function previewTabla(idEmpresa, tabla, limite = 50) {
	const cfg = configTabla(tabla);
	if (!cfg) {
		const e = new Error('Tabla no válida para previsualizar');
		e.statusCode = 400;
		throw e;
	}
	if (cfg.estrategia !== 'tenant') {
		return {
			tabla,
			label: cfg.label,
			estrategia: cfg.estrategia,
			total: null,
			columnas: [],
			filas: [],
			nota: 'Catálogo de plataforma: los datos se toman de la nube (Railway), no del servidor físico.',
		};
	}

	const pool = await getTenantPool(Number(idEmpresa));
	const cols = await sqlServerColumnas(pool, tabla).catch(() => []);
	if (!cols.length) {
		return {
			tabla,
			label: cfg.label,
			estrategia: cfg.estrategia,
			total: 0,
			columnas: [],
			filas: [],
			nota: 'La tabla no existe en el servidor físico; al importar se conservan los datos de la nube.',
		};
	}

	const lim = Math.min(Math.max(Number(limite) || 50, 1), 200);
	const data = await pool.request().query(`SELECT TOP ${lim} * FROM dbo.[${tabla}]`);
	const filas = (data.recordset || []).map((row) => {
		const out = {};
		for (const c of cols) out[c] = valorPreview(row[c]);
		return out;
	});
	return {
		tabla,
		label: cfg.label,
		estrategia: cfg.estrategia,
		total: await sqlServerContar(pool, tabla),
		columnas: cols,
		filas,
	};
}

/**
 * Copia (snapshot, re-ejecutable con upsert) las tablas seleccionadas de SQL Server → MySQL.
 * - Catálogos globales (roles/permisos/IVA) NO se copian: se usan los de Railway.
 * - Tablas que no existan en el físico se conservan desde la nube (no fallan).
 * - Datos de empresa: se copian con el mismo id del físico y IdEmpresa destino.
 */
async function importarTablas(idEmpresa, tablas) {
	const emp = Number(idEmpresa);

	const pedidas = (Array.isArray(tablas) ? tablas : []).map((t) => String(t).toLowerCase());
	const pidePersonal = pedidas.includes('impassword') || pedidas.includes('impersonal');
	const seleccion = TABLAS_IMPORTABLES
		.map((x) => x.tabla)
		.filter((t) => {
			const cfg = configTabla(t);
			// Se genera el vínculo usuario-empresa solo si se importó personal/usuarios.
			if (cfg?.estrategia === 'vinculo') return pidePersonal;
			return pedidas.includes(t.toLowerCase());
		});
	if (!seleccion.length) {
		const e = new Error('No se seleccionaron tablas válidas para importar');
		e.statusCode = 400;
		throw e;
	}

	console.log(`[import] empresa ${emp}: conectando al servidor físico…`);
	let pool;
	try {
		pool = await getTenantPool(emp);
	} catch (e) {
		console.error(`[import] empresa ${emp}: no se pudo conectar al servidor físico:`, e.message);
		const err = new Error(`No se pudo conectar al servidor físico de la empresa: ${e.message}`);
		err.statusCode = 502;
		throw err;
	}
	console.log(`[import] empresa ${emp}: conectado. Tablas a procesar:`, seleccion.join(', '));
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

		// Vínculo usuario↔empresa: se GENERA a partir del personal del físico (el físico no
		// mantiene imPersonalEmpresas). Sin esto los usuarios importados no podrían loguearse.
		if (cfg.estrategia === 'vinculo') {
			try {
				const tienePass = (await sqlServerColumnas(pool, 'imPassword').catch(() => [])).length > 0;
				const fuente = tienePass ? 'imPassword' : 'imPersonal';
				const idCol = tienePass ? 'ValorPersonal' : 'Valor';
				const data = await pool.request().query(`SELECT [${idCol}] AS pid FROM dbo.[${fuente}]`);
				const ids = [...new Set(
					(data.recordset || []).map((r) => Number(r.pid)).filter((n) => Number.isFinite(n) && n > 0),
				)];
				res.leidas = ids.length;
				for (const lote of chunk(ids, 500)) {
					const flat = [];
					for (const pid of lote) flat.push(pid, emp);
					const valuesSql = lote.map(() => '(?, ?)').join(', ');
					const r = await mysqlExec(
						`INSERT INTO \`imPersonalEmpresas\` (IdPersonal, IdEmpresa) VALUES ${valuesSql}
             ON DUPLICATE KEY UPDATE IdEmpresa = VALUES(IdEmpresa)`,
						flat,
					);
					res.escritas += Number(r?.affectedRows) || lote.length;
				}
				res.nota = 'Vínculos generados desde el personal importado';
			} catch (e) {
				res.error = e.message;
			}
			console.log(`[import] empresa ${emp}: ${res.tabla} (vínculo) → generados=${res.escritas}` +
				`${res.error ? ` ERROR: ${res.error}` : ''}`);
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

			const forzar = (cfg.forzarEmpresa || []).filter((c) => destinoPorLower.has(c.toLowerCase()));
			const forzarReal = forzar.map((c) => destinoPorLower.get(c.toLowerCase()));
			const soloSet = cfg.soloColumnas
				? new Set(cfg.soloColumnas.map((c) => c.toLowerCase()))
				: null;
			let comunesFiltradas = comunes.filter(
				(c) =>
					!forzarReal.some((f) => f.toLowerCase() === c.destino.toLowerCase()) &&
					!COLUMNAS_EXCLUIR_IMPORT.has(c.destino.toLowerCase()) &&
					(!soloSet || soloSet.has(c.destino.toLowerCase()) || soloSet.has(c.origen.toLowerCase())),
			);

			if (!comunesFiltradas.length && !forzarReal.length) {
				throw new Error(`Sin columnas en común entre origen y nube para ${tabla}`);
			}

			const selectCols = comunesFiltradas.map((c) => `[${c.origen}]`).join(', ');
			const data = await pool.request().query(`SELECT ${selectCols} FROM dbo.[${tabla}]`);
			const filas = data.recordset || [];
			res.leidas = filas.length;
			if (!filas.length) { resultados.push(res); continue; }

			const colDest = [...comunesFiltradas.map((c) => c.destino), ...forzarReal];
			const placeholdersFila = `(${colDest.map(() => '?').join(', ')})`;
			const updates = colDest.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ');
			const colList = colDest.map((c) => `\`${c}\``).join(', ');
			const loteSize = tabla.toLowerCase() === 'impersonal' ? 25 : 100;

			for (const lote of chunk(filas, loteSize)) {
				const flat = [];
				for (const fila of lote) {
					for (const c of comunesFiltradas) {
						const meta = destinoMeta.get(c.destino);
						flat.push(sanitizarValorImport(fila[c.origen], meta));
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
			console.error(`[import] empresa ${emp}: ${tabla} ERROR:`, e.message, e.stack);
		}
		console.log(`[import] empresa ${emp}: ${res.tabla} → leidas=${res.leidas} escritas=${res.escritas}` +
			`${res.omitida ? ' (omitida)' : ''}${res.error ? ` ERROR: ${res.error}` : ''}`);
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
	asegurarFichaPersonal,
	crearUsuarioEmpresa,
	actualizarUsuarioEmpresa,
	desvincularUsuarioEmpresa,
	vincularUsuarioEmpresa,
	resolverSectoresUsuario,
	esRolAdmin,
	listarTablasImportables,
	previewTabla,
	importarTablas,
};
