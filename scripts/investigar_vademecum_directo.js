const { executeQuery } = require("../src/models/db");

async function investigarVademecum() {
    try {
        console.log('='.repeat(80));
        console.log('INVESTIGANDO TABLA DE VADEMÉCUM');
        console.log('='.repeat(80));

        // 1. Buscar la tabla correcta
        console.log('\n1. Buscando tablas con "Vademecum" o similar...\n');
        const tablas = await executeQuery(`
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME LIKE '%Vademecum%' OR TABLE_NAME LIKE '%vadem%'
            ORDER BY TABLE_NAME
        `);
        console.table(tablas);

        // 2. Intentar consultar directamente como en el código
        console.log('\n2. Consultando imVademecum directamente (como en el código)...\n');
        try {
            const vademecum = await executeQuery(`
                SELECT TOP 5
                    Troquel,
                    Alias,
                    Descripcion,
                    TipoMedicamento
                FROM imVademecum
                WHERE Alias <> ''
                ORDER BY Alias
            `);
            console.log('✅ Tabla encontrada!');
            console.table(vademecum);
            
            // 3. Ver todos los valores de TipoMedicamento
            console.log('\n3. Valores únicos de TipoMedicamento...\n');
            const tipos = await executeQuery(`
                SELECT TipoMedicamento, COUNT(*) as Cantidad
                FROM imVademecum
                GROUP BY TipoMedicamento
                ORDER BY Cantidad DESC
            `);
            console.table(tipos);

            // 4. Ver los medicamentos específicos
            console.log('\n4. Medicamentos específicos (ABBOCATT, ALCOHOL GEL, DEXTROSA)...\n');
            const especificos = await executeQuery(`
                SELECT 
                    Troquel,
                    Alias,
                    Descripcion,
                    TipoMedicamento
                FROM imVademecum
                WHERE Troquel IN (1031, 12000005, 9956856)
                ORDER BY Troquel
            `);
            console.table(especificos);

            // 5. Ver registro completo de ABBOCATT
            console.log('\n5. Registro COMPLETO de ABBOCATT Nº14 (Troquel 1031)...\n');
            const abbocatt = await executeQuery(`
                SELECT * FROM imVademecum WHERE Troquel = 1031
            `);
            if (abbocatt.length > 0) {
                console.log('Columnas disponibles:', Object.keys(abbocatt[0]));
                console.log('\nDatos completos:');
                console.log(JSON.stringify(abbocatt[0], null, 2));
            }

            // 6. Ver registro completo de DEXTROSA
            console.log('\n6. Registro COMPLETO de DEXTROSA (Troquel 9956856)...\n');
            const dextrosa = await executeQuery(`
                SELECT * FROM imVademecum WHERE Troquel = 9956856
            `);
            if (dextrosa.length > 0) {
                console.log('Columnas disponibles:', Object.keys(dextrosa[0]));
                console.log('\nDatos completos:');
                console.log(JSON.stringify(dextrosa[0], null, 2));
            }

            // 7. Buscar medicamentos con TipoMedicamento = 'DESC'
            console.log('\n7. Ejemplos de medicamentos con TipoMedicamento = DESC...\n');
            const desc = await executeQuery(`
                SELECT TOP 10
                    Troquel,
                    Alias,
                    Descripcion,
                    TipoMedicamento
                FROM imVademecum
                WHERE TipoMedicamento = 'DESC'
                ORDER BY Alias
            `);
            console.table(desc);

            // 8. Buscar patrones de descartables
            console.log('\n8. Medicamentos con nombres típicos de descartables...\n');
            const patrones = await executeQuery(`
                SELECT TOP 20
                    Troquel,
                    Alias,
                    Descripcion,
                    TipoMedicamento
                FROM imVademecum
                WHERE Alias LIKE '%ABBOCATT%' 
                   OR Alias LIKE '%CATETER%' 
                   OR Alias LIKE '%AGUJA%' 
                   OR Alias LIKE '%JERINGA%'
                   OR Alias LIKE '%SONDA%'
                   OR Alias LIKE '%GUANTE%'
                ORDER BY Alias
            `);
            console.table(patrones);

        } catch (error) {
            console.error('❌ Error al consultar imVademecum:', error.message);
        }

        console.log('\n✅ Investigación completada');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error general:', error);
        process.exit(1);
    }
}

investigarVademecum();
