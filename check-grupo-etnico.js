/**
 * Script para verificar la estructura de la tabla imGrupoEtnico
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
        c.object_id = OBJECT_ID('imGrupoEtnico')
    `;
    
    console.log('Estructura de la tabla imGrupoEtnico:');
    console.log(result.recordset);
    
    // Ver si tiene datos
    const dataResult = await sql.query`SELECT * FROM imGrupoEtnico`;
    console.log(`Número de registros en imGrupoEtnico: ${dataResult.recordset.length}`);
    
    if (dataResult.recordset.length > 0) {
      console.log('Primeros 5 registros:');
      console.table(dataResult.recordset.slice(0, 5));
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.close();
  }
}

checkTable();
