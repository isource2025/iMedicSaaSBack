/**
 * Script para verificar la estructura detallada de la tabla imEstadoMilitar
 */
require('dotenv').config();
const sql = require('mssql');

// Configuración de la conexión
const sqlConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  server: process.env.DB_SERVER,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function checkTableStructure() {
  try {
    // Conectar a la base de datos
    console.log('Intentando conectar a SQL Server...');
    await sql.connect(sqlConfig);
    console.log('✅ Conexión exitosa a la base de datos', process.env.DB_NAME);

    // Obtener estructura detallada de la tabla
    const columnsResult = await sql.query`
      SELECT 
        COLUMN_NAME, 
        DATA_TYPE, 
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imEstadoMilitar'
    `;
    
    console.log('Estructura detallada de la tabla imEstadoMilitar:');
    console.table(columnsResult.recordset);

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await sql.close();
  }
}

checkTableStructure();
