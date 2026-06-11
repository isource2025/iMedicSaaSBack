/**
 * Pipeline completo: reset/migrate → drop legacy → auditoría → smoke test.
 * Uso: node scripts/ejecutar_cleanup_bot.js
 */
require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

const root = __dirname;

function run(script) {
	console.log(`\n>>> node ${script}`);
	execSync(`node "${path.join(root, script)}"`, { stdio: 'inherit', cwd: path.join(root, '..') });
}

(async () => {
	console.log(`BD: ${process.env.DB_SERVER}/${process.env.DB_NAME}`);
	run('ejecutar_reset_migrate.js');
	run('ejecutar_drop_legacy_bot.js');
	run('audit_bot_schema.js');
	run('smoke_bot_conversaciones.js');
})();
