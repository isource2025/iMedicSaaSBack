const sql = require('mssql');
const { connectDB } = require('../src/config/database');

async function checkPatchColumn() {
  try {
    const pool = await connectDB();
    
    console.log('🔍 Verificando tipo de dato de la columna Patch...\n');
    
    // Obtener información de la columna
    const columnInfo = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        COLLATION_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'imPedidosEstudiosAdjuntos'
        AND COLUMN_NAME = 'Patch'
    `);
    
    console.log('📋 Información de la columna Patch:');
    console.log(columnInfo.recordset);
    console.log('');
    
    // Obtener un ejemplo de ruta
    const ejemplo = await pool.request().query(`
      SELECT TOP 1 
        IdAdjunto,
        Patch,
        LEN(Patch) as Longitud,
        DATALENGTH(Patch) as Bytes
      FROM imPedidosEstudiosAdjuntos
      WHERE Patch LIKE '%AÑO%' OR Patch LIKE '%AÃ''O%'
      ORDER BY IdAdjunto DESC
    `);
    
    console.log('📄 Ejemplo de ruta con Ñ:');
    console.log(ejemplo.recordset);
    console.log('');
    
    // Verificar cómo se lee
    if (ejemplo.recordset.length > 0) {
      const ruta = ejemplo.recordset[0].Patch;
      console.log('🔤 Análisis de caracteres:');
      console.log('Ruta completa:', ruta);
      console.log('Contiene "AÑO":', ruta.includes('AÑO'));
      console.log('Contiene "AÃ\'O":', ruta.includes('AÃ\'O'));
      
      // Mostrar cada carácter
      const palabraAno = ruta.match(/A.{1,3}O 2026/);
      if (palabraAno) {
        console.log('\nPalabra "AÑO":');
        for (let i = 0; i < palabraAno[0].length; i++) {
          const char = palabraAno[0][i];
          console.log(`  [${i}] "${char}" - Code: ${char.charCodeAt(0)} (0x${char.charCodeAt(0).toString(16)})`);
        }
      }
    }
    
    await pool.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkPatchColumn();
