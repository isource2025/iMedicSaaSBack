const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Connect to database with fallback from SQL authentication to Windows authentication
 * @returns {Promise<object>} SQL connection object
 */
async function connectDB() {
  try {
    // Build connection string
    const server = process.env.DB_INSTANCE 
      ? `${process.env.DB_SERVER}\\${process.env.DB_INSTANCE}`
      : process.env.DB_SERVER;
    
    // Configure connection options first trying SQL authentication
    const connectionString = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      server: server,
      options: {
        encrypt: false, // For local connections in private network
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
    
    console.log(`Intentando conectar a: ${server}, Base de datos: ${process.env.DB_NAME}`);
    console.log('Credenciales: Usuario:', process.env.DB_USER);
    console.log('Configuración de conexión:', JSON.stringify({
      server: connectionString.server,
      database: connectionString.database,
      options: connectionString.options
    }, null, 2));
    
    try {
      // Try SQL Server authentication
      await sql.connect(connectionString);
      console.log('Conexión exitosa a SQL Server usando autenticación SQL');
    } catch (sqlError) {
      console.error('Error al conectar con autenticación SQL:', sqlError.message);
      console.error('Código de error:', sqlError.code);
      console.error('Detalles:', JSON.stringify(sqlError, null, 2));
      
      // If it fails, try Windows authentication
      console.log('Intentando conectar con autenticación Windows...');
      
      const windowsAuth = {
        database: process.env.DB_NAME,
        server: server,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true,
          trustedConnection: true,
          integratedSecurity: true
        },
        connectionTimeout: 30000
      };
      
      await sql.connect(windowsAuth);
      console.log('Conexión exitosa a SQL Server usando autenticación Windows');
    }
    
    return sql;
  } catch (err) {
    console.error('Error al conectar a SQL Server:', err.message);
    console.error('Código de error:', err.code);
    console.error('Número de error:', err.number);
    console.error('Estado:', err.state);
    console.error('Clase:', err.class);
    console.error('Detalles completos:', JSON.stringify(err, null, 2));
    throw err;
  }
}

/**
 * Ejecuta una consulta SQL con parámetros opcionales
 * @param {string} query - Consulta SQL a ejecutar
 * @param {Array} params - Parámetros opcionales para la consulta
 * @returns {Promise<Array>} - Resultado de la consulta
 */
async function executeQuery(query, params = []) {
  try {
    // Asegúrate de que la conexión esté establecida
    if (!sql.connected) {
      await connectDB();
    }
    
    // Preparar la solicitud
    const request = new sql.Request();
    
    // Agregar parámetros a la solicitud
    if (params && params.length > 0) {
      params.forEach((param, index) => {
        request.input(`p${index}`, param);
      });
    }
    
    console.log(`Ejecutando consulta: ${query}`);
    
    // Ejecutar la consulta
    const result = await request.query(query);
    
    console.log(`Consulta ejecutada. Filas afectadas: ${result.rowsAffected[0]}`);
    console.log(`Registros obtenidos: ${result.recordset ? result.recordset.length : 0}`);
    
    // Devolver los resultados
    return result.recordset || [];
  } catch (error) {
    console.error('Error al ejecutar consulta SQL:', error.message);
    console.error('Consulta:', query);
    console.error('Parámetros:', JSON.stringify(params));
    console.error('Detalles del error:', JSON.stringify(error, null, 2));
    throw new Error(`Error ejecutando consulta: ${error.message}`);
  }
}

module.exports = {
  connectDB,
  executeQuery,
  sql
};
