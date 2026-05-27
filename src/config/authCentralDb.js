const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

let pool = null;

function isTruthy(value) {
	return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isAuthCentralConfigured() {
	return !!(
		process.env.AUTH_DB_HOST &&
		process.env.AUTH_DB_USER &&
		process.env.AUTH_DB_NAME
	);
}

function isAuthCentralEnabled() {
	if (process.env.AUTH_DB_ENABLED != null && String(process.env.AUTH_DB_ENABLED).trim() !== '') {
		return isTruthy(process.env.AUTH_DB_ENABLED);
	}
	return isAuthCentralConfigured();
}

function authDbConfig() {
	const useSsl = isTruthy(process.env.AUTH_DB_SSL);
	return {
		host: process.env.AUTH_DB_HOST,
		port: Number(process.env.AUTH_DB_PORT || 3306),
		user: process.env.AUTH_DB_USER,
		password: process.env.AUTH_DB_PASSWORD || '',
		database: process.env.AUTH_DB_NAME,
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

module.exports = {
	getAuthCentralPool,
	authDbConfig,
	isAuthCentralConfigured,
	isAuthCentralEnabled,
};
