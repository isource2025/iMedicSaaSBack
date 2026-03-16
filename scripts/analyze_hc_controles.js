const { connectDB } = require('../src/config/database');

async function analyzeHCControles() {
  try {
    const pool = await connectDB();
    
    console.log('=== ANÁLISIS DE HISTORIA CLÍNICA Y CONTROLES ===\n');
    
    // 1. Buscar tablas relacionadas con historia clínica
    console.log('📋 1. TABLAS DE HISTORIA CLÍNICA:');
    const hcTables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE 'HC%' OR TABLE_NAME LIKE '%HistoriaClinica%'
      ORDER BY TABLE_NAME
    `);
    hcTables.recordset.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
    
    // 2. Buscar tablas de controles
    console.log('\n📋 2. TABLAS DE CONTROLES:');
    const controlTables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE '%Control%' OR TABLE_NAME LIKE '%Signo%'
      ORDER BY TABLE_NAME
    `);
    controlTables.recordset.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
    
    // 3. Buscar tabla imInterControles (mencionada en el análisis previo)
    console.log('\n📋 3. ESTRUCTURA DE imInterControles:');
    try {
      const colsControles = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'imInterControles'
        ORDER BY ORDINAL_POSITION
      `);
      colsControles.recordset.forEach(c => {
        const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
        console.log(`  ${c.COLUMN_NAME} | ${tipo} | ${c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      
      // Datos de ejemplo
      const ejemploControles = await pool.request().query(`SELECT TOP 3 * FROM imInterControles ORDER BY Valor DESC`);
      console.log('\n  Ejemplos de registros:');
      ejemploControles.recordset.forEach((r, i) => {
        console.log(`  --- Registro ${i + 1} ---`);
        Object.keys(r).forEach(k => {
          if (r[k] !== null && r[k] !== '' && r[k] !== 0) {
            console.log(`    ${k}: ${r[k]}`);
          }
        });
      });
    } catch (e) {
      console.log(`  ❌ No existe o error: ${e.message}`);
    }
    
    // 4. Buscar tabla de signos vitales en HC
    console.log('\n📋 4. BUSCAR TABLA DE SIGNOS VITALES EN HC:');
    const signosVitalesTables = ['HCSignosVitales', 'HCControles', 'HCDatosVitales', 'imHCSignosVitales', 'imHCControles'];
    for (const table of signosVitalesTables) {
      try {
        const exists = await pool.request().query(`
          SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}'
        `);
        if (exists.recordset[0].cnt > 0) {
          console.log(`\n  ✅ ${table} EXISTE`);
          const cols = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = '${table}'
            ORDER BY ORDINAL_POSITION
          `);
          cols.recordset.forEach(c => {
            const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
            console.log(`    ${c.COLUMN_NAME} | ${tipo}`);
          });
          
          // Ejemplo
          const ejemplo = await pool.request().query(`SELECT TOP 2 * FROM ${table}`);
          console.log(`\n    Ejemplos:`);
          ejemplo.recordset.forEach((r, i) => {
            console.log(`    --- Registro ${i + 1} ---`);
            Object.keys(r).slice(0, 10).forEach(k => {
              console.log(`      ${k}: ${r[k]}`);
            });
          });
        }
      } catch (e) {
        console.log(`  ❌ ${table} no existe`);
      }
    }
    
    // 5. Buscar en tablas HC generales
    console.log('\n📋 5. REVISAR TABLAS HC PRINCIPALES:');
    const mainHCTables = hcTables.recordset.map(t => t.TABLE_NAME).slice(0, 10);
    for (const table of mainHCTables) {
      try {
        const cols = await pool.request().query(`
          SELECT COLUMN_NAME, DATA_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = '${table}' 
            AND (COLUMN_NAME LIKE '%Signo%' 
              OR COLUMN_NAME LIKE '%Vital%' 
              OR COLUMN_NAME LIKE '%Presion%'
              OR COLUMN_NAME LIKE '%Temperatura%'
              OR COLUMN_NAME LIKE '%Peso%'
              OR COLUMN_NAME LIKE '%Talla%'
              OR COLUMN_NAME LIKE '%FC%'
              OR COLUMN_NAME LIKE '%FR%'
              OR COLUMN_NAME LIKE '%Sat%')
        `);
        if (cols.recordset.length > 0) {
          console.log(`\n  📁 ${table}:`);
          cols.recordset.forEach(c => console.log(`    - ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
        }
      } catch (e) {}
    }
    
    // 6. Buscar tipo de controles
    console.log('\n📋 6. TABLA imInterTipoControles:');
    try {
      const tipoControles = await pool.request().query(`SELECT * FROM imInterTipoControles ORDER BY Valor`);
      tipoControles.recordset.forEach(t => console.log(`  ${t.Valor}: ${JSON.stringify(t)}`));
    } catch (e) {
      console.log(`  ❌ No existe: ${e.message}`);
    }
    
    // 7. Buscar en el backend qué endpoints existen para HC
    console.log('\n📋 7. VERIFICAR RELACIÓN NumeroVisita:');
    try {
      const rel = await pool.request().query(`
        SELECT TOP 3 
          c.Valor, c.NumeroVisita, c.Fecha, c.Hora,
          v.NUMEROVISITA, v.IDPACIENTE
        FROM imInterControles c
        INNER JOIN imVisita v ON c.NumeroVisita = v.NUMEROVISITA
      `);
      console.log(`  ✅ imInterControles.NumeroVisita -> imVisita.NUMEROVISITA funciona`);
      rel.recordset.forEach(r => console.log(`    Control ${r.Valor} -> Visita ${r.NUMEROVISITA} Paciente ${r.IDPACIENTE}`));
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
    
    // 8. Contar registros
    console.log('\n📋 8. CANTIDAD DE REGISTROS:');
    try {
      const count = await pool.request().query(`SELECT COUNT(*) as total FROM imInterControles`);
      console.log(`  imInterControles: ${count.recordset[0].total} registros`);
    } catch (e) {}
    
    // 9. Ver campos numéricos de controles (los medibles)
    console.log('\n📋 9. CAMPOS NUMÉRICOS/MEDIBLES EN imInterControles:');
    try {
      const numericCols = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'imInterControles'
          AND DATA_TYPE IN ('int', 'decimal', 'real', 'float', 'numeric', 'smallint', 'tinyint')
        ORDER BY ORDINAL_POSITION
      `);
      numericCols.recordset.forEach(c => console.log(`  - ${c.COLUMN_NAME} (${c.DATA_TYPE})`));
    } catch (e) {}

  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

analyzeHCControles();
