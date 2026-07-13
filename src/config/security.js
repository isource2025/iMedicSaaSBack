/**
 * Constantes y utilidades de seguridad compartidas.
 */
const crypto = require('crypto');

const AUTH_FAIL_MESSAGE = 'Usuario o contraseña incorrectos';

const TIMING_PAD_MS = Number(process.env.AUTH_TIMING_PAD_MS) || 350;

const DEFAULT_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 30;

const SESSION_ABSOLUTE_DAYS = Number(process.env.SESSION_ABSOLUTE_DAYS) || 7;

const TEMP_TOKEN_EXPIRATION = '5m';

const COOKIE_ACCESS = 'imedic_access';

const COOKIE_REFRESH = 'imedic_refresh';

function usernameHash(username) {
	return crypto
		.createHash('sha256')
		.update(String(username || '').trim().toLowerCase())
		.digest('hex');
}

function hashToken(token) {
	return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getClientIp(req) {
	const xf = req.headers['x-forwarded-for'];
	if (typeof xf === 'string' && xf.trim()) {
		return xf.split(',')[0].trim();
	}
	if (Array.isArray(xf) && xf[0]) return String(xf[0]).trim();
	return req.ip || req.socket?.remoteAddress || '';
}

function isLocalIp(ip) {
	const s = String(ip || '');
	return (
		s === '127.0.0.1' ||
		s === '::1' ||
		s === '::ffff:127.0.0.1' ||
		s.startsWith('192.168.') ||
		s.startsWith('10.') ||
		/^172\.(1[6-9]|2\d|3[0-1])\./.test(s)
	);
}

async function timingPad(startedAt) {
	const elapsed = Date.now() - (startedAt || Date.now());
	const wait = TIMING_PAD_MS - elapsed;
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function assertJwtSecret() {
	if (process.env.NODE_ENV !== 'production') return;
	if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).trim().length < 32) {
		throw new Error('JWT_SECRET obligatorio en producción (mínimo 32 caracteres)');
	}
}

module.exports = {
	AUTH_FAIL_MESSAGE,
	TIMING_PAD_MS,
	DEFAULT_IDLE_MINUTES,
	SESSION_ABSOLUTE_DAYS,
	TEMP_TOKEN_EXPIRATION,
	COOKIE_ACCESS,
	COOKIE_REFRESH,
	usernameHash,
	hashToken,
	getClientIp,
	isLocalIp,
	timingPad,
	assertJwtSecret,
};
