const { connectDB } = require('../config/database');

(async () => {
    try {
        const pool = await connectDB();
        
        console.log('=== Verificando tipos de datos ===\n');
        
        // Tipo de dato de IdProfecional en imHCI
        const hciType = await pool.request().query(`
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI' 
                AND COLUMN_NAME = 'IdProfecional'
        `);
        console.log('Tipo de IdProfecional en imHCI:');
        console.table(hciType.recordset);
        
        // Tipo de dato de Matricula en imPersonal
        const personalType = await pool.request().query(`
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imPersonal' 
                AND COLUMN_NAME = 'Matricula'
        `);
        console.log('\nTipo de Matricula en imPersonal:');
        console.table(personalType.recordset);
        
        // Buscar un registro específico
        console.log('\n=== Buscando IdProfecional 1151 ===\n');
        const hciData = await pool.request().query(`
            SELECT TOP 1 IdProfecional
            FROM imHCI
            WHERE IdProfecional = 1151
        `);
        console.log('En imHCI:', hciData.recordset);
        
        const personalData = await pool.request().query(`
            SELECT Matricula, ApellidoNombre
            FROM imPersonal
            WHERE Matricula = 1151
        `);
        console.log('En imPersonal:', personalData.recordset);
        
        // Intentar con TRIM
        const personalDataTrim = await pool.request().query(`
            SELECT Matricula, ApellidoNombre
            FROM imPersonal
            WHERE LTRIM(RTRIM(CAST(Matricula AS VARCHAR))) = '1151'
        `);
        console.log('En imPersonal con TRIM:', personalDataTrim.recordset);
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
