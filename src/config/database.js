const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLocalDevOnly() {
  return isTruthy(process.env.LOCAL_DEV_ONLY);
}

/** Hosts permitidos con LOCAL_DEV_ONLY (no producción remota). */
function isLocalSqlHost(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '(local)') return true;
  // .\\SQLEXPRESS o localhost\\SQLEXPRESS
  if (h === '.' || h.startsWith('.\\') || h.startsWith('localhost\\') || h.startsWith('127.0.0.1\\')) {
    return true;
  }
  // IPs privadas LAN (opcional si se usa SQL en red local del dev)
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h)) return true;
  return false;
}

function getPlatformDbName() {
  return process.env.DB_NAME || process.env.DB_DATABASE || '';
}

/** @returns {{ missing: string[] }} */
function validatePlatformDbEnv() {
  const missing = [];
  if (!process.env.DB_SERVER) missing.push('DB_SERVER');
  if (!process.env.DB_USER) missing.push('DB_USER');
  if (!process.env.DB_PASSWORD) missing.push('DB_PASSWORD');
  if (!getPlatformDbName()) missing.push('DB_NAME (o DB_DATABASE)');
  return { missing };
}

function buildSqlAuthConfig() {
  const { missing } = validatePlatformDbEnv();
  if (missing.length > 0) {
    throw new Error(
      `Variables de entorno de SQL Server incompletas: ${missing.join(', ')}. ` +
        'Configúralas en Railway (Variables del servicio) o en el archivo .env local.'
    );
  }

  const dbServer = process.env.DB_SERVER;
  // LOCAL_DEV_ONLY desactiva MySQL Railway; puede usarse con SQL del hospital en red
  // (181.x / VPN). Solo se bloquea si ALLOW_REMOTE_SQL=0 y el host no es local.
  const allowRemote =
    process.env.ALLOW_REMOTE_SQL == null ||
    isTruthy(process.env.ALLOW_REMOTE_SQL) ||
    process.env.ALLOW_REMOTE_SQL === '';
  if (isLocalDevOnly() && !isLocalSqlHost(dbServer) && !allowRemote) {
    throw new Error(
      `LOCAL_DEV_ONLY=1 y ALLOW_REMOTE_SQL=0: DB_SERVER="${dbServer}" no es un host local.`,
    );
  }
  if (isLocalDevOnly() && !isLocalSqlHost(dbServer)) {
    console.warn(
      `⚠ LOCAL_DEV_ONLY + SQL remota → ${dbServer} (no hay localhost:1433 o se eligió SQL físico de red)`,
    );
  }

  const server = process.env.DB_INSTANCE
    ? `${dbServer}\\${process.env.DB_INSTANCE}`
    : dbServer;
  const port = parseInt(process.env.DB_PORT, 10) || 1433;

  const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: getPlatformDbName(),
    server,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS) || 120000,
    },
    connectionTimeout: 30000,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };

  if (!process.env.DB_INSTANCE) {
    config.port = port;
  }

  return config;
}

let connectionPool;

/**
 * Establece la conexión a la base de datos si no está conectada.
 * @returns {Promise<sql.ConnectionPool>}
 */
async function connectDB() {
  // Si existe un pool y está conectado, retornarlo
  if (connectionPool && connectionPool.connected) {
    return connectionPool;
  }

  // Si existe un pool pero no está conectado, cerrarlo primero
  if (connectionPool && !connectionPool.connected) {
    try {
      await connectionPool.close();
    } catch (err) {
      console.warn('⚠️ Error al cerrar pool desconectado:', err.message);
    }
    connectionPool = null;
  }

  try {
    const sqlAuthConfig = buildSqlAuthConfig();
    const portLabel = sqlAuthConfig.port != null ? `:${sqlAuthConfig.port}` : '';
    console.log(`Conectando a SQL Server en ${sqlAuthConfig.server}${portLabel}`);
    connectionPool = new sql.ConnectionPool(sqlAuthConfig);
    await connectionPool.connect();
    console.log('✅ Conexión establecida correctamente con autenticación SQL');
    
    // Manejar eventos de error y cierre del pool
    connectionPool.on('error', err => {
      console.error('❌ Error en el pool de conexiones:', err.message);
      connectionPool = null;
    });

    return connectionPool;
  } catch (err) {
    console.error('❌ Error al conectar con SQL Server:', err.message);
    connectionPool = null;
    throw err;
  }
}

/**
 * Ejecuta una consulta SQL.
 * @param {string} query - Consulta SQL.
 * @param {Array} params - Parámetros opcionales.
 * @returns {Promise<Array>} Resultados.
 */
async function executeQuery(query, params = []) {
  try {
    const pool = await connectDB();
    const request = pool.request();

    params.forEach((param, i) => {
      request.input(`p${i}`, param);
    });

    const result = await request.query(query);
    return result.recordset || [];
  } catch (err) {
    console.error('❌ Error ejecutando consulta SQL:', err.message);
    console.error('Consulta:', query);
    throw err;
  }
}

/** Modo Render/legacy: catálogo en SQL Server vía .env */
function isPlatformSqlConfigured() {
  const { missing } = validatePlatformDbEnv();
  return missing.length === 0;
}

/** Log al arranque (Railway no usa .env del repo). */
function logPlatformDbEnvStatus() {
  if (!isPlatformSqlConfigured()) {
    console.log(
      'ℹ SQL Server plataforma (.env DB_*): no configurado — OK en Railway si AUTH_DB=1 y Empresas en MySQL',
    );
    return false;
  }
  if (isLocalDevOnly() && !isLocalSqlHost(process.env.DB_SERVER)) {
    console.warn(
      `⚠ LOCAL_DEV_ONLY + SQL remota → ${process.env.DB_SERVER} (SQL físico de red; no hay localhost:1433)`,
    );
  } else if (isLocalDevOnly() && !isLocalSqlHost(process.env.DB_SERVER) && process.env.ALLOW_REMOTE_SQL === '0') {
    console.error(
      `❌ LOCAL_DEV_ONLY=1 pero DB_SERVER=${process.env.DB_SERVER} no es local — abortar uso de producción`,
    );
    return false;
  }
  const port = process.env.DB_INSTANCE ? '(instancia nombrada)' : (process.env.DB_PORT || 1433);
  const mode = isLocalDevOnly() ? ' [LOCAL_DEV_ONLY]' : '';
  console.log(
    `✓ SQL Server plataforma${mode} → ${process.env.DB_SERVER}${typeof port === 'number' || String(port).match(/^\d/) ? `:${port}` : ` ${port}`} / ${getPlatformDbName()}`,
  );
  return true;
}

module.exports = {
  connectDB,
  executeQuery,
  sql,
  validatePlatformDbEnv,
  logPlatformDbEnvStatus,
  getPlatformDbName,
  isPlatformSqlConfigured,
};
