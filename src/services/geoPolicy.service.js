/**
 * Política de geo-blocking por país (ISO 3166-1 alpha-2).
 * Desactivado por defecto (GEO_BLOCK_ENABLED=0) — Starlink y VPNs suelen
 * resolver a países distintos de AR. Activar solo si hace falta.
 */
const geoip = require('geoip-lite');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const { isLocalIp } = require('../config/security');

let tablesReady = false;
/** Cache corto del flag en imPlataformaConfig */
let geoFlagCache = { value: null, at: 0 };
const GEO_FLAG_TTL_MS = 30_000;

function parseBoolFlag(raw) {
	const v = String(raw ?? '')
		.trim()
		.toLowerCase();
	if (['1', 'true', 'on', 'yes', 'si', 'sí'].includes(v)) return true;
	if (['0', 'false', 'off', 'no'].includes(v)) return false;
	return null;
}

/**
 * Geo-blocking: OFF por defecto.
 * Prioridad: GEO_BLOCK_ENABLED (env) → imPlataformaConfig GEO_BLOCK_ENABLED → false
 */
async function isGeoBlockEnabled() {
	const fromEnv = parseBoolFlag(process.env.GEO_BLOCK_ENABLED);
	if (fromEnv !== null) return fromEnv;

	if (!isAuthCentralEnabled()) return false;

	const now = Date.now();
	if (geoFlagCache.value !== null && now - geoFlagCache.at < GEO_FLAG_TTL_MS) {
		return geoFlagCache.value;
	}

	try {
		const pool = await getAuthCentralPool();
		const [rows] = await pool.query(
			`SELECT Valor FROM imPlataformaConfig WHERE Clave = 'GEO_BLOCK_ENABLED' LIMIT 1`,
		);
		const parsed = parseBoolFlag(rows[0]?.Valor);
		geoFlagCache = { value: parsed === true, at: now };
		return geoFlagCache.value;
	} catch {
		geoFlagCache = { value: false, at: now };
		return false;
	}
}

async function setGeoBlockEnabled(activo) {
	const on = Boolean(activo);
	if (!isAuthCentralEnabled()) {
		geoFlagCache = { value: on, at: Date.now() };
		return on;
	}
	const pool = await getAuthCentralPool();
	await pool.query(
		`INSERT INTO imPlataformaConfig (Clave, Valor, FechaMod)
     VALUES ('GEO_BLOCK_ENABLED', ?, NOW())
     ON DUPLICATE KEY UPDATE Valor = VALUES(Valor), FechaMod = NOW()`,
		[on ? '1' : '0'],
	);
	geoFlagCache = { value: on, at: Date.now() };
	return on;
}

async function ensureTables() {
	if (!isAuthCentralEnabled() || tablesReady) return;
	const pool = await getAuthCentralPool();
	await pool.query(`
    CREATE TABLE IF NOT EXISTS AuthPaisesPermitidos (
      CodigoISO CHAR(2) PRIMARY KEY,
      Nombre VARCHAR(128) NOT NULL,
      Activo TINYINT(1) NOT NULL DEFAULT 1,
      CreadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM AuthPaisesPermitidos`);
	if (Number(rows[0]?.c || 0) === 0) {
		await pool.query(
			`INSERT INTO AuthPaisesPermitidos (CodigoISO, Nombre, Activo) VALUES ('AR', 'Argentina', 1)`,
		);
	}
	tablesReady = true;
}

function countryFromIp(ip) {
	if (!ip || isLocalIp(ip)) return 'LOCAL';
	const lookup = geoip.lookup(String(ip).replace(/^::ffff:/, ''));
	return lookup?.country ? String(lookup.country).toUpperCase() : null;
}

async function listarPaises() {
	if (!isAuthCentralEnabled()) return [{ CodigoISO: 'AR', Nombre: 'Argentina', Activo: 1 }];
	await ensureTables();
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`SELECT CodigoISO, Nombre, Activo FROM AuthPaisesPermitidos ORDER BY Nombre`,
	);
	return rows;
}

async function upsertPais(codigoISO, nombre, activo = true) {
	await ensureTables();
	const code = String(codigoISO || '')
		.trim()
		.toUpperCase()
		.slice(0, 2);
	if (!/^[A-Z]{2}$/.test(code)) {
		const e = new Error('Código ISO de país inválido');
		e.statusCode = 400;
		throw e;
	}
	const pool = await getAuthCentralPool();
	await pool.query(
		`INSERT INTO AuthPaisesPermitidos (CodigoISO, Nombre, Activo)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE Nombre = VALUES(Nombre), Activo = VALUES(Activo)`,
		[code, String(nombre || code).slice(0, 128), activo ? 1 : 0],
	);
	return listarPaises();
}

async function setPaisActivo(codigoISO, activo) {
	await ensureTables();
	const code = String(codigoISO || '')
		.trim()
		.toUpperCase();
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthPaisesPermitidos SET Activo = ? WHERE CodigoISO = ?`, [
		activo ? 1 : 0,
		code,
	]);
	return listarPaises();
}

async function isPaisPermitido(codigoISO) {
	if (!codigoISO || codigoISO === 'LOCAL') return true;
	if (!isAuthCentralEnabled()) return codigoISO === 'AR';
	await ensureTables();
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`SELECT 1 FROM AuthPaisesPermitidos WHERE CodigoISO = ? AND Activo = 1 LIMIT 1`,
		[String(codigoISO).toUpperCase()],
	);
	return rows.length > 0;
}

async function assertIpPermitida(ip) {
	if (!(await isGeoBlockEnabled())) {
		return countryFromIp(ip) || 'BYPASS';
	}
	const country = countryFromIp(ip);
	if (country === 'LOCAL') return country;
	const ok = await isPaisPermitido(country);
	if (!ok) {
		const e = new Error('Acceso no disponible desde su región');
		e.statusCode = 403;
		e.country = country;
		throw e;
	}
	return country;
}

module.exports = {
	ensureTables,
	countryFromIp,
	listarPaises,
	upsertPais,
	setPaisActivo,
	isPaisPermitido,
	assertIpPermitida,
	isGeoBlockEnabled,
	setGeoBlockEnabled,
};
