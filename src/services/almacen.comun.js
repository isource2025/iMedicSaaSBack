/**
 * Helpers compartidos por los servicios de almacén sobre tablas Clarion.
 */
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { partesFechaHoraArgentina, ahoraWallArgentinaParaSql } = require('../utils/dateUtils');

function httpError(mensaje, statusCode = 400) {
	const e = new Error(mensaje);
	e.statusCode = statusCode;
	return e;
}

function trim(v) {
	if (v == null) return null;
	const s = String(v).replace(/\u0000/g, '').trim();
	return s || null;
}

function num(v) {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function pagina(page, pageSize, max = 100, def = 40) {
	const p = Math.max(1, parseInt(page, 10) || 1);
	const size = Math.min(max, Math.max(1, parseInt(pageSize, 10) || def));
	return { page: p, pageSize: size, offset: (p - 1) * size };
}

/** Código de operador del JWT (Aud_Usuario es smallint). */
function audUserDe(auth) {
	const u = auth?.usuario || {};
	for (const c of [u.codOperador, u.idCodOperador, auth?.idCodOperador]) {
		const n = c != null && c !== '' ? Number(c) : NaN;
		if (Number.isFinite(n) && n > 0 && n <= 32767) return n;
	}
	return null;
}

/**
 * Como audUserDe, pero si el JWT no trae CodOperador lo busca en imPassword por la ficha
 * (ValorPersonal) del mismo usuario. Clarion deja Aud_Usuario / IdEmpleado en NULL si no.
 */
async function resolverAudUser(auth) {
	const directo = audUserDe(auth);
	if (directo != null) return directo;
	const u = auth?.usuario || {};
	const vp = Number(u.id ?? u.idValorpersonal ?? u.idValorPersonal ?? u.valorPersonal);
	if (!Number.isFinite(vp) || vp <= 0) return null;
	const rows = await executeQuery(
		`SELECT TOP 1 CodOperador FROM dbo.imPassword WITH (NOLOCK)
     WHERE ValorPersonal = @p0 AND CodOperador > 0 AND CodOperador <= 32767
     ORDER BY CodOperador`,
		[{ value: vp, type: 'Int' }],
	);
	const n = Number(rows?.[0]?.CodOperador);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Fecha y hora "de pared" de Argentina, en la convención UTC que usa tedious. */
function ahoraCtx() {
	const { fecha } = partesFechaHoraArgentina();
	const ahora = ahoraWallArgentinaParaSql();
	return { ahora, fecha: new Date(`${fecha}T00:00:00Z`), anio: Number(fecha.slice(0, 4)) };
}

/** Error 2627/2601 (clave duplicada) o 547 (FK) de SQL Server. */
function esErrorSql(e, ...numeros) {
	const n = e?.number ?? e?.originalError?.info?.number;
	return numeros.includes(n);
}

async function enTransaccion(fn) {
	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const out = await fn(tx);
		await tx.commit();
		return out;
	} catch (e) {
		try {
			await tx.rollback();
		} catch (_) {
			/* ignore */
		}
		throw e;
	}
}

module.exports = {
	httpError,
	trim,
	num,
	pagina,
	audUserDe,
	resolverAudUser,
	ahoraCtx,
	esErrorSql,
	enTransaccion,
	sql,
};
