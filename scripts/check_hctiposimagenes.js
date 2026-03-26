const sql = require('mssql');
const { connectDB } = require('../src/config/database');

async function checkHcTiposImagenes() {
  try {
    const pool = await connectDB();
    
    console.log('🔍 Investigando tabla hctiposimagenes...\n');
    
    // Obtener estructura de la tabla
    const estructura = await pool.request().query(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'hctiposimagenes'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('📋 Estructura de la tabla hctiposimagenes:\n');
    console.log('─'.repeat(80));
    estructura.recordset.forEach(col => {
      console.log(`${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE.padEnd(15)} ${col.CHARACTER_MAXIMUM_LENGTH || ''}`);
    });
    console.log('─'.repeat(80));
    
    // Obtener todos los tipos de imágenes
    const tipos = await pool.request().query(`
      SELECT 
        tipoimagen,
        desctipoimagen
      FROM hctiposimagenes
      ORDER BY desctipoimagen
    `);
    
    console.log('\n📊 Tipos de imágenes disponibles:\n');
    console.log('─'.repeat(80));
    console.log('tipoimagen'.padEnd(30), 'desctipoimagen');
    console.log('─'.repeat(80));
    
    tipos.recordset.forEach(tipo => {
      console.log(
        `"${tipo.tipoimagen}"`.padEnd(30),
        `"${tipo.desctipoimagen}"`
      );
    });
    
    console.log('─'.repeat(80));
    console.log(`\nTotal de tipos: ${tipos.recordset.length}`);
    
    // Verificar relación con adjuntos
    console.log('\n🔗 Verificando relación con adjuntos:\n');
    
    const relacion = await pool.request().query(`
      SELECT TOP 10
        a.IdAdjunto,
        a.NumeroVisita,
        a.idtipoimagen,
        t.desctipoimagen,
        a.Descripcion
      FROM imPedidosEstudiosAdjuntos a
      LEFT JOIN hctiposimagenes t ON a.idtipoimagen = t.tipoimagen
      WHERE a.idtipoimagen IS NOT NULL AND a.idtipoimagen <> ''
      ORDER BY a.IdAdjunto DESC
    `);
    
    console.log('─'.repeat(80));
    relacion.recordset.forEach(adj => {
      console.log(`ID: ${adj.IdAdjunto} | Visita: ${adj.NumeroVisita}`);
      console.log(`  idtipoimagen: "${adj.idtipoimagen}"`);
      console.log(`  desctipoimagen: "${adj.desctipoimagen || 'NULL (sin relación)'}"`);
      console.log(`  Descripción: "${adj.Descripcion}"`);
      console.log('─'.repeat(80));
    });
    
    // Contar adjuntos por tipo
    console.log('\n📈 Adjuntos por tipo de imagen:\n');
    
    const conteo = await pool.request().query(`
      SELECT 
        t.desctipoimagen,
        COUNT(*) as cantidad
      FROM imPedidosEstudiosAdjuntos a
      LEFT JOIN hctiposimagenes t ON a.idtipoimagen = t.tipoimagen
      WHERE a.idtipoimagen IS NOT NULL AND a.idtipoimagen <> ''
      GROUP BY t.desctipoimagen
      ORDER BY cantidad DESC
    `);
    
    console.log('─'.repeat(80));
    console.log('Tipo de Imagen'.padEnd(50), 'Cantidad');
    console.log('─'.repeat(80));
    
    conteo.recordset.forEach(row => {
      console.log(
        `"${row.desctipoimagen || 'SIN TIPO'}"`.padEnd(50),
        row.cantidad.toString().padStart(8)
      );
    });
    
    console.log('─'.repeat(80));
    
    await pool.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkHcTiposImagenes();
