const { connectDB, sql } = require('../src/config/database');

async function diagnosticar() {
  try {
    console.log('🔍 Conectando a la base de datos...\n');
    const pool = await connectDB();
    
    // PASO 1: Verificar usuario
    console.log('=== PASO 1: Verificar usuario 40589127 ===');
    const usuario = await pool.request()
      .query(`SELECT CodOperador, NombreRed, Nombres, Apellido, ValorPersonal FROM impassword WHERE NombreRed = '40589127'`);
    console.log('Usuario encontrado:', usuario.recordset);
    
    if (usuario.recordset.length === 0) {
      console.log('❌ ERROR: Usuario 40589127 NO existe en impassword');
      process.exit(1);
    }
    
    const codOperador = usuario.recordset[0].CodOperador;
    console.log(`✅ Usuario existe con CodOperador: ${codOperador}\n`);
    
    // PASO 2: Verificar sectores del usuario
    console.log('=== PASO 2: Verificar sectores asignados ===');
    const sectoresUsuario = await pool.request()
      .query(`SELECT * FROM imPersonalSectores WHERE idPersonal = ${codOperador}`);
    console.log('Sectores del usuario:', sectoresUsuario.recordset);
    
    if (sectoresUsuario.recordset.length === 0) {
      console.log('❌ PROBLEMA ENCONTRADO: Usuario NO tiene sectores asignados en imPersonalSectores\n');
    } else {
      console.log(`✅ Usuario tiene ${sectoresUsuario.recordset.length} sector(es) asignado(s)\n`);
    }
    
    // PASO 3: Ver estructura de imPersonalSectores
    console.log('=== PASO 3: Estructura de imPersonalSectores (primeros 10) ===');
    const estructura = await pool.request()
      .query('SELECT TOP 10 * FROM imPersonalSectores');
    console.log('Registros ejemplo:', estructura.recordset);
    console.log('');
    
    // PASO 4: Ver sectores disponibles
    console.log('=== PASO 4: Sectores disponibles ===');
    const sectores = await pool.request()
      .query('SELECT * FROM imSectores');
    console.log('Sectores disponibles:', sectores.recordset);
    console.log('');
    
    // PASO 5: Verificar JOIN completo
    console.log('=== PASO 5: Verificar JOIN completo ===');
    const joinCompleto = await pool.request()
      .query(`
        SELECT 
          pw.CodOperador,
          pw.NombreRed,
          pw.Nombres,
          pw.Apellido,
          ps.idPersonal,
          ps.idSector,
          s.Descripcion as descripcionSector
        FROM impassword pw
        LEFT JOIN imPersonalSectores ps ON pw.CodOperador = ps.idPersonal
        LEFT JOIN imSectores s ON ps.idSector = s.Valor
        WHERE pw.NombreRed = '40589127'
      `);
    console.log('Resultado del JOIN:', joinCompleto.recordset);
    console.log('');
    
    // DIAGNÓSTICO FINAL
    console.log('=== DIAGNÓSTICO FINAL ===');
    if (sectoresUsuario.recordset.length === 0) {
      console.log('❌ PROBLEMA: Usuario 40589127 NO tiene sectores asignados');
      console.log('');
      console.log('📋 SOLUCIÓN: Necesitas insertar registros en imPersonalSectores');
      console.log('');
      console.log('Sectores disponibles para asignar:');
      sectores.recordset.forEach(s => {
        console.log(`  - ${s.Valor}: ${s.Descripcion}`);
      });
      console.log('');
      console.log('Ejemplo de INSERT:');
      console.log(`INSERT INTO imPersonalSectores (idPersonal, idSector)`);
      console.log(`VALUES (${codOperador}, 'VALOR_SECTOR')  -- Reemplazar VALOR_SECTOR con uno de los valores de arriba`);
      console.log('');
      console.log('¿Quieres que inserte automáticamente un sector de ejemplo? (Ctrl+C para cancelar)');
    } else {
      console.log('✅ Usuario tiene sectores asignados correctamente');
      console.log('El problema debe estar en otro lado del código');
    }
    
  } catch (error) {
    console.error('❌ Error durante el diagnóstico:', error);
    process.exit(1);
  }
}

diagnosticar();
