/**
 * Ejecuta scripts/sql/setup_saas_tenant_delta.sql en la BD tenant (.env).
 * Uso: node scripts/ejecutar_setup_saas_tenant.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/models/db');

async function main() {
	const sqlPath = path.join(__dirname, 'sql', 'setup_saas_tenant_delta.sql');
	const raw = fs.readFileSync(sqlPath, 'utf8');
	const bloques = raw
		.split(/\r?\nGO\s*\r?\n/i)
		.map((b) => b.trim())
		.filter((b) => b && !/^\/\*[\s\S]*\*\/$/.test(b.replace(/\s+/g, ' ').slice(0, 20)));

	console.log(
		`Ejecutando setup SaaS tenant en ${process.env.DB_SERVER}/${process.env.DB_NAME}…`,
	);
	let ok = 0;
	for (let i = 0; i < bloques.length; i++) {
		const bloque = bloques[i];
		if (!bloque || bloque.toUpperCase() === 'SET NOCOUNT ON;') {
			try {
				if (bloque) await db.executeQuery(bloque);
			} catch {
				/* ignore */
			}
			continue;
		}
		try {
			const rows = await db.executeQuery(bloque);
			ok++;
			if (Array.isArray(rows) && rows.length && rows[0]?.name) {
				console.table(rows.map((r) => ({ name: r.name, type: r.type_desc })));
			}
		} catch (e) {
			console.error(`Error en bloque ${i + 1}:`, e.message);
			console.error(bloque.slice(0, 200) + '…');
			throw e;
		}
	}
	console.log(`Setup SaaS tenant OK (${ok} batches).`);
	console.log('MySQL (AuthSessions / turnero tokens): node scripts/apply_security_mysql.js');
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
