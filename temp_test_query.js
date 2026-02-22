const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('=== TEST: Query completa de medicación con adicionales ===');
        const result = await executeQuery(`
            SELECT 
              mc.IDCtrlMedica,
              mc.NroIndicacion,
              mc.NumeroVisita,
              mc.Sector,
              CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
              CONVERT(varchar(8), DATEADD(ms, (NULLIF(mc.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
              mc.OperadorCarga,
              pw1.Apellido AS OperadorApellido,
              pw1.Nombres AS OperadorNombres,
              pw1.Nombres + ' ' + pw1.Apellido AS OperadorFullName,
              mc.Profesional,
              pw2.Apellido AS ProfesionalApellido,
              pw2.Nombres AS ProfesionalNombres,
              pw2.Nombres + ' ' + pw2.Apellido AS ProfesionalFullName,
              mc.Troquel,
              mc.Cantidad,
              mc.CantidadIndicada,
              mc.TipoUnidad,
              v.Alias AS NombreMedicamento,
              v.Descripcion AS DescripcionMedicamento,
              ind.NroAdicional,
              ind.FormaAdicional
            FROM dbo.imInterCtrlMedicamento AS mc
            LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = mc.OperadorCarga
            LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = mc.Profesional
            LEFT JOIN dbo.imVademecum AS v ON mc.Troquel = v.Troquel
            LEFT JOIN dbo.imInterIndMedicas AS ind ON mc.NroIndicacion = ind.NroIndicacion
            WHERE mc.NumeroVisita = 363245
            ORDER BY mc.FechaCarga DESC, mc.HoraCarga DESC, mc.IDCtrlMedica DESC
        `);
        
        console.log('\n📊 Resultados encontrados:', result.length);
        result.forEach((row, idx) => {
            console.log(`\n--- Registro ${idx + 1} ---`);
            console.log('NroIndicacion:', row.NroIndicacion);
            console.log('NombreMedicamento:', row.NombreMedicamento);
            console.log('Profesional:', row.Profesional);
            console.log('ProfesionalFullName:', row.ProfesionalFullName);
            console.log('OperadorCarga:', row.OperadorCarga);
            console.log('OperadorFullName:', row.OperadorFullName);
            console.log('NroAdicional:', row.NroAdicional);
            console.log('FormaAdicional:', row.FormaAdicional);
        });
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
