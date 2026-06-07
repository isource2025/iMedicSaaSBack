/**
 * Migración idempotente: WhatsApp + Bot (multi-tenant nube)
 *
 * Arquitectura:
 *   MySQL central Empresas     → enrutamiento webhook (phone_number_id → IDEMPRESA) + token cifrado
 *   SQL Server tenant          → imBotConfig (bot + espejo WhatsApp), imBotConversacion, imBotMensaje
 *
 * Uso (desde iMedicWSBack):
 *   node scripts/setup_whatsapp_bot.js              # perfil .env actual
 *   node scripts/setup_whatsapp_bot.js local        # BD dev 190.227.150.183
 *   node scripts/setup_whatsapp_bot.js prod         # BD producción 181.4.71.230
 *   node scripts/setup_whatsapp_bot.js mysql        # solo MySQL Railway (.env.railway)
 *   node scripts/setup_whatsapp_bot.js all          # local + prod + mysql
 *
 * Opciones env:
 *   EMPRESA_ID=1              Solo migrar tenant(s) de esa empresa
 *   SEED_WHATSAPP_FROM_ENV=1  Persistir WHATSAPP_* del .env en BD
 *   SKIP_MYSQL=1 / SKIP_TENANT=1
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { connectDB } = require('../src/config/database');
const { encrypt } = require('../src/utils/dbCrypto');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../src/config/authCentralDb');
const {
	getTenantPool,
	loadEmpresaConnectionRow,
	rowToSqlConfig,
	configCacheKey,
} = require('../src/config/tenantDb');

const PROFILE = (process.argv[2] || process.env.SETUP_PROFILE || 'current').toLowerCase();
const SKIP_MYSQL = process.env.SKIP_MYSQL === '1';
const SKIP_TENANT = process.env.SKIP_TENANT === '1';
const SEED_FROM_ENV =
	process.env.SEED_WHATSAPP_FROM_ENV === '1' || process.env.SEED_WHATSAPP_FROM_ENV === 'true';
const FILTER_EMPRESA = process.env.EMPRESA_ID ? Number(process.env.EMPRESA_ID) : null;

const SQL_FILES_TENANT = [
	'sql/create_bot_tables.sql',
	'sql/alter_imBotConfig_valor_max.sql',
	'sql/create_bot_conversaciones.sql',
	'sql/seed_whatsapp_imbotconfig.sql',
];

const PROFILES = {
	local: {
		label: 'Local dev (190.227.150.183 / iSource)',
		DB_SERVER: '190.227.150.183',
		DB_PORT: '1433',
		DB_NAME: 'iSource',
		DB_USER: 'sa',
		DB_PASSWORD: 'isource',
		AUTH_DB_ENABLED: '0',
	},
	prod: {
		label: 'Producción SQL tenant (181.4.71.230 / isource)',
		DB_SERVER: '181.4.71.230',
		DB_PORT: '1433',
		DB_NAME: 'isource',
		DB_USER: 'sa',
		DB_PASSWORD: 'isource',
		AUTH_DB_ENABLED: '0',
	},
};

function applyProfile(name) {
	if (name === 'current' || name === 'default') return;
	if (name === 'mysql') return;
	if (name === 'all') return;
	const p = PROFILES[name];
	if (!p) {
		throw new Error(`Perfil desconocido: ${name}. Usá: local, prod, mysql, all`);
	}
	console.log(`Perfil: ${p.label}`);
	for (const [k, v] of Object.entries(p)) {
		if (k !== 'label') process.env[k] = v;
	}
}

function loadRailwayEnv() {
	if (isAuthCentralEnabled()) {
		const { resolveAuthDbEnv } = require('../src/config/authCentralDb');
		const env = resolveAuthDbEnv();
		if (env.host && env.user && env.database) {
			console.log(`MySQL ya configurado en entorno → ${env.host}:${env.port}/${env.database}`);
			return;
		}
	}
	const railwayEnv = path.join(__dirname, '..', '.env.railway');
	if (!fs.existsSync(railwayEnv)) {
		throw new Error(
			'Falta AUTH_DB_* en entorno o iMedicWSBack/.env.railway (copiá desde Railway → Variables del backend)',
		);
	}
	dotenv.config({ path: railwayEnv, override: true });
	process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';
	console.log('Cargado .env.railway para MySQL central');
}

function whatsappFromEnv() {
	const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
	const wabaId = String(process.env.WHATSAPP_WABA_ID || '').trim();
	const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
	if (!phoneNumberId && !wabaId && !accessToken) return null;
	return { phoneNumberId, wabaId, accessToken };
}

async function ejecutarSqlArchivo(poolOrRequest, relativePath, { isMysql = false } = {}) {
	const filePath = path.join(__dirname, relativePath);
	if (!fs.existsSync(filePath)) throw new Error(`No existe ${relativePath}`);
	const sqlText = fs.readFileSync(filePath, 'utf8');
	const batches = sqlText.split(/\nGO\r?\n/gi).filter((b) => b.trim());
	if (isMysql) {
		for (const batch of batches) await poolOrRequest.query(batch);
		return;
	}
	for (const batch of batches) await poolOrRequest.request().query(batch);
}

async function sqlServerEmpresasColumns(platformPool) {
	const r = await platformPool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Empresas'
  `);
	return new Set((r.recordset || []).map((row) => String(row.COLUMN_NAME)));
}

async function listarEmpresasCatalogo(platformPool) {
	if (isAuthCentralEnabled()) {
		try {
			const pool = await getAuthCentralPool();
			const [rows] = await pool.query(
				`SELECT IDEMPRESA, DESCRIPCION, DbServer, DbName FROM Empresas ORDER BY IDEMPRESA`,
			);
			return (rows || []).map((r) => ({
				idEmpresa: Number(r.IDEMPRESA),
				descripcion: r.DESCRIPCION,
				dbServer: r.DbServer,
				dbName: r.DbName,
			}));
		} catch (e) {
			console.warn('[setup whatsapp] MySQL catálogo:', e.message);
		}
	}

	const cols = await sqlServerEmpresasColumns(platformPool);
	const sel = ['IDEMPRESA', 'DESCRIPCION'];
	if (cols.has('DbServer')) sel.push('DbServer');
	if (cols.has('DbName')) sel.push('DbName');

	const r = await platformPool.request().query(
		`SELECT ${sel.join(', ')} FROM dbo.Empresas ORDER BY IDEMPRESA`,
	);
	return (r.recordset || []).map((row) => ({
		idEmpresa: Number(row.IDEMPRESA),
		descripcion: row.DESCRIPCION,
		dbServer: row.DbServer || null,
		dbName: row.DbName || null,
	}));
}

function filtrarEmpresas(empresas) {
	if (FILTER_EMPRESA != null && Number.isFinite(FILTER_EMPRESA)) {
		return empresas.filter((e) => e.idEmpresa === FILTER_EMPRESA);
	}
	return empresas;
}

async function agruparPorConexionTenant(empresas) {
	const groups = new Map();
	for (const emp of empresas) {
		try {
			const row = await loadEmpresaConnectionRow(emp.idEmpresa);
			const key = configCacheKey(rowToSqlConfig(row));
			if (!groups.has(key)) groups.set(key, { probeId: emp.idEmpresa, empresas: [] });
			groups.get(key).empresas.push(emp);
		} catch (e) {
			console.warn(`  ! Empresa ${emp.idEmpresa}: sin conexión tenant (${e.message})`);
		}
	}
	return groups;
}

async function migrarTenantSql(probeId) {
	const tenantPool = await getTenantPool(probeId);
	console.log(`  • DDL bot/WhatsApp en tenant (probe empresa ${probeId})…`);
	for (const rel of SQL_FILES_TENANT) await ejecutarSqlArchivo(tenantPool, rel);
	return tenantPool;
}

async function upsertImBotConfigClave(tenantPool, clave, valor, tipo = 'string') {
	await tenantPool
		.request()
		.input('clave', clave)
		.input('valor', valor == null ? '' : String(valor))
		.input('tipo', tipo)
		.query(`
    UPDATE dbo.imBotConfig SET Activo = 0 WHERE Clave = @clave AND Activo = 1;
    INSERT INTO dbo.imBotConfig (Clave, Valor, Tipo, Activo) VALUES (@clave, @valor, @tipo, 1);
  `);
}

async function seedWhatsappTenant(tenantPool, idEmpresa, cfg) {
	if (!cfg) return;
	console.log(`  • Seed WhatsApp imBotConfig (empresa ${idEmpresa})…`);
	if (cfg.phoneNumberId) await upsertImBotConfigClave(tenantPool, 'whatsapp_phone_number_id', cfg.phoneNumberId);
	if (cfg.wabaId) await upsertImBotConfigClave(tenantPool, 'whatsapp_waba_id', cfg.wabaId);
	if (cfg.accessToken) {
		await upsertImBotConfigClave(tenantPool, 'whatsapp_access_token_enc', encrypt(cfg.accessToken));
	}
}

async function mysqlColumnExists(conn, column) {
	const [rows] = await conn.query(
		`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = ?`,
		[column],
	);
	return Number(rows[0]?.n || 0) > 0;
}

async function migrarMysqlCentral() {
	if (SKIP_MYSQL) {
		console.log('\n=== MySQL central: omitido (SKIP_MYSQL=1) ===');
		return false;
	}
	if (!isAuthCentralEnabled()) {
		console.log('\n=== MySQL central: omitido (AUTH_DB no habilitado) ===');
		return false;
	}
	console.log('\n=== MySQL central (Empresas WhatsApp) ===');
	const pool = await getAuthCentralPool();

	const columns = [
		{
			name: 'WhatsAppPhoneNumberId',
			ddl: 'ADD COLUMN `WhatsAppPhoneNumberId` VARCHAR(32) NULL COMMENT \'Meta Phone Number ID — enruta webhook a IDEMPRESA\'',
		},
		{
			name: 'WhatsAppWabaId',
			ddl: 'ADD COLUMN `WhatsAppWabaId` VARCHAR(32) NULL COMMENT \'WhatsApp Business Account ID\'',
		},
		{
			name: 'WhatsAppAccessTokenEnc',
			ddl: 'ADD COLUMN `WhatsAppAccessTokenEnc` TEXT NULL COMMENT \'Token Graph API cifrado (PLATFORM_DB_SECRET)\'',
		},
	];

	for (const col of columns) {
		if (!(await mysqlColumnExists(pool, col.name))) {
			await pool.query(`ALTER TABLE \`Empresas\` ${col.ddl}`);
			console.log(`• Columna ${col.name} creada`);
		}
	}

	const [idxRows] = await pool.query(
		`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND INDEX_NAME = 'UX_Empresas_WhatsAppPhone'`,
	);
	if (Number(idxRows[0]?.n || 0) === 0) {
		await pool.query(
			'CREATE UNIQUE INDEX UX_Empresas_WhatsAppPhone ON `Empresas` (`WhatsAppPhoneNumberId`)',
		);
		console.log('• Índice UX_Empresas_WhatsAppPhone creado');
	}

	console.log('• Columnas WhatsApp OK');
	return true;
}

async function seedWhatsappMysql(idEmpresa, cfg) {
	if (!cfg || !isAuthCentralEnabled()) return;
	const pool = await getAuthCentralPool();
	if (!(await mysqlColumnExists(pool, 'WhatsAppPhoneNumberId'))) {
		console.warn('  ! MySQL sin columnas WhatsApp');
		return;
	}
	const enc = cfg.accessToken ? encrypt(cfg.accessToken) : null;
	await pool.query(
		`UPDATE Empresas SET
		   WhatsAppPhoneNumberId = ?,
		   WhatsAppWabaId = ?,
		   WhatsAppAccessTokenEnc = COALESCE(?, WhatsAppAccessTokenEnc)
		 WHERE IDEMPRESA = ?`,
		[cfg.phoneNumberId || null, cfg.wabaId || null, enc, Number(idEmpresa)],
	);
	console.log(`  • Seed MySQL Empresas WhatsApp (IDEMPRESA=${idEmpresa})`);
}

async function listarEmpresasMysql() {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(`SELECT IDEMPRESA, DESCRIPCION FROM Empresas ORDER BY IDEMPRESA`);
	return (rows || []).map((r) => ({
		idEmpresa: Number(r.IDEMPRESA),
		descripcion: r.DESCRIPCION,
	}));
}

async function verificarTenant(probeId) {
	const tenantPool = await getTenantPool(probeId);
	const checks = await tenantPool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='imBotConfig') AS hasConfig,
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='imBotConversacion') AS hasConv,
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='imBotMensaje') AS hasMsg,
      (SELECT COUNT(*) FROM dbo.imBotConfig WHERE Clave='whatsapp_phone_number_id' AND Activo=1 AND LTRIM(RTRIM(ISNULL(Valor,'')))<>'' ) AS hasWaPhone
  `);
	const r = checks.recordset[0] || {};
	return {
		imBotConfig: Number(r.hasConfig) > 0,
		imBotConversacion: Number(r.hasConv) > 0,
		imBotMensaje: Number(r.hasMsg) > 0,
		whatsappConfigurado: Number(r.hasWaPhone) > 0,
	};
}

async function verificarMysql(idEmpresa) {
	if (!isAuthCentralEnabled()) return null;
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`SELECT WhatsAppPhoneNumberId, WhatsAppWabaId,
		        CASE WHEN WhatsAppAccessTokenEnc IS NOT NULL AND WhatsAppAccessTokenEnc <> '' THEN 1 ELSE 0 END AS hasToken
		 FROM Empresas WHERE IDEMPRESA = ? LIMIT 1`,
		[Number(idEmpresa)],
	);
	return rows[0] || null;
}

async function runTenantPhase(empresas) {
	if (SKIP_TENANT) {
		console.log('\n=== SQL tenant: omitido (SKIP_TENANT=1) ===');
		return;
	}
	console.log('\n=== SQL Server tenant(s) ===');
	const groups = await agruparPorConexionTenant(empresas);
	const envCfg = SEED_FROM_ENV ? whatsappFromEnv() : null;
	if (SEED_FROM_ENV && !envCfg) {
		console.warn('SEED_WHATSAPP_FROM_ENV=1 pero faltan WHATSAPP_* en .env');
	}
	for (const { probeId, empresas: emps } of groups.values()) {
		const labels = emps.map((e) => `${e.idEmpresa}:${String(e.descripcion || '').trim()}`).join(', ');
		console.log(`\nConexión tenant [${labels}]`);
		const tenantPool = await migrarTenantSql(probeId);
		if (envCfg) {
			for (const emp of emps) {
				await seedWhatsappTenant(tenantPool, emp.idEmpresa, envCfg);
				await seedWhatsappMysql(emp.idEmpresa, envCfg);
			}
		}
	}
}

async function runVerification(empresas) {
	console.log('\n--- Verificación ---');
	for (const emp of empresas) {
		let tenantOk = null;
		try {
			tenantOk = await verificarTenant(emp.idEmpresa);
		} catch (e) {
			tenantOk = { error: e.message };
		}
		const mysqlRow = await verificarMysql(emp.idEmpresa);
		console.log(`\nEmpresa ${emp.idEmpresa} — ${String(emp.descripcion || '').trim()}`);
		if (tenantOk?.error) console.log(`  Tenant SQL: ERROR — ${tenantOk.error}`);
		else if (tenantOk) {
			console.log(
				`  Tenant SQL: imBotConfig=${tenantOk.imBotConfig ? 'OK' : 'NO'} | conversaciones=${tenantOk.imBotConversacion ? 'OK' : 'NO'} | mensajes=${tenantOk.imBotMensaje ? 'OK' : 'NO'} | WhatsApp=${tenantOk.whatsappConfigurado ? 'configurado' : 'pendiente'}`,
			);
		}
		if (mysqlRow) {
			console.log(
				`  MySQL: phone=${mysqlRow.WhatsAppPhoneNumberId || '—'} | waba=${mysqlRow.WhatsAppWabaId || '—'} | token=${mysqlRow.hasToken ? 'cifrado' : '—'}`,
			);
		} else if (isAuthCentralEnabled()) {
			console.log('  MySQL: sin fila');
		} else {
			console.log('  MySQL: no aplica en este perfil');
		}
	}
}

async function runSingleProfile(profileName) {
	applyProfile(profileName);
	if (profileName === 'mysql') loadRailwayEnv();

	console.log(`\n========== ${profileName.toUpperCase()} ==========`);

	let empresas = [];
	if (profileName === 'mysql') {
		await migrarMysqlCentral();
		empresas = filtrarEmpresas(await listarEmpresasMysql());
		if (!empresas.length) empresas = [{ idEmpresa: Number(process.env.BOT_EMPRESA_ID || 1), descripcion: 'default' }];
		const envCfg = SEED_FROM_ENV ? whatsappFromEnv() : null;
		if (envCfg) {
			for (const emp of empresas) await seedWhatsappMysql(emp.idEmpresa, envCfg);
		}
		await runVerification(empresas);
		return;
	}

	if (!process.env.DB_SERVER && !isAuthCentralEnabled()) {
		throw new Error('Falta DB_SERVER o AUTH_DB_*');
	}

	const platformPool = await connectDB();
	empresas = filtrarEmpresas(await listarEmpresasCatalogo(platformPool));
	console.log(`Empresas: ${empresas.map((e) => e.idEmpresa).join(', ') || '(ninguna)'}`);

	await migrarMysqlCentral();
	await runTenantPhase(empresas);
	await runVerification(empresas);
}

(async () => {
	console.log('=== Setup WhatsApp + Bot (multi-tenant) ===');
	if (!SEED_FROM_ENV) process.env.SEED_WHATSAPP_FROM_ENV = '1';

	const profiles =
		PROFILE === 'all'
			? ['local', 'prod', 'mysql']
			: PROFILE === 'current' || PROFILE === 'default'
				? ['current']
				: [PROFILE];

	for (const p of profiles) {
		try {
			await runSingleProfile(p);
		} catch (e) {
			if (p === 'mysql') {
				console.warn(`\n⚠ MySQL Railway omitido: ${e.message}`);
				console.warn('  Creá iMedicWSBack/.env.railway con AUTH_DB_* desde Railway y re-ejecutá:');
				console.warn('  node scripts/setup_whatsapp_bot.js mysql');
			} else {
				throw e;
			}
		}
	}

	console.log('\n=== Listo ===');
	process.exit(0);
})().catch((err) => {
	console.error('Error:', err.message);
	process.exit(1);
});
