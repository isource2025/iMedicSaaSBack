const { executeQuery } = require('../models/db');

async function verEstructuraCabecera() {
  try {
    console.log('\n=== Verificando estructura de imHCExamenesLabCabecera ===\n');

    const consulta = `
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCExamenesLabCabecera'
      ORDER BY ORDINAL_POSITION
    `;

    const columnas = await executeQuery(consulta);
    console.table(columnas);

    console.log('\n=== Primeros 3 registros de imHCExamenesLabCabecera ===\n');
    const datos = await executeQuery('SELECT TOP 3 * FROM imHCExamenesLabCabecera');
    console.table(datos);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

verEstructuraCabecera();
