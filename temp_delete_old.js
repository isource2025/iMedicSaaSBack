const { executeQuery } = require('./src/models/db');

(async () => {
    try {
        console.log('=== Eliminar el registro viejo de medicación para poder volver a aplicar ===');
        
        const result = await executeQuery(`
            DELETE FROM dbo.imInterCtrlMedicamento
            WHERE IDCtrlMedica = 1794679
        `);
        
        console.log('✅ Registro eliminado. Ahora podés volver a aplicar la indicación 3279607');
        console.log('   El nuevo código insertará automáticamente la indicación adicional 3279608');
        
        process.exit(0);
    } catch(e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();
