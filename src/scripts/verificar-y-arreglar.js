const { connectDB } = require('../config/database');

async function main() {
  try {
    console.log('\n🔍 Verificando estructura de tablas...\n');
    
    const pool = await connectDB();

    // Verificar estructura de la tabla de configuración
    const columnas = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('Columnas de imHCExamenesLabDetalleConf:');
    columnas.recordset.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
    });

    console.log('\n✓ Verificación completada\n');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

main();
