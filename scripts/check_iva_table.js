const db = require('../src/models/db');

(async () => {
    try {
        console.log('🔍 Buscando tablas relacionadas con IVA...\n');
        
        const sql = `
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME LIKE '%IVA%' OR TABLE_NAME LIKE '%Iva%'
        `;
        
        const result = await db.executeQuery(sql);
        console.log('Tablas encontradas:', JSON.stringify(result, null, 2));
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
})();
