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
	{ tabla: 'imServicios', label: 'Servicios', estrategia: 'tenant', forzarEmpresa: ['IdEmpresa'] },
	{ tabla: 'imPersonalServicios', label: 'Servicios por personal', estrategia: 'tenant', forzarEmpresa: ['IdEmpresa'] },
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
	'int', 'bigint', 'smallint', 'tinyint', 'mediumint', 'decimal', 'numeric', 'float', 'double', 'bit', 'year',
]);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const BINARY_TYPES = new Set(['blob', 'mediumblob', 'longblob', 'tinyblob', 'binary', 'varbinary']);
const STRING_TYPES = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set']);

/** Anchos mínimos para columnas de texto copiadas desde Clarion (CHAR 20). */
const IMPASSWORD_MIN_WIDTH = Object.freeze({
	Apellido: 80,
	Nombres: 80,
	NombreRed: 80,
	NumeroDocumento: 30,
	CodOperador: 30,
	Password: 255,
});

/** Columnas que nunca se copian al importar (binarios / clínico pesado). */
const COLUMNAS_EXCLUIR_IMPORT = new Set(['firma', 'foto', 'imagen', 'observaciones']);

function sanitizarValorImport(v, meta) {
	if (v === undefined) return null;
	if (Buffer.isBuffer(v)) return null;
	if (v instanceof Date) return v;
	if (meta && BINARY_TYPES.has(meta.tipo)) return null;
	if (meta && esTipoNumerico(meta.tipo)) {
		if (v === null || v === '') return null;
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	if (meta && STRING_TYPES.has(meta.tipo) && v != null) {
		return truncarSegunMeta(meta, String(v));
	}
	return v;
}

function esTipoNumerico(tipo) {
	return NUMERIC_TYPES.has(String(tipo || '').toLowerCase());
}

function defaultEsUsable(meta) {
	if (meta.def == null) return false;
	const s = String(meta.def).trim().replace(/^'|'$/g, '');
	if (!s || /^null$/i.test(s)) return false;
	if (esTipoNumerico(meta.tipo) && s === '') return false;
	return true;
}

async function columnasMeta(tabla) {
	const rows = await mysqlQuery(
		`SELECT COLUMN_NAME AS col, DATA_TYPE AS tipo, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS def, EXTRA AS extra, CHARACTER_MAXIMUM_LENGTH AS maxlen
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
		[tabla],
	);
	const map = new Map();
	for (const r of rows) {
		const tipo = String(r.tipo).toLowerCase();
		const meta = {
			nombre: String(r.col),
			tipo,
			nullable: String(r.nullable).toUpperCase() === 'YES',
			def: r.def,
			hasDefault: defaultEsUsable({ tipo, def: r.def }),
			autoInc: String(r.extra || '').toLowerCase().includes('auto_increment'),
			maxlen: r.maxlen != null ? Number(r.maxlen) : null,
		};
		map.set(meta.nombre, meta);
	}
	return map;
}

function colMeta(colMap, col) {
	if (!col || !colMap) return undefined;
	if (colMap.has(col)) return colMap.get(col);
	const lower = String(col).toLowerCase();
	for (const meta of colMap.values()) {
		if (meta.nombre.toLowerCase() === lower) return meta;
	}
	return undefined;
}

function truncarSegunMeta(meta, s) {
	const str = String(s ?? '');
	const max = Number(meta?.maxlen);
	if (Number.isFinite(max) && max > 0) return str.slice(0, max);
	return str;
}

function valorPorTipo(meta) {
	if (esTipoNumerico(meta.tipo)) return 0;
	if (DATE_TYPES.has(meta.tipo)) return meta.tipo === 'date' ? '1900-01-01' : '1900-01-01 00:00:00';
	if (meta.tipo === 'char' || meta.tipo === 'nchar') return ' '.slice(0, Math.max(1, Number(meta.maxlen) || 1));
	return '';
}

/** Completa columnas NOT NULL sin default usable con un valor seguro por tipo. Nunca inserta '' en numéricos. */
function completarObligatorias(colMap, campos, valores) {
	const puestas = new Set(campos.map((c) => String(c).toLowerCase()));
	const seen = new Set();
	for (const meta of colMap.values()) {
		const key = meta.nombre.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		if (puestas.has(key)) continue;
		if (meta.nullable || meta.hasDefault || meta.autoInc) continue;
		if (BINARY_TYPES.has(meta.tipo)) continue;
		if (COLUMNAS_EXCLUIR_IMPORT.has(key)) continue;
		campos.push(meta.nombre);
		valores.push(valorPorTipo(meta));
	}
}

function esNumerica(colMap, col) {
	return esTipoNumerico(colMeta(colMap, col)?.tipo);
}

/** Convierte valores para UPDATE/INSERT según el tipo real de la columna en MySQL. */
function valorCampoSegunTipo(colMap, col, raw) {
	const meta = colMeta(colMap, col);
	if (raw == null) return null;
	if (!meta) {
		const s = String(raw).trim();
		return s === '' ? null : s;
	}
	if (esTipoNumerico(meta.tipo)) {
		const s = String(raw).trim();
		if (s === '') return null;
		const n = Number(String(s).replace(/[^\d.-]/g, ''));
		return Number.isFinite(n) ? n : null;
	}
	const s = String(raw).trim();
	if (s === '') return null;
	return truncarSegunMeta(meta, s);
}

/**
 * El esquema copiado desde SQL Server/Clarion deja Apellido CHAR(20) y Legajo INT DEFAULT ''.
 * Ensancha textos y saca defaults vacíos en columnas numéricas.
 */
async function ensureImPasswordUsableSchema() {
	const colMap = await columnasMeta('imPassword');
	for (const [logical, minLen] of Object.entries(IMPASSWORD_MIN_WIDTH)) {
		const meta = colMeta(colMap, logical);
		if (!meta) continue;
		if (!STRING_TYPES.has(meta.tipo)) continue;
		const max = Number(meta.maxlen);
		if (!Number.isFinite(max) || max <= 0 || max >= minLen) continue;
		const nullSql = meta.nullable ? 'NULL' : 'NOT NULL';
		try {
			await mysqlExec(
				`ALTER TABLE \`imPassword\` MODIFY \`${meta.nombre}\` VARCHAR(${minLen}) ${nullSql}`,
			);
			meta.tipo = 'varchar';
			meta.maxlen = minLen;
		} catch (e) {
			console.warn(`[nube] widen imPassword.${meta.nombre}:`, e.message);
		}
	}
	const NUMERIC_DEFAULT_FIX = new Set(['legajo', 'grupo', 'marcadebaja']);
	const seen = new Set();
	for (const meta of colMap.values()) {
		const key = meta.nombre.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		if (!NUMERIC_DEFAULT_FIX.has(key)) continue;
		if (!esTipoNumerico(meta.tipo) || meta.nullable || meta.autoInc) continue;
		const def = meta.def == null ? '' : String(meta.def).trim().replace(/^'|'$/g, '');
		if (def !== '') continue;
		try {
			await mysqlExec(`ALTER TABLE \`imPassword\` ALTER \`${meta.nombre}\` SET DEFAULT 0`);
			meta.hasDefault = true;
			meta.def = '0';
		} catch (e) {
			console.warn(`[nube] default imPassword.${meta.nombre}:`, e.message);
		}
	}
	return colMap;
}

