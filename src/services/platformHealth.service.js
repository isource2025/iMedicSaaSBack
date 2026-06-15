/**
 * Health checks de infraestructura SaaS (MySQL auth + tenants SQL).
 */
const { isAuthCentralEnabled, getAuthCentralPool, testAuthCentralConnection } = require('../config/authCentralDb');
const { isPlatformSqlConfigured } = require('../config/database');
const { getTenantPool } = require('../config/tenantDb');
const {
	empresaRowHasSqlConnection,
	normalizeEmpresaRow,
} = require('../utils/empresaDbConnection');
const platformMysql = require('./platformMysql.service');

async function checkMysqlBasic() {
	const started = Date.now();
	try {
		await testAuthCentralConnection();
		const pool = await getAuthCentralPool();
		const [empresas] = await pool.query('SELECT COUNT(*) AS c FROM Empresas');
		const [users] = await pool.query(
			'SELECT COUNT(*) AS c FROM imPersonalEmpresas',
		);
		return {
			ok: true,
			ms: Date.now() - started,
			empresas: Number(empresas[0]?.c) || 0,
			vinculosAuth: Number(users[0]?.c) || 0,
		};
	} catch (e) {
		return { ok: false, ms: Date.now() - started, error: e.message };
	}
}

async function probeTenantSql(idEmpresa, timeoutMs = 8000) {
	const started = Date.now();
	try {
		const row = await platformMysql.obtenerEmpresaRow(idEmpresa);
		if (!row) {
			return {
				idEmpresa,
				ok: false,
				error: 'Sin fila en Empresas (MySQL)',
			};
		}
		const norm = normalizeEmpresaRow(row);
		if (!empresaRowHasSqlConnection(norm)) {
			return {
				idEmpresa,
				nombre: norm.DESCRIPCION,
				ok: true,
				skipped: true,
				reason: 'Conexión SQL incompleta (DbServer/DbName/DbUser/DbPassword*)',
				hasEnc: Boolean(norm.DbPasswordEnc),
				hasPlain: Boolean(norm.DbPassword),
			};
		}

		const pool = await Promise.race([
			getTenantPool(idEmpresa),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('timeout conexión tenant')), timeoutMs),
			),
		]);
		await pool.request().query('SELECT 1 AS ok');
		return {
			idEmpresa,
			nombre: norm.DESCRIPCION,
			ok: true,
			ms: Date.now() - started,
			dbServer: norm.DbServer,
			dbName: norm.DbName,
			passwordSource: norm.DbPassword ? 'DbPassword' : 'DbPasswordEnc',
		};
	} catch (e) {
		return {
			idEmpresa,
			ok: false,
			ms: Date.now() - started,
			error: e.message,
			code: e.code,
		};
	}
}

async function getHealth({ deep = false, idEmpresa = null } = {}) {
	const mode = isAuthCentralEnabled()
		? isPlatformSqlConfigured()
			? 'hybrid'
			: 'saas'
		: 'legacy';

	const payload = {
		ok: true,
		service: 'iMedicSaaSBack',
		mode,
		timestamp: new Date().toISOString(),
		mysql: { enabled: isAuthCentralEnabled(), ok: false },
		platformSql: { configured: isPlatformSqlConfigured() },
		tenants: [],
	};

	if (!isAuthCentralEnabled()) {
		payload.ok = isPlatformSqlConfigured();
		if (!payload.ok) {
			payload.error = 'Ni AUTH_DB ni DB_* plataforma configurados';
		}
		return payload;
	}

	payload.mysql = await checkMysqlBasic();
	if (!payload.mysql.ok) {
		payload.ok = false;
		return payload;
	}

	if (deep) {
		const empresas = await platformMysql.listarEmpresasRows();
		const targets =
			idEmpresa != null && Number.isFinite(Number(idEmpresa))
				? empresas.filter((e) => Number(e.IDEMPRESA) === Number(idEmpresa))
				: empresas;
		for (const e of targets) {
			const probe = await probeTenantSql(Number(e.IDEMPRESA));
			payload.tenants.push(probe);
			if (!probe.ok && !probe.skipped) payload.ok = false;
		}
	}

	return payload;
}

module.exports = {
	getHealth,
	checkMysqlBasic,
	probeTenantSql,
};
