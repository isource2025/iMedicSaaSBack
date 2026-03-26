const db = require('../src/models/db');

(async () => {
    try {
        console.log('🔍 Analizando rutas de archivos adjuntos...\n');
        
        // Primero ver algunos ejemplos recientes
        const sql1 = `
            SELECT TOP 10
                IdAdjunto,
                NumeroVisita,
                Descripcion,
                Patch,
                Fecha
            FROM imPedidosEstudiosAdjuntos
            ORDER BY Fecha DESC
        `;
        
        const recientes = await db.executeQuery(sql1);
        
        console.log('📁 ARCHIVOS RECIENTES:');
        recientes.forEach(adj => {
            console.log(`\n   ID: ${adj.IdAdjunto}`);
            console.log(`   Visita: ${adj.NumeroVisita}`);
            console.log(`   Archivo: ${adj.Descripcion}`);
            console.log(`   Path: ${adj.Patch}`);
            console.log(`   Fecha: ${adj.Fecha}`);
        });
        
        // Buscar archivos con path E:\
        console.log('\n\n🔍 Buscando archivos en E:\\imagenes...\n');
        
        const sql2 = `
            SELECT TOP 10
                IdAdjunto,
                NumeroVisita,
                Descripcion,
                Patch,
                Fecha
            FROM imPedidosEstudiosAdjuntos
            WHERE Patch LIKE 'E:\\%'
            ORDER BY Fecha DESC
        `;
        
        const viejos = await db.executeQuery(sql2);
        
        console.log(`📁 ARCHIVOS EN E:\\ (Total encontrados: ${viejos.length})`);
        viejos.forEach(adj => {
            console.log(`\n   ID: ${adj.IdAdjunto}`);
            console.log(`   Path: ${adj.Patch}`);
        });
        
        // Buscar específicamente por el número 416367
        console.log('\n\n🔍 Buscando archivos con "416367"...\n');
        
        const sql3 = `
            SELECT 
                IdAdjunto,
                NumeroVisita,
                Descripcion,
                Patch,
                Fecha
            FROM imPedidosEstudiosAdjuntos
            WHERE Patch LIKE '%416367%'
            ORDER BY Fecha DESC
        `;
        
        const especifico = await db.executeQuery(sql3);
        
        if (especifico.length > 0) {
            console.log(`✅ Encontrados ${especifico.length} archivos:`);
            especifico.forEach(adj => {
                console.log(`\n   ID: ${adj.IdAdjunto}`);
                console.log(`   Visita: ${adj.NumeroVisita}`);
                console.log(`   Path: ${adj.Patch}`);
            });
        } else {
            console.log('❌ No se encontraron archivos con ese criterio');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
})();
