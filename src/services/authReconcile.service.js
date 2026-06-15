/**
 * Reconciliación auth MySQL ↔ SQL Server tenant.
 * Usado por scripts/reconcile_auth_mysql.js y Super Admin API.
 */
const { runWithTenant } = require('../context/tenantContext');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const authCentralSync = require('./authCentralSync.service');
const platformMysql = require('./platformMysql.service');

async function mysqlQuery(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function tenantUsuarios(idEmpresa) {
	return runWithTenant(idEmpresa, async () => {
		const { executeQuery } = require('../models/db');
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

async function reconcileEmpresa(idEmpresa, fix = false) {
	const issues = [];
	let tenant = [];
	let central = [];

	try {
		tenant = await tenantUsuarios(idEmpresa);
	} catch (e) {
		issues.push({ type: 'TENANT_ERROR', message: e.message });
		return { idEmpresa, tenant: 0, central: 0, issues, error: e.message };
	}

	try {
		central = await mysqlUsuarios(idEmpresa);
	} catch (e) {
		issues.push({ type: 'MYSQL_ERROR', message: e.message });
		return { idEmpresa, tenant: tenant.length, central: 0, issues, error: e.message };
	}

	const tenantSet = new Set(tenant.map((u) => u.valorPersonal));
	const centralSet = new Set(central.map((u) => u.valorPersonal));

	let missingCount = 0;
	for (const u of tenant) {
		if (!centralSet.has(u.valorPersonal)) missingCount++;
	}

	let fixDone = 0;
	for (const u of tenant) {
		if (!centralSet.has(u.valorPersonal)) {
			issues.push({
				type: 'MISSING_IN_MYSQL',
				valorPersonal: u.valorPersonal,
				nombreRed: u.nombreRed,
			});
			if (fix) {
				try {
					await runWithTenant(idEmpresa, () =>
						authCentralSync.syncUserLoginBundle(idEmpresa, u.valorPersonal),
					);
					fixDone++;
					if (fixDone % 50 === 0 || fixDone === missingCount) {
						console.log(`  sync ${fixDone}/${missingCount} usuarios…`);
					}
				} catch (e) {
					issues.push({
						type: 'SYNC_ERROR',
						valorPersonal: u.valorPersonal,
						message: e.message,
					});
				}
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
		ok: issues.length === 0,
	};
}

async function reconcileAll({ idEmpresa = null, fix = false, migrate = false } = {}) {
	if (!isAuthCentralEnabled()) {
		const e = new Error('AUTH_DB_ENABLED=1 requerido');
		e.statusCode = 503;
		throw e;
	}

	const migration = migrate ? await platformMysql.aplicarMigracionPlataforma() : null;

	let empresas = [];
	if (idEmpresa != null && Number.isFinite(Number(idEmpresa))) {
		empresas = [{ IDEMPRESA: Number(idEmpresa) }];
	} else {
		const rows = await platformMysql.listarEmpresasRows();
		empresas = rows.map((r) => ({ IDEMPRESA: r.IDEMPRESA }));
	}

	const reports = [];
	for (const e of empresas) {
		const id = Number(e.IDEMPRESA);
		try {
			if (fix) {
				console.log(`[reconcile] Empresa ${id}…`);
			}
			reports.push(await reconcileEmpresa(id, fix));
		} catch (err) {
			reports.push({
				idEmpresa: id,
				tenant: 0,
				central: 0,
				issues: [{ type: 'FATAL', message: err.message }],
				ok: false,
				error: err.message,
			});
		}
	}

	const totalIssues = reports.reduce((n, r) => n + (r.issues?.length || 0), 0);

	return {
		migration,
		fix,
		totalEmpresas: reports.length,
		totalIssues,
		ok: totalIssues === 0,
		reports,
	};
}

module.exports = {
	reconcileEmpresa,
	reconcileAll,
};
