const { executeQuery } = require("../src/models/db");

async function compararMedicamentos() {
    try {
        console.log('='.repeat(80));
        console.log('COMPARACIÓN DE MEDICAMENTOS');
        console.log('='.repeat(80));

        // Comparar ABBOCATT (SÍ es descartable) vs DEXTROSA (NO es descartable)
        console.log('\n1. ABBOCATT Nº14 (SÍ debe estar en Insumos) - Troquel 1031\n');
        const abbocatt = await executeQuery(`SELECT * FROM imVademecum WHERE Troquel = 1031`);
        if (abbocatt.length > 0) {
            console.log(JSON.stringify(abbocatt[0], null, 2));
        }

        console.log('\n' + '='.repeat(80));
        console.log('2. DEXTROSA (NO debe estar en Insumos) - Troquel 9956856\n');
        const dextrosa = await executeQuery(`SELECT * FROM imVademecum WHERE Troquel = 9956856`);
        if (dextrosa.length > 0) {
            console.log(JSON.stringify(dextrosa[0], null, 2));
        }

        console.log('\n' + '='.repeat(80));
        console.log('3. ALCOHOL EN GEL (SÍ debe estar en Insumos) - Troquel 12000005\n');
        const alcohol = await executeQuery(`SELECT * FROM imVademecum WHERE Troquel = 12000005`);
        if (alcohol.length > 0) {
            console.log(JSON.stringify(alcohol[0], null, 2));
        }

        // Buscar diferencias clave
        console.log('\n' + '='.repeat(80));
        console.log('4. COMPARACIÓN DE CAMPOS CLAVE\n');
        if (abbocatt.length > 0 && dextrosa.length > 0 && alcohol.length > 0) {
            const campos = Object.keys(abbocatt[0]);
            console.log('Comparando campos...\n');
            
            campos.forEach(campo => {
                const valAbbocatt = abbocatt[0][campo];
                const valDextrosa = dextrosa[0][campo];
                const valAlcohol = alcohol[0][campo];
                
                // Solo mostrar campos que sean diferentes
                if (valAbbocatt !== valDextrosa || valAbbocatt !== valAlcohol) {
                    console.log(`${campo}:`);
                    console.log(`  ABBOCATT (insumo):  ${JSON.stringify(valAbbocatt)}`);
                    console.log(`  ALCOHOL (insumo):   ${JSON.stringify(valAlcohol)}`);
                    console.log(`  DEXTROSA (NO):      ${JSON.stringify(valDextrosa)}`);
                    console.log('');
                }
            });
        }

        // Ver más ejemplos de cada tipo
        console.log('\n' + '='.repeat(80));
        console.log('5. MÁS EJEMPLOS DE DESCARTABLES TÍPICOS (agujas, catéteres, etc.)\n');
        const descartablesTipicos = await executeQuery(`
            SELECT TOP 10 Troquel, Alias, Descripcion, TipoMedicamento
            FROM imVademecum
            WHERE (Alias LIKE '%AGUJA%' OR Alias LIKE '%CATETER%' OR Alias LIKE '%ABBOCATT%')
            AND Alias <> ''
            ORDER BY Alias
        `);
        console.table(descartablesTipicos);

        console.log('\n' + '='.repeat(80));
        console.log('6. EJEMPLOS DE MEDICAMENTOS (soluciones, drogas, etc.)\n');
        const medicamentos = await executeQuery(`
            SELECT TOP 10 Troquel, Alias, Descripcion, TipoMedicamento
            FROM imVademecum
            WHERE (Alias LIKE '%SOLUCION%' OR Alias LIKE '%DEXTROSA%' OR Alias LIKE '%SUERO%')
            AND Alias <> ''
            ORDER BY Alias
        `);
        console.table(medicamentos);

        console.log('\n✅ Comparación completada');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

compararMedicamentos();
