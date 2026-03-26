const db = require('../src/models/db');

(async () => {
    try {
        // Columnas SV_* en imHCI
        const svCols = await db.executeQuery(
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='imHCI' AND COLUMN_NAME LIKE 'SV[_]%' ORDER BY COLUMN_NAME"
        );
        console.log('=== Columnas SV_* en imHCI ===');
        svCols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}${c.CHARACTER_MAXIMUM_LENGTH ? '(' + c.CHARACTER_MAXIMUM_LENGTH + ')' : ''})`));
        console.log('Total:', svCols.length);

        // Todas las columnas de imHCI
        const allCols = await db.executeQuery(
            "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='imHCI' ORDER BY ORDINAL_POSITION"
        );
        console.log('\n=== TODAS las columnas de imHCI ===');
        allCols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}${c.CHARACTER_MAXIMUM_LENGTH ? '(' + c.CHARACTER_MAXIMUM_LENGTH + ')' : ''})`));
        console.log('Total:', allCols.length);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
