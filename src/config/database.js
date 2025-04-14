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
      connectionTimeout: 30000
    };
    
    console.log(`Attempting to connect to: ${server}, Database: ${process.env.DB_NAME}`);
    
    try {
      // Try SQL Server authentication
      await sql.connect(connectionString);
      console.log('Successful connection to SQL Server using SQL authentication');
    } catch (sqlError) {
      console.error('Error connecting with SQL authentication:', sqlError.message);
      
      // If it fails, try Windows authentication
      console.log('Trying to connect with Windows authentication...');
      
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
      console.log('Successful connection to SQL Server using Windows authentication');
    }
    
    return sql;
  } catch (err) {
    console.error('Error connecting to SQL Server:', err.message);
    console.error('Additional details:', err);
    throw err;
  }
}

module.exports = {
  connectDB,
  sql
};
