const db = require('../src/models/db');

/**
 * Script para corregir TipoUnidad vacío en indicaciones de medicamentos
 * Actualiza TipoUnidad desde imVademecum.TipoMedicamento para todas las indicaciones
 * de tipo Medicamento (TipoIndicacion donde Tipo = 'M') que tienen TipoUnidad vacío
 */

(async () => {
    try {
        console.log('🔍 Buscando indicaciones de medicamentos con TipoUnidad vacío...\n');
        
        // 1. Primero ver cuántas hay
        const sqlCount = `
            SELECT COUNT(*) as Total
            FROM imInterIndMedicas iim
            INNER JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
            WHERE tit.Tipo = 'M'
                AND (iim.TipoUnidad IS NULL OR RTRIM(iim.TipoUnidad) = '')
        `;
        
        const countResult = await db.executeQuery(sqlCount);
        const total = countResult[0]?.Total || 0;
        
        console.log(`📊 Total de indicaciones de medicamentos con TipoUnidad vacío: ${total}\n`);
        
        if (total === 0) {
            console.log('✅ No hay indicaciones para corregir');
            process.exit(0);
        }
        
        // 2. Actualizar TipoUnidad desde el vademécum
        const sqlUpdate = `
            UPDATE iim
            SET iim.TipoUnidad = v.TipoMedicamento
            FROM imInterIndMedicas iim
            INNER JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
            INNER JOIN imVademecum v ON iim.Codigo = v.Troquel
            WHERE tit.Tipo = 'M'
                AND (iim.TipoUnidad IS NULL OR RTRIM(iim.TipoUnidad) = '')
                AND v.TipoMedicamento IS NOT NULL
                AND RTRIM(v.TipoMedicamento) <> ''
        `;
        
        console.log('🔧 Ejecutando actualización...\n');
        const updateResult = await db.executeQuery(sqlUpdate);
        
        console.log(`✅ Actualización completada`);
        console.log(`📝 Resultado:`, updateResult);
        
        // 3. Verificar cuántas quedaron sin corregir (medicamentos sin TipoMedicamento en vademécum)
        const sqlRemaining = `
            SELECT COUNT(*) as Total
            FROM imInterIndMedicas iim
            INNER JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
            WHERE tit.Tipo = 'M'
                AND (iim.TipoUnidad IS NULL OR RTRIM(iim.TipoUnidad) = '')
        `;
        
        const remainingResult = await db.executeQuery(sqlRemaining);
        const remaining = remainingResult[0]?.Total || 0;
        
        if (remaining > 0) {
            console.log(`⚠️  Quedan ${remaining} indicaciones sin TipoUnidad (medicamentos sin TipoMedicamento en vademécum)\n`);
            
            // Mostrar algunos ejemplos
            const sqlExamples = `
                SELECT TOP 10
                    iim.NroIndicacion,
                    iim.Codigo,
                    iim.AliasMedicamento,
                    v.Alias as VademecumAlias,
                    v.TipoMedicamento
                FROM imInterIndMedicas iim
                INNER JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
                LEFT JOIN imVademecum v ON iim.Codigo = v.Troquel
                WHERE tit.Tipo = 'M'
                    AND (iim.TipoUnidad IS NULL OR RTRIM(iim.TipoUnidad) = '')
            `;
            
            const examples = await db.executeQuery(sqlExamples);
            console.log('📋 Ejemplos de indicaciones sin corregir:');
            console.log(JSON.stringify(examples, null, 2));
        } else {
            console.log('✅ Todas las indicaciones de medicamentos tienen TipoUnidad');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
})();
