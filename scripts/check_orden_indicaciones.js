const db = require('../src/models/db');

(async () => {
    try {
        console.log('🔍 Verificando tabla imInterTipoIndicacion y campo Orden...\n');
        
        // Ver la estructura de la tabla de tipos de indicaciones
        const sql1 = `
            SELECT 
                Valor,
                Descripcion,
                Tipo,
                Orden,
                PromptCodigo
            FROM imInterTipoIndicacion
            ORDER BY Orden ASC
        `;
        
        const tipos = await db.executeQuery(sql1);
        
        console.log('📋 TIPOS DE INDICACIONES (ordenados por campo Orden):');
        console.log('═══════════════════════════════════════════════════════\n');
        
        tipos.forEach(tipo => {
            console.log(`Valor: ${tipo.Valor}`);
            console.log(`  Descripción: ${tipo.Descripcion}`);
            console.log(`  Tipo: ${tipo.Tipo}`);
            console.log(`  Orden: ${tipo.Orden}`);
            console.log(`  PromptCodigo: ${tipo.PromptCodigo}`);
            console.log('');
        });
        
        // Ahora verificar cómo se están ordenando las indicaciones en producción
        console.log('\n🔍 Verificando orden actual de indicaciones para una visita de ejemplo...\n');
        
        const sql2 = `
            SELECT TOP 20
                iim.NroIndicacion,
                iim.TipoIndicacion,
                tit.Descripcion AS TipoDescripcion,
                tit.Orden AS OrdenTipo,
                iim.Orden AS OrdenIndicacion,
                iim.AliasMedicamento,
                CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaCarga,0), '1800-12-28'), 23) AS FechaCarga
            FROM imInterIndMedicas iim
            LEFT JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
            WHERE iim.NumeroVisita IN (
                SELECT TOP 1 NumeroVisita 
                FROM imInterIndMedicas 
                WHERE FechaCarga > 0
                GROUP BY NumeroVisita
                HAVING COUNT(*) > 5
                ORDER BY MAX(FechaCarga) DESC
            )
            ORDER BY iim.NroIndicacion ASC
        `;
        
        const indicaciones = await db.executeQuery(sql2);
        
        if (indicaciones.length > 0) {
            console.log('📊 INDICACIONES ACTUALES (ordenadas por NroIndicacion):');
            console.log('═══════════════════════════════════════════════════════\n');
            
            indicaciones.forEach(ind => {
                console.log(`NroIndicacion: ${ind.NroIndicacion}`);
                console.log(`  Tipo: ${ind.TipoDescripcion} (Orden en tabla: ${ind.OrdenTipo})`);
                console.log(`  Medicamento: ${ind.AliasMedicamento}`);
                console.log(`  Orden en indicación: ${ind.OrdenIndicacion}`);
                console.log(`  Fecha: ${ind.FechaCarga}`);
                console.log('');
            });
            
            console.log('\n⚠️ PROBLEMA DETECTADO:');
            console.log('Las indicaciones se están ordenando por NroIndicacion (orden de creación)');
            console.log('pero deberían ordenarse por el campo Orden de imInterTipoIndicacion');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
})();
