const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const config = {
  user: 'sa',
  password: 'isource',
  server: '186.124.198.40\\SQLEXPRESS',
  database: 'iSource',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

async function ejecutarScript(nombreArchivo) {
  console.log(`\n========================================`);
  console.log(`Ejecutando: ${nombreArchivo}`);
  console.log(`========================================\n`);

  const scriptPath = path.join(__dirname, nombreArchivo);
  const script = fs.readFileSync(scriptPath, 'utf8');

  // Dividir por GO y ejecutar cada batch
  const batches = script
    .split(/\nGO\n/gi)
    .filter(batch => batch.trim().length > 0);

  const pool = await sql.connect(config);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i].trim();
    if (batch.length === 0) continue;

    try {
      console.log(`Ejecutando batch ${i + 1}/${batches.length}...`);
      const result = await pool.request().query(batch);
      
      // Mostrar mensajes de PRINT
      if (result.recordset && result.recordset.length > 0) {
        result.recordset.forEach(row => {
          console.log(Object.values(row)[0]);
        });
      }
      
      console.log(`✓ Batch ${i + 1} ejecutado exitosamente`);
    } catch (err) {
      console.error(`✗ Error en batch ${i + 1}:`, err.message);
      // Continuar con el siguiente batch
    }
  }

  await pool.close();
  console.log(`\n✓ Script ${nombreArchivo} completado\n`);
}

async function main() {
  try {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  SETUP DE TABLAS DE LABORATORIOS              ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    // 1. Crear tablas
    await ejecutarScript('crear_tablas_laboratorios.sql');

    // 2. Poblar parámetros
    await ejecutarScript('poblar_parametros_laboratorio.sql');

    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  ✓ SETUP COMPLETADO EXITOSAMENTE              ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (err) {
    console.error('\n✗ Error durante el setup:', err.message);
    console.error(err);
    process.exit(1);
  }
}

main();
