#!/usr/bin/env node
/**
 * Diagnóstico de infraestructura SaaS (MySQL + tenants SQL).
 *
 * Uso:
 *   npm run auth:mysql:infra-check
 *   npm run auth:mysql:infra-check -- --deep
 *   npm run auth:mysql:infra-check -- --empresa=1
 */
require('dotenv').config();

const platformHealth = require('../src/services/platformHealth.service');
const authReconcile = require('../src/services/authReconcile.service');
const { isAuthCentralEnabled } = require('../src/config/authCentralDb');

function parseArgs() {
	const args = { deep: false, empresa: null, reconcile: false };
	for (const a of process.argv.slice(2)) {
		if (a === '--deep') args.deep = true;
		else if (a === '--reconcile') args.reconcile = true;
		else if (a.startsWith('--empresa=')) args.empresa = Number(a.split('=')[1]);
	}
	return args;
}

async function main() {
	if (!isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED=1 y AUTH_DB_* / MYSQL* requeridos');
		process.exit(1);
	}

	const { deep, empresa, reconcile } = parseArgs();
	console.log('=== Infra check SaaS ===\n');

	const health = await platformHealth.getHealth({
		deep: deep || empresa != null,
		idEmpresa: empresa,
	});
	console.log('Modo:', health.mode);
	console.log('MySQL:', health.mysql.ok ? `OK (${health.mysql.empresas} empresas, ${health.mysql.vinculosAuth} vínculos auth)` : `FAIL — ${health.mysql.error}`);

	if (health.tenants?.length) {
		console.log('\nTenants SQL:');
		for (const t of health.tenants) {
			if (empresa != null && t.idEmpresa !== empresa) continue;
			const icon = t.ok ? '✓' : '✗';
			console.log(
				`  ${icon} ${t.idEmpresa}${t.nombre ? ` (${t.nombre})` : ''}: ${t.ok ? `${t.ms}ms → ${t.dbServer}/${t.dbName}` : t.error}`,
			);
		}
	}

	if (reconcile || empresa != null) {
		console.log('\nReconciliación auth:');
		const result = await authReconcile.reconcileAll({
			idEmpresa: empresa,
			fix: false,
		});
		for (const r of result.reports) {
			const icon = r.ok ? '✓' : '⚠';
			console.log(
				`  ${icon} Empresa ${r.idEmpresa}: tenant=${r.tenant} mysql=${r.central} issues=${r.issues?.length || 0}`,
			);
			if (r.error) console.log(`     ERROR: ${r.error}`);
		}
		if (!result.ok) {
			console.log(`\n→ ${result.totalIssues} discrepancia(s). Ejecutá: npm run auth:mysql:reconcile -- --fix`);
		}
	} else if (!deep && empresa == null) {
		console.log('\nTip: npm run auth:mysql:infra-check -- --deep --reconcile');
	}

	console.log('\nHealth API: GET /api/health?deep=1');
	process.exit(health.ok ? 0 : 1);
}

main().catch((e) => {
	console.error('Error fatal:', e.message);
	process.exit(1);
});
