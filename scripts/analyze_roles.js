const { connectDB } = require('../src/config/database');

async function analyzeRoles() {
  try {
    const pool = await connectDB();
    
    console.log('=== ANÁLISIS DE CAMPOS DE ROL EN imPersonal ===\n');
    
    // 1. Valores distintos de Tipo
    console.log('📋 1. CAMPO: Tipo (varchar)');
    const tipos = await pool.request().query(`
      SELECT Tipo, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY Tipo 
      ORDER BY Cantidad DESC
    `);
    tipos.recordset.forEach(t => console.log(`  "${t.Tipo}" -> ${t.Cantidad} registros`));
    
    // 2. Valores distintos de ValorFunciones
    console.log('\n📋 2. CAMPO: ValorFunciones (tinyint)');
    const funciones = await pool.request().query(`
      SELECT ValorFunciones, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY ValorFunciones 
      ORDER BY ValorFunciones
    `);
    funciones.recordset.forEach(f => console.log(`  ${f.ValorFunciones} -> ${f.Cantidad} registros`));
    
    // 3. Valores distintos de ValorCategoria
    console.log('\n📋 3. CAMPO: ValorCategoria (tinyint)');
    const categorias = await pool.request().query(`
      SELECT ValorCategoria, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY ValorCategoria 
      ORDER BY ValorCategoria
    `);
    categorias.recordset.forEach(c => console.log(`  ${c.ValorCategoria} -> ${c.Cantidad} registros`));
    
    // 4. Valores distintos de ValorClase
    console.log('\n📋 4. CAMPO: ValorClase (varchar)');
    const clases = await pool.request().query(`
      SELECT ValorClase, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY ValorClase 
      ORDER BY Cantidad DESC
    `);
    clases.recordset.forEach(c => console.log(`  "${c.ValorClase}" -> ${c.Cantidad} registros`));
    
    // 5. ValorEspecialidad
    console.log('\n📋 5. CAMPO: ValorEspecialidad (smallint)');
    const especialidades = await pool.request().query(`
      SELECT ValorEspecialidad, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY ValorEspecialidad 
      ORDER BY Cantidad DESC
    `);
    console.log(`  Total valores distintos: ${especialidades.recordset.length}`);
    especialidades.recordset.slice(0, 15).forEach(e => console.log(`  ${e.ValorEspecialidad} -> ${e.Cantidad} registros`));
    
    // 6. ValorServicio
    console.log('\n📋 6. CAMPO: ValorServicio (varchar)');
    const servicios = await pool.request().query(`
      SELECT ValorServicio, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY ValorServicio 
      ORDER BY Cantidad DESC
    `);
    servicios.recordset.forEach(s => console.log(`  "${s.ValorServicio}" -> ${s.Cantidad} registros`));
    
    // 7. ValorDepartamento
    console.log('\n📋 7. CAMPO: ValorDepartamento (tinyint)');
    const departamentos = await pool.request().query(`
      SELECT ValorDepartamento, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY ValorDepartamento 
      ORDER BY ValorDepartamento
    `);
    departamentos.recordset.forEach(d => console.log(`  ${d.ValorDepartamento} -> ${d.Cantidad} registros`));
    
    // 8. Estado
    console.log('\n📋 8. CAMPO: Estado (tinyint)');
    const estados = await pool.request().query(`
      SELECT Estado, COUNT(*) as Cantidad 
      FROM imPersonal 
      GROUP BY Estado 
      ORDER BY Estado
    `);
    estados.recordset.forEach(e => console.log(`  ${e.Estado} -> ${e.Cantidad} registros`));
    
    // 9. Total de personal
    console.log('\n📋 9. TOTAL REGISTROS:');
    const total = await pool.request().query(`SELECT COUNT(*) as total FROM imPersonal`);
    console.log(`  ${total.recordset[0].total} profesionales registrados`);
    
    // 10. Ejemplos de médicos vs enfermeros (si se puede distinguir)
    console.log('\n📋 10. EJEMPLOS DE PERSONAL POR TIPO:');
    const ejemplos = await pool.request().query(`
      SELECT TOP 3 Valor, ApellidoNombre, Tipo, ValorFunciones, ValorCategoria, ValorClase, ValorEspecialidad, ValorServicio, Estado
      FROM imPersonal 
      WHERE Tipo IS NOT NULL AND Tipo != ''
      ORDER BY Valor
    `);
    ejemplos.recordset.forEach(e => {
      console.log(`  ${e.ApellidoNombre}: Tipo="${e.Tipo}", Func=${e.ValorFunciones}, Cat=${e.ValorCategoria}, Clase="${e.ValorClase}", Esp=${e.ValorEspecialidad}, Serv="${e.ValorServicio}", Estado=${e.Estado}`);
    });
    
    // 11. Verificar tablas de catálogo existentes para funciones, categorías, etc
    console.log('\n\n=== TABLAS DE CATÁLOGO EXISTENTES ===');
    
    const catalogTables = ['imFunciones', 'imCategorias', 'imEspecialidades', 'imServicios', 'imDepartamentos', 'imClases', 'imTiposPersonal', 'imRoles'];
    for (const table of catalogTables) {
      try {
        const exists = await pool.request().query(`
          SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${table}'
        `);
        if (exists.recordset[0].cnt > 0) {
          const data = await pool.request().query(`SELECT TOP 10 * FROM ${table}`);
          console.log(`\n✅ ${table} EXISTE (${data.recordset.length}+ registros):`);
          data.recordset.forEach(r => console.log(`  `, r));
        } else {
          console.log(`❌ ${table} NO existe`);
        }
      } catch (e) {
        console.log(`❌ ${table} NO existe`);
      }
    }
    
    // 12. Buscar cualquier tabla con "funcion" o "categ" o "rol" en el nombre
    console.log('\n\n=== BUSCAR TABLAS RELACIONADAS CON ROLES ===');
    const related = await pool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE '%funcion%' 
         OR TABLE_NAME LIKE '%categ%' 
         OR TABLE_NAME LIKE '%rol%' 
         OR TABLE_NAME LIKE '%clase%'
         OR TABLE_NAME LIKE '%tipo%'
         OR TABLE_NAME LIKE '%especial%'
         OR TABLE_NAME LIKE '%permiso%'
         OR TABLE_NAME LIKE '%servicio%'
         OR TABLE_NAME LIKE '%depart%'
      ORDER BY TABLE_NAME
    `);
    related.recordset.forEach(r => console.log(`  📁 ${r.TABLE_NAME}`));
    
    // 13. Verificar relación impassword -> imPersonal
    console.log('\n\n=== RELACIÓN impassword -> imPersonal ===');
    try {
      const rel = await pool.request().query(`
        SELECT TOP 5 
          pw.CodOperador, pw.NombreRed, pw.ValorPersonal, pw.Grupo,
          p.Valor, p.ApellidoNombre, p.Tipo, p.ValorFunciones
        FROM impassword pw
        LEFT JOIN imPersonal p ON pw.ValorPersonal = p.Valor
        WHERE pw.ValorPersonal IS NOT NULL AND pw.ValorPersonal > 0
      `);
      rel.recordset.forEach(r => {
        console.log(`  User "${r.NombreRed}" (ValorPersonal:${r.ValorPersonal}, Grupo:${r.Grupo}) -> Personal "${r.ApellidoNombre}" Tipo="${r.Tipo}" Func=${r.ValorFunciones}`);
      });
    } catch (e) { console.log('  Error:', e.message); }
    
    // 14. Campo Grupo de impassword
    console.log('\n📋 14. CAMPO impassword.Grupo (tinyint):');
    const grupos = await pool.request().query(`
      SELECT Grupo, COUNT(*) as Cantidad FROM impassword GROUP BY Grupo ORDER BY Grupo
    `);
    grupos.recordset.forEach(g => console.log(`  Grupo ${g.Grupo} -> ${g.Cantidad} usuarios`));

  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

analyzeRoles();
