/**
 * Conexión directa a la BD SQL Server de cada tenant, para scripts de
 * mantenimiento que corren fuera del ciclo de request (sin tenantContext).
 */
const sql = require('mssql');
const { getAuthCentralPool } = require('../../src/config/authCentralDb');
const {
	normalizeEmpresaRow,
	resolvePasswordFromEmpresaRow,
} = require('../../src/utils/empresaDbConnection');

/** Carga el .env del backend con la misma precedencia que el server. */
function cargarEntorno() {
	require('dotenv').config();
	require('dotenv').config({ path: '.env.railway.local', override: true });
	process.env.LOCAL_DEV_ONLY = '0';
	process.env.AUTH_DB_ENABLED = '1';
}

/** @param {number[]} ids vacío = todas las empresas del catálogo */
async function obtenerEmpresas(ids = []) {
	const mysql = await getAuthCentralPool();
	try {
		const where = ids.length ? `WHERE IDEMPRESA IN (${ids.map(() => '?').join(', ')})` : '';
		const [filas] = await mysql.query(
			`SELECT * FROM Empresas ${where} ORDER BY IDEMPRESA`,
			ids,
		);
		return filas.map(normalizeEmpresaRow);
	} finally {
		await mysql.end();
	}
}

async function conectar(empresa) {
	return new sql.ConnectionPool({
		server: String(empresa.DbServer),
		port: Number(empresa.DbPort) || 1433,
		user: String(empresa.DbUser),
		password: resolvePasswordFromEmpresaRow(empresa),
		database: String(empresa.DbName),
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 20000,
		requestTimeout: 180000,
	}).connect();
}

/** '--empresas=1,100' | '--todas' -> lista de ids (vacía = todas) */
function parsearEmpresas(argv) {
	if (argv.includes('--todas')) return [];
	const arg = argv.find((a) => a.startsWith('--empresas=') || a.startsWith('--empresa='));
	if (!arg) return null;
	return arg
		.split('=')[1]
		.split(',')
		.map((n) => Number(n.trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
}

module.exports = { sql, cargarEntorno, obtenerEmpresas, conectar, parsearEmpresas };
