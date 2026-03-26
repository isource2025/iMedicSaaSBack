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
        
        // Buscar específicamente el paciente mencionado
        console.log('\n🔍 Buscando archivos de BEJARANO LORENA PAOLA...\n');
        
        const sql2 = `
            SELECT 
                a.IdAdjunto,
                a.NumeroVisita,
                a.Descripcion,
                a.Patch,
                a.Fecha,
                p.Apellido,
                p.Nombres
            FROM imPedidosEstudiosAdjuntos a
            LEFT JOIN imVisitaMovimiento vm ON a.NumeroVisita = vm.NumeroVisita
            LEFT JOIN imPacientes p ON vm.NroHistoriaClinica = p.NroHistoriaClinica
            WHERE a.Patch LIKE '%BEJARANO%' OR a.Patch LIKE '%416367%'
            ORDER BY a.Fecha DESC
        `;
        
        const result2 = await db.executeQuery(sql2);
        
        if (result2.length > 0) {
            console.log(`✅ Encontrados ${result2.length} archivos:`);
            result2.forEach(adj => {
                console.log(`\n   ID: ${adj.IdAdjunto}`);
                console.log(`   Paciente: ${adj.Apellido} ${adj.Nombres}`);
                console.log(`   Path: ${adj.Patch}`);
                console.log(`   Fecha: ${adj.Fecha}`);
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
