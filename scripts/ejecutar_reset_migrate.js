require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');

async function runBlocks(relPath) {
	const raw = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
	const bloques = raw.split(/\r?\nGO\r?\n/i).map((b) => b.trim()).filter(Boolean);
	for (let i = 0; i < bloques.length; i++) {
		if (bloques[i].startsWith('PRINT')) continue;
		console.log(`  bloque ${i + 1}/${bloques.length}…`);
		await db.executeQuery(bloques[i]);
	}
}

async function counts() {
	return (
		await db.executeQuery(`
		SELECT Tipo, COUNT(*) AS c FROM dbo.imBotChat GROUP BY Tipo ORDER BY Tipo
	`)
	).map((r) => `${r.Tipo}=${r.c}`).join(', ') || '(vacío)';
}

(async () => {
	console.log('Reset + migrate imBotChat…');
	await runBlocks('sql/reset_and_migrate_imBotChat.sql');
	console.log('Counts:', await counts());
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
