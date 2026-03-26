const db = require('../src/models/db');

(async () => {
    try {
        // Buscar indicaciones recientes de la visita 41797
        const sql = `
            SELECT TOP 10
                NroIndicacion, 
                TipoUnidad,
                '[' + TipoUnidad + ']' as TipoUnidadBrackets,
                Codigo, 
                AliasMedicamento
            FROM imInterIndMedicas 
            WHERE NumeroVisita = 41797
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
