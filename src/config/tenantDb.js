/**
 * Pools de conexión por empresa (tenant).
 * Toda la conexión SQL sale de Empresas (MySQL o SQL Server): DbServer, DbPort, DbName, DbUser, DbPassword.
 */
const sql = require('mssql');
const { connectDB: connectPlatform, isPlatformSqlConfigured } = require('./database');
const {
	normalizeEmpresaRow,
	resolvePasswordFromEmpresaRow,
	empresaRowHasSqlConnection,
} = require('../utils/empresaDbConnection');
const authCentralService = require('../services/authCentral.service');
const { TtlCache } = require('../utils/ttlCache');
const { sumarCacheHit } = require('../context/requestTiming');

/** @type {Map<number, { pool: sql.ConnectionPool, key: string }>} */
const poolCache = new Map();
/** Conexiones en curso: evita N pools simultáneos al mismo SQL (Sarmiento, etc.). */
const connectInflight = new Map();
let empresasColumnsCache = null;

/**
 * Fila de conexión de Empresas por idEmpresa. Antes se releía de MySQL en
 * CADA executeQuery (una query MySQL extra por cada query SQL Server).
 * TTL corto: los cambios desde Super Admin pasan por invalidateTenantPool,
 * y cualquier otro cambio se ve en ≤ TENANT_EMPRESA_CACHE_MS.
 */
const empresaRowCache = new TtlCache({
	ttlMs: 120_000, // fila de Empresas: 2 min; se invalida al reconfigurar el tenant
	max: 500,
	nombre: 'empresaRow',
});

const PROBE_MS = Number(process.env.TENANT_CONNECT_TIMEOUT_MS) || 12000;
const REQUEST_MS = Number(process.env.TENANT_REQUEST_TIMEOUT_MS) || 120000;

function isLocalDevOnly() {
	return ['1', 'true', 'yes', 'on'].includes(
		String(process.env.LOCAL_DEV_ONLY || '').trim().toLowerCase(),
	);
}

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
			requestTimeout: REQUEST_MS,
		},
		connectionTimeout: PROBE_MS,
		pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
	};
}

function rowToSqlConfig(row) {
	const empresa = normalizeEmpresaRow(row);
	const authCentral = authCentralService.isAuthCentralEnabled();

	if (isLocalDevOnly() && isPlatformSqlConfigured() && !authCentral) {
		console.log('[tenantDb] LOCAL_DEV_ONLY=1 → conexión tenant desde .env DB_* (ignora DbServer remoto en Empresas)');
		return envDefaultConfig();
	}
	if (!empresaRowHasSqlConnection(empresa)) {
		// SaaS: cada empresa tiene su SQL en MySQL Empresas — nunca mezclar con .env DB_*.
		if (authCentral) {
			const id = empresa.IDEMPRESA ?? '?';
			const err = new Error(
				`Falta conexión SQL en Empresas (ID ${id}): completá DbServer, DbName, DbUser y contraseña (DbPassword o DbPasswordEnc).`,
			);
			err.code = 'TENANT_DB_NOT_CONFIGURED';
			throw err;
		}
		if (isPlatformSqlConfigured()) {
			return envDefaultConfig();
		}
		const err = new Error(
			'Falta conexión SQL en Empresas: DbServer, DbName, DbUser y contraseña (DbPassword o DbPasswordEnc)',
		);
		err.code = 'TENANT_DB_NOT_CONFIGURED';
		throw err;
	}

	const server = String(empresa.DbServer).trim();
	const password = resolvePasswordFromEmpresaRow(empresa);
	const hasExplicitPort =
		empresa.DbPort != null && empresa.DbPort !== '' && Number.isFinite(Number(empresa.DbPort));
	const port = hasExplicitPort ? Number(empresa.DbPort) : 1433;

	const config = {
		server,
		database: String(empresa.DbName).trim(),
		user: String(empresa.DbUser).trim(),
		password,
		options: {
			encrypt: false,
			trustServerCertificate: true,
			enableArithAbort: true,
			requestTimeout: REQUEST_MS,
		},
		connectionTimeout: PROBE_MS,
		pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
	};

	// Puerto TCP explícito (típico en cloud → SQL on-prem): no mezclar instanceName (SQLEXPRESS).
	if (hasExplicitPort) {
		config.port = port;
	} else {
		const instance =
			empresa.DbInstance != null ? String(empresa.DbInstance).trim() : '';
		if (instance) {
			config.options.instanceName = instance;
		} else {
			config.port = 1433;
		}
	}

	return config;
}

