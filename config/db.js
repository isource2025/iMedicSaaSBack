const sql = require('mssql');
const dotenv = require('dotenv');

dotenv.config();

// Función para conectar a la base de datos
async function connectDB() {
  try {
    // Construir cadena de conexión
    const server = process.env.DB_INSTANCE 
      ? `${process.env.DB_SERVER}\\${process.env.DB_INSTANCE}`
      : process.env.DB_SERVER;
    
    // Configurar opciones de conexión probando primero autenticación SQL
    const connectionString = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      server: server,
      options: {
        encrypt: false, // Para conexiones locales en red privada
        trustServerCertificate: true,
        enableArithAbort: true
      },
      connectionTimeout: 30000
    };
    
    console.log(`Intentando conectar a: ${server}, Base de datos: ${process.env.DB_NAME}`);
    
    try {
      // Intentar con autenticación SQL Server
      await sql.connect(connectionString);
      console.log('Conexión exitosa a SQL Server usando autenticación SQL');
    } catch (sqlError) {
      console.error('Error al conectar con autenticación SQL:', sqlError.message);
      
      // Si falla, intentar con autenticación de Windows
      console.log('Intentando conectar con autenticación de Windows...');
      
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
      console.log('Conexión exitosa a SQL Server usando autenticación de Windows');
    }
    
    return sql;
  } catch (err) {
    console.error('Error al conectar a SQL Server:', err.message);
    console.error('Detalles adicionales:', err);
    throw err;
  }
}

module.exports = {
  connectDB,
  sql
};
