/**
 * Pools de conexión por empresa (tenant).
 * Toda la conexión SQL sale de Empresas (MySQL o SQL Server): DbServer, DbPort, DbName, DbUser, DbPassword.
 */
const sql = require('mssql');
const { connectDB: connectPlatform, isPlatformSqlConfigured } = require('./database');
const {
	resolvePasswordFromEmpresaRow,
	empresaRowHasSqlConnection,
} = require('../utils/empresaDbConnection');
const authCentralService = require('../services/authCentral.service');

/** @type {Map<number, { pool: sql.ConnectionPool, key: string }>} */
const poolCache = new Map();
let empresasColumnsCache = null;

const PROBE_MS = Number(process.env.TENANT_CONNECT_TIMEOUT_MS) || 12000;

/** Misma estrategia que database.js: IP + puerto (sin instanceName salvo que esté en la fila Empresas). */
function envDefaultConfig() {
	return {
		server: process.env.DB_SERVER,
		port: parseInt(process.env.DB_PORT, 10) || 1433,
		database: process.env.DB_NAME,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		options: {
			encrypt: false,
			trustServerCertificate: true,
			enableArithAbort: true,
		},
		connectionTimeout: PROBE_MS,
		pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
	};
}

function rowToSqlConfig(row) {
	if (!empresaRowHasSqlConnection(row)) {
		if (isPlatformSqlConfigured()) {
			return envDefaultConfig();
		}
		const err = new Error(
			'Falta conexión SQL en Empresas: DbServer, DbName, DbUser y DbPassword (o DbPasswordEnc válido)',
		);
		err.code = 'TENANT_DB_NOT_CONFIGURED';
		throw err;
	}

	const server = String(row.DbServer).trim();
	const password = resolvePasswordFromEmpresaRow(row);

	const config = {
		server,
		port: row.DbPort != null && row.DbPort !== '' ? Number(row.DbPort) : 1433,
		database: String(row.DbName).trim(),
		user: String(row.DbUser).trim(),
		password,
		options: {
			encrypt: false,
			trustServerCertificate: true,
			enableArithAbort: true,
		},
		connectionTimeout: PROBE_MS,
		pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
	};

	const instance = row.DbInstance != null ? String(row.DbInstance).trim() : '';
	if (instance) {
		config.options.instanceName = instance;
	}

	return config;
}

function configCacheKey(config) {
	return `${config.server}|${config.port}|${config.database}|${config.user}|${config.options?.instanceName || ''}`;
}

/**
 * Lee fila de conexión desde BD plataforma.
 */
async function loadEmpresaConnectionRow(idEmpresa) {
	if (authCentralService.isAuthCentralEnabled()) {
		try {
			const rowCentral = await authCentralService.obtenerEmpresaPorId(idEmpresa);
			if (rowCentral) return rowCentral;
		} catch (e) {
			console.warn(`[authCentral] loadEmpresaConnectionRow ${idEmpresa}:`, e.message);
		}
	}
	const pool = await connectPlatform();
	if (!empresasColumnsCache) {
		const cols = await pool.request().query(`
      SELECT LOWER(name) AS col
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.Empresas')
    `);
		empresasColumnsCache = new Set((cols.recordset || []).map((r) => String(r.col || '').trim()));
	}
	const c = (name) =>
		empresasColumnsCache.has(String(name).toLowerCase()) ? name : `NULL AS ${name}`;
	const result = await pool
		.request()
		.input('id', sql.Int, Number(idEmpresa))
		.query(`
      SELECT TOP 1
        IDEMPRESA,
        DESCRIPCION,
        ${c('DbServer')},
        ${c('DbPort')},
        ${c('DbInstance')},
        ${c('DbName')},
        ${c('DbUser')},
        ${c('DbPassword')},
        ${c('DbPasswordEnc')}
      FROM dbo.Empresas
      WHERE IDEMPRESA = @id
    `);
	return result.recordset[0] || null;
}

async function getTenantPool(idEmpresa) {
	if (idEmpresa == null || idEmpresa === '' || idEmpresa === 0 || idEmpresa === '0') {
		return connectPlatform();
	}

	const id = Number(idEmpresa);
	if (!Number.isFinite(id) || id <= 0) {
		return connectPlatform();
	}

	const row = await loadEmpresaConnectionRow(id);
	const config = rowToSqlConfig(row);
	const key = configCacheKey(config);

	const cached = poolCache.get(id);
	if (cached && cached.key === key && cached.pool.connected) {
		return cached.pool;
	}

	if (cached?.pool) {
		try {
			await cached.pool.close();
		} catch {
			/* ignore */
		}
	}

	const pool = new sql.ConnectionPool(config);
	await pool.connect();
	poolCache.set(id, { pool, key });
	return pool;
}

async function testTenantConnection(configOrIdEmpresa) {
	let config;
	if (typeof configOrIdEmpresa === 'number' || typeof configOrIdEmpresa === 'string') {
		const row = await loadEmpresaConnectionRow(Number(configOrIdEmpresa));
		config = rowToSqlConfig(row);
	} else {
		config = rowToSqlConfig(configOrIdEmpresa);
	}

	const pool = new sql.ConnectionPool(config);
	try {
		await pool.connect();
		await pool.request().query('SELECT 1 AS ok');
		return { ok: true };
	} finally {
		try {
			await pool.close();
		} catch {
			/* ignore */
		}
	}
}

module.exports = {
	getTenantPool,
	loadEmpresaConnectionRow,
	rowToSqlConfig,
	configCacheKey,
	testTenantConnection,
	envDefaultConfig,
};
