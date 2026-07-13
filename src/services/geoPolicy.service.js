/**
 * Política de geo-blocking por país (ISO 3166-1 alpha-2).
 * Por defecto solo Argentina (AR); ampliable desde panel Super Admin.
 */
const geoip = require('geoip-lite');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const { isLocalIp } = require('../config/security');

let tablesReady = false;

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
};
