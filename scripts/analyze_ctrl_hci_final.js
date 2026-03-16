const { connectDB } = require('../src/config/database');

async function analyzeFinal() {
  try {
    const pool = await connectDB();
    
    console.log('=== ANÁLISIS FINAL: CONTROLES vs HC ===\n');
    
    // 1. imInterCtrlFrecuente - Campos numéricos (medibles)
    console.log('📋 1. CAMPOS MEDIBLES EN imInterCtrlFrecuente:');
    const numericCtrl = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'imInterCtrlFrecuente'
        AND DATA_TYPE IN ('int', 'decimal', 'real', 'float', 'numeric', 'smallint', 'tinyint')
      ORDER BY ORDINAL_POSITION
    `);
    numericCtrl.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // 2. imHCI - Campos de signos vitales
    console.log('\n📋 2. CAMPOS DE SIGNOS VITALES EN imHCI:');
    const svHCI = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'imHCI'
        AND (COLUMN_NAME LIKE '%FC%' 
          OR COLUMN_NAME LIKE '%FR%'
          OR COLUMN_NAME LIKE '%Pulso%'
          OR COLUMN_NAME LIKE '%Temperatura%'
          OR COLUMN_NAME LIKE '%Presion%'
          OR COLUMN_NAME LIKE '%Peso%'
          OR COLUMN_NAME LIKE '%Talla%'
          OR COLUMN_NAME LIKE '%Saturacion%'
          OR COLUMN_NAME LIKE '%IMC%'
          OR COLUMN_NAME LIKE '%Superficie%'
          OR COLUMN_NAME LIKE '%Nutric%'
          OR COLUMN_NAME LIKE '%Perimetro%')
      ORDER BY ORDINAL_POSITION
    `);
    svHCI.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    
    // 3. PK de imHCI
    console.log('\n📋 3. PRIMARY KEY DE imHCI:');
    const pkHCI = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_NAME = 'imHCI'
        AND CONSTRAINT_NAME LIKE 'PK%'
    `);
    pkHCI.recordset.forEach(c => console.log(`  PK: ${c.COLUMN_NAME}`));
    
    // 4. PK de imInterCtrlFrecuente
    console.log('\n📋 4. PRIMARY KEY DE imInterCtrlFrecuente:');
    const pkCtrl = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_NAME = 'imInterCtrlFrecuente'
        AND CONSTRAINT_NAME LIKE 'PK%'
    `);
    pkCtrl.recordset.forEach(c => console.log(`  PK: ${c.COLUMN_NAME}`));
    
    // 5. Ejemplo de registro completo de imInterCtrlFrecuente
    console.log('\n📋 5. EJEMPLO COMPLETO DE imInterCtrlFrecuente:');
    const ejCtrl = await pool.request().query(`SELECT TOP 1 * FROM imInterCtrlFrecuente WHERE Pulso IS NOT NULL OR FC IS NOT NULL`);
    if (ejCtrl.recordset.length > 0) {
      Object.keys(ejCtrl.recordset[0]).forEach(k => {
        console.log(`  ${k}: ${ejCtrl.recordset[0][k]}`);
      });
    }
    
    // 6. Ejemplo de registro de imHCI con signos vitales
    console.log('\n📋 6. EJEMPLO DE imHCI (solo campos de signos vitales):');
    const ejHCI = await pool.request().query(`
      SELECT TOP 1 NumeroVisita, FC, FR, Pulso, Temperatura, Presion, Peso, Talla, 
             SupCorporal, IMC, EstadoNutricional, PerimetroCefalico
      FROM imHCI 
      WHERE FC IS NOT NULL OR FR IS NOT NULL
    `);
    if (ejHCI.recordset.length > 0) {
      Object.keys(ejHCI.recordset[0]).forEach(k => {
        console.log(`  ${k}: ${ejHCI.recordset[0][k]}`);
      });
    }
    
    // 7. Buscar archivos del backend
    console.log('\n📋 7. ARCHIVOS DEL BACKEND A REVISAR:');
    console.log('  Buscar en src/services/ y src/controllers/:');
    console.log('    - historiaClinica.service.js o hc.service.js o hci.service.js');
    console.log('    - controles.service.js o ctrlFrecuente.service.js');
    console.log('    - Endpoints relacionados con POST/PUT de HC');
    
    // 8. Mapeo de campos
    console.log('\n📋 8. MAPEO PROPUESTO (Controles ← → HC):');
    console.log('  DATOS MEDIBLES (van a ambas tablas):');
    console.log('    imInterCtrlFrecuente.FC ← → imHCI.FC');
    console.log('    imInterCtrlFrecuente.FR ← → imHCI.FR');
    console.log('    imInterCtrlFrecuente.Pulso ← → imHCI.Pulso');
    console.log('    imInterCtrlFrecuente.Temperatura ← → imHCI.Temperatura');
    console.log('    imInterCtrlFrecuente.Presion ← → imHCI.Presion');
    console.log('    (Verificar si hay Saturacion, Glucemia, etc.)');
    console.log('\n  DATOS ANTROPOMÉTRICOS (solo en HC):');
    console.log('    imHCI.Peso');
    console.log('    imHCI.Talla');
    console.log('    imHCI.IMC');
    console.log('    imHCI.SupCorporal');
    console.log('    imHCI.EstadoNutricional');
    console.log('    imHCI.PerimetroCefalico');

  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

analyzeFinal();
