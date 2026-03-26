const db = require('../src/models/db');

(async () => {
    try {
        const sql = `
            SELECT 
                iim.NroIndicacion, 
                iim.ProfesionalAsiste, 
                pw.ValorPersonal, 
                pw.Apellido, 
                pw.Nombres,
                LTRIM(RTRIM(ISNULL(pw.Apellido, '') + ' ' + ISNULL(pw.Nombres, ''))) AS ProfesionalNombre
            FROM imInterIndMedicas iim 
            LEFT JOIN imPassword pw ON iim.ProfesionalAsiste = pw.ValorPersonal 
            WHERE iim.ProfesionalAsiste = 999999 
                AND iim.NroIndicacion = 3665333
        `;
        
        const result = await db.executeQuery(sql);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
})();
