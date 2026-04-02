const { executeQuery } = require('../models/db');

async function verificarIdSector() {
  try {
    console.log('\n=== Verificando columna IdSector en imHCExamenesLabCabecera ===\n');

    const consulta = `
      SELECT
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCExamenesLabCabecera'
      ORDER BY ORDINAL_POSITION
    `;

    const columnas = await executeQuery(consulta);
    console.table(columnas);

    const tieneIdSector = columnas.some(c => c.COLUMN_NAME === 'IdSector');
    
    if (!tieneIdSector) {
      console.log('\n⚠️  La columna IdSector NO EXISTE. Creándola...\n');
      
      await executeQuery(`
        ALTER TABLE imHCExamenesLabCabecera
        ADD IdSector varchar(10) NULL
      `);
      
      console.log('✅ Columna IdSector agregada correctamente\n');
    } else {
      console.log('\n✅ La columna IdSector ya existe\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

verificarIdSector();
