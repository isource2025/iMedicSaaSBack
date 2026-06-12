const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

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
  const port = process.env.DB_INSTANCE ? '(instancia nombrada)' : (process.env.DB_PORT || 1433);
  console.log(
    `✓ SQL Server plataforma → ${process.env.DB_SERVER}${typeof port === 'number' || String(port).match(/^\d/) ? `:${port}` : ` ${port}`} / ${getPlatformDbName()}`,
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
