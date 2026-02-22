const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('=== Verificar indicaciones adicionales en la base de datos ===\n');
        
        // Buscar indicaciones con adicionales
        const result = await executeQuery(`
            SELECT 
                iim.NroIndicacion,
                iim.NroAdicional,
                iim.NumeroVisita,
                iim.AliasMedicamento,
                iim.FormaAdicional,
                iim.Estado,
                CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaCarga,0), '1800-12-28'), 23) AS FechaCarga
            FROM dbo.imInterIndMedicas AS iim
            WHERE iim.NumeroVisita = 363245
            ORDER BY iim.NroIndicacion, iim.NroAdicional
        `);
        
        console.log(`📊 Total de indicaciones encontradas: ${result.length}\n`);
        
        // Agrupar por padre/hijas
        const padres = result.filter(r => !r.NroAdicional || r.NroAdicional === 0);
        const hijas = result.filter(r => r.NroAdicional && r.NroAdicional > 0);
        
        console.log(`👨 Indicaciones padre (NroAdicional = 0 o NULL): ${padres.length}`);
        console.log(`👶 Indicaciones hijas (NroAdicional > 0): ${hijas.length}\n`);
        
        if (hijas.length > 0) {
            console.log('=== INDICACIONES HIJAS ENCONTRADAS ===\n');
            hijas.forEach((hija) => {
                console.log(`NroIndicacion: ${hija.NroIndicacion}`);
                console.log(`NroAdicional (padre): ${hija.NroAdicional}`);
                console.log(`Medicamento: ${hija.AliasMedicamento}`);
                console.log(`FormaAdicional: ${hija.FormaAdicional}`);
                console.log(`Estado: ${hija.Estado}`);
                console.log(`FechaCarga: ${hija.FechaCarga}`);
                console.log('---');
            });
        } else {
            console.log('❌ No se encontraron indicaciones hijas (adicionales)');
            console.log('   Las indicaciones adicionales deben tener NroAdicional > 0');
        }
        
        // Mostrar algunas indicaciones padre
        if (padres.length > 0) {
            console.log('\n=== PRIMERAS 5 INDICACIONES PADRE ===\n');
            padres.slice(0, 5).forEach((padre) => {
                console.log(`NroIndicacion: ${padre.NroIndicacion}`);
                console.log(`Medicamento: ${padre.AliasMedicamento}`);
                console.log(`Estado: ${padre.Estado}`);
                console.log(`FechaCarga: ${padre.FechaCarga}`);
                
                // Buscar si tiene hijas
                const hijasDelPadre = hijas.filter(h => h.NroAdicional === padre.NroIndicacion);
                if (hijasDelPadre.length > 0) {
                    console.log(`✅ Tiene ${hijasDelPadre.length} indicación(es) adicional(es):`);
                    hijasDelPadre.forEach(h => {
                        console.log(`   - ${h.AliasMedicamento} (${h.FormaAdicional})`);
                    });
                }
                console.log('---');
            });
        }
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
