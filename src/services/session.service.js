/**
 * Sesiones con cookies httpOnly, expiración por inactividad y refresh rotativo.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const { JWT_SECRET, ACCESS_TOKEN_EXPIRATION } = require('../config/jwt');
const {
	COOKIE_ACCESS,
	COOKIE_REFRESH,
	DEFAULT_IDLE_MINUTES,
	SESSION_ABSOLUTE_DAYS,
	hashToken,
} = require('../config/security');

let tablesReady = false;
let idleMinutesCache = { value: DEFAULT_IDLE_MINUTES, at: 0 };

async function ensureTables() {
	if (!isAuthCentralEnabled() || tablesReady) return;
	const pool = await getAuthCentralPool();
	await pool.query(`
    CREATE TABLE IF NOT EXISTS AuthSessions (
      SessionId VARCHAR(36) PRIMARY KEY,
      ValorPersonal INT NOT NULL,
      Username VARCHAR(128) NOT NULL,
      IdEmpresa INT NULL,
      RefreshTokenHash VARCHAR(128) NOT NULL,
      LastActivityAt DATETIME NOT NULL,
      ExpiresAt DATETIME NOT NULL,
      Revoked TINYINT(1) NOT NULL DEFAULT 0,
      UserAgent VARCHAR(512) NULL,
      Ip VARCHAR(45) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_vp (ValorPersonal),
      INDEX idx_sessions_refresh (RefreshTokenHash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	tablesReady = true;
}

async function getIdleTimeoutMinutes(idEmpresa = null) {
	const now = Date.now();
	if (now - idleMinutesCache.at < 60_000) return idleMinutesCache.value;
	let minutes = DEFAULT_IDLE_MINUTES;
	if (isAuthCentralEnabled()) {
		try {
			const pool = await getAuthCentralPool();
			const [rows] = await pool.query(
				`SELECT Valor FROM imPlataformaConfig WHERE Clave = 'SESSION_IDLE_MINUTES' LIMIT 1`,
			);
			if (rows[0]?.Valor != null && Number.isFinite(Number(rows[0].Valor))) {
				minutes = Math.max(5, Math.min(480, Number(rows[0].Valor)));
			}
			if (idEmpresa != null) {
				const [empRows] = await pool.query(
					`SELECT SessionIdleMinutes FROM Empresas WHERE IDEMPRESA = ? LIMIT 1`,
					[Number(idEmpresa)],
				);
				if (
					empRows[0]?.SessionIdleMinutes != null &&
					Number.isFinite(Number(empRows[0].SessionIdleMinutes))
				) {
					minutes = Math.max(5, Math.min(480, Number(empRows[0].SessionIdleMinutes)));
				}
			}
		} catch {
			/* tabla/columna opcional */
		}
	}
	idleMinutesCache = { value: minutes, at: now };
	return minutes;
}

function signAccessToken(payload) {
	return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRATION });
}

function cookieOptions(maxAgeMs) {
	const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';
	return {
		httpOnly: true,
		secure,
		sameSite: 'strict',
		path: '/',
		...(maxAgeMs != null ? { maxAge: maxAgeMs } : {}),
	};
}

function setAuthCookies(res, accessToken, refreshToken) {
	const maxRefresh = SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000;
	res.cookie(COOKIE_ACCESS, accessToken, cookieOptions(maxRefresh));
	res.cookie(COOKIE_REFRESH, refreshToken, { ...cookieOptions(maxRefresh), path: '/api/auth' });
}

function clearAuthCookies(res) {
	res.clearCookie(COOKIE_ACCESS, { path: '/' });
	res.clearCookie(COOKIE_REFRESH, { path: '/api/auth' });
}

async function createSession({ valorPersonal, username, idEmpresa, ip, userAgent, jwtPayload }) {
	await ensureTables();
	const pool = await getAuthCentralPool();
	const sessionId = uuidv4();
	const refreshToken = crypto.randomBytes(48).toString('hex');
	const refreshHash = hashToken(refreshToken);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000);

	await pool.query(
		`INSERT INTO AuthSessions
      (SessionId, ValorPersonal, Username, IdEmpresa, RefreshTokenHash, LastActivityAt, ExpiresAt, UserAgent, Ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			sessionId,
			Number(valorPersonal),
			String(username || '').slice(0, 128),
			idEmpresa != null ? Number(idEmpresa) : null,
			refreshHash,
			now,
			expiresAt,
			userAgent ? String(userAgent).slice(0, 512) : null,
			ip ? String(ip).slice(0, 45) : null,
		],
	);

	const accessToken = signAccessToken({ ...jwtPayload, sessionId });
	return { accessToken, refreshToken, sessionId };
}

async function getSession(sessionId) {
	if (!sessionId || !isAuthCentralEnabled()) return null;
	await ensureTables();
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`SELECT * FROM AuthSessions WHERE SessionId = ? AND Revoked = 0 LIMIT 1`,
		[String(sessionId)],
	);
	return rows[0] || null;
}

async function touchSession(sessionId) {
	if (!sessionId) return;
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthSessions SET LastActivityAt = NOW() WHERE SessionId = ?`, [
		String(sessionId),
	]);
}

async function validateSession(sessionId) {
	const row = await getSession(sessionId);
	if (!row) return null;
	const now = Date.now();
	if (new Date(row.ExpiresAt).getTime() < now) {
		await revokeSession(sessionId);
		return null;
	}
	const idleMinutes = await getIdleTimeoutMinutes(row.IdEmpresa);
	const idleMs = idleMinutes * 60 * 1000;
	if (now - new Date(row.LastActivityAt).getTime() > idleMs) {
		await revokeSession(sessionId);
		return null;
	}
	await touchSession(sessionId);
	return row;
}

async function revokeSession(sessionId) {
	if (!sessionId) return;
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthSessions SET Revoked = 1 WHERE SessionId = ?`, [String(sessionId)]);
}

async function revokeByRefreshToken(refreshToken) {
	if (!refreshToken) return;
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthSessions SET Revoked = 1 WHERE RefreshTokenHash = ?`, [
		hashToken(refreshToken),
	]);
}

async function rotateRefresh(sessionId, oldRefreshToken) {
	await ensureTables();
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`SELECT * FROM AuthSessions WHERE SessionId = ? AND RefreshTokenHash = ? AND Revoked = 0 LIMIT 1`,
		[String(sessionId), hashToken(oldRefreshToken)],
	);
	const row = rows[0];
	if (!row) return null;

	const newRefresh = crypto.randomBytes(48).toString('hex');
	await pool.query(
		`UPDATE AuthSessions SET RefreshTokenHash = ?, LastActivityAt = NOW() WHERE SessionId = ?`,
		[hashToken(newRefresh), String(sessionId)],
	);
	return { sessionRow: row, refreshToken: newRefresh };
}

module.exports = {
	ensureTables,
	getIdleTimeoutMinutes,
	signAccessToken,
	setAuthCookies,
	clearAuthCookies,
	createSession,
	validateSession,
	revokeSession,
	revokeByRefreshToken,
	rotateRefresh,
	touchSession,
	COOKIE_ACCESS,
	COOKIE_REFRESH,
};
