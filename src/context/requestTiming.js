/**
 * Medición por request: cuánto se fue en MySQL (auth/plataforma), cuánto en
 * SQL Server (tenant) y cuánto en total. Se expone como header `Server-Timing`
 * para verlo en DevTools (pestaña Network → Timing) sin tocar el front.
 *
 * Usa un AsyncLocalStorage propio para que db.js y authCentralDb puedan sumar
 * tiempos sin recibir `req` por parámetro.
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function nuevoStore() {
	return {
		t0: process.hrtime.bigint(),
		mysqlMs: 0,
		mysqlN: 0,
		sqlMs: 0,
		sqlN: 0,
		cacheHits: 0,
	};
}

function store() {
	return storage.getStore() || null;
}

function msDesde(hr) {
	return Number(process.hrtime.bigint() - hr) / 1e6;
}

/** Suma una query MySQL al request actual (si lo hay). */
function sumarMysql(ms) {
	const s = store();
	if (!s) return;
	s.mysqlMs += ms;
	s.mysqlN += 1;
}

/** Suma una query SQL Server al request actual (si lo hay). */
function sumarSql(ms) {
	const s = store();
	if (!s) return;
	s.sqlMs += ms;
	s.sqlN += 1;
}

function sumarCacheHit() {
	const s = store();
	if (s) s.cacheHits += 1;
}

/** Mide una promesa y la acumula en la categoría indicada. */
async function medir(categoria, fn) {
	const t = process.hrtime.bigint();
	try {
		return await fn();
	} finally {
		const ms = msDesde(t);
		if (categoria === 'mysql') sumarMysql(ms);
		else if (categoria === 'sql') sumarSql(ms);
	}
}

function headerServerTiming(s) {
	const total = msDesde(s.t0);
	const partes = [
		`mysql;dur=${s.mysqlMs.toFixed(1)};desc="MySQL x${s.mysqlN}"`,
		`sqlserver;dur=${s.sqlMs.toFixed(1)};desc="SQL Server x${s.sqlN}"`,
		`cache;desc="hits ${s.cacheHits}"`,
		`total;dur=${total.toFixed(1)}`,
	];
	return partes.join(', ');
}

/**
 * Middleware Express: abre el contexto de medición y agrega Server-Timing
 * justo antes de escribir los headers (sirve también para SSE y streams).
 */
function requestTimingMiddleware(req, res, next) {
	const s = nuevoStore();
	const writeHead = res.writeHead;
	res.writeHead = function patchedWriteHead(...args) {
		if (!res.headersSent) {
			try {
				res.setHeader('Server-Timing', headerServerTiming(s));
				if (!res.getHeader('Timing-Allow-Origin')) {
					res.setHeader('Timing-Allow-Origin', '*');
				}
			} catch {
				/* headers ya enviados o no modificables */
			}
		}
		return writeHead.apply(this, args);
	};
	return storage.run(s, () => next());
}

module.exports = {
	requestTimingMiddleware,
	medir,
	sumarMysql,
	sumarSql,
	sumarCacheHit,
	store,
};
