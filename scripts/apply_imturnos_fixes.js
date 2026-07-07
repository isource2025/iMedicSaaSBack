/**
 * Aplica corrección de trigger imTurnosLog + columnas de trazabilidad.
 * Uso: node scripts/apply_imturnos_fixes.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { executeQuery } = require('../src/models/db');

async function runSqlFile(relPath) {
	const full = path.join(__dirname, relPath);
	const raw = fs.readFileSync(full, 'utf8');
	const batches = raw.split(/\r?\nGO\r?\n/i).map((b) => b.trim()).filter(Boolean);
	for (const batch of batches) {
		await executeQuery(batch);
	}
}

(async () => {
	try {
		console.log('Aplicando fix_imturnos_insert_trigger.sql…');
		await runSqlFile('sql/fix_imturnos_insert_trigger.sql');
		console.log('Aplicando alter_imturnos_trazabilidad_operadores.sql…');
		await runSqlFile('sql/alter_imturnos_trazabilidad_operadores.sql');
		console.log('Listo.');
	} catch (e) {
		console.error('Error:', e.message);
		process.exit(1);
	}
	process.exit(0);
})();
