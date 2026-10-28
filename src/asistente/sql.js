/**
 * Consultas SQL de solo lectura sobre la base del tenant.
 * - Una sola sentencia SELECT / WITH.
 * - Corre dentro de una transacción que siempre se revierte.
 * - Bloquea tablas/columnas de credenciales.
 */
const { getRequestPool, sql } = require('../models/db');
const { repararStringsDeep } = require('../utils/clarionText');

const MAX_FILAS = Number(process.env.ASISTENTE_SQL_MAX_FILAS) || 200;
const TIMEOUT_MS = Number(process.env.ASISTENTE_SQL_TIMEOUT_MS) || 20000;
/** @deprecated Preferir permiso ASISTENTE.SQL.VER en la matriz. Env sólo como override de emergencia. */
const ROLES_SQL = new Set(
	String(process.env.ASISTENTE_SQL_ROLES || '')
		.split(',')
		.map((s) => s.trim().toUpperCase())
		.filter(Boolean),
);

const PROHIBIDAS = [
	'INSERT',
	'UPDATE',
	'DELETE',
	'MERGE',
	'DROP',
	'ALTER',
	'CREATE',
	'TRUNCATE',
	'EXEC',
	'EXECUTE',
	'GRANT',
	'REVOKE',
	'DENY',
	'BACKUP',
	'RESTORE',
	'DBCC',
	'SHUTDOWN',
	'WAITFOR',
	'OPENROWSET',
	'OPENQUERY',
	'OPENDATASOURCE',
	'OPENXML',
	'BULK',
	'RECONFIGURE',
	'KILL',
	'USE',
	'SETUSER',
	'INTO',
	'DECLARE',
];

const SENSIBLES = /\b(imPassword\w*|\w*Password\w*|\w*Passwd\w*|\w*Token\w*|\w*Secret\w*|\w*Sesion(es)?\b|\w*Session\w*|DbPasswordEnc|Empresas)\b/i;

function quitarComentariosYStrings(q) {
	return String(q || '')
		.replace(/--[^\n]*/g, ' ')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/'(?:''|[^'])*'/g, "''");
}

/** @returns {{ ok: true, sql: string } | { ok: false, error: string }} */
function validar(consulta) {
	const original = String(consulta || '').trim();
	if (!original) return { ok: false, error: 'Consulta vacía' };
	if (original.length > 8000) return { ok: false, error: 'Consulta demasiado larga' };

	const limpia = quitarComentariosYStrings(original).replace(/;\s*$/, '');
	if (limpia.includes(';')) return { ok: false, error: 'Solo se permite una sentencia' };
	if (!/^\s*(SELECT|WITH)\b/i.test(limpia)) {
		return { ok: false, error: 'Solo se permiten consultas SELECT (o WITH ... SELECT)' };
	}
	for (const kw of PROHIBIDAS) {
		if (new RegExp(`\\b${kw}\\b`, 'i').test(limpia)) {
			return { ok: false, error: `Palabra no permitida en modo lectura: ${kw}` };
		}
	}
	if (/\b(xp_|sp_)\w+/i.test(limpia)) return { ok: false, error: 'Procedimientos de sistema no permitidos' };
	if (/\bsys\.|\bmaster\.|\bmsdb\.|\btempdb\./i.test(limpia)) {
		return { ok: false, error: 'Catálogos de sistema no permitidos (usá listar_tablas / describir_tabla)' };
	}
	if (SENSIBLES.test(limpia)) {
		return { ok: false, error: 'La consulta toca tablas o columnas de credenciales/sesiones: bloqueado' };
	}
	return { ok: true, sql: original.replace(/;\s*$/, '') };
}

function puedeUsarSql(rolNombre, permisos) {
	if (Array.isArray(permisos) && permisos.includes('ASISTENTE.SQL.VER')) return true;
	const rol = String(rolNombre || '').toUpperCase();
	return ROLES_SQL.size > 0 && ROLES_SQL.has(rol);
}

