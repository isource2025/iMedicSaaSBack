/**
 * Script para obtener la estructura de la tabla impacientes
 */
const { sql } = require('../config/database');

async function getTableStructure() {
  try {
    // Conectar a la base de datos
    await sql.connect();
    console.log('Conexión establecida');

    // Consulta para obtener la estructura de la tabla
    const query = `
      SELECT 
        c.name AS ColumnName,
        t.name AS DataType,
        c.max_length AS MaxLength,
        c.precision AS Precision,
        c.scale AS Scale,
        c.is_nullable AS IsNullable
      FROM 
        sys.columns c
      INNER JOIN 
        sys.types t ON c.user_type_id = t.user_type_id
      INNER JOIN 
        sys.tables tbl ON c.object_id = tbl.object_id
      WHERE 
        tbl.name = 'impacientes'
      ORDER BY 
        c.column_id;
    `;

    const request = new sql.Request();
    const result = await request.query(query);
    
    console.log('Estructura de la tabla impacientes:');
    console.table(result.recordset);

    // Cerrar la conexión
    await sql.close();
    console.log('Conexión cerrada');
  } catch (error) {
    console.error('Error al obtener la estructura de la tabla:', error);
    // Asegurarse de cerrar la conexión en caso de error
    try {
      await sql.close();
    } catch (closeError) {
      console.error('Error al cerrar la conexión:', closeError);
    }
  }
}

// Ejecutar la función
getTableStructure();
