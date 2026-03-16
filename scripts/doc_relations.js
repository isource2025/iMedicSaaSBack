const { connectDB } = require('../src/config/database');

async function checkRelations() {
  try {
    const pool = await connectDB();
    
    // Columnas de imPacientes
    console.log('=== COLUMNAS imPacientes ===');
    const colsPac = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imPacientes' ORDER BY ORDINAL_POSITION`);
    colsPac.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));

    // Columnas de imPersonal
    console.log('\n=== COLUMNAS imPersonal ===');
    const colsPer = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imPersonal' ORDER BY ORDINAL_POSITION`);
    colsPer.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));

    // Columnas de ImVisita
    console.log('\n=== COLUMNAS ImVisita ===');
    const colsVis = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imVisita' ORDER BY ORDINAL_POSITION`);
    colsVis.recordset.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE})`));

    // Verificar relaciones
    console.log('\n=== VERIFICACIÓN DE RELACIONES ===');

    // ImVisita -> imPacientes por HCPaciente
    try {
      const r1 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.HCPACIENTE, p.HCPaciente as PHC, p.Apellido1 
        FROM imVisita v INNER JOIN imPacientes p ON v.HCPACIENTE = p.HCPaciente
      `);
      console.log(`\nimVisita.HCPACIENTE -> imPacientes.HCPaciente: ✅ (${r1.recordset.length} resultados)`);
      r1.recordset.forEach(r => console.log(`  Visita ${r.NUMEROVISITA} -> Paciente HC:${r.PHC} ${r.Apellido1}`));
    } catch (e) { console.log(`\nimVisita -> imPacientes por HCPaciente: ❌ ${e.message}`); }

    // ImVisita -> imPersonal por Medico
    try {
      const r2 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.DOCTORASISTIENDO, p.Valor, p.Apellido1 as MedApellido
        FROM imVisita v INNER JOIN imPersonal p ON v.DOCTORASISTIENDO = p.Valor
      `);
      console.log(`\nimVisita.DOCTORASISTIENDO -> imPersonal.Valor: ✅ (${r2.recordset.length} resultados)`);
      r2.recordset.forEach(r => console.log(`  Visita ${r.NUMEROVISITA} -> Médico ${r.MedApellido}`));
    } catch (e) { console.log(`\nimVisita.DOCTORASISTIENDO -> imPersonal: ❌ ${e.message}`); }

    // imFacpracticas -> ImVisita por NumeroVisita
    try {
      const r3 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.NumeroVisita, v.NUMEROVISITA as VNV, v.HCPACIENTE
        FROM imFacpracticas f INNER JOIN imVisita v ON f.NumeroVisita = v.NUMEROVISITA
      `);
      console.log(`\nimFacpracticas.NumeroVisita -> imVisita.NUMEROVISITA: ✅ (${r3.recordset.length} resultados)`);
      r3.recordset.forEach(r => console.log(`  Practica ${r.Valor} -> Visita ${r.VNV} HC:${r.HCPACIENTE}`));
    } catch (e) { console.log(`\nimFacpracticas -> imVisita: ❌ ${e.message}`); }

    // imFacDetalle -> ImVisita por NUMEROVISITA
    try {
      const r4 = await pool.request().query(`
        SELECT TOP 3 d.IDDETALLE, d.NUMEROVISITA, v.NUMEROVISITA as VNV
        FROM imFacDetalle d INNER JOIN imVisita v ON d.NUMEROVISITA = v.NUMEROVISITA
      `);
      console.log(`\nimFacDetalle.NUMEROVISITA -> imVisita.NUMEROVISITA: ✅ (${r4.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacDetalle -> imVisita: ❌ ${e.message}`); }

    // imFacDetalle -> imFacpracticas por IDPRACTICA
    try {
      const r5 = await pool.request().query(`
        SELECT TOP 3 d.IDDETALLE, d.IDPRACTICA, f.Valor as FValor, f.Practica
        FROM imFacDetalle d INNER JOIN imFacpracticas f ON d.IDPRACTICA = f.Valor
      `);
      console.log(`\nimFacDetalle.IDPRACTICA -> imFacpracticas.Valor: ✅ (${r5.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacDetalle.IDPRACTICA -> imFacpracticas.Valor: ❌ ${e.message}`); }

    // imFacpracticas -> imPersonal por CodOperador
    try {
      const r6 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.CodOperador, p.Valor as PValor, p.Apellido1
        FROM imFacpracticas f INNER JOIN imPersonal p ON f.CodOperador = p.Valor
        WHERE f.CodOperador > 0
      `);
      console.log(`\nimFacpracticas.CodOperador -> imPersonal.Valor: ✅ (${r6.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacpracticas.CodOperador -> imPersonal: ❌ ${e.message}`); }

    // imFacDetalle.MATRICULA -> imPersonal.Matricula
    try {
      const r7 = await pool.request().query(`
        SELECT TOP 3 d.IDDETALLE, d.MATRICULA, p.Valor, p.Apellido1, p.Matricula
        FROM imFacDetalle d INNER JOIN imPersonal p ON d.MATRICULA = p.Matricula
        WHERE d.MATRICULA > 0
      `);
      console.log(`\nimFacDetalle.MATRICULA -> imPersonal.Matricula: ✅ (${r7.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacDetalle.MATRICULA -> imPersonal: ❌ ${e.message}`); }

    // ImVisita otros doctores
    try {
      const r8 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.DOCTORADMISOR, p.Valor, p.Apellido1
        FROM imVisita v INNER JOIN imPersonal p ON v.DOCTORADMISOR = p.Valor
        WHERE v.DOCTORADMISOR > 0
      `);
      console.log(`\nimVisita.DOCTORADMISOR -> imPersonal.Valor: ✅ (${r8.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimVisita.DOCTORADMISOR -> imPersonal: ❌ ${e.message}`); }

    // imFacpracticas -> imPacientes por IdPaciente
    try {
      const r9 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.IdPaciente, p.IdPaciente as PId, p.Apellido1
        FROM imFacpracticas f INNER JOIN imPacientes p ON f.IdPaciente = p.IdPaciente
        WHERE f.IdPaciente IS NOT NULL AND f.IdPaciente > 0
      `);
      console.log(`\nimFacpracticas.IdPaciente -> imPacientes.IdPaciente: ✅ (${r9.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacpracticas.IdPaciente -> imPacientes: ❌ ${e.message}`); }

    // ImVisita -> imSectores
    try {
      const r10 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.VALORSECTOR, s.Valor, s.Descripcion
        FROM imVisita v INNER JOIN imSectores s ON v.VALORSECTOR = s.Valor
        WHERE v.VALORSECTOR IS NOT NULL AND v.VALORSECTOR != ''
      `);
      console.log(`\nimVisita.VALORSECTOR -> imSectores.Valor: ✅ (${r10.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimVisita.VALORSECTOR -> imSectores: ❌ ${e.message}`); }

    // imFacpracticas.ValorSector -> imSectores.Valor
    try {
      const r11 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.ValorSector, s.Descripcion
        FROM imFacpracticas f INNER JOIN imSectores s ON RTRIM(LTRIM(f.ValorSector)) = RTRIM(LTRIM(s.Valor))
        WHERE f.ValorSector IS NOT NULL AND f.ValorSector != ''
      `);
      console.log(`\nimFacpracticas.ValorSector -> imSectores.Valor: ✅ (${r11.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacpracticas.ValorSector -> imSectores: ❌ ${e.message}`); }

    // ImVisita otros campos a imPersonal
    try {
      const r12 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.DOCTORREFERENCIADO, v.DOCTORCONSULTOR
        FROM imVisita v WHERE v.DOCTORREFERENCIADO > 0 OR v.DOCTORCONSULTOR > 0
      `);
      if (r12.recordset.length > 0) {
        console.log(`\nimVisita tiene DOCTORREFERENCIADO/DOCTORCONSULTOR con datos -> relación con imPersonal.Valor`);
      }
    } catch (e) {}

  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkRelations();
