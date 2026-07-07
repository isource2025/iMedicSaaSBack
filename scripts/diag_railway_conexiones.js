#!/usr/bin/env node
/**
 * Diagnóstico de tablas de conexión multi-tenant (MySQL Railway o SQL Server local).
 *
 * Uso:
 *   node scripts/diag_railway_conexiones.js              # SQL Server plataforma (.env DB_*)
 *   node scripts/diag_railway_conexiones.js --railway    # MySQL Railway (AUTH_DB_*)
 *   node scripts/diag_railway_conexiones.js --railway --probe   # + prueba TCP a cada SQL tenant
 *   node scripts/diag_railway_conexiones.js --env-file .env.railway.local
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const sql = require('mssql');

const args = process.argv.slice(2);
const useRailway = args.includes('--railway');
const doProbe = args.includes('--probe');
const envFileIdx = args.indexOf('--env-file');
const envFile =
	envFileIdx >= 0 && args[envFileIdx + 1]
		? path.resolve(process.cwd(), args[envFileIdx + 1])
		: null;

if (envFile) {
	if (!fs.existsSync(envFile)) {
		console.error(`No existe el archivo: ${envFile}`);
		process.exit(1);
	}
	dotenv.config({ path: envFile, override: true });
} else {
	dotenv.config();
}

if (useRailway) {
	process.env.LOCAL_DEV_ONLY = '0';
	process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';
}

const {
	normalizeEmpresaRow,
	resolvePasswordFromEmpresaRow,
	empresaRowHasSqlConnection,
} = require('../src/utils/empresaDbConnection');
const { secretsForDecrypt } = require('../src/utils/dbCrypto');

const TABLAS_REQUERIDAS = [
	'Empresas',
	'imPassword',
	'imPersonal',
	'imPersonalEmpresas',
	'imRoles',
	'imUsuarioEmpresaLogin',
	'EmpresasModuloPack',
	'EmpresasOnboarding',
	'EmpresasSuscripcion',
];

const COLUMNAS_CONEXION = [
	'DbServer',
	'DbPort',
	'DbInstance',
	'DbName',
	'DbUser',
	'DbPassword',
	'DbPasswordEnc',
];

function mask(val) {
	if (val == null || val === '') return '(vacío)';
	const s = String(val);
	if (s.length <= 4) return '****';
	return `${s.slice(0, 2)}…${s.slice(-2)} (${s.length} chars)`;
}

function statusIcon(ok) {
	return ok ? '✓' : '✗';
}

function printHeader(title) {
	console.log('\n' + '═'.repeat(60));
	console.log(`  ${title}`);
	console.log('═'.repeat(60));
}

function printEnvSummary() {
	const pds = process.env.PLATFORM_DB_SECRET?.trim();
	const jwt = process.env.JWT_SECRET?.trim();
	console.log('Modo:', useRailway ? 'MySQL Railway (AUTH_DB)' : 'SQL Server plataforma (DB_*)');
	console.log('LOCAL_DEV_ONLY:', process.env.LOCAL_DEV_ONLY || '(unset)');
	console.log('AUTH_DB_ENABLED:', process.env.AUTH_DB_ENABLED || '(unset)');
	console.log('PLATFORM_DB_SECRET:', pds ? `set (${pds.length} chars)` : 'MISSING');
	console.log('JWT_SECRET:', jwt ? `set (${jwt.length} chars)` : 'MISSING');
	console.log('Secrets descifrado:', secretsForDecrypt().map((s, i) => `#${i + 1}`).join(' → '));
	if (!useRailway) {
		console.log('DB plataforma:', `${process.env.DB_SERVER || '?'}:${process.env.DB_PORT || 1433}/${process.env.DB_NAME || '?'}`);
	} else {
		const host = process.env.AUTH_DB_HOST || process.env.MYSQLHOST || '?';
		const db = process.env.AUTH_DB_NAME || process.env.MYSQLDATABASE || '?';
		console.log('MySQL Railway:', `${host}:${process.env.AUTH_DB_PORT || process.env.MYSQLPORT || 3306}/${db}`);
	}
}

async function getMysqlPool() {
	const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');
	if (!isAuthCentralEnabled()) {
		throw new Error(
			'MySQL no configurado. Copiá .env.railway.local.template → .env.railway.local y completá AUTH_DB_*.\n' +
				'Luego: node scripts/diag_railway_conexiones.js --railway --env-file .env.railway.local',
		);
	}
	return getAuthCentralPool();
}

async function mysqlQuery(pool, sqlText, params = []) {
	const [rows] = await pool.query(sqlText, params);
	return rows || [];
}

async function listarTablasMysql(pool) {
	const rows = await mysqlQuery(
		pool,
		`SELECT TABLE_NAME AS nombre
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME`,
	);
	return rows.map((r) => r.nombre);
}

async function listarColumnasMysql(pool, tabla) {
	const rows = await mysqlQuery(
		pool,
		`SELECT COLUMN_NAME AS col, DATA_TYPE AS tipo, IS_NULLABLE AS nullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
		[tabla],
	);
	return rows;
}

async function listarEmpresasMysql(pool) {
	return mysqlQuery(
		pool,
		`SELECT IDEMPRESA, DESCRIPCION, DbServer, DbPort, DbInstance, DbName, DbUser,
            DbPassword, DbPasswordEnc
     FROM Empresas
     ORDER BY IDEMPRESA`,
	);
}

async function listarSuperAdminsMysql(pool) {
	const C = 'utf8mb4_unicode_ci';
	return mysqlQuery(
		pool,
		`
    SELECT pw.ValorPersonal, pw.NombreRed, pw.Grupo, r.Nombre AS RolNombre
    FROM imPassword pw
    LEFT JOIN imPersonal p ON p.Valor = pw.ValorPersonal
    LEFT JOIN imRoles r
      ON CAST(r.IdRol AS CHAR) COLLATE ${C} = TRIM(p.Rol) COLLATE ${C} AND r.Activo = 1
    WHERE UPPER(COALESCE(r.Nombre, '')) COLLATE ${C} = 'SUPER_ADMIN'
       OR TRIM(COALESCE(p.Rol, '')) COLLATE ${C} = '5'
       OR COALESCE(pw.Grupo, 0) = 11
    ORDER BY pw.NombreRed
    `,
	);
}

async function listarOnboardingMysql(pool) {
	try {
		return await mysqlQuery(
			pool,
			`SELECT o.IdEmpresa, e.DESCRIPCION, o.PasoActual, o.Completado
       FROM EmpresasOnboarding o
       LEFT JOIN Empresas e ON e.IDEMPRESA = o.IdEmpresa
       ORDER BY o.IdEmpresa`,
		);
	} catch {
		return null;
	}
}

async function listarUsuariosPorEmpresaMysql(pool) {
	return mysqlQuery(
		pool,
		`SELECT pe.IdEmpresa, e.DESCRIPCION, COUNT(*) AS usuarios
     FROM imPersonalEmpresas pe
     LEFT JOIN Empresas e ON e.IDEMPRESA = pe.IdEmpresa
     GROUP BY pe.IdEmpresa, e.DESCRIPCION
     ORDER BY pe.IdEmpresa`,
	);
}

async function getSqlServerPool() {
	const { connectDB } = require('../src/config/database');
	return connectDB();
}

async function listarEmpresasSql(pool) {
	const r = await pool.request().query(`
    SELECT IDEMPRESA, DESCRIPCION, DbServer, DbPort, DbInstance, DbName, DbUser, DbPasswordEnc
    FROM dbo.Empresas
    ORDER BY IDEMPRESA
  `);
	return r.recordset || [];
}

async function listarSuperAdminsSql(pool) {
	const r = await pool.request().query(`
    SELECT pw.ValorPersonal, pw.NombreRed, pw.Grupo, r.Nombre AS RolNombre
    FROM dbo.imPassword pw
    LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
    LEFT JOIN dbo.imRoles r ON CONVERT(VARCHAR(20), r.IdRol) = LTRIM(RTRIM(p.Rol)) AND r.Activo = 1
    WHERE UPPER(COALESCE(r.Nombre, '')) = 'SUPER_ADMIN'
       OR LTRIM(RTRIM(COALESCE(p.Rol, ''))) = '5'
       OR COALESCE(pw.Grupo, 0) = 11
    ORDER BY pw.NombreRed
  `);
	return r.recordset || [];
}

async function listarColumnasSql(pool, tabla) {
	const r = await pool.request().input('t', tabla).query(`
    SELECT COLUMN_NAME AS col, DATA_TYPE AS tipo, IS_NULLABLE AS nullable
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @t
    ORDER BY ORDINAL_POSITION
  `);
	return r.recordset || [];
}

function analizarConexion(row) {
	const n = normalizeEmpresaRow(row);
	const checks = {
		DbServer: !!String(n.DbServer || '').trim(),
		DbName: !!String(n.DbName || '').trim(),
		DbUser: !!String(n.DbUser || '').trim(),
		DbPasswordPlain: !!String(n.DbPassword || '').trim(),
		DbPasswordEnc: !!String(n.DbPasswordEnc || '').trim(),
	};
	let passwordOk = false;
	let decryptError = null;
	try {
		const pwd = resolvePasswordFromEmpresaRow(n);
		passwordOk = !!pwd;
	} catch (e) {
		decryptError = e.message;
	}
	const completa = empresaRowHasSqlConnection(n);
	return { n, checks, passwordOk, decryptError, completa };
}

async function probeSqlConnection(row) {
	const n = normalizeEmpresaRow(row);
	if (!empresaRowHasSqlConnection(n)) {
		return { ok: false, error: 'Conexión incompleta en Empresas' };
	}
	const hasPort = n.DbPort != null && n.DbPort !== '' && Number.isFinite(Number(n.DbPort));
	const config = {
		server: String(n.DbServer).trim(),
		database: String(n.DbName).trim(),
		user: String(n.DbUser).trim(),
		password: resolvePasswordFromEmpresaRow(n),
		options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
		connectionTimeout: Number(process.env.TENANT_CONNECT_TIMEOUT_MS) || 12000,
	};
	if (hasPort) config.port = Number(n.DbPort);
	else if (n.DbInstance) config.options.instanceName = String(n.DbInstance).trim();

	let pool;
	try {
		pool = await sql.connect(config);
		await pool.request().query('SELECT 1 AS ok');
		return { ok: true, target: `${config.server}:${config.port || n.DbInstance || 1433}/${config.database}` };
	} catch (e) {
		return { ok: false, error: e.message, target: `${config.server}:${config.port || 1433}/${config.database}` };
	} finally {
		if (pool) {
			try {
				await pool.close();
			} catch {
				/* ignore */
			}
		}
	}
}

