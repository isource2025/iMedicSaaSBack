const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('=== VERIFICACIÓN 1: ¿Existe el código 999999 en imPassword? ===');
        const passwordCheck = await executeQuery(`
            SELECT CodOperador, Apellido, Nombres 
            FROM imPassword 
            WHERE CodOperador = 999999
        `);
        console.log('Resultado:', passwordCheck);
        
        console.log('\n=== VERIFICACIÓN 2: ¿La indicación 3279607 tiene indicaciones adicionales? ===');
        const adicionalesCheck = await executeQuery(`
            SELECT 
                NroIndicacion,
                NroAdicional,
                FormaAdicional,
                AliasMedicamento,
                Cantidad,
                CantidadIndicada
            FROM imInterIndMedicas 
            WHERE NroAdicional = 3279607
            ORDER BY NroIndicacion
        `);
        console.log('Indicaciones adicionales encontradas:', adicionalesCheck.length);
        console.log('Datos:', JSON.stringify(adicionalesCheck, null, 2));
        
        console.log('\n=== VERIFICACIÓN 3: Datos de la indicación principal 3279607 ===');
        const indicacionPrincipal = await executeQuery(`
            SELECT 
                NroIndicacion,
                NroAdicional,
                OperadorCarga,
                ProfesionalAsiste,
                AliasMedicamento,
                Cantidad,
                CantidadIndicada
            FROM imInterIndMedicas 
            WHERE NroIndicacion = 3279607
        `);
        console.log('Indicación principal:', JSON.stringify(indicacionPrincipal, null, 2));
        
        console.log('\n=== VERIFICACIÓN 4: ¿Qué códigos de operador existen en imPassword? (primeros 10) ===');
        const operadoresExistentes = await executeQuery(`
            SELECT TOP 10 CodOperador, Apellido, Nombres 
            FROM imPassword 
            ORDER BY CodOperador
        `);
        console.log('Operadores:', JSON.stringify(operadoresExistentes, null, 2));
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