function esNombreDebil(value) {
	const s = String(value || '').trim();
	if (!s) return true;
	if (/^\d+$/.test(s)) return true;
	if (/^(null|undefined|n\/a)$/i.test(s)) return true;
	return false;
}

function splitApellidoNombre(apellidoNombre) {
	const s = String(apellidoNombre || '').trim();
	if (!s) return { nombres: '', apellido: '' };
	if (s.includes(',')) {
		const [ap, ...rest] = s.split(',');
		return { apellido: ap.trim(), nombres: rest.join(',').trim() };
	}
	const parts = s.split(/\s+/).filter(Boolean);
	if (parts.length === 1) return { nombres: parts[0], apellido: '' };
	return { apellido: parts[0], nombres: parts.slice(1).join(' ') };
}

function apellidoNombreDesdePartes(apellido, nombres) {
	const a = String(apellido || '').trim();
	const n = String(nombres || '').trim();
	if (a && n) return `${a}, ${n}`;
	return a || n || '';
}

/** imPassword.Nombres/Apellido o, si vienen vacíos, imPersonal.ApellidoNombre. */
function identidadDesdeFila(row) {
	let nombres = String(row.Nombre || row.Nombres || '').trim();
	let apellido = String(row.Apellido || '').trim();
	if (esNombreDebil(nombres) && esNombreDebil(apellido)) {
		const fromPersonal = splitApellidoNombre(row.ApellidoNombre);
		if (!esNombreDebil(fromPersonal.nombres) || !esNombreDebil(fromPersonal.apellido)) {
			nombres = fromPersonal.nombres;
			apellido = fromPersonal.apellido;
		}
	}
	if (esNombreDebil(nombres)) nombres = '';
	if (esNombreDebil(apellido)) apellido = '';
	const docPw = String(row.NumeroDocumento ?? '').trim();
	const docP =
		row.Numero != null && String(row.Numero).trim() !== '' && String(row.Numero) !== '0'
			? String(row.Numero).trim()
			: '';
	return {
		nombre: nombres,
		apellido,
		apellidoNombre: apellidoNombreDesdePartes(apellido, nombres) || String(row.ApellidoNombre || '').trim(),
		numeroDocumento: docPw && docPw !== '0' ? docPw : docP,
	};
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

function mapCatalogoFilas(rows) {
	return (rows || [])
		.map((s) => ({
			id: String(s.Valor ?? s.IdSector ?? s.id ?? '').trim(),
			descripcion: String(s.Descripcion ?? s.descripcion ?? s.Valor ?? s.id ?? '').trim(),
			ambInt: s.AmbInt != null ? String(s.AmbInt).trim() : undefined,
			valorServicio: s.ValorServicio != null ? String(s.ValorServicio).trim() : undefined,
		}))
		.filter((s) => s.id);
}

async function empresaEsFisica(idEmpresa) {
	const emp = Number(idEmpresa);
	const empRow = await mysqlQuery(
		`SELECT TipoServidor, DbServer FROM \`Empresas\` WHERE IDEMPRESA = ? LIMIT 1`,
		[emp],
	);
	const tipo = String(empRow[0]?.TipoServidor || '').trim().toUpperCase();
	const server = String(empRow[0]?.DbServer || '').trim();
	return { emp, fisica: tipo !== 'NUBE' && !!server };
}

async function seedSectoresDesdeFisico(idEmpresa) {
	const { emp, fisica } = await empresaEsFisica(idEmpresa);
	if (!fisica) return 0;
	try {
		const pool = await getTenantPool(emp);
		const cols = await sqlServerColumnas(pool, 'imSectores').catch(() => []);
		if (!cols.length) return 0;
		const hasAmb = cols.some((c) => String(c).toLowerCase() === 'ambint');
		const data = await pool.request().query(
			`SELECT LTRIM(RTRIM(CAST(Valor AS VARCHAR(20)))) AS Valor,
			        LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(200)))) AS Descripcion
			        ${hasAmb ? ', LTRIM(RTRIM(CAST(AmbInt AS VARCHAR(4)))) AS AmbInt' : ''}
			 FROM dbo.imSectores`,
		);
		const filas = data.recordset || [];
		const destCols = await columnasMeta('imSectores');
		const hasDestAmb = !!colMeta(destCols, 'AmbInt');
		for (const r of filas) {
			const valor = String(r.Valor || '').trim().slice(0, 20);
			const desc = String(r.Descripcion || r.Valor || '').trim().slice(0, 200);
			if (!valor) continue;
			try {
				if (hasDestAmb) {
					await mysqlExec(
						`INSERT INTO \`imSectores\` (\`IdEmpresa\`, \`Valor\`, \`Descripcion\`, \`AmbInt\`)
						 SELECT ?, ?, ?, ? FROM DUAL
						 WHERE NOT EXISTS (
						   SELECT 1 FROM \`imSectores\` WHERE IdEmpresa = ? AND Valor = ?
						 )`,
						[emp, valor, desc, String(r.AmbInt || 'A').trim().slice(0, 1) || 'A', emp, valor],
					);
				} else {
					await mysqlExec(
						`INSERT INTO \`imSectores\` (\`IdEmpresa\`, \`Valor\`, \`Descripcion\`)
						 SELECT ?, ?, ? FROM DUAL
						 WHERE NOT EXISTS (
						   SELECT 1 FROM \`imSectores\` WHERE IdEmpresa = ? AND Valor = ?
						 )`,
						[emp, valor, desc, emp, valor],
					);
				}
			} catch (e) {
				console.warn('[nube] seed sector', valor, e.message);
			}
		}
		return filas.length;
	} catch (e) {
		console.warn('[nube] seed sectores desde físico:', e.message);
		return 0;
	}
}

async function listarSectores(idEmpresa) {
	const emp = Number(idEmpresa);
	try {
		let cols = await columnasMeta('imSectores');
		if (!cols.size) return [];
		const hasAmb = !!colMeta(cols, 'AmbInt');
		const hasEmp = !!colMeta(cols, 'IdEmpresa');
		const hasVs = !!colMeta(cols, 'ValorServicio');
		const select = [
			'`Valor`',
			'`Descripcion`',
			hasAmb ? '`AmbInt`' : null,
			hasVs ? '`ValorServicio`' : null,
		]
			.filter(Boolean)
			.join(', ');
		const sql = hasEmp
			? `SELECT ${select} FROM \`imSectores\` WHERE IdEmpresa = ? ORDER BY Descripcion`
			: `SELECT ${select} FROM \`imSectores\` ORDER BY Descripcion`;
		let rows = await mysqlQuery(sql, hasEmp ? [emp] : []);
		return mapCatalogoFilas(rows);
	} catch (e) {
		console.warn('[nube] listarSectores', e.message);
		return [];
	}
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

async function ensurePersonalSectoresTable(idEmpresa) {
	const emp = Number(idEmpresa);
	await mysqlExec(
		`CREATE TABLE IF NOT EXISTS \`imPersonalSectores\` (
			\`IdEmpresa\` INT NOT NULL,
			\`idPersonal\` INT NOT NULL,
			\`idSector\` VARCHAR(20) NOT NULL,
			PRIMARY KEY (\`IdEmpresa\`, \`idPersonal\`, \`idSector\`)
		)`,
	);
	await mysqlExec(`ALTER TABLE \`imPersonalSectores\` MODIFY idSector VARCHAR(20) NOT NULL`).catch(() => {});
	const cols = await columnasMeta('imPersonalSectores');
	if (!colMeta(cols, 'IdEmpresa')) {
		await mysqlExec(`ALTER TABLE \`imPersonalSectores\` ADD COLUMN IdEmpresa INT NOT NULL DEFAULT 0`).catch(() => {});
	}
	return emp;
}

async function seedServiciosDesdeFisico(idEmpresa) {
	const { emp, fisica } = await empresaEsFisica(idEmpresa);
	if (!fisica) return 0;
	try {
		const pool = await getTenantPool(emp);
		for (const tabla of ['imServicios', 'imServiciosMedicos']) {
			const cols = await sqlServerColumnas(pool, tabla).catch(() => []);
			if (!cols.length) continue;
			const data = await pool.request().query(
				`SELECT LTRIM(RTRIM(CAST(Valor AS VARCHAR(50)))) AS Valor,
				        LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(200)))) AS Descripcion
				 FROM dbo.[${tabla}]`,
			);
			const filas = data.recordset || [];
			if (!filas.length) continue;
			for (const r of filas) {
				const valor = String(r.Valor || '').trim().slice(0, 20);
				const desc = String(r.Descripcion || r.Valor || '').trim().slice(0, 200);
				if (!valor) continue;
				try {
					await mysqlExec(
						`INSERT INTO \`imServicios\` (\`IdEmpresa\`, \`Valor\`, \`Descripcion\`)
						 SELECT ?, ?, ? FROM DUAL
						 WHERE NOT EXISTS (
						   SELECT 1 FROM \`imServicios\` WHERE IdEmpresa = ? AND Valor = ?
						 )`,
						[emp, valor, desc, emp, valor],
					);
				} catch (e) {
					console.warn('[nube] seed servicio', valor, e.message);
				}
			}
			return filas.length;
		}
	} catch (e) {
		console.warn('[nube] seed servicios desde físico:', e.message);
	}
	return 0;
}

async function listarServicios(idEmpresa) {
	const emp = await ensureServiciosTables(idEmpresa);
	let rows = await mysqlQuery(
		`SELECT Valor, Descripcion FROM \`imServicios\` WHERE IdEmpresa = ? ORDER BY Descripcion`,
		[emp],
	);
	if (!rows.length) {
		await seedServiciosDesdeFisico(emp);
		rows = await mysqlQuery(
			`SELECT Valor, Descripcion FROM \`imServicios\` WHERE IdEmpresa = ? ORDER BY Descripcion`,
			[emp],
		);
	}
	return rows.map((s) => ({
		id: String(s.Valor || '').trim(),
		descripcion: String(s.Descripcion || '').trim(),
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
	const cols = await columnasMeta('imPersonalServicios');
	const cEmp = colMeta(cols, 'IdEmpresa')?.nombre || 'IdEmpresa';
	const cPers = colMeta(cols, 'idPersonal')?.nombre || 'idPersonal';
	const cSrv = colMeta(cols, 'idServicio')?.nombre || 'idServicio';
	await mysqlExec(`DELETE FROM \`imPersonalServicios\` WHERE \`${cEmp}\` = ? AND \`${cPers}\` = ?`, [emp, id]);
	const failed = [];
	const seen = new Set();
	for (const raw of servicios || []) {
		const sid = String(raw || '').trim();
		if (!sid || seen.has(sid.toUpperCase())) continue;
		seen.add(sid.toUpperCase());
		try {
			const campos = [cEmp, cPers, cSrv];
			const valores = [emp, id, sid.slice(0, 50)];
			completarObligatorias(cols, campos, valores);
			await mysqlExec(
				`INSERT INTO \`imPersonalServicios\` (${campos.map((c) => `\`${c}\``).join(', ')})
				 VALUES (${campos.map(() => '?').join(', ')})`,
				valores,
			);
		} catch (e) {
			console.warn('[nube] asignar servicio', sid, e.message);
			failed.push(sid);
		}
	}
	if (failed.length) {
		const e = new Error(`No se pudieron asignar ${failed.length} servicio(s): ${failed.slice(0, 3).join(', ')}`);
		e.statusCode = 500;
		throw e;
	}
}

async function reemplazarSectoresUsuario(idEmpresa, idPersonal, sectores) {
	const emp = await ensurePersonalSectoresTable(idEmpresa);
	const id = Number(idPersonal);
	const cols = await columnasMeta('imPersonalSectores');
	const cEmp = colMeta(cols, 'IdEmpresa')?.nombre || 'IdEmpresa';
	const cPers = colMeta(cols, 'idPersonal')?.nombre || 'idPersonal';
	const cSec = colMeta(cols, 'idSector')?.nombre || 'idSector';
	await mysqlExec(`DELETE FROM \`imPersonalSectores\` WHERE \`${cEmp}\` = ? AND \`${cPers}\` = ?`, [emp, id]);
	const failed = [];
	const seen = new Set();
	for (const raw of sectores || []) {
		const sid = String(raw || '').trim();
		if (!sid || seen.has(sid.toUpperCase())) continue;
		seen.add(sid.toUpperCase());
		try {
			const campos = [cEmp, cPers, cSec];
			const valores = [emp, id, sid.slice(0, 20)];
			completarObligatorias(cols, campos, valores);
			await mysqlExec(
				`INSERT INTO \`imPersonalSectores\` (${campos.map((c) => `\`${c}\``).join(', ')})
				 VALUES (${campos.map(() => '?').join(', ')})`,
				valores,
			);
		} catch (e) {
			console.warn('[nube] asignar sector', sid, e.message);
			failed.push(sid);
		}
	}
	if (failed.length) {
		const e = new Error(`No se pudieron asignar ${failed.length} sector(es): ${failed.slice(0, 3).join(', ')}`);
		e.statusCode = 500;
		throw e;
	}
}

async function listarSectoresDeUsuario(idEmpresa, idPersonal) {
	const emp = await ensurePersonalSectoresTable(idEmpresa);
	const vp = Number(idPersonal);
	const sqlConEmp = `SELECT ps.idSector AS idSector, s.Descripcion AS descripcion
		 FROM \`imPersonalSectores\` ps
		 LEFT JOIN \`imSectores\` s
		   ON s.Valor COLLATE ${COLLATE} = ps.idSector COLLATE ${COLLATE}
		  AND s.IdEmpresa = ps.IdEmpresa
		 WHERE ps.IdEmpresa = ? AND ps.idPersonal = ?`;
	const sqlSinEmp = `SELECT ps.idSector AS idSector, s.Descripcion AS descripcion
		 FROM \`imPersonalSectores\` ps
		 LEFT JOIN \`imSectores\` s
		   ON s.Valor COLLATE ${COLLATE} = ps.idSector COLLATE ${COLLATE}
		 WHERE ps.idPersonal = ?`;
	let rows = [];
	try {
		rows = await mysqlQuery(sqlConEmp, [emp, vp]);
	} catch {
		rows = await mysqlQuery(sqlSinEmp, [vp]);
	}
	return (rows || []).map((s) => ({
		id: String(s.idSector || '').trim(),
		descripcion: String(s.descripcion || s.idSector || '').trim(),
	})).filter((s) => s.id);
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
		descripcion: String(s.descripcion || '').trim(),
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
      p.ApellidoNombre AS ApellidoNombre, p.Numero AS Numero,
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
      p.ApellidoNombre AS ApellidoNombre, p.Numero AS Numero,
      NULL AS IdRol, NULL AS RolNombre, NULL AS RolDescripcion
    FROM \`imPersonalEmpresas\` pe
    INNER JOIN \`imPassword\` pw
      ON pw.ValorPersonal = pe.IdPersonal AND pw.IdEmpresa = pe.IdEmpresa
    LEFT JOIN \`imPersonal\` p
      ON p.Valor = pe.IdPersonal AND p.IdEmpresa = pe.IdEmpresa
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
			sectores = await listarSectoresDeUsuario(id, idPersonal);
		} catch {
			sectores = [];
		}
		let servicios = [];
		try {
			servicios = await listarServiciosDeUsuario(id, idPersonal);
		} catch {
			servicios = [];
		}
		const ident = identidadDesdeFila(r);
		usuarios.push({
			idPersonal,
			usuario: String(r.Usuario || '').trim(),
			nombre: ident.nombre,
			apellido: ident.apellido,
			numeroDocumento: ident.numeroDocumento,
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
	const pushCol = (logical, value) => {
		const meta = colMeta(colMap, logical);
		if (!meta) return;
		campos.push(meta.nombre);
		valores.push(value);
	};

	if (existe.length) {
		const rolMeta = colMeta(colMap, 'Rol');
		if (idRol != null && rolMeta) {
			await mysqlExec(`UPDATE \`imPersonal\` SET \`${rolMeta.nombre}\` = ? WHERE IdEmpresa = ? AND Valor = ?`, [
				String(idRol), emp, valorPersonal,
			]);
		}
		return;
	}

	const campos = ['IdEmpresa', 'Valor'];
	const valores = [emp, valorPersonal];
	if (colMeta(colMap, 'Rol')) {
		pushCol('Rol', idRol != null ? String(idRol) : (esNumerica(colMap, 'Rol') ? 0 : null));
	}
	if (colMeta(colMap, 'Matricula')) pushCol('Matricula', valorPersonal);
	if (colMeta(colMap, 'ApellidoNombre')) {
		pushCol(
			'ApellidoNombre',
			valorCampoSegunTipo(colMap, 'ApellidoNombre', apellidoNombre) || `Usuario ${valorPersonal}`.slice(0, 80),
		);
	}
	if (colMeta(colMap, 'Numero')) {
		const rawDoc = numeroDocumento != null ? String(numeroDocumento).replace(/\D/g, '') : '';
		const num = rawDoc ? Number(rawDoc) : null;
		pushCol('Numero', esNumerica(colMap, 'Numero') ? (Number.isFinite(num) ? num : null) : rawDoc || null);
	}
	if (colMeta(colMap, 'Estado')) pushCol('Estado', 1);
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
	const colMap = await ensureImPasswordUsableSchema();
	const pushCol = (logical, value) => {
		const meta = colMeta(colMap, logical);
		if (!meta) return;
		campos.push(meta.nombre);
		valores.push(value);
	};

	const apellidoSafe = valorCampoSegunTipo(colMap, 'Apellido', apellido.trim()) || apellido.trim().slice(0, 80);
	const nombresSafe = valorCampoSegunTipo(colMap, 'Nombres', nombres.trim()) || nombres.trim().slice(0, 80);
	const nombreRedSafe = valorCampoSegunTipo(colMap, 'NombreRed', nombreRed.trim()) || nombreRed.trim().slice(0, 80);
	const passwordSafe = valorCampoSegunTipo(colMap, 'Password', password.trim()) || password.trim();

	const campos = ['IdEmpresa', 'ValorPersonal'];
	const valores = [emp, valorPersonal];
	pushCol('NombreRed', nombreRedSafe);
	pushCol('Password', passwordSafe);
	pushCol('Apellido', apellidoSafe);
	pushCol('Nombres', nombresSafe);
	if (colMeta(colMap, 'NumeroDocumento')) {
		pushCol('NumeroDocumento', valorCampoSegunTipo(colMap, 'NumeroDocumento', numeroDocumento));
	}
	if (colMeta(colMap, 'Legajo')) {
		const v = valorCampoSegunTipo(colMap, 'Legajo', legajo);
		if (v != null) {
			pushCol('Legajo', v);
		} else if (esNumerica(colMap, 'Legajo')) {
			pushCol('Legajo', valorPersonal);
		} else {
			pushCol('Legajo', String(valorPersonal));
		}
	}
	if (colMeta(colMap, 'CodOperador')) {
		pushCol(
			'CodOperador',
			esNumerica(colMap, 'CodOperador')
				? (Number(codOperador) || valorPersonal)
				: (String(codOperador || '').trim() || String(valorPersonal)),
		);
	}
	if (colMeta(colMap, 'Grupo')) pushCol('Grupo', 0);
	if (colMeta(colMap, 'MarcadeBaja')) {
		pushCol('MarcadeBaja', esNumerica(colMap, 'MarcadeBaja') ? 0 : '0');
	}
	if (colMeta(colMap, 'FechaActual')) {
		pushCol('FechaActual', esNumerica(colMap, 'FechaActual') ? fechaClarionHoy() : new Date());
	}
	completarObligatorias(colMap, campos, valores);
	for (let i = 0; i < campos.length; i++) {
		const meta = colMeta(colMap, campos[i]);
		if (!meta) continue;
		if (esTipoNumerico(meta.tipo) && (valores[i] === '' || valores[i] == null)) {
			valores[i] = meta.nullable ? null : campos[i].toLowerCase() === 'legajo' ? valorPersonal : 0;
		} else if (STRING_TYPES.has(meta.tipo) && valores[i] != null) {
			valores[i] = truncarSegunMeta(meta, valores[i]);
		}
	}
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
		const sqlMsg = String(err?.sqlMessage || err?.message || '');
		if (/data too long/i.test(sqlMsg)) {
			const e = new Error(
				'Un dato de texto (apellido, nombre o usuario) es más largo que lo que admite la base. Acortalo e intentá de nuevo.',
			);
			e.statusCode = 400;
			throw e;
		}
		if (/incorrect integer value/i.test(sqlMsg)) {
			const e = new Error(
				'La base rechazó un número vacío (por ejemplo Legajo). Recargá la página e intentá crear el usuario otra vez.',
			);
			e.statusCode = 400;
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

	const sectoresAsignar = (await resolverSectoresUsuario(emp, idRol, sectores)) || [];
	await reemplazarSectoresUsuario(emp, valorPersonal, sectoresAsignar);

	const serviciosAsignar = (await resolverServiciosUsuario(emp, idRol, servicios)) || [];
	await reemplazarServiciosUsuario(emp, valorPersonal, serviciosAsignar);

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

	const colMap = await ensureImPasswordUsableSchema();
	const sets = [];
	const params = [];
	const set = (col, v) => {
		const meta = colMeta(colMap, col);
		if (meta) {
			sets.push(`\`${meta.nombre}\` = ?`);
			params.push(v);
		}
	};
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

	if (body.apellido != null || body.nombres != null || body.numeroDocumento != null) {
		try {
			await asegurarFichaPersonal(emp, id, {
				apellido: body.apellido,
				nombres: body.nombres,
				numeroDocumento: body.numeroDocumento,
				idRol: body.idRol,
			});
			const pcols = await columnasMeta('imPersonal');
			const pSets = [];
			const pParams = [];
			if (pcols.has('ApellidoNombre') && (body.apellido != null || body.nombres != null)) {
				pSets.push('`ApellidoNombre` = ?');
				pParams.push(apellidoNombreDesdePartes(body.apellido, body.nombres));
			}
			if (pcols.has('Numero') && body.numeroDocumento != null) {
				pSets.push('`Numero` = ?');
				pParams.push(valorCampoSegunTipo(pcols, 'Numero', body.numeroDocumento));
			}
			if (pSets.length) {
				pParams.push(emp, id);
				await mysqlExec(
					`UPDATE \`imPersonal\` SET ${pSets.join(', ')} WHERE IdEmpresa = ? AND Valor = ?`,
					pParams,
				);
			}
		} catch (e) {
			console.warn('[nube] sync ficha personal', e.message);
		}
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
		await reemplazarSectoresUsuario(emp, id, sectoresAsignar);
	}

	const serviciosAsignar = await resolverServiciosUsuario(emp, body.idRol, body.servicios);
	if (serviciosAsignar != null) {
		await reemplazarServiciosUsuario(emp, id, serviciosAsignar);
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

async function obtenerFichaUsuario(idEmpresa, valorPersonal) {
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	if (!Number.isFinite(emp) || emp <= 0 || !Number.isFinite(vp) || vp <= 0) return null;
	let rows = [];
	try {
		rows = await mysqlQuery(
			`
    SELECT
      pw.ValorPersonal AS ValorPersonal,
      pw.NombreRed AS NombreRed,
      pw.Nombres AS Nombres,
      pw.Apellido AS Apellido,
      pw.NumeroDocumento AS NumeroDocumento,
      pw.CodOperador AS CodOperador,
      p.ApellidoNombre AS ApellidoNombre,
      p.Numero AS Numero,
      p.TipoDocumento AS TipoDocumento,
      p.Matricula AS Matricula,
      p.MatriculaNacional AS MatriculaNacional,
      p.Telefono AS Telefono,
      p.Domicilio AS Domicilio,
      p.ValorEspecialidad AS ValorEspecialidad,
      p.ValorServicio AS ValorServicio,
      p.ValorServicioParaFacturar AS ValorServicioParaFacturar,
      p.ValorCategoria AS ValorCategoria,
      p.CUIT AS CUIT,
      p.Estado AS Estado
    FROM \`imPassword\` pw
    LEFT JOIN \`imPersonal\` p
      ON p.Valor = pw.ValorPersonal AND p.IdEmpresa = pw.IdEmpresa
    WHERE pw.IdEmpresa = ? AND pw.ValorPersonal = ?
    LIMIT 1
    `,
			[emp, vp],
		);
	} catch (e) {
		console.warn('[nube] obtener ficha usuario:', e.message);
		try {
			rows = await mysqlQuery(
				`
      SELECT
        pw.ValorPersonal AS ValorPersonal,
        pw.NombreRed AS NombreRed,
        pw.Nombres AS Nombres,
        pw.Apellido AS Apellido,
        pw.NumeroDocumento AS NumeroDocumento,
        pw.CodOperador AS CodOperador,
        NULL AS ApellidoNombre,
        NULL AS Numero,
        NULL AS TipoDocumento,
        NULL AS Matricula,
        NULL AS MatriculaNacional,
        NULL AS Telefono,
        NULL AS Domicilio,
        NULL AS ValorEspecialidad,
        NULL AS ValorServicio,
        NULL AS ValorServicioParaFacturar,
        NULL AS ValorCategoria,
        NULL AS CUIT,
        NULL AS Estado
      FROM \`imPassword\` pw
      WHERE pw.IdEmpresa = ? AND pw.ValorPersonal = ?
      LIMIT 1
      `,
				[emp, vp],
			);
		} catch (e2) {
			console.warn('[nube] obtener ficha usuario (password):', e2.message);
			return null;
		}
	}
	const row = rows[0];
	if (!row) return null;
	const id = identidadDesdeFila(row);
	const numDoc = id.numeroDocumento ? Number(String(id.numeroDocumento).replace(/\D/g, '')) : null;
	return {
		valorPersonal: Number(row.ValorPersonal),
		nombreRed: String(row.NombreRed || '').trim(),
		nombres: id.nombre,
		apellido: id.apellido,
		apellidoNombre: id.apellidoNombre,
		numeroDocumento: Number.isFinite(numDoc) && numDoc > 0 ? numDoc : null,
		codOperador: row.CodOperador == null ? null : String(row.CodOperador),
		tipoDocumento: row.TipoDocumento != null ? String(row.TipoDocumento).trim() : null,
		matricula: row.Matricula != null ? Number(row.Matricula) : null,
		matriculaNacional: row.MatriculaNacional != null ? Number(row.MatriculaNacional) : null,
		telefono: row.Telefono != null ? String(row.Telefono).trim() : null,
		domicilio: row.Domicilio != null ? String(row.Domicilio).trim() : null,
		valorEspecialidad: row.ValorEspecialidad != null ? Number(row.ValorEspecialidad) : null,
		valorServicio: row.ValorServicio != null ? String(row.ValorServicio).trim() : null,
		valorServicioParaFacturar:
			row.ValorServicioParaFacturar != null ? String(row.ValorServicioParaFacturar).trim() : null,
		valorCategoria: row.ValorCategoria != null ? Number(row.ValorCategoria) : null,
		cuit: row.CUIT != null ? String(row.CUIT).trim() : null,
		estado: row.Estado != null ? Number(row.Estado) : null,
	};
}

async function actualizarFichaPerfil(idEmpresa, valorPersonal, data = {}) {
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	if (!Number.isFinite(emp) || emp <= 0 || !Number.isFinite(vp) || vp <= 0) {
		const e = new Error('Empresa o usuario inválido');
		e.statusCode = 400;
		throw e;
	}
	const apellidoNombre = String(data.ApellidoNombre || '').trim();
	const partes = splitApellidoNombre(apellidoNombre);
	await asegurarFichaPersonal(emp, vp, {
		apellido: partes.apellido,
		nombres: partes.nombres,
		numeroDocumento: data.NumeroDocumento,
	});

	const pwCols = await columnasMeta('imPassword');
	const pwSets = [];
	const pwParams = [];
	const setPw = (col, v) => {
		if (!pwCols.has(col) || v === undefined) return;
		pwSets.push(`\`${col}\` = ?`);
		pwParams.push(v);
	};
	if (partes.apellido) setPw('Apellido', partes.apellido);
	if (partes.nombres) setPw('Nombres', partes.nombres);
	if (data.NumeroDocumento != null) {
		setPw('NumeroDocumento', valorCampoSegunTipo(pwCols, 'NumeroDocumento', data.NumeroDocumento));
	}
	if (pwSets.length) {
		pwParams.push(emp, vp);
		await mysqlExec(
			`UPDATE \`imPassword\` SET ${pwSets.join(', ')} WHERE IdEmpresa = ? AND ValorPersonal = ?`,
			pwParams,
		);
	}

	const pCols = await columnasMeta('imPersonal');
	const pSets = [];
	const pParams = [];
	const setP = (col, v) => {
		if (!pCols.has(col) || v === undefined) return;
		pSets.push(`\`${col}\` = ?`);
		pParams.push(valorCampoSegunTipo(pCols, col, v));
	};
	if (apellidoNombre) setP('ApellidoNombre', apellidoNombre);
	if (data.NumeroDocumento != null) setP('Numero', data.NumeroDocumento);
	if (data.TipoDocumento != null) setP('TipoDocumento', data.TipoDocumento);
	if (data.Telefono != null) setP('Telefono', data.Telefono);
	if (data.Domicilio != null) setP('Domicilio', data.Domicilio);
	if (data.MatriculaProvincial != null) setP('Matricula', data.MatriculaProvincial);
	if (data.MatriculaNacional != null) setP('MatriculaNacional', data.MatriculaNacional);
	if (data.ValorEspecialidad != null) setP('ValorEspecialidad', data.ValorEspecialidad);
	if (data.ValorCategoria != null) setP('ValorCategoria', data.ValorCategoria);
	if (data.ValorServicio != null) setP('ValorServicio', data.ValorServicio);
	if (data.ValorServicioParaFacturar != null) {
		setP('ValorServicioParaFacturar', data.ValorServicioParaFacturar);
	}
	if (pSets.length) {
		pParams.push(emp, vp);
		await mysqlExec(`UPDATE \`imPersonal\` SET ${pSets.join(', ')} WHERE IdEmpresa = ? AND Valor = ?`, pParams);
	}
	return obtenerFichaUsuario(emp, vp);
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
	resolverSectoresUsuario,
	listarRoles,
	listarUsuariosEmpresa,
	obtenerFichaUsuario,
	actualizarFichaPerfil,
	asegurarFichaPersonal,
	crearUsuarioEmpresa,
	actualizarUsuarioEmpresa,
	desvincularUsuarioEmpresa,
	vincularUsuarioEmpresa,
	listarSectoresDeUsuario,
	listarServiciosDeUsuario,
	esRolAdmin,
	listarTablasImportables,
	previewTabla,
	importarTablas,
};
