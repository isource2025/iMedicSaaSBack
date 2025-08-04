/**
 * Script simplificado para verificar la estructura de imEstadoMilitar
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

async function checkTable() {
  try {
    // Conectar a la base de datos
    await sql.connect(sqlConfig);
    console.log('Conexión exitosa');
    
    // Revisar estructura
    const result = await sql.query`
      SELECT 
        c.name AS 'ColumnName', 
        t.name AS 'DataType',
        c.max_length AS 'MaxLength',
        c.is_nullable AS 'IsNullable'
      FROM 
        sys.columns c
      INNER JOIN 
        sys.types t ON c.user_type_id = t.user_type_id
      WHERE 
        c.object_id = OBJECT_ID('imEstadoMilitar')
    `;
    
    console.log('Estructura de la tabla imEstadoMilitar:');
    console.log(result.recordset);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.close();
  }
}

checkTable();
