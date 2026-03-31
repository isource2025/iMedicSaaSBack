const { executeQuery } = require('../models/db');

async function verDetalleConf() {
  try {
    const query = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf'
      ORDER BY ORDINAL_POSITION
    `;
    
    const result = await executeQuery(query);
    console.log('\n=== Estructura de imHCExamenesLabDetalleConf ===');
    console.table(result);
    
    // Ver algunos registros de ejemplo
    const query2 = `SELECT TOP 10 * FROM imHCExamenesLabDetalleConf`;
    const result2 = await executeQuery(query2);
    console.log('\n=== Registros de ejemplo ===');
    console.table(result2);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verDetalleConf();
