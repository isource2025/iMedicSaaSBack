const { executeQuery } = require('../models/db');

async function verEstructuraSectores() {
  try {
    console.log('\n=== Verificando estructura de imSectores ===\n');

    const consulta = `
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMNPROPERTY(OBJECT_ID(TABLE_SCHEMA + '.' + TABLE_NAME), COLUMN_NAME, 'IsIdentity') as IS_IDENTITY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imSectores'
      ORDER BY ORDINAL_POSITION
    `;

    const columnas = await executeQuery(consulta);
    console.table(columnas);

    console.log('\n=== Primeros 5 registros de imSectores ===\n');
    const datos = await executeQuery('SELECT TOP 5 * FROM imSectores');
    console.table(datos);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

verEstructuraSectores();
