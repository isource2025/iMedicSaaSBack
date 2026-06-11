/**
 * Ejecuta scripts/sql/setup_bot_minimal.sql en la BD tenant (.env).
 * Uso: node scripts/ejecutar_setup_bot.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');

async function main() {
	const sqlPath = path.join(__dirname, 'sql', 'setup_bot_minimal.sql');
	const raw = fs.readFileSync(sqlPath, 'utf8');
	const bloques = raw.split(/\r?\nGO\r?\n/i).map((b) => b.trim()).filter(Boolean);

	console.log(`Ejecutando setup bot en ${process.env.DB_SERVER}/${process.env.DB_NAME}…`);
	for (let i = 0; i < bloques.length; i++) {
		const bloque = bloques[i];
		if (!bloque || bloque.startsWith('/*') && !bloque.includes('CREATE')) continue;
		try {
			await db.executeQuery(bloque);
		} catch (e) {
			console.error(`Error en bloque ${i + 1}:`, e.message);
			throw e;
		}
	}
	console.log('Setup completado. Corré: node scripts/audit_bot_schema.js');
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
