const { connectDB } = require('../src/config/database');

async function findControlesTable() {
  try {
    const pool = await connectDB();
    
    console.log('=== BÚSQUEDA DE TABLA DE CONTROLES ===\n');
    
    // 1. Buscar todas las tablas con "Inter" en el nombre
    console.log('📋 1. TABLAS CON "Inter":');
    const interTables = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE '%Inter%'
      ORDER BY TABLE_NAME
    `);
    interTables.recordset.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
    
    // 2. Buscar tablas que tengan relación con NumeroVisita y controles
    console.log('\n📋 2. TABLAS CON COLUMNA "NumeroVisita" Y algo de control:');
    const withNumVisita = await pool.request().query(`
      SELECT DISTINCT t.TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES t
      INNER JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
      WHERE c.COLUMN_NAME LIKE '%NumeroVisita%'
        AND (t.TABLE_NAME LIKE '%Control%' 
          OR t.TABLE_NAME LIKE '%Signo%'
          OR t.TABLE_NAME LIKE '%Vital%'
          OR t.TABLE_NAME LIKE '%Inter%')
      ORDER BY t.TABLE_NAME
    `);
    withNumVisita.recordset.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
    
    // 3. Revisar HCVisitas (puede tener signos vitales)
    console.log('\n📋 3. ESTRUCTURA DE HCVisitas:');
    try {
      const colsHCVisitas = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'HCVisitas'
        ORDER BY ORDINAL_POSITION
      `);
      colsHCVisitas.recordset.forEach(c => {
        const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
        console.log(`  ${c.COLUMN_NAME} | ${tipo}`);
      });
      
      // Ejemplo
      const ejemplo = await pool.request().query(`SELECT TOP 2 * FROM HCVisitas`);
      console.log('\n  Ejemplos:');
      ejemplo.recordset.forEach((r, i) => {
        console.log(`  --- Registro ${i + 1} ---`);
        Object.keys(r).forEach(k => {
          if (r[k] !== null && r[k] !== '' && r[k] !== 0) {
            console.log(`    ${k}: ${r[k]}`);
          }
        });
      });
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
    
    // 4. Revisar HCInfo
    console.log('\n📋 4. ESTRUCTURA DE HCInfo:');
    try {
      const colsHCInfo = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'HCInfo'
        ORDER BY ORDINAL_POSITION
      `);
      colsHCInfo.recordset.forEach(c => {
        const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
        console.log(`  ${c.COLUMN_NAME} | ${tipo}`);
      });
      
      // Ejemplo
      const ejemplo = await pool.request().query(`SELECT TOP 2 * FROM HCInfo`);
      console.log('\n  Ejemplos:');
      ejemplo.recordset.forEach((r, i) => {
        console.log(`  --- Registro ${i + 1} ---`);
        Object.keys(r).forEach(k => {
          if (r[k] !== null && r[k] !== '' && r[k] !== 0) {
            console.log(`    ${k}: ${r[k]}`);
          }
        });
      });
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
    
    // 5. Buscar en el código del backend
    console.log('\n📋 5. BUSCAR EN CÓDIGO DEL BACKEND:');
    console.log('  Revisar archivos en src/services/ y src/controllers/ que mencionen "controles" o "signos vitales"');
    
    // 6. Buscar tablas que tengan campos típicos de signos vitales
    console.log('\n📋 6. TABLAS CON CAMPOS DE SIGNOS VITALES:');
    const vitalFields = ['Temperatura', 'Presion', 'Pulso', 'FC', 'FR', 'Saturacion', 'Peso', 'Talla'];
    for (const field of vitalFields) {
      const tables = await pool.request().query(`
        SELECT DISTINCT TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME LIKE '%${field}%'
        ORDER BY TABLE_NAME
      `);
      if (tables.recordset.length > 0) {
        console.log(`\n  Campo "${field}" encontrado en:`);
        tables.recordset.forEach(t => console.log(`    - ${t.TABLE_NAME}`));
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
  process.exit(0);
}

findControlesTable();
