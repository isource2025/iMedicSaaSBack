const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('🔍 Analizando estructura de Signos Vitales...\n');

        // 1. Estructura de tabla de controles frecuentes
        console.log('📊 Tabla: imInterCtrlFrecuente');
        console.log('=====================================');
        const colsControles = await executeQuery(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imInterCtrlFrecuente'
            ORDER BY COLUMN_NAME
        `);
        colsControles.forEach((c, idx) => {
            const maxLen = c.CHARACTER_MAXIMUM_LENGTH || 'N/A';
            console.log(`${(idx + 1).toString().padStart(2)}. ${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE.padEnd(15)} (${maxLen})`);
        });

        // 2. Campos de signos vitales en imHCI
        console.log('\n\n📊 Campos de Signos Vitales en imHCI (prefijo SV_)');
        console.log('=====================================');
        const colsSV = await executeQuery(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'imHCI'
            AND COLUMN_NAME LIKE 'SV_%'
            ORDER BY COLUMN_NAME
        `);
        colsSV.forEach((c, idx) => {
            const maxLen = c.CHARACTER_MAXIMUM_LENGTH || 'N/A';
            console.log(`${(idx + 1).toString().padStart(2)}. ${c.COLUMN_NAME.padEnd(30)} ${c.DATA_TYPE.padEnd(15)} (${maxLen})`);
        });

        // 3. Ejemplo de registro de controles frecuentes
        console.log('\n\n📝 Ejemplo de registro de Controles Frecuentes:');
        console.log('=====================================');
        const ejemploControl = await executeQuery(`
            SELECT TOP 1 *
            FROM imInterCtrlFrecuente
            ORDER BY FechaControl DESC
        `);
        
        if (ejemploControl.length > 0) {
            const registro = ejemploControl[0];
            Object.keys(registro).forEach((campo) => {
                if (registro[campo] !== null && registro[campo] !== '') {
                    const valor = String(registro[campo]);
                    const valorMostrar = valor.length > 50 ? valor.substring(0, 50) + '...' : valor;
                    console.log(`${campo.padEnd(30)} = ${valorMostrar}`);
                }
            });
        }

        // 4. Mapeo de campos
        console.log('\n\n🔗 Mapeo sugerido: Controles Frecuentes → HC Signos Vitales');
        console.log('=====================================');
        console.log('imInterCtrlFrecuente          →  imHCI');
        console.log('----------------------------------------');
        console.log('PA (Presión Arterial)         →  SV_PA');
        console.log('FC (Frecuencia Cardíaca)      →  SV_FC');
        console.log('FR (Frecuencia Respiratoria)  →  SV_FR');
        console.log('TAX (Temperatura Axilar)      →  SV_TAX');
        console.log('Glucemia                      →  SV_GLUCEMIA');
        console.log('Peso                          →  SV_PESOACTUAL');
        console.log('Talla                         →  SV_TALLA');

        console.log('\n✅ Análisis completado');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
})();