function printEmpresaDiagnostico(row, idx) {
	const { n, checks, passwordOk, decryptError, completa } = analizarConexion(row);
	console.log(`\n── Empresa #${idx + 1}: [${n.IDEMPRESA}] ${n.DESCRIPCION || '(sin nombre)'} ──`);
	console.log(`  DbServer:      ${n.DbServer || '(vacío)'}  ${statusIcon(checks.DbServer)}`);
	console.log(`  DbPort:        ${n.DbPort ?? '(vacío)'}`);
	console.log(`  DbInstance:    ${n.DbInstance || '(vacío)'}`);
	console.log(`  DbName:        ${n.DbName || '(vacío)'}  ${statusIcon(checks.DbName)}`);
	console.log(`  DbUser:        ${n.DbUser || '(vacío)'}  ${statusIcon(checks.DbUser)}`);
	console.log(`  DbPassword:    ${checks.DbPasswordPlain ? mask(n.DbPassword) : '(vacío)'}  ${statusIcon(checks.DbPasswordPlain)}`);
	console.log(`  DbPasswordEnc: ${checks.DbPasswordEnc ? mask(n.DbPasswordEnc) : '(vacío)'}  ${statusIcon(checks.DbPasswordEnc)}`);
	if (decryptError) {
		console.log(`  Descifrado:    ✗ ${decryptError}`);
	} else {
		console.log(`  Contraseña OK: ${statusIcon(passwordOk)}`);
	}
	console.log(`  → Lista para conectar: ${completa ? 'SÍ' : 'NO'}`);
	if (!completa) {
		const faltan = [];
		if (!checks.DbServer) faltan.push('DbServer');
		if (!checks.DbName) faltan.push('DbName');
		if (!checks.DbUser) faltan.push('DbUser');
		if (!passwordOk) faltan.push('DbPassword o DbPasswordEnc válido');
		console.log(`  → Falta: ${faltan.join(', ')}`);
	}
}

