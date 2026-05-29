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

function validateAuthDbEnv() {
	const missing = [];
	if (!process.env.AUTH_DB_HOST) missing.push('AUTH_DB_HOST');
	if (!process.env.AUTH_DB_USER) missing.push('AUTH_DB_USER');
	if (!process.env.AUTH_DB_NAME) missing.push('AUTH_DB_NAME');
	return { missing };
}

function logAuthDbEnvStatus() {
	if (!isAuthCentralEnabled()) {
		console.log('ℹ AUTH MySQL: desactivado (modo Render/legacy — login en SQL Server plataforma)');
		return false;
	}
	const { missing } = validateAuthDbEnv();
	if (missing.length > 0) {
		console.error('❌ AUTH MySQL: faltan variables en Railway:', missing.join(', '));
		return false;
	}
	console.log(
		`✓ AUTH MySQL → ${process.env.AUTH_DB_HOST}:${process.env.AUTH_DB_PORT || 3306} / ${process.env.AUTH_DB_NAME}`,
	);
	return true;
}

module.exports = {
	getAuthCentralPool,
	authDbConfig,
	isAuthCentralConfigured,
	isAuthCentralEnabled,
	validateAuthDbEnv,
	logAuthDbEnvStatus,
};
