const fs = require('fs');
const path = require('path');
const { connectDB } = require('../src/config/database');

(async () => {
	const scriptPath = path.join(__dirname, 'sql', 'setup_roles.sql');
	const script = fs.readFileSync(scriptPath, 'utf8');

	const pool = await connectDB();

	// SSMS usa "GO" como separador de batches; mssql lo necesita en consultas separadas.
	const batches = script
		.split(/^\s*GO\s*$/gim)
		.map((b) => b.trim())
		.filter((b) => b.length > 0);

	console.log(`Ejecutando ${batches.length} batch(es) desde ${path.relative(process.cwd(), scriptPath)}\n`);

	for (let i = 0; i < batches.length; i++) {
		const batch = batches[i];
		try {
			const result = await pool.request().query(batch);
			if (result?.recordset?.length) {
				console.log(`Batch ${i + 1}/${batches.length} OK — filas devueltas:`);
				console.table(result.recordset);
			} else if (Array.isArray(result?.recordsets) && result.recordsets.length > 0) {
				for (const rs of result.recordsets) {
					if (rs?.length) console.table(rs);
				}
				console.log(`Batch ${i + 1}/${batches.length} OK`);
			} else {
				console.log(`Batch ${i + 1}/${batches.length} OK`);
			}
		} catch (e) {
			console.error(`Batch ${i + 1}/${batches.length} FALLÓ:\n${e.message}`);
			console.error('---SQL---\n' + batch.slice(0, 600) + (batch.length > 600 ? '\n...' : ''));
			process.exit(1);
		}
	}

	console.log('\n✅ Setup de roles completado.');
	process.exit(0);
})().catch((e) => {
	console.error('Error fatal:', e);
	process.exit(1);
});
