const { connectDB } = require('../src/config/database');

async function analyzeRoles2() {
  try {
    const pool = await connectDB();
    
    // 1. imEspecialidad (existe, diferente nombre)
    console.log('=== imEspecialidad ===');
    const esp = await pool.request().query(`SELECT * FROM imEspecialidad ORDER BY Valor`);
    esp.recordset.forEach(e => console.log(`  ${e.Valor}: ${JSON.stringify(e)}`));
    
    // 2. imFunciones completo
    console.log('\n=== imFunciones ===');
    const func = await pool.request().query(`SELECT * FROM imFunciones ORDER BY Valor`);
    func.recordset.forEach(f => console.log(`  ${f.Valor}: ${f.Descripcion}`));
    
    // 3. imRolContacto
    console.log('\n=== imRolContacto ===');
    try {
      const rol = await pool.request().query(`SELECT * FROM imRolContacto`);
      rol.recordset.forEach(r => console.log(`  `, r));
    } catch (e) { console.log('  Error:', e.message); }
    
    // 4. impassword.Grupo = 11 es admin, Grupo = 0 es normal. ¿Hay más?
    console.log('\n=== impassword - Detalle por Grupo ===');
    const grupoDetail = await pool.request().query(`
      SELECT pw.Grupo, pw.NombreRed, pw.CodOperador, pw.ValorPersonal,
             p.ApellidoNombre, p.Tipo, p.ValorFunciones, p.ValorEspecialidad
      FROM impassword pw
      LEFT JOIN imPersonal p ON pw.ValorPersonal = p.Valor
      WHERE pw.Grupo = 11
    `);
    console.log('Grupo 11 (Admin):');
    grupoDetail.recordset.forEach(r => console.log(`  ${r.NombreRed} -> ${r.ApellidoNombre}`));
    
    // 5. Personal con ValorFunciones != 0 (para ver qué significa cada valor)
    console.log('\n=== Personal con ValorFunciones > 0 ===');
    const conFunc = await pool.request().query(`
      SELECT TOP 10 p.Valor, p.ApellidoNombre, p.ValorFunciones, f.Descripcion as FuncionDesc, 
             p.ValorEspecialidad, p.ValorCategoria, p.ValorServicio
      FROM imPersonal p
      LEFT JOIN imFunciones f ON p.ValorFunciones = f.Valor
      WHERE p.ValorFunciones > 0
    `);
    conFunc.recordset.forEach(r => console.log(`  ${r.ApellidoNombre}: Func=${r.ValorFunciones}(${r.FuncionDesc || 'N/A'}), Esp=${r.ValorEspecialidad}, Cat=${r.ValorCategoria}, Serv="${r.ValorServicio}"`));
    
    // 6. Personal con ValorCategoria > 0
    console.log('\n=== Personal con ValorCategoria > 0 ===');
    const conCat = await pool.request().query(`
      SELECT TOP 10 p.Valor, p.ApellidoNombre, p.ValorCategoria, c.Descripcion as CatDesc,
             p.ValorFunciones, p.ValorEspecialidad
      FROM imPersonal p
      LEFT JOIN imCategorias c ON p.ValorCategoria = c.Valor
      WHERE p.ValorCategoria > 0
    `);
    conCat.recordset.forEach(r => console.log(`  ${r.ApellidoNombre}: Cat=${r.ValorCategoria}(${r.CatDesc || 'N/A'}), Func=${r.ValorFunciones}, Esp=${r.ValorEspecialidad}`));
    
    // 7. Intentar distinguir médicos de enfermeros por especialidad
    console.log('\n=== Personal por Especialidad (con nombre) ===');
    const porEsp = await pool.request().query(`
      SELECT e.Valor, e.Descripcion, COUNT(p.Valor) as CantPersonal
      FROM imEspecialidad e
      LEFT JOIN imPersonal p ON e.Valor = p.ValorEspecialidad
      GROUP BY e.Valor, e.Descripcion
      HAVING COUNT(p.Valor) > 0
      ORDER BY CantPersonal DESC
    `);
    porEsp.recordset.forEach(r => console.log(`  Esp ${r.Valor} "${r.Descripcion}": ${r.CantPersonal} personal`));
    
    // 8. Ejemplo de enfermeros (si hay especialidad de enfermería)
    console.log('\n=== Buscar "ENFERMER" en especialidades ===');
    const enfEsp = await pool.request().query(`
      SELECT * FROM imEspecialidad WHERE Descripcion LIKE '%ENFERMER%' OR Descripcion LIKE '%AUXILIAR%'
    `);
    enfEsp.recordset.forEach(r => console.log(`  ${r.Valor}: ${r.Descripcion}`));
    
    if (enfEsp.recordset.length > 0) {
      for (const esp of enfEsp.recordset) {
        const enfPersonal = await pool.request().query(`
          SELECT TOP 5 Valor, ApellidoNombre FROM imPersonal WHERE ValorEspecialidad = ${esp.Valor}
        `);
        console.log(`  Personal con especialidad "${esp.Descripcion}":`);
        enfPersonal.recordset.forEach(p => console.log(`    - ${p.ApellidoNombre}`));
      }
    }

    // 9. Buscar "MEDIC" en especialidades
    console.log('\n=== Buscar "MEDIC" o "CLINIC" en especialidades ===');
    const medEsp = await pool.request().query(`
      SELECT * FROM imEspecialidad WHERE Descripcion LIKE '%MEDIC%' OR Descripcion LIKE '%CLINIC%' OR Descripcion LIKE '%CIRUG%'
    `);
    medEsp.recordset.forEach(r => console.log(`  ${r.Valor}: ${r.Descripcion}`));

  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

analyzeRoles2();
