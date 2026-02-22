const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('🔍 Buscando campos de Antecedentes en tabla imHCI...\n');

        // Buscar campos que puedan contener antecedentes
        const columnas = await executeQuery(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI'
            AND (
                COLUMN_NAME LIKE '%Antecedente%'
                OR COLUMN_NAME LIKE '%AP_%'
                OR COLUMN_NAME LIKE '%AF_%'
                OR COLUMN_NAME LIKE '%Habito%'
                OR COLUMN_NAME LIKE '%Alergia%'
                OR COLUMN_NAME LIKE '%Familiar%'
                OR COLUMN_NAME LIKE '%Personal%'
            )
            ORDER BY COLUMN_NAME
        `);

        console.log(`📊 Campos encontrados: ${columnas.length}\n`);
        console.log('=====================================');
        
        if (columnas.length > 0) {
            columnas.forEach((col, idx) => {
                const maxLen = col.CHARACTER_MAXIMUM_LENGTH || 'N/A';
                console.log(`${(idx + 1).toString().padStart(2)}. ${col.COLUMN_NAME.padEnd(40)} ${col.DATA_TYPE.padEnd(15)} (${maxLen})`);
            });
        } else {
            console.log('❌ No se encontraron campos específicos de antecedentes');
            console.log('\n🔍 Buscando todos los campos que no sean de secciones médicas...\n');
            
            // Buscar campos generales (sin prefijos de secciones)
            const camposGenerales = await executeQuery(`
                SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'imHCI'
                AND COLUMN_NAME NOT LIKE 'SV_%'
                AND COLUMN_NAME NOT LIKE 'PF_%'
                AND COLUMN_NAME NOT LIKE 'C_%'
                AND COLUMN_NAME NOT LIKE 'A_%'
                AND COLUMN_NAME NOT LIKE 'AC_%'
                AND COLUMN_NAME NOT LIKE 'AR_%'
                AND COLUMN_NAME NOT LIKE 'EO_%'
                AND COLUMN_NAME NOT LIKE 'EC_%'
                AND COLUMN_NAME NOT LIKE 'RDT_%'
                AND COLUMN_NAME NOT LIKE 'PT_%'
                AND COLUMN_NAME NOT LIKE 'PD_%'
                AND COLUMN_NAME NOT LIKE 'SN_%'
                AND COLUMN_NAME NOT LIKE 'MI_%'
                AND COLUMN_NAME NOT LIKE 'MP_%'
                AND COLUMN_NAME NOT LIKE 'M_%'
                AND COLUMN_NAME NOT LIKE 'SOAM_%'
                AND COLUMN_NAME NOT LIKE 'CU_%'
                AND COLUMN_NAME NOT LIKE 'TCS_%'
                AND COLUMN_NAME NOT LIKE 'SL_%'
                AND COLUMN_NAME NOT LIKE 'AUG_%'
                AND COLUMN_NAME NOT LIKE 'AD_%'
                AND COLUMN_NAME NOT LIKE 'EN_%'
                AND COLUMN_NAME NOT LIKE 'EG_%'
                AND COLUMN_NAME NOT LIKE 'DIA_%'
                AND COLUMN_NAME NOT LIKE 'AIG_%'
                ORDER BY ORDINAL_POSITION
            `);

            console.log(`📊 Campos generales (no de secciones médicas): ${camposGenerales.length}\n`);
            console.log('=====================================');
            camposGenerales.forEach((col, idx) => {
                const maxLen = col.CHARACTER_MAXIMUM_LENGTH || 'N/A';
                console.log(`${(idx + 1).toString().padStart(2)}. ${col.COLUMN_NAME.padEnd(40)} ${col.DATA_TYPE.padEnd(15)} (${maxLen})`);
            });
        }

        // Obtener un registro de ejemplo para ver qué campos tienen datos
        console.log('\n\n🔍 Obteniendo registro de ejemplo...\n');
        const ejemplo = await executeQuery(`
            SELECT TOP 1 *
            FROM imHCI
            WHERE MotivoConsulta IS NOT NULL
            ORDER BY Fecha DESC
        `);

        if (ejemplo.length > 0) {
            const registro = ejemplo[0];
            console.log('📝 Campos con datos en el registro de ejemplo:');
            console.log('=====================================');
            
            Object.keys(registro).forEach((campo) => {
                if (registro[campo] !== null && registro[campo] !== '') {
                    const valor = String(registro[campo]);
                    const valorMostrar = valor.length > 50 ? valor.substring(0, 50) + '...' : valor;
                    console.log(`${campo.padEnd(40)} = ${valorMostrar}`);
                }
            });
        }

        console.log('\n✅ Búsqueda completada');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
})();
