#!/usr/bin/env node
/**
 * Diagnóstico y reconciliación auth MySQL ↔ SQL Server tenant.
 *
 * Uso:
 *   npm run auth:mysql:reconcile
 *   npm run auth:mysql:reconcile -- --empresa=1
 *   npm run auth:mysql:reconcile -- --fix
 *   npm run auth:mysql:reconcile -- --migrate --fix
 */
require('dotenv').config();

const authReconcile = require('../src/services/authReconcile.service');

function parseArgs() {
	const args = { empresa: null, fix: false, migrate: false };
	for (const a of process.argv.slice(2)) {
		if (a === '--fix') args.fix = true;
		else if (a === '--migrate') args.migrate = true;
		else if (a.startsWith('--empresa=')) args.empresa = Number(a.split('=')[1]);
	}
	return args;
}

async function main() {
	const { isAuthCentralEnabled } = require('../src/config/authCentralDb');
	if (!isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED=1 y credenciales AUTH_DB_* / MYSQL* en .env requeridos');
		console.error('Copiá Railway → MySQL → Connect → variables a iMedicSaaSBack/.env');
		process.exit(1);
	}

	const { empresa, fix, migrate } = parseArgs();
	console.log('=== Reconciliación auth MySQL ↔ tenant SQL ===');
	console.log('Modo:', fix ? 'FIX' : 'diagnóstico', migrate ? '+ migrate' : '');
	console.log('');

	const result = await authReconcile.reconcileAll({ idEmpresa: empresa, fix, migrate });

	if (result.migration) {
		console.log('✓ Migración plataforma:', result.migration);
	}

	for (const report of result.reports) {
		const status = report.ok ? '✓' : '⚠';
		console.log(
			`${status} Empresa ${report.idEmpresa}: tenant=${report.tenant} mysql=${report.central} issues=${report.issues?.length || 0}`,
		);
		if (report.error) console.log(`   ERROR: ${report.error}`);
		for (const i of report.issues || []) {
			console.log(`   - [${i.type}]`, i.valorPersonal ?? i.message ?? '');
		}
	}

	console.log('');
	if (result.ok) {
		console.log('✓ Sin discrepancias detectadas.');
	} else if (!fix) {
		console.log(`Encontradas ${result.totalIssues} discrepancia(s). Ejecutá con --fix para corregir.`);
	} else {
		console.log(`Procesadas ${result.totalIssues} discrepancia(s) con --fix.`);
	}

	process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
	console.error('Error fatal:', err.message);
	process.exit(1);
});
