const { getConnection } = require('./src/config/db');

(async () => {
    try {
        const pool = await getConnection();
        
        // Buscar tablas relacionadas con HC
        const result = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME LIKE '%HC%' 
               OR TABLE_NAME LIKE '%Historia%'
               OR TABLE_NAME LIKE '%Ingreso%'
            ORDER BY TABLE_NAME
        `);
        
        console.log('Tablas encontradas:');
        console.log(JSON.stringify(result.recordset, null, 2));
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
