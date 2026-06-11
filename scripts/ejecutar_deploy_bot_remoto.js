/**
 * Ejecuta scripts/sql/deploy_bot_whatsapp_remoto.sql en la BD tenant (.env).
 * Uso: node scripts/ejecutar_deploy_bot_remoto.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');

async function main() {
	const sqlPath = path.join(__dirname, 'sql', 'deploy_bot_whatsapp_remoto.sql');
	const raw = fs.readFileSync(sqlPath, 'utf8');
	const bloques = raw
		.split(/\r?\nGO\r?\n/i)
		.map((b) => b.trim())
		.filter((b) => {
			if (!b) return false;
			if (b.startsWith('/*') && !b.includes('CREATE') && !b.includes('INSERT') && !b.includes('DROP'))
				return false;
			return true;
		});

	console.log(`Deploy bot WhatsApp en ${process.env.DB_SERVER}/${process.env.DB_NAME}…`);
	for (let i = 0; i < bloques.length; i++) {
		const bloque = bloques[i];
		try {
			const rows = await db.executeQuery(bloque);
			if (Array.isArray(rows) && rows.length && bloque.includes('SELECT')) {
				console.table(rows);
			}
		} catch (e) {
			console.error(`Error en bloque ${i + 1}:`, e.message);
			throw e;
		}
	}
	console.log('Deploy completado. Verificá: node scripts/audit_bot_schema.js');
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
