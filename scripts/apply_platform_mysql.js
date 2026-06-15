#!/usr/bin/env node
/**
 * Aplica migración de tablas plataforma SaaS en MySQL Railway.
 * Uso: npm run auth:mysql:platform-migrate
 */
require('dotenv').config();

async function main() {
	const { isAuthCentralEnabled } = require('../src/config/authCentralDb');
	if (!isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED=1 requerido');
		process.exit(1);
	}
	const platformMysql = require('../src/services/platformMysql.service');
	const result = await platformMysql.aplicarMigracionPlataforma();
	console.log('✓ Migración plataforma MySQL aplicada:', result);
	process.exit(0);
}

main().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
