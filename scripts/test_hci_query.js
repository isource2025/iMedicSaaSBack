const db = require('../src/models/db');

(async () => {
    try {
        console.log('🔍 Probando consulta de HC de Ingreso...\n');
        
        const sql = `
        SELECT 
            hc.*,
            CONVERT(VARCHAR(10), hc.Fecha, 23) AS FechaFormateada,
            SUBSTRING(CONVERT(VARCHAR(8), hc.Fecha, 108), 1, 5) AS HoraFormateada,
            LTRIM(RTRIM(ISNULL(pw.Apellido, '') + ' ' + ISNULL(pw.Nombres, ''))) AS ProfesionalNombre,
            sec.Descripcion AS SectorDescripcion
        FROM dbo.imHCI AS hc
        LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = hc.IdProfecional
        LEFT JOIN dbo.imSectores AS sec ON hc.IdSector = sec.Valor
        WHERE hc.NumeroVisita = @param0
        ORDER BY hc.Fecha DESC, hc.IdHCIngreso DESC
        `;
        
        const result = await db.executeQuery(sql, [{ value: 41797 }]);
        console.log('✅ Consulta básica exitosa. Registros:', result.length);
        
        if (result.length > 0) {
            console.log('\n📋 Primer registro:');
            console.log('IdHCIngreso:', result[0].IdHCIngreso);
            console.log('NumeroVisita:', result[0].NumeroVisita);
            console.log('ProfesionalNombre:', result[0].ProfesionalNombre);
        }
        
        // Ahora probar con el OUTER APPLY
        console.log('\n🔍 Probando con OUTER APPLY...\n');
        
        const sql2 = `
        SELECT 
            hc.IdHCIngreso,
            hc.NumeroVisita,
            uc.Valor AS ControlValor,
            uc.Pulso,
            uc.IdHci
        FROM dbo.imHCI AS hc
        OUTER APPLY (
            SELECT TOP 1 cf.*
            FROM dbo.imInterCtrlFrecuente cf
            WHERE cf.IdHci = hc.IdHCIngreso
            ORDER BY cf.Valor DESC
        ) uc
        WHERE hc.NumeroVisita = @param0
        ORDER BY hc.Fecha DESC, hc.IdHCIngreso DESC
        `;
        
        const result2 = await db.executeQuery(sql2, [{ value: 41797 }]);
        console.log('✅ Consulta con OUTER APPLY exitosa. Registros:', result2.length);
        
        if (result2.length > 0) {
            console.log('\n📋 Primer registro con control:');
            console.log(JSON.stringify(result2[0], null, 2));
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Detalles:', error);
        process.exit(1);
    }
})();
