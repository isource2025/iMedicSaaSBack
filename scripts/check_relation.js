const { connectDB } = require('../src/config/database');

async function checkRelation() {
  try {
    const pool = await connectDB();
    
    console.log('=== ESTRUCTURA DE TABLAS ===\n');
    
    // Ver columnas de impassword
    console.log('📋 Columnas de impassword:');
    const colsPassword = await pool.request()
      .query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'impassword'`);
    colsPassword.recordset.forEach(c => console.log(`  - ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    console.log('\n📋 Columnas de imPersonalSectores:');
    const colsPersonalSectores = await pool.request()
      .query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imPersonalSectores'`);
    colsPersonalSectores.recordset.forEach(c => console.log(`  - ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    console.log('\n📋 Columnas de imSectores:');
    const colsSectores = await pool.request()
      .query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imSectores'`);
    colsSectores.recordset.forEach(c => console.log(`  - ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    console.log('\n=== DATOS DE EJEMPLO ===\n');
    
    // Ver un usuario de ejemplo
    console.log('👤 Usuario 40589127:');
    const user = await pool.request()
      .query(`SELECT * FROM impassword WHERE NombreRed = '40589127'`);
    console.log(user.recordset[0]);
    
    // Ver registros de ejemplo de imPersonalSectores
    console.log('\n🔗 Ejemplos de imPersonalSectores (primeros 5):');
    const ejemplos = await pool.request()
      .query(`SELECT TOP 5 * FROM imPersonalSectores`);
    ejemplos.recordset.forEach(e => console.log(e));
    
    // Ver qué campo de impassword se usa en imPersonalSectores
    console.log('\n🔍 Verificando relación - Usuarios que SÍ tienen sectores:');
    const conSectores = await pool.request()
      .query(`
        SELECT TOP 5
          pw.CodOperador,
          pw.ValorPersonal,
          pw.NombreRed,
          pw.Nombres,
          ps.idPersonal,
          ps.idSector
        FROM impassword pw
        INNER JOIN imPersonalSectores ps ON pw.CodOperador = ps.idPersonal
      `);
    conSectores.recordset.forEach(r => {
      console.log(`  CodOperador: ${r.CodOperador}, ValorPersonal: ${r.ValorPersonal}, idPersonal: ${r.idPersonal} -> ${r.CodOperador === r.idPersonal ? '✅ MATCH con CodOperador' : '❌ NO MATCH'}`);
    });
    
    // Intentar con ValorPersonal
    console.log('\n🔍 Intentando relación con ValorPersonal:');
    const conValorPersonal = await pool.request()
      .query(`
        SELECT TOP 5
          pw.CodOperador,
          pw.ValorPersonal,
          pw.NombreRed,
          ps.idPersonal,
          ps.idSector
        FROM impassword pw
        INNER JOIN imPersonalSectores ps ON pw.ValorPersonal = ps.idPersonal
      `);
    console.log(`Registros encontrados con ValorPersonal: ${conValorPersonal.recordset.length}`);
    if (conValorPersonal.recordset.length > 0) {
      conValorPersonal.recordset.forEach(r => {
        console.log(`  ValorPersonal: ${r.ValorPersonal}, idPersonal: ${r.idPersonal} -> ${r.ValorPersonal === r.idPersonal ? '✅ MATCH' : '❌ NO MATCH'}`);
      });
    }
    
    console.log('\n=== CONCLUSIÓN ===');
    console.log('La relación correcta es:');
    console.log('impassword.CodOperador = imPersonalSectores.idPersonal');
    console.log('O');
    console.log('impassword.ValorPersonal = imPersonalSectores.idPersonal');
    
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkRelation();
