const { executeQuery } = require('./src/models/db');

(async () => {
  try {
    console.log('🔍 Verificando estructura de tabla imHCI...\n');

    // Verificar si la tabla existe
    const tablaExiste = await executeQuery(`
      SELECT COUNT(*) as existe
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'imHCI'
    `);

    if (tablaExiste[0].existe === 0) {
      console.log('❌ La tabla imHCI NO existe en la base de datos');
      process.exit(1);
    }

    console.log('✅ La tabla imHCI existe\n');

    // Obtener estructura de columnas
    const columnas = await executeQuery(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCI'
      ORDER BY ORDINAL_POSITION
    `);

    console.log(`📊 Total de columnas: ${columnas.length}\n`);

    // Contar registros
    const totalRegistros = await executeQuery(`
      SELECT COUNT(*) as total FROM imHCI
    `);

    console.log(`📝 Total de registros: ${totalRegistros[0].total}\n`);

    // Mostrar primeras columnas
    console.log('📋 Primeras 20 columnas:\n');
    columnas.slice(0, 20).forEach((col, idx) => {
      const tipo = col.CHARACTER_MAXIMUM_LENGTH 
        ? `${col.DATA_TYPE}(${col.CHARACTER_MAXIMUM_LENGTH})`
        : col.DATA_TYPE;
      console.log(`${(idx + 1).toString().padStart(2)}. ${col.COLUMN_NAME.padEnd(30)} ${tipo}`);
    });

    // Agrupar por prefijos
    const prefijos = {};
    columnas.forEach(col => {
      const nombre = col.COLUMN_NAME;
      const prefijo = nombre.split('_')[0];
      
      if (nombre.includes('_')) {
        if (!prefijos[prefijo]) {
          prefijos[prefijo] = 0;
        }
        prefijos[prefijo]++;
      }
    });

    console.log('\n📊 Campos por prefijo (secciones médicas):\n');
    Object.entries(prefijos)
      .sort((a, b) => b[1] - a[1])
      .forEach(([prefijo, count]) => {
        console.log(`${prefijo.padEnd(10)} → ${count} campos`);
      });

    // Obtener un registro de ejemplo
    const ejemplo = await executeQuery(`
      SELECT TOP 1 * FROM imHCI
      ORDER BY Fecha DESC
    `);

    if (ejemplo.length > 0) {
      console.log('\n✅ Registro de ejemplo encontrado:');
      console.log(`   NumeroVisita: ${ejemplo[0].NumeroVisita}`);
      console.log(`   Fecha: ${ejemplo[0].Fecha}`);
      console.log(`   IdSector: ${ejemplo[0].IdSector || 'N/A'}`);
      console.log(`   MotivoConsulta: ${ejemplo[0].MotivoConsulta ? ejemplo[0].MotivoConsulta.substring(0, 50) + '...' : 'N/A'}`);
    }

    console.log('\n✅ Verificación completada exitosamente');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
