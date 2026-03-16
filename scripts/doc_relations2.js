const { connectDB } = require('../src/config/database');

async function checkRelations() {
  try {
    const pool = await connectDB();
    
    console.log('=== VERIFICACIÓN DE RELACIONES ===\n');

    // ImVisita.IDPACIENTE -> imPacientes.IdPaciente
    try {
      const r1 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.IDPACIENTE, p.IdPaciente, p.ApellidoyNombre
        FROM imVisita v INNER JOIN imPacientes p ON v.IDPACIENTE = p.IdPaciente
      `);
      console.log(`imVisita.IDPACIENTE -> imPacientes.IdPaciente: ✅ (${r1.recordset.length} resultados)`);
      r1.recordset.forEach(r => console.log(`  Visita ${r.NUMEROVISITA} -> Paciente ${r.ApellidoyNombre}`));
    } catch (e) { console.log(`imVisita.IDPACIENTE -> imPacientes.IdPaciente: ❌ ${e.message}`); }

    // ImVisita.DOCTORASISTIENDO -> imPersonal.Valor
    try {
      const r2 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.DOCTORASISTIENDO, p.Valor, p.ApellidoNombre
        FROM imVisita v INNER JOIN imPersonal p ON v.DOCTORASISTIENDO = p.Valor
        WHERE v.DOCTORASISTIENDO > 0
      `);
      console.log(`\nimVisita.DOCTORASISTIENDO -> imPersonal.Valor: ✅ (${r2.recordset.length} resultados)`);
      r2.recordset.forEach(r => console.log(`  Visita ${r.NUMEROVISITA} -> Médico ${r.ApellidoNombre}`));
    } catch (e) { console.log(`\nimVisita.DOCTORASISTIENDO -> imPersonal: ❌ ${e.message}`); }

    // ImVisita.DOCTORADMISOR -> imPersonal.Valor
    try {
      const r3 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.DOCTORADMISOR, p.Valor, p.ApellidoNombre
        FROM imVisita v INNER JOIN imPersonal p ON v.DOCTORADMISOR = p.Valor
        WHERE v.DOCTORADMISOR > 0
      `);
      console.log(`\nimVisita.DOCTORADMISOR -> imPersonal.Valor: ✅ (${r3.recordset.length} resultados)`);
      r3.recordset.forEach(r => console.log(`  Visita ${r.NUMEROVISITA} -> Admitidor ${r.ApellidoNombre}`));
    } catch (e) { console.log(`\nimVisita.DOCTORADMISOR -> imPersonal: ❌ ${e.message}`); }

    // imFacpracticas.NumeroVisita -> ImVisita.NUMEROVISITA
    try {
      const r4 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.NumeroVisita, v.NUMEROVISITA, v.IDPACIENTE
        FROM imFacpracticas f INNER JOIN imVisita v ON f.NumeroVisita = v.NUMEROVISITA
      `);
      console.log(`\nimFacpracticas.NumeroVisita -> imVisita.NUMEROVISITA: ✅ (${r4.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacpracticas -> imVisita: ❌ ${e.message}`); }

    // imFacDetalle.NUMEROVISITA -> ImVisita.NUMEROVISITA
    try {
      const r5 = await pool.request().query(`
        SELECT TOP 3 d.IDDETALLE, d.NUMEROVISITA, v.NUMEROVISITA as VNV
        FROM imFacDetalle d INNER JOIN imVisita v ON d.NUMEROVISITA = v.NUMEROVISITA
      `);
      console.log(`\nimFacDetalle.NUMEROVISITA -> imVisita.NUMEROVISITA: ✅ (${r5.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacDetalle -> imVisita: ❌ ${e.message}`); }

    // imFacDetalle.IDPRACTICA -> imFacpracticas.Valor
    try {
      const r6 = await pool.request().query(`
        SELECT TOP 3 d.IDDETALLE, d.IDPRACTICA, f.Valor, f.Practica, f.NumeroVisita
        FROM imFacDetalle d INNER JOIN imFacpracticas f ON d.IDPRACTICA = f.Valor
      `);
      console.log(`\nimFacDetalle.IDPRACTICA -> imFacpracticas.Valor: ✅ (${r6.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacDetalle.IDPRACTICA -> imFacpracticas: ❌ ${e.message}`); }

    // imFacpracticas.CodOperador -> imPersonal.Valor
    try {
      const r7 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.CodOperador, p.Valor as PVal, p.ApellidoNombre
        FROM imFacpracticas f INNER JOIN imPersonal p ON f.CodOperador = p.Valor
        WHERE f.CodOperador > 0
      `);
      console.log(`\nimFacpracticas.CodOperador -> imPersonal.Valor: ✅ (${r7.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacpracticas.CodOperador -> imPersonal: ❌ ${e.message}`); }

    // imFacDetalle.MATRICULA -> imPersonal.Matricula
    try {
      const r8 = await pool.request().query(`
        SELECT TOP 3 d.IDDETALLE, d.MATRICULA, p.Matricula, p.ApellidoNombre
        FROM imFacDetalle d INNER JOIN imPersonal p ON d.MATRICULA = p.Matricula
        WHERE d.MATRICULA > 0
      `);
      console.log(`\nimFacDetalle.MATRICULA -> imPersonal.Matricula: ✅ (${r8.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacDetalle.MATRICULA -> imPersonal: ❌ ${e.message}`); }

    // imFacpracticas.IdPaciente -> imPacientes.IdPaciente
    try {
      const r9 = await pool.request().query(`
        SELECT TOP 3 f.Valor, f.IdPaciente, p.IdPaciente, p.ApellidoyNombre
        FROM imFacpracticas f INNER JOIN imPacientes p ON f.IdPaciente = p.IdPaciente
        WHERE f.IdPaciente IS NOT NULL AND f.IdPaciente > 0
      `);
      console.log(`\nimFacpracticas.IdPaciente -> imPacientes.IdPaciente: ✅ (${r9.recordset.length} resultados)`);
    } catch (e) { console.log(`\nimFacpracticas.IdPaciente -> imPacientes: ❌ ${e.message}`); }

    // imVisita.VALORSECTOR -> imSectores.Valor
    try {
      const r10 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.VALORSECTOR, s.Descripcion
        FROM imVisita v INNER JOIN imSectores s ON RTRIM(LTRIM(v.VALORSECTOR)) = RTRIM(LTRIM(s.Valor))
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

    // imVisita.CLIENTE -> ¿alguna tabla de clientes/convenios?
    try {
      const r12 = await pool.request().query(`
        SELECT TOP 3 v.NUMEROVISITA, v.CLIENTE FROM imVisita v WHERE v.CLIENTE > 0
      `);
      console.log(`\nimVisita.CLIENTE: tiene datos (${r12.recordset.length} registros con CLIENTE > 0)`);
      r12.recordset.forEach(r => console.log(`  Visita ${r.NUMEROVISITA} -> Cliente ${r.CLIENTE}`));
    } catch (e) {}

    // imFacDetalle.IDCONVENIO -> alguna tabla?
    try {
      const r13 = await pool.request().query(`
        SELECT DISTINCT TOP 10 IDCONVENIO FROM imFacDetalle WHERE IDCONVENIO IS NOT NULL AND IDCONVENIO > 0
      `);
      console.log(`\nimFacDetalle.IDCONVENIO: valores distintos: ${r13.recordset.map(r => r.IDCONVENIO).join(', ')}`);
    } catch (e) {}

    // imFacpracticas.IdConvenio
    try {
      const r14 = await pool.request().query(`
        SELECT DISTINCT TOP 10 IdConvenio FROM imFacpracticas WHERE IdConvenio IS NOT NULL AND IdConvenio > 0
      `);
      console.log(`imFacpracticas.IdConvenio: valores distintos: ${r14.recordset.map(r => r.IdConvenio).join(', ')}`);
    } catch (e) {}

    // Nota sobre fechas Clarion
    console.log('\n\n=== NOTA SOBRE FECHAS ===');
    console.log('Las fechas en formato Clarion (int) se convierten con:');
    console.log('DATEADD(DAY, campo - 2, \'19000101\')');
    console.log('Las horas en formato Clarion (int) se convierten con:');
    console.log('centésimas de segundo desde medianoche');

  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

checkRelations();
