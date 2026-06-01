const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

let pool = null;

function isTruthy(value) {
	return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/** Variables AUTH_DB_* o las que inyecta Railway al vincular MySQL (MYSQLHOST, …). */
function resolveAuthDbEnv() {
	return {
		host:
			process.env.AUTH_DB_HOST ||
			process.env.MYSQLHOST ||
			process.env.MYSQL_HOST ||
			'',
		port: Number(
			process.env.AUTH_DB_PORT ||
				process.env.MYSQLPORT ||
				process.env.MYSQL_PORT ||
				3306,
		),
		user:
			process.env.AUTH_DB_USER ||
			process.env.MYSQLUSER ||
			process.env.MYSQL_USER ||
			'',
		password:
			process.env.AUTH_DB_PASSWORD ||
			process.env.MYSQLPASSWORD ||
			process.env.MYSQL_PASSWORD ||
			'',
		database:
			process.env.AUTH_DB_NAME ||
			process.env.MYSQLDATABASE ||
			process.env.MYSQL_DATABASE ||
			'',
	};
}

function isAuthCentralConfigured() {
	const { host, user, database } = resolveAuthDbEnv();
	return !!(host && user && database);
}

function isAuthCentralEnabled() {
	if (process.env.AUTH_DB_ENABLED != null && String(process.env.AUTH_DB_ENABLED).trim() !== '') {
		return isTruthy(process.env.AUTH_DB_ENABLED);
	}
	return isAuthCentralConfigured();
}

function authDbConfig() {
	const env = resolveAuthDbEnv();
	const useSsl = isTruthy(process.env.AUTH_DB_SSL);
	return {
		host: env.host,
		port: env.port,
		user: env.user,
		password: env.password,
		database: env.database,
		waitForConnections: true,
		connectionLimit: Number(process.env.AUTH_DB_POOL_MAX || 10),
		queueLimit: 0,
		charset: 'utf8mb4',
		ssl: useSsl ? { rejectUnauthorized: false } : undefined,
	};
}

async function getAuthCentralPool() {
	if (!isAuthCentralEnabled()) {
		const err = new Error('AUTH_DB no configurada');
		err.code = 'AUTH_DB_DISABLED';
		throw err;
	}
	if (pool) return pool;
	pool = mysql.createPool(authDbConfig());
	return pool;
}

function validateAuthDbEnv() {
	const env = resolveAuthDbEnv();
	const missing = [];
	if (!env.host) missing.push('AUTH_DB_HOST (o MYSQLHOST de Railway)');
	if (!env.user) missing.push('AUTH_DB_USER (o MYSQLUSER)');
	if (!env.database) missing.push('AUTH_DB_NAME (o MYSQLDATABASE)');
	return { missing, env };
}

async function testAuthCentralConnection() {
	const pool = await getAuthCentralPool();
	await pool.query('SELECT 1 AS ok');
}

function logAuthDbEnvStatus() {
	if (
		process.env.AUTH_DB_ENABLED != null &&
		String(process.env.AUTH_DB_ENABLED).trim() !== '' &&
		!isTruthy(process.env.AUTH_DB_ENABLED)
	) {
		console.error('❌ AUTH MySQL: AUTH_DB_ENABLED=0 — el login usará SQL plataforma (DB_*)');
		return false;
	}
	if (!isAuthCentralEnabled()) {
		console.log('ℹ AUTH MySQL: desactivado — configurá AUTH_DB_* o vinculá MySQL en Railway');
		return false;
	}
	const { missing, env } = validateAuthDbEnv();
	if (missing.length > 0) {
		console.error('❌ AUTH MySQL: faltan variables:', missing.join(', '));
		console.error('   En Railway: Variables del servicio backend o referencia ${{MySQL.MYSQLHOST}}');
		return false;
	}
	console.log(`✓ AUTH MySQL → ${env.host}:${env.port} / ${env.database}`);
	return true;
}

module.exports = {
	getAuthCentralPool,
	authDbConfig,
	resolveAuthDbEnv,
	isAuthCentralConfigured,
	isAuthCentralEnabled,
	validateAuthDbEnv,
	logAuthDbEnvStatus,
	testAuthCentralConnection,
};
