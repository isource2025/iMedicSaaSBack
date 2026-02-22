const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('=== Verificar si se insertaron las indicaciones adicionales en imInterCtrlMedicamento ===');
        
        const result = await executeQuery(`
            SELECT 
                mc.IDCtrlMedica,
                mc.NroIndicacion,
                mc.NumeroVisita,
                ind.NroAdicional,
                ind.FormaAdicional,
                ind.AliasMedicamento,
                v.Alias AS NombreMedicamento
            FROM dbo.imInterCtrlMedicamento AS mc
            LEFT JOIN dbo.imInterIndMedicas AS ind ON mc.NroIndicacion = ind.NroIndicacion
            LEFT JOIN dbo.imVademecum AS v ON mc.Troquel = v.Troquel
            WHERE mc.NumeroVisita = 363245
            ORDER BY mc.FechaCarga DESC, mc.IDCtrlMedica DESC
        `);
        
        console.log('\n📊 Total registros en imInterCtrlMedicamento:', result.length);
        console.log('\n--- Detalles ---');
        result.forEach((row, idx) => {
            console.log(`\n[${idx + 1}] IDCtrlMedica: ${row.IDCtrlMedica}`);
            console.log(`    NroIndicacion: ${row.NroIndicacion}`);
            console.log(`    NombreMedicamento: ${row.NombreMedicamento}`);
            console.log(`    NroAdicional: ${row.NroAdicional}`);
            console.log(`    FormaAdicional: ${row.FormaAdicional}`);
            console.log(`    AliasMedicamento (de ind): ${row.AliasMedicamento}`);
        });
        
        console.log('\n=== Verificar indicaciones en imInterIndMedicas ===');
        const indResult = await executeQuery(`
            SELECT NroIndicacion, NroAdicional, FormaAdicional, AliasMedicamento
            FROM dbo.imInterIndMedicas
            WHERE NroIndicacion IN (3279607, 3279608)
            ORDER BY NroIndicacion
        `);
        
        console.log('\n📊 Indicaciones en imInterIndMedicas:');
        indResult.forEach((row) => {
            console.log(`NroIndicacion: ${row.NroIndicacion}, NroAdicional: ${row.NroAdicional}, FormaAdicional: ${row.FormaAdicional}, Medicamento: ${row.AliasMedicamento}`);
        });
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
