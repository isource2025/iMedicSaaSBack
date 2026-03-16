const { connectDB } = require('../src/config/database');

async function analyzeCtrlFrecuenteHCI() {
  try {
    const pool = await connectDB();
    
    console.log('=== ANÁLISIS DE imInterCtrlFrecuente vs imHCI ===\n');
    
    // 1. Estructura de imInterCtrlFrecuente
    console.log('📋 1. ESTRUCTURA DE imInterCtrlFrecuente (CONTROLES DE ENFERMERÍA):');
    const colsCtrl = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'imInterCtrlFrecuente'
      ORDER BY ORDINAL_POSITION
    `);
    colsCtrl.recordset.forEach(c => {
      const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
      const nullable = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      console.log(`  ${c.COLUMN_NAME} | ${tipo} | ${nullable}`);
    });
    
    // Ejemplos
    const ejemploCtrl = await pool.request().query(`SELECT TOP 3 * FROM imInterCtrlFrecuente ORDER BY Valor DESC`);
    console.log('\n  Ejemplos de registros:');
    ejemploCtrl.recordset.forEach((r, i) => {
      console.log(`  --- Registro ${i + 1} ---`);
      Object.keys(r).forEach(k => {
        if (r[k] !== null && r[k] !== '' && r[k] !== 0) {
          console.log(`    ${k}: ${r[k]}`);
        }
      });
    });
    
    // Contar
    const countCtrl = await pool.request().query(`SELECT COUNT(*) as total FROM imInterCtrlFrecuente`);
    console.log(`\n  Total registros: ${countCtrl.recordset[0].total}`);
    
    // 2. Estructura de imHCI (Historia Clínica Internación)
    console.log('\n\n📋 2. ESTRUCTURA DE imHCI (HISTORIA CLÍNICA):');
    const colsHCI = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'imHCI'
      ORDER BY ORDINAL_POSITION
    `);
    colsHCI.recordset.forEach(c => {
      const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
      const nullable = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      console.log(`  ${c.COLUMN_NAME} | ${tipo} | ${nullable}`);
    });
    
    // Ejemplos
    const ejemploHCI = await pool.request().query(`SELECT TOP 2 * FROM imHCI ORDER BY Valor DESC`);
    console.log('\n  Ejemplos de registros (primeros 20 campos):');
    ejemploHCI.recordset.forEach((r, i) => {
      console.log(`  --- Registro ${i + 1} ---`);
      Object.keys(r).slice(0, 20).forEach(k => {
        if (r[k] !== null && r[k] !== '' && r[k] !== 0) {
          console.log(`    ${k}: ${r[k]}`);
        }
      });
    });
    
    // Contar
    const countHCI = await pool.request().query(`SELECT COUNT(*) as total FROM imHCI`);
    console.log(`\n  Total registros: ${countHCI.recordset[0].total}`);
    
    // 3. Comparar campos comunes (signos vitales)
    console.log('\n\n📋 3. CAMPOS COMUNES (SIGNOS VITALES):');
    const camposComunes = ['Pulso', 'FC', 'FR', 'Temperatura', 'Peso', 'Talla', 'Presion', 'Saturacion'];
    
    console.log('\n  En imInterCtrlFrecuente:');
    for (const campo of camposComunes) {
      const existe = colsCtrl.recordset.find(c => c.COLUMN_NAME.toLowerCase().includes(campo.toLowerCase()));
      if (existe) {
        const tipo = existe.CHARACTER_MAXIMUM_LENGTH ? `${existe.DATA_TYPE}(${existe.CHARACTER_MAXIMUM_LENGTH})` : existe.DATA_TYPE;
        console.log(`    ✅ ${existe.COLUMN_NAME} (${tipo})`);
      } else {
        console.log(`    ❌ ${campo} - NO existe`);
      }
    }
    
    console.log('\n  En imHCI:');
    for (const campo of camposComunes) {
      const existe = colsHCI.recordset.find(c => c.COLUMN_NAME.toLowerCase().includes(campo.toLowerCase()));
      if (existe) {
        const tipo = existe.CHARACTER_MAXIMUM_LENGTH ? `${existe.DATA_TYPE}(${existe.CHARACTER_MAXIMUM_LENGTH})` : existe.DATA_TYPE;
        console.log(`    ✅ ${existe.COLUMN_NAME} (${tipo})`);
      } else {
        console.log(`    ❌ ${campo} - NO existe`);
      }
    }
    
    // 4. Buscar campos de antropometría en imHCI
    console.log('\n\n📋 4. CAMPOS DE ANTROPOMETRÍA EN imHCI:');
    const antropometria = colsHCI.recordset.filter(c => 
      c.COLUMN_NAME.toLowerCase().includes('peso') ||
      c.COLUMN_NAME.toLowerCase().includes('talla') ||
      c.COLUMN_NAME.toLowerCase().includes('imc') ||
      c.COLUMN_NAME.toLowerCase().includes('nutric') ||
      c.COLUMN_NAME.toLowerCase().includes('perimetro') ||
      c.COLUMN_NAME.toLowerCase().includes('superficie')
    );
    antropometria.forEach(c => {
      const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
      console.log(`  ${c.COLUMN_NAME} | ${tipo}`);
    });
    
    // 5. Ver relación con NumeroVisita
    console.log('\n\n📋 5. RELACIÓN CON NumeroVisita:');
    try {
      const relCtrl = await pool.request().query(`
        SELECT TOP 3 c.Valor, c.NumeroVisita, c.Fecha, c.Hora, v.NUMEROVISITA, v.IDPACIENTE
        FROM imInterCtrlFrecuente c
        INNER JOIN imVisita v ON c.NumeroVisita = v.NUMEROVISITA
      `);
      console.log('  ✅ imInterCtrlFrecuente.NumeroVisita -> imVisita.NUMEROVISITA');
      relCtrl.recordset.forEach(r => console.log(`    Control ${r.Valor} -> Visita ${r.NUMEROVISITA} Paciente ${r.IDPACIENTE}`));
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
    
    try {
      const relHCI = await pool.request().query(`
        SELECT TOP 3 h.Valor, h.NumeroVisita, v.NUMEROVISITA, v.IDPACIENTE
        FROM imHCI h
        INNER JOIN imVisita v ON h.NumeroVisita = v.NUMEROVISITA
      `);
      console.log('\n  ✅ imHCI.NumeroVisita -> imVisita.NUMEROVISITA');
      relHCI.recordset.forEach(r => console.log(`    HC ${r.Valor} -> Visita ${r.NUMEROVISITA} Paciente ${r.IDPACIENTE}`));
    } catch (e) {
      console.log(`\n  ❌ Error: ${e.message}`);
    }
    
    // 6. Buscar en el backend los servicios/controladores
    console.log('\n\n📋 6. BUSCAR EN BACKEND:');
    console.log('  Archivos a revisar:');
    console.log('    - src/services/historiaClinica.service.js o hc.service.js');
    console.log('    - src/services/controles.service.js');
    console.log('    - src/controllers/historiaClinica.controller.js');
    console.log('    - src/controllers/controles.controller.js');

  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

analyzeCtrlFrecuenteHCI();
