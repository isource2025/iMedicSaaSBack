require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');

(async () => {
	const raw = fs.readFileSync(path.join(__dirname, 'sql', 'cleanup_bot_legacy.sql'), 'utf8');
	for (const b of raw.split(/\r?\nGO\r?\n/i).map((x) => x.trim()).filter(Boolean)) {
		await db.executeQuery(b);
	}
	const tables = await db.executeQuery(
		`SELECT name FROM sys.tables WHERE name LIKE 'imBot%' ORDER BY name`,
	);
	console.log('Tablas imBot*:', tables.map((t) => t.name).join(', '));
	const counts = await db.executeQuery(
		`SELECT Tipo, COUNT(*) AS c FROM dbo.imBotChat GROUP BY Tipo ORDER BY Tipo`,
	);
	console.log('imBotChat:', counts);
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
