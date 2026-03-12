const { connectDB } = require('../src/config/database');

async function insertSector() {
  try {
    const pool = await connectDB();
    
    console.log('🔧 Insertando sector para usuario 40589127...\n');
    
    // Verificar usuario
    const user = await pool.request()
      .query(`SELECT CodOperador, ValorPersonal, NombreRed, Nombres, Apellido FROM impassword WHERE NombreRed = '40589127'`);
    
    if (user.recordset.length === 0) {
      console.log('❌ Usuario no encontrado');
      process.exit(1);
    }
    
    const valorPersonal = user.recordset[0].ValorPersonal;
    console.log(`✅ Usuario encontrado: ${user.recordset[0].Nombres} ${user.recordset[0].Apellido}`);
    console.log(`   ValorPersonal: ${valorPersonal}\n`);
    
    // Insertar sector EME (Emergencia) como ejemplo
    console.log('📝 Insertando sector EME (EMERGENCIA GENERAL)...');
    
    await pool.request()
      .query(`
        INSERT INTO imPersonalSectores (IdPersonal, IdSector, UltimoAcceso)
        VALUES (${valorPersonal}, 'EME', GETDATE())
      `);
    
    console.log('✅ Sector insertado correctamente\n');
    
    // Verificar
    console.log('🔍 Verificando sectores del usuario...');
    const sectores = await pool.request()
      .query(`
        SELECT 
          ps.IdPersonal,
          ps.IdSector,
          s.Descripcion
        FROM imPersonalSectores ps
        INNER JOIN imSectores s ON ps.IdSector = s.Valor
        WHERE ps.IdPersonal = ${valorPersonal}
      `);
    
    console.log('Sectores asignados:');
    sectores.recordset.forEach(s => {
      console.log(`  - ${s.IdSector}: ${s.Descripcion}`);
    });
    
    console.log('\n✅ COMPLETADO - El usuario ahora puede hacer login');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
  process.exit(0);
}

insertSector();
