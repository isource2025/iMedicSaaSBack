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
  if (connectionPool && connectionPool.connected) {
    return connectionPool;
  }

  try {
    console.log(`Conectando a SQL Server en ${sqlAuthConfig.server}:${sqlAuthConfig.port}`);
    connectionPool = await sql.connect(sqlAuthConfig);
    console.log('✅ Conexión establecida correctamente con autenticación SQL');
    return connectionPool;
  } catch (err) {
    console.error('❌ Error al conectar con SQL Server:', err.message);
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
