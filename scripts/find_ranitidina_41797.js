const db = require('../src/models/db');

(async () => {
    try {
        const sql = `
            SELECT TOP 10
                iim.NroIndicacion,
                iim.NumeroVisita,
                iim.TipoIndicacion,
                tit.Tipo as TipoIndicacionCodigo,
                iim.Codigo,
                iim.TipoUnidad,
                '[' + iim.TipoUnidad + ']' as TipoUnidadBrackets,
                iim.AliasMedicamento,
                v.Alias as VademecumAlias,
                v.TipoMedicamento
            FROM imInterIndMedicas iim
            INNER JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
            LEFT JOIN imVademecum v ON iim.Codigo = v.Troquel AND tit.Tipo = 'M'
            WHERE iim.NumeroVisita = 41797
                AND tit.Tipo = 'M'
            ORDER BY iim.NroIndicacion DESC
        `;
        
        const result = await db.executeQuery(sql);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
})();
