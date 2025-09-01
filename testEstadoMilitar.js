/**
 * Script para verificar la tabla imEstadoMilitar
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

async function testConnection() {
  try {
    // Conectar a la base de datos
    console.log('Intentando conectar a SQL Server...');
    await sql.connect(sqlConfig);
    console.log('✅ Conexión exitosa a la base de datos', process.env.DB_NAME);

    // Verificar si la tabla imEstadoMilitar existe
    const tableResult = await sql.query`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'imEstadoMilitar'
    `;
    
    if (tableResult.recordset.length > 0) {
      console.log('✅ La tabla imEstadoMilitar existe');
      
      // Verificar estructura de la tabla
      const columnsResult = await sql.query`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'imEstadoMilitar'
      `;
      
      console.log('Estructura de la tabla imEstadoMilitar:');
      console.table(columnsResult.recordset);
      
      // Obtener los datos de la tabla
      const dataResult = await sql.query`
        SELECT Valor, Descripcion FROM imEstadoMilitar
      `;
      
      console.log(`Datos de la tabla imEstadoMilitar (${dataResult.recordset.length} registros):`);
      console.table(dataResult.recordset);

      // Verificar si hay problema de mayúsculas/minúsculas en los nombres de columnas
      const rawResult = await sql.query`
        SELECT TOP 1 * FROM imEstadoMilitar
      `;
      
      if (rawResult.recordset.length > 0) {
        console.log('Nombres exactos de las columnas (case-sensitive):');
        console.log(Object.keys(rawResult.recordset[0]));
      }
      
      // Ejecutar la misma consulta que en el controlador
      const controllerQuery = await sql.query`
        SELECT Valor AS valor, Descripcion AS descripcion FROM imEstadoMilitar ORDER BY descripcion
      `;
      
      console.log(`Resultado de la consulta del controlador (${controllerQuery.recordset.length} registros):`);
      console.table(controllerQuery.recordset);
    } else {
      console.log('❌ La tabla imEstadoMilitar NO existe');
    }

  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await sql.close();
  }
}

testConnection();
