const { executeQuery } = require('../models/db');

async function verEstructuraTabla() {
  try {
    const query = `
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') as IS_IDENTITY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCExamenesLabCabecera'
      ORDER BY ORDINAL_POSITION
    `;
    
    const result = await executeQuery(query);
    
    console.log('\n=== Estructura de imHCExamenesLabCabecera ===');
    console.table(result);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verEstructuraTabla();
