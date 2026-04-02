const { executeQuery } = require('../models/db');

async function fixIdSectorTipo() {
  try {
    console.log('\n=== Corrigiendo tipo de dato de IdSector ===\n');

    // Verificar si hay datos en la columna
    const datos = await executeQuery('SELECT IdSector FROM imHCExamenesLabCabecera WHERE IdSector IS NOT NULL');
    console.log(`Registros con IdSector: ${datos.length}`);

    if (datos.length > 0) {
      console.log('⚠️  Hay datos en IdSector. Limpiando antes de cambiar tipo...');
      await executeQuery('UPDATE imHCExamenesLabCabecera SET IdSector = NULL');
    }

    // Eliminar la columna
    console.log('Eliminando columna IdSector (int)...');
    await executeQuery('ALTER TABLE imHCExamenesLabCabecera DROP COLUMN IdSector');

    // Agregar la columna con el tipo correcto
    console.log('Agregando columna IdSector (varchar)...');
    await executeQuery('ALTER TABLE imHCExamenesLabCabecera ADD IdSector varchar(10) NULL');

    console.log('\n✅ Columna IdSector corregida a varchar(10)\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixIdSectorTipo();
