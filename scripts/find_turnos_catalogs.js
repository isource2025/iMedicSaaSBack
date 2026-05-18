const db = require('../src/models/db');
(async () => {
	const r = await db.executeQuery(
		`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
		 WHERE TABLE_NAME LIKE '%urno%' OR TABLE_NAME LIKE '%tatus%'
		    OR TABLE_NAME LIKE '%ipoTurn%' OR TABLE_NAME LIKE '%stadoTurn%'
		 ORDER BY TABLE_NAME`
	);
	console.log('Posibles catálogos:');
	console.log(r.map((x) => x.TABLE_NAME).join('\n') || '(ninguno)');

	// Para cada coincidencia, intentar mostrar contenido (TOP 20)
	for (const row of r) {
		try {
			const rows = await db.executeQuery(`SELECT TOP 20 * FROM dbo.[${row.TABLE_NAME}]`);
			console.log(`\n--- ${row.TABLE_NAME} (${rows.length} filas mostradas) ---`);
			console.log(JSON.stringify(rows, null, 2));
		} catch (e) {
			console.log(`Error en ${row.TABLE_NAME}: ${e.message}`);
		}
	}
	process.exit(0);
})();
