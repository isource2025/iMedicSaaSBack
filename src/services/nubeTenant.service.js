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
		// Campos exportables / sync FÍSICO → NUBE (alineado a personalExportFields).
		soloColumnas: [
			'Valor',
			'Rol',
			'Matricula',
			'Numero',
			'ApellidoNombre',
			'TipoDocumento',
			'MatriculaNacional',
			'ValorEspecialidad',
			'ValorServicio',
			'ValorServicioParaFacturar',
			'ValorCategoria',
			'Telefono',
			'CUIT',
			'Domicilio',
			'Estado',
		],
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
		if (BINARY_TYPES.has(meta.tipo)) continue;
		if (COLUMNAS_EXCLUIR_IMPORT.has(meta.nombre.toLowerCase())) continue;
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

/** Si mandan lista (aunque vacía), esa es la asignación. ADMIN solo recibe todos si no mandaron lista. */
async function resolverSectoresUsuario(idEmpresa, idRol, sectores) {
	if (Array.isArray(sectores)) return sectores.map(String);
	if (await esRolAdmin(idRol)) {
		const todos = await listarSectores(idEmpresa);
		return todos.map((s) => s.id);
	}
	return null;
}

async function resolverServiciosUsuario(idEmpresa, idRol, servicios) {
	if (Array.isArray(servicios)) return servicios.map(String);
	if (await esRolAdmin(idRol)) {
		const todos = await listarServicios(idEmpresa);
		return todos.map((s) => s.id);
	}
	return null;
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

// ───────────────────────────── servicios (NUBE) ─────────────────────────────

async function ensureServiciosTables(idEmpresa) {
	const emp = Number(idEmpresa);
	await mysqlExec(
		`CREATE TABLE IF NOT EXISTS \`imServicios\` (
			\`IdEmpresa\` INT NOT NULL,
			\`Valor\` VARCHAR(20) NOT NULL,
			\`Descripcion\` VARCHAR(200) NULL,
			PRIMARY KEY (\`IdEmpresa\`, \`Valor\`)
		)`,
	);
	await mysqlExec(
		`CREATE TABLE IF NOT EXISTS \`imPersonalServicios\` (
			\`IdEmpresa\` INT NOT NULL,
			\`idPersonal\` INT NOT NULL,
			\`idServicio\` VARCHAR(50) NOT NULL,
			PRIMARY KEY (\`IdEmpresa\`, \`idPersonal\`, \`idServicio\`)
		)`,
	);
	await mysqlExec(
		`ALTER TABLE \`imPersonalServicios\` MODIFY idServicio VARCHAR(50) NOT NULL`,
	).catch(() => {});
	return emp;
}

async function listarServicios(idEmpresa) {
	const emp = await ensureServiciosTables(idEmpresa);
	const rows = await mysqlQuery(
		`SELECT Valor, Descripcion FROM \`imServicios\` WHERE IdEmpresa = ? ORDER BY Descripcion`,
		[emp],
	);
	return rows.map((s) => ({
		id: String(s.Valor || '').trim(),
		descripcion: String(s.Descripcion || s.Valor || '').trim(),
	}));
}

async function crearServicio(idEmpresa, { valor, descripcion }) {
	const emp = await ensureServiciosTables(idEmpresa);
	const cod = String(valor || '').trim().toUpperCase().slice(0, 20);
	const desc = String(descripcion || '').trim();
	if (!cod) {
		const e = new Error('El código del servicio es obligatorio');
		e.statusCode = 400;
		throw e;
	}
	if (!desc) {
		const e = new Error('La descripción del servicio es obligatoria');
		e.statusCode = 400;
		throw e;
	}
	const dup = await mysqlQuery(
		`SELECT Valor FROM \`imServicios\` WHERE IdEmpresa = ? AND Valor = ? LIMIT 1`,
		[emp, cod],
	);
	if (dup.length) {
		const e = new Error('Ya existe un servicio con ese código');
		e.statusCode = 409;
		throw e;
	}
	const colMap = await columnasMeta('imServicios');
	const campos = ['IdEmpresa', 'Valor', 'Descripcion'];
	const valores = [emp, cod, desc];
	completarObligatorias(colMap, campos, valores);
	await mysqlExec(
		`INSERT INTO \`imServicios\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${campos.map(() => '?').join(', ')})`,
		valores,
	);
	return { id: cod, descripcion: desc };
}

async function actualizarServicio(idEmpresa, valor, { descripcion }) {
	const emp = await ensureServiciosTables(idEmpresa);
	const id = String(valor || '').trim().toUpperCase();
	const desc = String(descripcion || '').trim();
	if (!desc) {
		const e = new Error('La descripción es obligatoria');
		e.statusCode = 400;
		throw e;
	}
	await mysqlExec(`UPDATE \`imServicios\` SET Descripcion = ? WHERE IdEmpresa = ? AND Valor = ?`, [
		desc,
		emp,
		id,
	]);
	return { id, descripcion: desc };
}

async function eliminarServicio(idEmpresa, valor) {
	const emp = await ensureServiciosTables(idEmpresa);
	const id = String(valor || '').trim().toUpperCase();
	const enUso = await mysqlQuery(
		`SELECT 1 FROM \`imPersonalServicios\` WHERE IdEmpresa = ? AND idServicio = ? LIMIT 1`,
		[emp, id],
	);
	if (enUso.length) {
		const e = new Error('No se puede eliminar: el servicio está asignado a personal');
		e.statusCode = 409;
		throw e;
	}
	await mysqlExec(`DELETE FROM \`imServicios\` WHERE IdEmpresa = ? AND Valor = ?`, [emp, id]);
	return { ok: true, id };
}

async function reemplazarServiciosUsuario(idEmpresa, idPersonal, servicios) {
	const emp = await ensureServiciosTables(idEmpresa);
	const id = Number(idPersonal);
	await mysqlExec(`DELETE FROM \`imPersonalServicios\` WHERE IdEmpresa = ? AND idPersonal = ?`, [
		emp,
		id,
	]);
	for (const raw of servicios || []) {
		const sid = String(raw || '').trim();
		if (!sid) continue;
		try {
			await mysqlExec(
				`INSERT INTO \`imPersonalServicios\` (IdEmpresa, idPersonal, idServicio) VALUES (?, ?, ?)`,
				[emp, id, sid],
			);
		} catch (e) {
			console.warn('[nube] asignar servicio', sid, e.message);
		}
	}
}

async function listarServiciosDeUsuario(idEmpresa, idPersonal) {
	const emp = await ensureServiciosTables(idEmpresa);
	const rows = await mysqlQuery(
		`SELECT ps.idServicio AS id, s.Descripcion AS descripcion
		 FROM \`imPersonalServicios\` ps
		 LEFT JOIN \`imServicios\` s
		   ON s.IdEmpresa = ps.IdEmpresa AND s.Valor = ps.idServicio
		 WHERE ps.IdEmpresa = ? AND ps.idPersonal = ?`,
		[emp, Number(idPersonal)],
	);
	return (rows || []).map((s) => ({
		id: String(s.id || '').trim(),
		descripcion: String(s.descripcion || s.id || '').trim(),
	}));
}

// ───────────────────────────── roles (NUBE) ─────────────────────────────

async function listarRoles() {
	const rows = await mysqlQuery(
		`SELECT IdRol, Nombre, Descripcion, Nivel FROM \`imRoles\` WHERE Activo = 1 ORDER BY Nivel DESC, Nombre`,
	);
	return rows
		.filter((r) => String(r.Nombre) !== 'SUPER_ADMIN')
		.map((r) => ({
			idRol: r.IdRol,
			nombre: String(r.Nombre || ''),
			descripcion: String(r.Descripcion || '').trim(),
			nivel: r.Nivel,
		}));
}

// ───────────────────────────── usuarios (NUBE) ─────────────────────────────

async function listarUsuariosEmpresa(idEmpresa) {
	const id = Number(idEmpresa);
	let rows = [];
	try {
		rows = await mysqlQuery(
			`
    SELECT
      pw.ValorPersonal AS IdPersonal, pw.NombreRed AS Usuario,
      pw.Nombres AS Nombre, pw.Apellido AS Apellido,
      pw.NumeroDocumento AS NumeroDocumento, pw.CodOperador AS CodOperador,
      r.IdRol AS IdRol, r.Nombre AS RolNombre, r.Descripcion AS RolDescripcion
    FROM \`imPersonalEmpresas\` pe
    INNER JOIN \`imPassword\` pw
      ON pw.ValorPersonal = pe.IdPersonal AND pw.IdEmpresa = pe.IdEmpresa
    LEFT JOIN \`imPersonal\` p
      ON p.Valor = pe.IdPersonal AND p.IdEmpresa = pe.IdEmpresa
    LEFT JOIN \`imRoles\` r
      ON r.IdRol = CAST(NULLIF(TRIM(CAST(p.Rol AS CHAR)), '') AS UNSIGNED) AND r.Activo = 1
    WHERE pe.IdEmpresa = ?
    ORDER BY pw.Apellido, pw.Nombres
    `,
			[id],
		);
	} catch (e) {
		console.warn('[nube] listar usuarios (join roles):', e.message);
		rows = await mysqlQuery(
			`
    SELECT
      pw.ValorPersonal AS IdPersonal, pw.NombreRed AS Usuario,
      pw.Nombres AS Nombre, pw.Apellido AS Apellido,
      pw.NumeroDocumento AS NumeroDocumento, pw.CodOperador AS CodOperador,
      NULL AS IdRol, NULL AS RolNombre, NULL AS RolDescripcion
    FROM \`imPersonalEmpresas\` pe
    INNER JOIN \`imPassword\` pw
      ON pw.ValorPersonal = pe.IdPersonal AND pw.IdEmpresa = pe.IdEmpresa
    WHERE pe.IdEmpresa = ?
    ORDER BY pw.Apellido, pw.Nombres
    `,
			[id],
		);
	}
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
		let servicios = [];
		try {
			servicios = await listarServiciosDeUsuario(id, idPersonal);
		} catch {
			servicios = [];
		}
		usuarios.push({
			idPersonal,
			usuario: String(r.Usuario || '').trim(),
			nombre: String(r.Nombre || '').trim(),
			apellido: String(r.Apellido || '').trim(),
			numeroDocumento: String(r.NumeroDocumento ?? '').trim(),
			codOperador: r.CodOperador == null ? null : String(r.CodOperador),
			idRol: r.IdRol != null ? Number(r.IdRol) : null,
			rol: String(r.RolDescripcion || r.RolNombre || '').trim() || null,
			activo: true,
			sectores,
			servicios,
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
		const rawDoc = numeroDocumento != null ? String(numeroDocumento).replace(/\D/g, '') : '';
		const num = rawDoc ? Number(rawDoc) : null;
		campos.push('Numero');
		valores.push(esNumerica(colMap, 'Numero') ? (Number.isFinite(num) ? num : null) : rawDoc || null);
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

async function asignarRolNube(idEmpresa, valorPersonal, idRol) {
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	const rol = idRol == null || idRol === '' || Number(idRol) === 0 ? null : Number(idRol);
	await mysqlExec(`
    CREATE TABLE IF NOT EXISTS \`imPersonalRoles\` (
      \`IdEmpresa\` INT NOT NULL,
      \`Valor\` INT NOT NULL,
      \`IdRol\` INT NOT NULL,
      \`EsPrincipal\` TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (\`IdEmpresa\`, \`Valor\`, \`IdRol\`)
    )
  `);
	await mysqlExec(`DELETE FROM \`imPersonalRoles\` WHERE IdEmpresa = ? AND Valor = ?`, [emp, vp]);
	if (rol == null) {
		await mysqlExec(`UPDATE \`imPersonal\` SET Rol = NULL WHERE IdEmpresa = ? AND Valor = ?`, [emp, vp]).catch(
			() => {},
		);
		return;
	}
	await mysqlExec(
		`INSERT INTO \`imPersonalRoles\` (IdEmpresa, Valor, IdRol, EsPrincipal) VALUES (?, ?, ?, 1)`,
		[emp, vp, rol],
	);
	await mysqlExec(`UPDATE \`imPersonal\` SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?`, [
		String(rol),
		emp,
		vp,
	]);
}

function payloadUsuarioCreado(valorPersonal, body, idRol) {
	return {
		idPersonal: Number(valorPersonal),
		usuario: String(body.nombreRed || '').trim(),
		nombre: String(body.nombres || '').trim(),
		apellido: String(body.apellido || '').trim(),
		numeroDocumento: String(body.numeroDocumento || '').trim(),
		codOperador: body.codOperador != null ? String(body.codOperador) : null,
		idRol: idRol != null && idRol !== '' ? Number(idRol) : null,
		rol: null,
		activo: true,
		sectores: Array.isArray(body.sectores) ? body.sectores.map((s) => ({ id: String(s), descripcion: String(s) })) : [],
		servicios: Array.isArray(body.servicios)
			? body.servicios.map((s) => ({ id: String(s), descripcion: String(s) }))
			: [],
	};
}

/**
 * MySQL ER_DUP_ENTRY (1062) → HTTP 409 con mensaje usable.
 */
function mapMysqlDuplicateToHttp(err) {
	const errno = err?.errno ?? err?.code;
	if (errno !== 1062 && err?.code !== 'ER_DUP_ENTRY') return null;
	const msg = String(err?.sqlMessage || err?.message || '').toLowerCase();
	if (msg.includes('nombrered') || msg.includes('nombre_red') || msg.includes('usuario')) {
		return {
			statusCode: 409,
			message: 'Ya existe un usuario con ese nombre de acceso. Elegí otro.',
		};
	}
	if (msg.includes('password')) {
		return {
			statusCode: 409,
			message:
				'Esa contraseña ya está en uso por otro usuario (la base exige contraseñas únicas). Elegí otra.',
		};
	}
	if (msg.includes('documento') || msg.includes('dni') || msg.includes('numero')) {
		return {
			statusCode: 409,
			message: 'Ya existe un usuario con ese número de documento.',
		};
	}
	return {
		statusCode: 409,
		message: 'Ya existe un registro con esos datos. Revisá usuario, contraseña o documento.',
	};
}

async function crearUsuarioEmpresa(idEmpresa, body) {
	const emp = Number(idEmpresa);
	const { nombreRed, password, apellido, nombres, numeroDocumento, legajo, codOperador, idRol, sectores, servicios } = body;
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
		const e = new Error(
			`Ya existe el usuario "${nombreRed.trim()}" en esta empresa. Elegí otro nombre de acceso o editá el existente.`,
		);
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
	if (colMap.has('Legajo')) {
		const v = valorCampoSegunTipo(colMap, 'Legajo', legajo);
		if (v != null) {
			campos.push('Legajo');
			valores.push(v);
		} else if (esNumerica(colMap, 'Legajo')) {
			campos.push('Legajo');
			valores.push(valorPersonal);
		}
	}
	if (colMap.has('CodOperador')) {
		campos.push('CodOperador');
		valores.push(
			esNumerica(colMap, 'CodOperador')
				? (Number(codOperador) || valorPersonal)
				: (String(codOperador || '').trim() || String(valorPersonal)),
		);
	}
	if (colMap.has('Grupo')) { campos.push('Grupo'); valores.push(0); }
	if (colMap.has('MarcadeBaja')) {
		campos.push('MarcadeBaja');
		valores.push(esNumerica(colMap, 'MarcadeBaja') ? 0 : '0');
	}
	if (colMap.has('FechaActual')) {
		campos.push('FechaActual');
		valores.push(esNumerica(colMap, 'FechaActual') ? fechaClarionHoy() : new Date());
	}
	completarObligatorias(colMap, campos, valores);
	try {
		await mysqlExec(
			`INSERT INTO \`imPassword\` (${campos.map((c) => `\`${c}\``).join(', ')})
     VALUES (${campos.map(() => '?').join(', ')})`,
			valores,
		);
	} catch (err) {
		const mapped = mapMysqlDuplicateToHttp(err);
		if (mapped) {
			const e = new Error(mapped.message);
			e.statusCode = mapped.statusCode;
			throw e;
		}
		throw err;
	}

	try {
		await asegurarFichaPersonal(emp, valorPersonal, { apellido, nombres, numeroDocumento, idRol });
	} catch (e) {
		console.warn('[nube] ficha personal', e.message);
	}
	await vincularUsuarioEmpresa(emp, valorPersonal);
	try {
		await asignarRolNube(emp, valorPersonal, idRol);
	} catch (e) {
		console.warn('[nube] asignar rol', e.message);
	}

	let sectoresAsignar = [];
	try {
		sectoresAsignar = (await resolverSectoresUsuario(emp, idRol, sectores)) || [];
	} catch (e) {
		console.warn('[nube] resolver sectores', e.message);
	}
	for (const idSector of sectoresAsignar) {
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

	try {
		const serviciosAsignar = await resolverServiciosUsuario(emp, idRol, servicios);
		if (serviciosAsignar != null) {
			await reemplazarServiciosUsuario(emp, valorPersonal, serviciosAsignar);
		}
	} catch (e) {
		console.warn('[nube] asignar servicios', e.message);
	}

	try {
		const lista = await listarUsuariosEmpresa(idEmpresa);
		const found = lista.find((u) => Number(u.idPersonal) === Number(valorPersonal));
		if (found) return found;
	} catch (e) {
		console.warn('[nube] listar usuarios post-alta', e.message);
	}
	return payloadUsuarioCreado(valorPersonal, body, idRol);
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
		try {
			await asignarRolNube(emp, id, body.idRol);
		} catch (e) {
			console.warn('[nube] actualizar rol', e.message);
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

	const serviciosAsignar = await resolverServiciosUsuario(emp, body.idRol, body.servicios);
	if (serviciosAsignar != null) {
		try {
			await reemplazarServiciosUsuario(emp, id, serviciosAsignar);
		} catch (e) {
			console.warn('[nube] actualizar servicios', e.message);
		}
	}

	try {
		const lista = await listarUsuariosEmpresa(idEmpresa);
		return lista.find((u) => Number(u.idPersonal) === id) || payloadUsuarioCreado(id, body, body.idRol);
	} catch (e) {
		console.warn('[nube] listar usuarios post-edicion', e.message);
		return payloadUsuarioCreado(id, body, body.idRol);
	}
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

	if (seleccion.some((t) => t.toLowerCase() === 'impersonal')) {
		try {
			const { ensureImPersonalExportColumns } = require('./personalSync.service');
			await ensureImPersonalExportColumns();
		} catch (e) {
			console.warn('[import] ensureImPersonalExportColumns:', e.message);
		}
	}

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
				// Legacy: ValorPersonal puede ser NULL y el id real vive en CodOperador (IDENTITY).
				const idExpr = tienePass ? 'COALESCE(ValorPersonal, CodOperador)' : 'Valor';
				const data = await pool.request().query(`SELECT ${idExpr} AS pid FROM dbo.[${fuente}]`);
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

			// imPassword legacy: leer CodOperador aunque no se copie, para rellenar ValorPersonal NULL.
			const esImPassword = tabla.toLowerCase() === 'impassword';
			const origenColsLower = new Set(origenCols.map((c) => c.toLowerCase()));
			const selectList = [...comunesFiltradas.map((c) => `[${c.origen}]`)];
			if (esImPassword && origenColsLower.has('codoperador')
				&& !comunesFiltradas.some((c) => c.origen.toLowerCase() === 'codoperador')) {
				selectList.push('[CodOperador]');
			}
			const selectCols = selectList.join(', ');
			const data = await pool.request().query(`SELECT ${selectCols} FROM dbo.[${tabla}]`);
			let filas = data.recordset || [];
			res.leidas = filas.length;
			if (!filas.length) { resultados.push(res); continue; }

			if (esImPassword) {
				filas = filas.map((fila) => {
					const out = { ...fila };
					const vp = out.ValorPersonal ?? out.valorPersonal;
					const cod = out.CodOperador ?? out.codOperador;
					if ((vp == null || vp === '') && cod != null && cod !== '') {
						const n = Number(cod);
						out.ValorPersonal = Number.isFinite(n) ? n : null;
					}
					return out;
				}).filter((fila) => {
					const vp = fila.ValorPersonal ?? fila.valorPersonal;
					return vp != null && vp !== '' && Number.isFinite(Number(vp));
				});
				if (!filas.length) {
					res.error = 'imPassword sin ValorPersonal ni CodOperador usable (legado)';
					resultados.push(res);
					continue;
				}
			}

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
	listarServicios,
	crearServicio,
	actualizarServicio,
	eliminarServicio,
	reemplazarServiciosUsuario,
	resolverServiciosUsuario,
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
