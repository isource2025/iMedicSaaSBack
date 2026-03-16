const { connectDB } = require('../src/config/database');

async function documentTables() {
  try {
    const pool = await connectDB();
    
    const tables = ['imPacientes', 'imPersonal', 'ImVisita', 'imFacpracticas', 'imFacDetalle'];
    
    for (const table of tables) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TABLA: ${table}`);
      console.log('='.repeat(60));
      
      // Columnas
      const cols = await pool.request().query(`
        SELECT 
          c.COLUMN_NAME, 
          c.DATA_TYPE, 
          c.CHARACTER_MAXIMUM_LENGTH,
          c.IS_NULLABLE,
          c.COLUMN_DEFAULT,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PK' ELSE '' END as IS_PK
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.COLUMN_NAME, ku.TABLE_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME AND c.TABLE_NAME = pk.TABLE_NAME
        WHERE c.TABLE_NAME = '${table}'
        ORDER BY c.ORDINAL_POSITION
      `);
      
      console.log('\nCOLUMNAS:');
      cols.recordset.forEach(c => {
        const tipo = c.CHARACTER_MAXIMUM_LENGTH ? `${c.DATA_TYPE}(${c.CHARACTER_MAXIMUM_LENGTH})` : c.DATA_TYPE;
        const pk = c.IS_PK ? ' [PK]' : '';
        const nullable = c.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
        console.log(`  ${c.COLUMN_NAME} | ${tipo}${nullable}${pk}`);
      });
      
      // Contar registros
      try {
        const count = await pool.request().query(`SELECT COUNT(*) as total FROM ${table}`);
        console.log(`\nTOTAL REGISTROS: ${count.recordset[0].total}`);
      } catch (e) {
        console.log(`\nERROR al contar: ${e.message}`);
      }
      
      // Ejemplo de datos
      try {
        const sample = await pool.request().query(`SELECT TOP 2 * FROM ${table}`);
        console.log('\nEJEMPLO (2 registros):');
        sample.recordset.forEach((r, i) => {
          console.log(`  --- Registro ${i + 1} ---`);
          Object.keys(r).forEach(k => {
            console.log(`    ${k}: ${r[k]}`);
          });
        });
      } catch (e) {
        console.log(`\nERROR al obtener ejemplo: ${e.message}`);
      }
    }
    
    // Buscar relaciones FK
    console.log(`\n${'='.repeat(60)}`);
    console.log('RELACIONES (FOREIGN KEYS)');
    console.log('='.repeat(60));
    
    const fks = await pool.request().query(`
      SELECT 
        fk.name AS FK_Name,
        tp.name AS Parent_Table,
        cp.name AS Parent_Column,
        tr.name AS Referenced_Table,
        cr.name AS Referenced_Column
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
      INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
      INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
      INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
      WHERE tp.name IN ('imPacientes', 'imPersonal', 'ImVisita', 'imFacpracticas', 'imFacDetalle')
         OR tr.name IN ('imPacientes', 'imPersonal', 'ImVisita', 'imFacpracticas', 'imFacDetalle')
    `);
    
    if (fks.recordset.length > 0) {
      fks.recordset.forEach(fk => {
        console.log(`  ${fk.Parent_Table}.${fk.Parent_Column} -> ${fk.Referenced_Table}.${fk.Referenced_Column} (${fk.FK_Name})`);
      });
    } else {
      console.log('  No hay FK formales definidas. Buscando relaciones implícitas...');
    }
    
    // Buscar relaciones implícitas por nombres de columnas comunes
    console.log('\nRELACIONES IMPLÍCITAS (columnas con nombres similares):');
    
    const allCols = await pool.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('imPacientes', 'imPersonal', 'ImVisita', 'imFacpracticas', 'imFacDetalle')
      ORDER BY COLUMN_NAME, TABLE_NAME
    `);
    
    // Agrupar por nombre de columna
    const colMap = {};
    allCols.recordset.forEach(c => {
      if (!colMap[c.COLUMN_NAME]) colMap[c.COLUMN_NAME] = [];
      colMap[c.COLUMN_NAME].push({ table: c.TABLE_NAME, type: c.DATA_TYPE });
    });
    
    // Mostrar columnas que aparecen en más de una tabla
    Object.keys(colMap).forEach(colName => {
      if (colMap[colName].length > 1) {
        const tables = colMap[colName].map(c => `${c.table}(${c.type})`).join(', ');
        console.log(`  ${colName} -> presente en: ${tables}`);
      }
    });
    
    // Verificar relaciones específicas probables
    console.log('\nVERIFICACIÓN DE RELACIONES CLAVE:');
    
    // ImVisita -> imPacientes
    try {
      const rel1 = await pool.request().query(`
        SELECT TOP 3 v.NumeroVisita, v.HCPaciente, p.HCPaciente as PacHC, p.Apellido, p.Nombres
        FROM ImVisita v
        INNER JOIN imPacientes p ON v.HCPaciente = p.HCPaciente
      `);
      console.log(`\n  ImVisita.HCPaciente -> imPacientes.HCPaciente: ✅ FUNCIONA (${rel1.recordset.length} resultados)`);
      if (rel1.recordset.length > 0) console.log(`    Ejemplo: Visita ${rel1.recordset[0].NumeroVisita} -> Paciente ${rel1.recordset[0].Apellido} ${rel1.recordset[0].Nombres}`);
    } catch (e) { console.log(`  ImVisita -> imPacientes: ❌ ${e.message}`); }
    
    // imFacpracticas -> ImVisita
    try {
      const rel2 = await pool.request().query(`
        SELECT TOP 3 f.NumeroVisita, f.Codigo, v.NumeroVisita as VNumVisita
        FROM imFacpracticas f
        INNER JOIN ImVisita v ON f.NumeroVisita = v.NumeroVisita
      `);
      console.log(`  imFacpracticas.NumeroVisita -> ImVisita.NumeroVisita: ✅ FUNCIONA (${rel2.recordset.length} resultados)`);
    } catch (e) { console.log(`  imFacpracticas -> ImVisita: ❌ ${e.message}`); }
    
    // imFacDetalle -> imFacpracticas
    try {
      const rel3 = await pool.request().query(`
        SELECT TOP 3 d.NumeroVisita, d.Codigo, f.NumeroVisita as FNumVisita
        FROM imFacDetalle d
        INNER JOIN imFacpracticas f ON d.NumeroVisita = f.NumeroVisita AND d.Codigo = f.Codigo
      `);
      console.log(`  imFacDetalle -> imFacpracticas (NumeroVisita+Codigo): ✅ FUNCIONA (${rel3.recordset.length} resultados)`);
    } catch (e) { console.log(`  imFacDetalle -> imFacpracticas: ❌ ${e.message}`); }
    
    // ImVisita -> imPersonal (médico)
    try {
      const rel4 = await pool.request().query(`
        SELECT TOP 3 v.NumeroVisita, v.Medico, p.Valor, p.Apellido as MedApellido
        FROM ImVisita v
        INNER JOIN imPersonal p ON v.Medico = p.Valor
      `);
      console.log(`  ImVisita.Medico -> imPersonal.Valor: ✅ FUNCIONA (${rel4.recordset.length} resultados)`);
      if (rel4.recordset.length > 0) console.log(`    Ejemplo: Visita ${rel4.recordset[0].NumeroVisita} -> Médico ${rel4.recordset[0].MedApellido}`);
    } catch (e) { console.log(`  ImVisita.Medico -> imPersonal: ❌ ${e.message}`); }

  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

documentTables();
