const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        const cols = await executeQuery(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'imHCI' 
            AND (
                COLUMN_NAME LIKE '%Titulo%' 
                OR COLUMN_NAME LIKE '%Nombre%' 
                OR COLUMN_NAME LIKE '%Descripcion%'
                OR COLUMN_NAME LIKE '%Label%'
            )
            ORDER BY COLUMN_NAME
        `);
        
        console.log('Campos de título/nombre en imHCI:');
        if (cols.length > 0) {
            cols.forEach(c => console.log(`- ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
        } else {
            console.log('❌ No se encontraron campos de título');
        }
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
