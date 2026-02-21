const { connectDB } = require('../config/database');

(async () => {
    try {
        const pool = await connectDB();
        
        console.log('=== Estructura de la tabla imHCI ===\n');
        
        // Obtener estructura de columnas
        const columnsResult = await pool.request().query(`
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE,
                COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI'
            ORDER BY ORDINAL_POSITION
        `);
        
        console.log('Columnas de la tabla imHCI:');
        console.table(columnsResult.recordset);
        
        // Obtener la clave primaria
        console.log('\n=== Buscando clave primaria ===\n');
        const pkResult = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_NAME = 'imHCI'
                AND CONSTRAINT_NAME LIKE 'PK%'
        `);
        
        console.log('Clave primaria:', pkResult.recordset);
        
        // Buscar campos relacionados con profesional
        console.log('\n=== Buscando campos de profesional ===\n');
        const profResult = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI'
                AND COLUMN_NAME LIKE '%Prof%'
        `);
        console.log('Campos de profesional:', profResult.recordset);
        
        // Buscar campos de fecha y hora
        console.log('\n=== Buscando campos de fecha y hora ===\n');
        const fechaHoraResult = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI'
                AND (COLUMN_NAME LIKE '%Fecha%' OR COLUMN_NAME LIKE '%Hora%')
        `);
        console.log('Campos de fecha/hora:', fechaHoraResult.recordset);
        
        // Obtener algunos registros de ejemplo con campos clave
        console.log('\n=== Registros de ejemplo (campos principales) ===\n');
        const dataResult = await pool.request().query(`
            SELECT TOP 5 
                IdHCIngreso,
                NumeroVisita,
                IdSector,
                MotivoConsulta,
                EnfermedadActual,
                IdProfecional
            FROM imHCI
            WHERE NumeroVisita IS NOT NULL
        `);
        
        console.log('Registros de ejemplo:');
        console.log(JSON.stringify(dataResult.recordset, null, 2));
        
        // Verificar si existe relación con NumeroVisita
        console.log('\n=== Verificando relación con visitas ===\n');
        const visitaCheck = await pool.request().query(`
            SELECT TOP 1 
                COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI' 
                AND (COLUMN_NAME LIKE '%Visita%' OR COLUMN_NAME LIKE '%Visit%')
        `);
        
        if (visitaCheck.recordset.length > 0) {
            console.log('Columna de visita encontrada:', visitaCheck.recordset[0].COLUMN_NAME);
        } else {
            console.log('No se encontró columna de visita directa');
        }
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