async function runMysql() {
	const pool = await getMysqlPool();
	printHeader('MySQL Railway — esquema y conexiones');

	const tablas = await listarTablasMysql(pool);
	console.log('\nTablas en la base:');
	for (const t of TABLAS_REQUERIDAS) {
		const ok = tablas.includes(t);
		console.log(`  ${statusIcon(ok)} ${t}${ok ? '' : '  ← FALTA (correr auth:mysql:infra-migrate)'}`);
	}

	printHeader('Columnas de conexión en Empresas');
	const cols = await listarColumnasMysql(pool, 'Empresas');
	const colSet = new Set(cols.map((c) => c.col));
	for (const c of COLUMNAS_CONEXION) {
		const found = colSet.has(c);
		console.log(`  ${statusIcon(found)} ${c}`);
	}

	const empresas = await listarEmpresasMysql(pool);
	printHeader(`Empresas (${empresas.length})`);
	if (!empresas.length) {
		console.log('  (ninguna — crear desde Super Admin)');
	} else {
		for (let i = 0; i < empresas.length; i++) {
			printEmpresaDiagnostico(empresas[i], i);
			if (doProbe) {
				const probe = await probeSqlConnection(empresas[i]);
				console.log(
					`  Probe SQL:     ${probe.ok ? '✓' : '✗'} ${probe.target || ''}${probe.error ? ` — ${probe.error}` : ''}`,
				);
			}
		}
	}

	printHeader('Onboarding');
	const onboarding = await listarOnboardingMysql(pool);
	if (onboarding == null) {
		console.log('  ✗ Tabla EmpresasOnboarding no existe — correr auth:mysql:platform-migrate');
	} else if (!onboarding.length) {
		console.log('  (sin filas — correr auth:mysql:platform-migrate)');
	} else {
		for (const o of onboarding) {
			console.log(
				`  [${o.IdEmpresa}] ${o.DESCRIPCION || '?'} — paso ${o.PasoActual}, completado=${o.Completado ? 'sí' : 'no'}`,
			);
		}
	}

	printHeader('Usuarios por empresa (imPersonalEmpresas)');
	const usuarios = await listarUsuariosPorEmpresaMysql(pool);
	if (!usuarios.length) console.log('  (ninguno — correr auth:mysql:sync)');
	else usuarios.forEach((u) => console.log(`  [${u.IdEmpresa}] ${u.DESCRIPCION}: ${u.usuarios} usuario(s)`));

	printHeader('Super Admins (login plataforma)');
	const admins = await listarSuperAdminsMysql(pool);
	if (!admins.length) {
		console.log('  ✗ Ninguno. Crear con sync desde SQL tenant o insertar en imPassword con Grupo=11 / Rol SUPER_ADMIN');
	} else {
		for (const a of admins) {
			console.log(`  • ${a.NombreRed} (ValorPersonal=${a.ValorPersonal}, Rol=${a.RolNombre || 'Grupo ' + a.Grupo})`);
		}
		console.log('  (contraseña en imPassword.Password — no se muestra por seguridad)');
	}

	await pool.end();
}

