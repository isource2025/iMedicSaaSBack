const db = require('../src/models/db');

(async () => {
    try {
        const sql = `
            SELECT TOP 5 
                NroIndicacion, 
                TipoUnidad,
                DATALENGTH(TipoUnidad) as BytesTipoUnidad,
                LEN(RTRIM(TipoUnidad)) as LongitudTrim,
                Codigo, 
                AliasMedicamento
            FROM imInterIndMedicas 
            WHERE NumeroVisita = 41797 
                AND AliasMedicamento LIKE '%RANITIDINA%'
            ORDER BY NroIndicacion DESC
        `;
        
        const result = await db.executeQuery(sql);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
})();
