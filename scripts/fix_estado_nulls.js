/**
 * Corregir Estado NULL en registros creados por sistema nuevo
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');

(async () => {
    try {
        const pool = await connectDB();
        
        // Identificar los registros creados por el sistema nuevo (los más recientes con Estado NULL)
        console.log('Buscando registros recientes con Estado NULL...');
        const search = await pool.request().query(`
            SELECT NroIndicacion, Estado, NroAdicional, FechaCarga
            FROM imInterIndMedicas
            WHERE NroIndicacion >= 3665327
            ORDER BY NroIndicacion DESC
        `);
        search.recordset.forEach(row => console.log(JSON.stringify(row)));
        
        // Corregir Estado NULL en registros recientes del sistema nuevo
        console.log('\nCorrigiendo Estado NULL en registros recientes...');
        const fix = await pool.request().query(`
            UPDATE imInterIndMedicas 
            SET Estado = 'N' 
            WHERE NroIndicacion >= 3665327 
              AND Estado IS NULL
        `);
        console.log('Rows affected:', fix.rowsAffected[0]);
        
        // Verificar
        console.log('\nVerificación post-corrección:');
        const verify = await pool.request().query(`
            SELECT NroIndicacion, Estado, NroAdicional, Cantidad, Frecuencia
            FROM imInterIndMedicas
            WHERE NroIndicacion >= 3665327
            ORDER BY NroIndicacion DESC
        `);
        verify.recordset.forEach(row => console.log(JSON.stringify(row)));
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
})();