async function runSqlServer() {
	const pool = await getSqlServerPool();
	printHeader('SQL Server plataforma — esquema y conexiones');

	const tablasSql = ['Empresas', 'EmpresasModuloPack', 'EmpresasOnboarding', 'EmpresasSuscripcion', 'imUsuarioEmpresaLogin'];
	for (const t of tablasSql) {
		const cols = await listarColumnasSql(pool, t);
		console.log(`  ${statusIcon(cols.length)} ${t}${cols.length ? '' : '  ← tabla no existe'}`);
	}

	printHeader('Columnas de conexión en Empresas');
	const cols = await listarColumnasSql(pool, 'Empresas');
	const colSet = new Set(cols.map((c) => c.col));
	for (const c of COLUMNAS_CONEXION) {
		if (c === 'DbPassword') {
			console.log(`  — ${c} (solo MySQL Railway; en SQL Server solo DbPasswordEnc)`);
			continue;
		}
		console.log(`  ${statusIcon(colSet.has(c))} ${c}`);
	}

	const empresas = await listarEmpresasSql(pool);
	printHeader(`Empresas (${empresas.length})`);
	if (process.env.LOCAL_DEV_ONLY === '1') {
		console.log('  ⚠ LOCAL_DEV_ONLY=1: en runtime se ignora DbServer remoto; se usa .env DB_*');
	}
	for (let i = 0; i < empresas.length; i++) {
		printEmpresaDiagnostico(empresas[i], i);
		if (doProbe) {
			const probe = await probeSqlConnection(empresas[i]);
			console.log(
				`  Probe SQL:     ${probe.ok ? '✓' : '✗'} ${probe.target || ''}${probe.error ? ` — ${probe.error}` : ''}`,
			);
		}
	}

	printHeader('Super Admins');
	const admins = await listarSuperAdminsSql(pool);
	if (!admins.length) {
		console.log('  ✗ Ninguno. Ejecutar: node scripts/crear_super_admin_test.js');
	} else {
		for (const a of admins) {
			console.log(`  • ${a.NombreRed} (ValorPersonal=${a.ValorPersonal}, Rol=${a.RolNombre || 'Grupo ' + a.Grupo})`);
		}
		console.log('  Default script: superadmin / SuperAdmin2026!');
	}
}

(async () => {
	try {
		printHeader('diag_railway_conexiones');
		printEnvSummary();
		if (useRailway) await runMysql();
		else await runSqlServer();
		console.log('\n');
		process.exit(0);
	} catch (e) {
		console.error('\nError:', e.message || e);
		process.exit(1);
	}
})();
