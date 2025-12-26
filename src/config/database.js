const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

const DB_PORT = parseInt(process.env.DB_PORT, 10);

const server = process.env.DB_INSTANCE
  ? `${process.env.DB_SERVER}\\${process.env.DB_INSTANCE}`
  : process.env.DB_SERVER;

const sqlAuthConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER,
  port: DB_PORT || 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  connectionTimeout: 30000,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

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
    console.log(`Conectando a SQL Server en ${sqlAuthConfig.server}:${sqlAuthConfig.port}`);
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

module.exports = {
  connectDB,
  executeQuery,
  sql
};
