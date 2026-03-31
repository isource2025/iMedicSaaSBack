const { connectDB } = require('../config/database');

async function main() {
  try {
    const pool = await connectDB();

    // Ver tablas de laboratorio
    console.log('\n📋 Tablas de laboratorio existentes:\n');
    const tablas = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE '%Lab%' OR TABLE_NAME LIKE '%Examen%'
      ORDER BY TABLE_NAME
    `);

    for (const tabla of tablas.recordset) {
      console.log(`\n🔹 ${tabla.TABLE_NAME}`);
      
      const columnas = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tabla.TABLE_NAME}'
        ORDER BY ORDINAL_POSITION
      `);
      
      columnas.recordset.forEach(col => {
        const len = col.CHARACTER_MAXIMUM_LENGTH ? `(${col.CHARACTER_MAXIMUM_LENGTH})` : '';
        console.log(`   - ${col.COLUMN_NAME}: ${col.DATA_TYPE}${len}`);
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
