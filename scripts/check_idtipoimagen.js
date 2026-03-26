const sql = require('mssql');
const { connectDB } = require('../src/config/database');

async function checkIdTipoImagen() {
  try {
    const pool = await connectDB();
    
    console.log('🔍 Analizando campo idtipoimagen...\n');
    
    // Obtener valores únicos de idtipoimagen
    const result = await pool.request().query(`
      SELECT 
        idtipoimagen,
        COUNT(*) as cantidad
      FROM imPedidosEstudiosAdjuntos
      WHERE idtipoimagen IS NOT NULL AND idtipoimagen <> ''
      GROUP BY idtipoimagen
      ORDER BY cantidad DESC
    `);
    
    console.log('📊 Valores únicos de idtipoimagen:\n');
    console.log('─'.repeat(80));
    console.log('Tipo de Imagen'.padEnd(50), 'Cantidad');
    console.log('─'.repeat(80));
    
    result.recordset.forEach(row => {
      console.log(
        `"${row.idtipoimagen}"`.padEnd(50),
        row.cantidad.toString().padStart(8)
      );
    });
    
    console.log('─'.repeat(80));
    console.log(`\nTotal de tipos diferentes: ${result.recordset.length}`);
    
    // Detectar duplicados por normalización (case-insensitive)
    console.log('\n🔄 Detectando duplicados (case-insensitive):\n');
    const normalized = new Map();
    
    result.recordset.forEach(row => {
      const key = row.idtipoimagen.toLowerCase().trim();
      if (!normalized.has(key)) {
        normalized.set(key, []);
      }
      normalized.get(key).push({
        original: row.idtipoimagen,
        cantidad: row.cantidad
      });
    });
    
    // Mostrar grupos con duplicados
    let hasDuplicates = false;
    normalized.forEach((variants, normalizedKey) => {
      if (variants.length > 1) {
        hasDuplicates = true;
        console.log(`\n📌 Grupo: "${normalizedKey}"`);
        variants.forEach(v => {
          console.log(`   - "${v.original}" (${v.cantidad} registros)`);
        });
      }
    });
    
    if (!hasDuplicates) {
      console.log('✅ No se encontraron duplicados por mayúsculas/minúsculas');
    }
    
    // Mostrar ejemplos de adjuntos con cada tipo
    console.log('\n\n📄 Ejemplos de adjuntos por tipo:\n');
    
    const ejemplos = await pool.request().query(`
      SELECT TOP 20
        IdAdjunto,
        NumeroVisita,
        idtipoimagen,
        Descripcion,
        PatchServidor
      FROM imPedidosEstudiosAdjuntos
      WHERE idtipoimagen IS NOT NULL AND idtipoimagen <> ''
      ORDER BY IdAdjunto DESC
    `);
    
    ejemplos.recordset.forEach(adj => {
      console.log('─'.repeat(80));
      console.log(`ID: ${adj.IdAdjunto} | Visita: ${adj.NumeroVisita}`);
      console.log(`Tipo: "${adj.idtipoimagen}"`);
      console.log(`Descripción: "${adj.Descripcion}"`);
      console.log(`Path: ${adj.PatchServidor}`);
    });
    
    await pool.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkIdTipoImagen();
