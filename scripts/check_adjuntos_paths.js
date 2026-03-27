const db = require('../src/models/db');

(async () => {
    try {
        console.log('🔍 Analizando rutas de archivos adjuntos...\n');
        
        const sql = `
            SELECT TOP 20
                IdAdjunto,
                NumeroVisita,
                Descripcion,
                Patch,
                Fecha
            FROM imPedidosEstudiosAdjuntos
            ORDER BY Fecha DESC
        `;
        
        const result = await db.executeQuery(sql);
        
        console.log(`📊 Total de adjuntos recientes: ${result.length}\n`);
        
        // Agrupar por tipo de path
        const pathsNuevos = [];
        const pathsViejos = [];
        
        result.forEach(adj => {
            const path = adj.Patch || '';
            if (path.includes('uploads') || path.includes('\\uploads\\')) {
                pathsNuevos.push(adj);
            } else if (path.includes('E:\\') || path.includes('imagenes')) {
                pathsViejos.push(adj);
            }
        });
        
        console.log('📁 ARCHIVOS NUEVOS (en uploads):');
        console.log(`   Total: ${pathsNuevos.length}`);
        if (pathsNuevos.length > 0) {
            console.log('   Ejemplo:', pathsNuevos[0].Patch);
        }
        
        console.log('\n📁 ARCHIVOS VIEJOS (en E:\\imagenes):');
        console.log(`   Total: ${pathsViejos.length}`);
        if (pathsViejos.length > 0) {
            console.log('   Ejemplos:');
            pathsViejos.slice(0, 3).forEach(adj => {
                console.log(`   - ${adj.Patch}`);
            });
        }
        
        // Buscar archivos con estructura de carpetas por paciente
        console.log('\n🔍 Buscando archivos con estructura de carpetas...\n');
        
        const sql2 = `
            SELECT TOP 10
                IdAdjunto,
                NumeroVisita,
                Descripcion,
                Patch,
                PatchServidor,
                Fecha
            FROM imPedidosEstudiosAdjuntos
            WHERE (Patch LIKE '%\\\\server\\%' OR Patch LIKE '%Imagenes%' OR Patch LIKE '%Vida%')
            ORDER BY Fecha DESC
        `;
        
        const result2 = await db.executeQuery(sql2);
        
        if (result2.length > 0) {
            console.log(`✅ Encontrados ${result2.length} archivos con estructura:`);
            result2.forEach(adj => {
                console.log(`\n   ID: ${adj.IdAdjunto}`);
                console.log(`   Visita: ${adj.NumeroVisita}`);
                console.log(`   Patch: ${adj.Patch}`);
                console.log(`   PatchServidor: ${adj.PatchServidor || 'NULL'}`);
            });
        } else {
            console.log('❌ No se encontraron archivos con ese criterio');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
})();
