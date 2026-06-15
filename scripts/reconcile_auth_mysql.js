#!/usr/bin/env node
/**
 * Diagnóstico y reconciliación auth MySQL ↔ SQL Server tenant.
 *
 * Uso:
 *   node scripts/reconcile_auth_mysql.js              # reporte todas las empresas
 *   node scripts/reconcile_auth_mysql.js --empresa=1  # solo empresa 1
 *   node scripts/reconcile_auth_mysql.js --fix        # sync bundle faltante
 */
require('dotenv').config();

const { runWithTenant } = require('../src/context/tenantContext');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../src/config/authCentralDb');
const authCentralSync = require('../src/services/authCentralSync.service');
const platformMysql = require('../src/services/platformMysql.service');

function parseArgs() {
	const args = { empresa: null, fix: false };
	for (const a of process.argv.slice(2)) {
		if (a === '--fix') args.fix = true;
		else if (a.startsWith('--empresa=')) args.empresa = Number(a.split('=')[1]);
	}
	return args;
}

async function mysqlQuery(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function tenantUsuarios(idEmpresa) {
	return runWithTenant(idEmpresa, async () => {
		const { executeQuery } = require('../src/models/db');
		const rows = await executeQuery(
			`
      SELECT pe.IdPersonal AS valorPersonal, pw.NombreRed AS nombreRed
      FROM dbo.imPersonalEmpresas pe
      INNER JOIN dbo.imPassword pw ON pw.ValorPersonal = pe.IdPersonal
      WHERE pe.IdEmpresa = @p0
      ORDER BY pe.IdPersonal
      `,
			[{ value: idEmpresa, type: 'Int' }],
		);
		return rows.map((r) => ({
			valorPersonal: Number(r.valorPersonal),
			nombreRed: String(r.nombreRed || '').trim(),
		}));
	});
}

async function mysqlUsuarios(idEmpresa) {
	return mysqlQuery(
		`
    SELECT pe.IdPersonal AS valorPersonal, pw.NombreRed AS nombreRed
    FROM imPersonalEmpresas pe
    INNER JOIN imPassword pw ON pw.ValorPersonal = pe.IdPersonal
    WHERE pe.IdEmpresa = ?
    ORDER BY pe.IdPersonal
    `,
		[idEmpresa],
	);
}

async function reconcileEmpresa(idEmpresa, fix) {
	const issues = [];
	const tenant = await tenantUsuarios(idEmpresa);
	let central = [];
	try {
		central = await mysqlUsuarios(idEmpresa);
	} catch (e) {
		issues.push({ type: 'MYSQL_ERROR', message: e.message });
		return { idEmpresa, tenant: tenant.length, central: 0, issues };
	}

	const tenantSet = new Set(tenant.map((u) => u.valorPersonal));
	const centralSet = new Set(central.map((u) => u.valorPersonal));

	for (const u of tenant) {
		if (!centralSet.has(u.valorPersonal)) {
			issues.push({
				type: 'MISSING_IN_MYSQL',
				valorPersonal: u.valorPersonal,
				nombreRed: u.nombreRed,
			});
			if (fix) {
				await runWithTenant(idEmpresa, () =>
					authCentralSync.syncUserLoginBundle(idEmpresa, u.valorPersonal),
				);
			}
		}
	}

	for (const u of central) {
		if (!tenantSet.has(u.valorPersonal)) {
			issues.push({
				type: 'ORPHAN_IN_MYSQL',
				valorPersonal: u.valorPersonal,
				nombreRed: u.nombreRed,
			});
			if (fix) {
				await authCentralSync.removePersonalEmpresa(idEmpresa, u.valorPersonal);
				await authCentralSync.purgePersonalAuthIfOrphan(u.valorPersonal);
			}
		}
	}

	// Empresa existe en MySQL con conexión SQL
	try {
		const row = await platformMysql.obtenerEmpresaRow(idEmpresa);
		if (!row) {
			issues.push({ type: 'EMPRESA_MISSING_MYSQL', message: 'Sin fila en Empresas' });
		} else if (!row.DbServer || !row.DbName || !row.DbUser) {
			issues.push({
				type: 'CONEXION_INCOMPLETA',
				message: `DbServer=${row.DbServer || '-'} DbName=${row.DbName || '-'}`,
			});
		}
	} catch (e) {
		issues.push({ type: 'EMPRESA_CHECK_ERROR', message: e.message });
	}

	return {
		idEmpresa,
		tenant: tenant.length,
		central: central.length,
		issues,
		fixed: fix ? issues.length : 0,
	};
}

async function main() {
	if (!isAuthCentralEnabled()) {
		console.error('AUTH_DB_ENABLED=1 requerido');
		process.exit(1);
	}

	const { empresa, fix } = parseArgs();
	console.log('=== Reconciliación auth MySQL ↔ tenant SQL ===');
	console.log('Modo:', fix ? 'FIX (aplica correcciones)' : 'solo diagnóstico');
	console.log('');

	let empresas = [];
	if (empresa) {
		empresas = [{ IDEMPRESA: empresa }];
	} else {
		const rows = await platformMysql.listarEmpresasRows();
		empresas = rows.map((r) => ({ IDEMPRESA: r.IDEMPRESA }));
	}

	let totalIssues = 0;
	for (const e of empresas) {
		const id = Number(e.IDEMPRESA);
		let report;
		try {
			report = await reconcileEmpresa(id, fix);
		} catch (err) {
			console.log(`Empresa ${id}: ERROR — ${err.message}`);
			totalIssues += 1;
			continue;
		}
		const status = report.issues.length ? '⚠' : '✓';
		console.log(
			`${status} Empresa ${id}: tenant=${report.tenant} mysql=${report.central} issues=${report.issues.length}`,
		);
		for (const i of report.issues) {
			console.log(`   - [${i.type}]`, i.valorPersonal ?? i.message ?? '');
		}
		totalIssues += report.issues.length;
	}

	console.log('');
	if (totalIssues === 0) {
		console.log('✓ Sin discrepancias detectadas.');
	} else if (!fix) {
		console.log(`Encontradas ${totalIssues} discrepancia(s). Ejecutá con --fix para corregir.`);
	} else {
		console.log(`Procesadas ${totalIssues} discrepancia(s) con --fix.`);
	}
	process.exit(totalIssues > 0 && !fix ? 1 : 0);
}

main().catch((err) => {
	console.error('Error fatal:', err);
	process.exit(1);
});
