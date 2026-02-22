const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('=== Buscar usuario ADMINISTRADOR en imPassword ===');
        
        const result = await executeQuery(`
            SELECT CodOperador, Nombres, Apellido, Nombres + ' ' + Apellido AS FullName
            FROM dbo.imPassword
            WHERE Apellido LIKE '%ADMINISTRADOR%' OR Nombres LIKE '%ADMINISTRADOR%'
            ORDER BY CodOperador
        `);
        
        console.log('\n📊 Usuarios encontrados:', result.length);
        result.forEach((row) => {
            console.log(`\nCodOperador: ${row.CodOperador}`);
            console.log(`Nombres: ${row.Nombres}`);
            console.log(`Apellido: ${row.Apellido}`);
            console.log(`FullName: ${row.FullName}`);
        });
        
        console.log('\n=== Verificar qué código usa el sistema actualmente ===');
        const current = await executeQuery(`
            SELECT TOP 5 OperadorCarga, Profesional
            FROM dbo.imInterCtrlMedicamento
            WHERE NumeroVisita = 363245
            ORDER BY IDCtrlMedica DESC
        `);
        
        console.log('\nÚltimos 5 registros de medicación:');
        current.forEach((row, idx) => {
            console.log(`[${idx + 1}] OperadorCarga: ${row.OperadorCarga}, Profesional: ${row.Profesional}`);
        });
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