function configCacheKey(config) {
	return `${config.server}|${config.port}|${config.database}|${config.user}|${config.options?.instanceName || ''}`;
}

/**
 * Lee fila de conexión desde BD plataforma (con cache en memoria).
 */
async function loadEmpresaConnectionRow(idEmpresa) {
	const key = String(Number(idEmpresa));
	const cached = empresaRowCache.get(key);
	if (cached !== undefined) {
		sumarCacheHit();
		return cached;
	}
	return empresaRowCache.getOrLoad(key, () => loadEmpresaConnectionRowSinCache(idEmpresa));
}

async function loadEmpresaConnectionRowSinCache(idEmpresa) {
	if (authCentralService.isAuthCentralEnabled()) {
		try {
			const rowCentral = await authCentralService.obtenerEmpresaPorId(idEmpresa);
			if (rowCentral) return normalizeEmpresaRow(rowCentral);
			if (!isPlatformSqlConfigured()) {
				const err = new Error(
					`Empresa ${idEmpresa} no encontrada en MySQL (tabla Empresas). Revisá IDEMPRESA y datos DbServer/DbPassword.`,
				);
				err.code = 'TENANT_EMPRESA_NOT_FOUND';
				throw err;
			}
		} catch (e) {
			if (e.code === 'TENANT_EMPRESA_NOT_FOUND') throw e;
			console.warn(`[authCentral] loadEmpresaConnectionRow ${idEmpresa}:`, e.message);
		}
	}
	if (!isPlatformSqlConfigured()) {
		const err = new Error(
			'Catálogo SQL plataforma no configurado y no se pudo leer Empresas desde MySQL.',
		);
		err.code = 'TENANT_DB_NOT_CONFIGURED';
		throw err;
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
        ${c('DbPasswordEnc')},
        ${c('FileServerUrl')}
      FROM dbo.Empresas
      WHERE IDEMPRESA = @id
    `);
	return normalizeEmpresaRow(result.recordset[0] || null);
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

	const inflightKey = `${id}|${key}`;
	const pending = connectInflight.get(inflightKey);
	if (pending) return pending;

	const connecting = (async () => {
		const existing = poolCache.get(id);
		if (existing && existing.key === key && existing.pool.connected) {
			return existing.pool;
		}
		if (existing?.pool) {
			try {
				await existing.pool.close();
			} catch {
				/* ignore */
			}
			poolCache.delete(id);
		}

		const pool = new sql.ConnectionPool(config);
		pool.on('error', (err) => {
			console.error(`[tenant] error pool empresa ${id}:`, err.message);
			poolCache.delete(id);
		});
		try {
			await pool.connect();
			console.log(
				`[tenant] pool empresa ${id} → ${config.server}${config.port ? `:${config.port}` : ''}/${config.database}`,
			);
		} catch (e) {
			console.error(
				`[tenant] SQL empresa ${id} → ${config.server}${config.port ? `:${config.port}` : ''}/${config.database}:`,
				e.message,
			);
			throw e;
		}
		poolCache.set(id, { pool, key });
		return pool;
	})();

	connectInflight.set(inflightKey, connecting);
	try {
		return await connecting;
	} finally {
		connectInflight.delete(inflightKey);
	}
}

/** Invalida pool cacheado tras cambiar credenciales SQL en Empresas (MySQL). */
function invalidateTenantPool(idEmpresa) {
	const id = Number(idEmpresa);
	empresaRowCache.delete(String(id));
	for (const k of [...connectInflight.keys()]) {
		if (k.startsWith(`${id}|`)) connectInflight.delete(k);
	}
	const cached = poolCache.get(id);
	if (cached?.pool) {
		cached.pool.close().catch(() => {});
	}
	poolCache.delete(id);
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

/** Purga la fila Empresas cacheada (sin cerrar el pool). */
function invalidateEmpresaRowCache(idEmpresa) {
	if (idEmpresa == null) {
		empresaRowCache.clear();
		return;
	}
	empresaRowCache.delete(String(Number(idEmpresa)));
}

module.exports = {
	getTenantPool,
	loadEmpresaConnectionRow,
	invalidateEmpresaRowCache,
	rowToSqlConfig,
	configCacheKey,
	testTenantConnection,
	invalidateTenantPool,
	envDefaultConfig,
};