function limpiarFila(row) {
	const out = {};
	for (const [k, v] of Object.entries(row || {})) {
		if (Buffer.isBuffer(v)) out[k] = `[binario ${v.length} bytes]`;
		else if (typeof v === 'string' && v.length > 1500) out[k] = `${v.slice(0, 1500)}…`;
		else out[k] = v;
	}
	return out;
}

async function ejecutarLectura(consulta, params = {}) {
	const v = validar(consulta);
	if (!v.ok) return { error: v.error };

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	const request = new sql.Request(tx);
	for (const [k, val] of Object.entries(params || {})) request.input(k, val);

	let timer;
	try {
		const resultado = await Promise.race([
			request.query(v.sql),
			new Promise((_, rej) => {
				timer = setTimeout(() => {
					try {
						request.cancel();
					} catch {
						/* noop */
					}
					rej(new Error(`Consulta cancelada por timeout (${TIMEOUT_MS} ms)`));
				}, TIMEOUT_MS);
			}),
		]);
		const rows = Array.isArray(resultado?.recordset) ? resultado.recordset : [];
		const filas = repararStringsDeep(rows.slice(0, MAX_FILAS)).map(limpiarFila);
		const sumas = sumasDeColumnas(rows);
		return {
			columnas: filas[0] ? Object.keys(filas[0]) : [],
			filas,
			total: rows.length,
			...(sumas
				? {
						sumas,
						nota: '"total" es la cantidad de filas. Para totales de una columna (ej. pacientes) usá "sumas".',
					}
				: {}),
			truncado: rows.length > MAX_FILAS,
		};
	} catch (err) {
		return { error: `SQL: ${err.message}` };
	} finally {
		clearTimeout(timer);
		try {
			await tx.rollback();
		} catch {
			/* noop */
		}
	}
}

const COLUMNA_NO_SUMABLE = /^(id|numero|nro|valor|codigo|fecha|hora|documento|matricula|dni|cuit|anio|año|mes|dia)|(^|_)id$/i;

/** Suma de las columnas numéricas de cantidades, sobre todas las filas devueltas. */
function sumasDeColumnas(rows) {
	if (!Array.isArray(rows) || rows.length < 2) return null;
	const out = {};
	for (const col of Object.keys(rows[0] || {})) {
		if (COLUMNA_NO_SUMABLE.test(col)) continue;
		const valores = rows.map((r) => r[col]).filter((v) => v != null);
		if (!valores.length || !valores.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
		out[col] = Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100;
	}
	return Object.keys(out).length ? out : null;
}

async function listarTablas(filtro) {
	const f = String(filtro || '').replace(/[^A-Za-z0-9_]/g, '');
	const r = await ejecutarLectura(
		`SELECT TOP 150 TABLE_NAME AS tabla, TABLE_TYPE AS tipo
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = 'dbo' ${f ? 'AND TABLE_NAME LIKE @f' : ''}
     ORDER BY TABLE_NAME`,
		f ? { f: `%${f}%` } : {},
	);
	if (r.error) return r;
	return { tablas: r.filas.filter((x) => !SENSIBLES.test(x.tabla)), total: r.total };
}

async function describirTabla(tabla) {
	const t = String(tabla || '').replace(/^dbo\./i, '').replace(/[^A-Za-z0-9_]/g, '');
	if (!t) return { error: 'Tabla inválida' };
	if (SENSIBLES.test(t)) return { error: 'Tabla bloqueada (credenciales/sesiones)' };
	const r = await ejecutarLectura(
		`SELECT COLUMN_NAME AS columna, DATA_TYPE AS tipo, CHARACTER_MAXIMUM_LENGTH AS largo, IS_NULLABLE AS nulo
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @t
     ORDER BY ORDINAL_POSITION`,
		{ t },
	);
	if (r.error) return r;
	if (!r.filas.length) return { error: `No existe la tabla ${t}` };
	return {
		tabla: t,
		columnas: r.filas.filter((c) => !SENSIBLES.test(c.columna)),
	};
}

module.exports = {
	validar,
	puedeUsarSql,
	ejecutarLectura,
	listarTablas,
	describirTabla,
	sumasDeColumnas,
	MAX_FILAS,
	ROLES_SQL,
};
