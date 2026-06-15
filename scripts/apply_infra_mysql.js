#!/usr/bin/env node
/**
 * Migraciones incrementales infra MySQL (DbPassword, tablas plataforma).
 * Uso: npm run auth:mysql:infra-migrate
 */
require('dotenv').config();

async function main() {
	const { isAuthCentralEnabled } = require('../src/config/authCentralDb');
	if (!isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED=1 requerido');
		process.exit(1);
	}
	const platformMysql = require('../src/services/platformMysql.service');
	const result = await platformMysql.aplicarMigracionInfra();
	console.log('✓ Migración infra MySQL aplicada:', result);
	process.exit(0);
}

main().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
