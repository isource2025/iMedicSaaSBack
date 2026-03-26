const sql = require('mssql');
const { connectDB } = require('../src/config/database');

async function checkDescripcion() {
  try {
    const pool = await connectDB();
    
    console.log('🔍 Verificando campo Descripcion de adjuntos...\n');
    
    // Obtener ejemplos de adjuntos
    const result = await pool.request().query(`
      SELECT TOP 10
        IdAdjunto,
        Descripcion,
        PatchServidor,
        Patch
      FROM imPedidosEstudiosAdjuntos
      ORDER BY IdAdjunto DESC
    `);
    
    console.log('📄 Ejemplos de adjuntos:\n');
    result.recordset.forEach(adj => {
      console.log('─'.repeat(80));
      console.log(`ID: ${adj.IdAdjunto}`);
      console.log(`Descripcion: "${adj.Descripcion}"`);
      console.log(`PatchServidor: "${adj.PatchServidor}"`);
      console.log(`Patch: "${adj.Patch}"`);
      
      // Verificar si Descripcion tiene extensión
      const tieneExtension = adj.Descripcion && /\.[a-zA-Z0-9]+$/.test(adj.Descripcion);
      console.log(`¿Descripcion tiene extensión?: ${tieneExtension ? 'SÍ' : 'NO'}`);
      
      if (!tieneExtension && adj.PatchServidor) {
        const match = adj.PatchServidor.match(/\.([a-zA-Z0-9]+)$/);
        if (match) {
          console.log(`Extensión en PatchServidor: .${match[1]}`);
        }
      }
      console.log('');
    });
    
    await pool.close();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkDescripcion();
