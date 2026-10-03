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

const { TtlCache } = require('../utils/ttlCache');
const { sumarCacheHit } = require('../context/requestTiming');

let tablesReady = false;
let idleMinutesCache = { value: DEFAULT_IDLE_MINUTES, at: 0 };

/**
 * Cache de filas AuthSessions: evita SELECT + UPDATE en MySQL por cada request.
 * - La fila se relee de MySQL cada SESSION_CACHE_MS (30 s).
 * - LastActivityAt se actualiza en memoria en cada request y se persiste
 *   como máximo una vez cada SESSION_TOUCH_MS (60 s) por sesión.
 * - revoke/rotate/logout purgan la entrada en este proceso.
 * Efecto: una revocación hecha desde otra instancia tarda ≤ SESSION_CACHE_MS
 * en verse; el idle real puede quedar hasta SESSION_TOUCH_MS atrasado en BD
 * si el proceso se reinicia (irrelevante con idle ≥ 5 min).
 */
// Sesión en memoria 30 s (revocaciones locales son inmediatas); LastActivityAt se persiste cada 60 s.
const SESSION_CACHE_MS = 30_000;
const SESSION_TOUCH_MS = 60_000;
const sessionCache = new TtlCache({ ttlMs: SESSION_CACHE_MS, max: 20_000, nombre: 'session' });
/** sessionId -> timestamp del último UPDATE LastActivityAt persistido. */
const ultimoTouchPersistido = new Map();

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
	// Front y API en hosts distintos (Railway/Vercel): hace falta None+Secure.
	// En local (http) usamos Lax; None sin Secure lo rechazan los browsers.
	const raw = String(process.env.COOKIE_SAMESITE || '').toLowerCase();
	let sameSite = raw === 'strict' || raw === 'lax' || raw === 'none' ? raw : secure ? 'none' : 'lax';
	if (sameSite === 'none' && !secure) sameSite = 'lax';
	return {
		httpOnly: true,
		secure,
		sameSite,
		path: '/',
		...(maxAgeMs != null ? { maxAge: maxAgeMs } : {}),
	};
}

function setAuthCookies(res, accessToken, refreshToken) {
	const maxRefresh = SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000;
	res.cookie(COOKIE_ACCESS, accessToken, cookieOptions(maxRefresh));
	res.cookie(COOKIE_REFRESH, refreshToken, { ...cookieOptions(maxRefresh), path: '/api/auth' });
}

function setAccessCookie(res, accessToken) {
	const maxRefresh = SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000;
	res.cookie(COOKIE_ACCESS, accessToken, cookieOptions(maxRefresh));
}

function clearAuthCookies(res) {
	const base = cookieOptions();
	res.clearCookie(COOKIE_ACCESS, {
		path: '/',
		secure: base.secure,
		sameSite: base.sameSite,
		httpOnly: true,
	});
	res.clearCookie(COOKIE_REFRESH, {
		path: '/api/auth',
		secure: base.secure,
		sameSite: base.sameSite,
		httpOnly: true,
	});
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

async function getSessionAnyDesdeDb(sessionId) {
	if (!sessionId || !isAuthCentralEnabled()) return null;
	await ensureTables();
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(`SELECT * FROM AuthSessions WHERE SessionId = ? LIMIT 1`, [
		String(sessionId),
	]);
	return rows[0] || null;
}

/**
 * Fila de sesión (revocadas incluidas). Usa el cache en memoria; pasar
 * `{ fresco: true }` para forzar lectura de MySQL (logout, refresh, auditoría).
 */
async function getSessionAny(sessionId, opts = {}) {
	if (!sessionId || !isAuthCentralEnabled()) return null;
	const key = String(sessionId);
	if (!opts.fresco && SESSION_CACHE_MS > 0) {
		const hit = sessionCache.get(key);
		if (hit !== undefined) {
			sumarCacheHit();
			return hit;
		}
		return sessionCache.getOrLoad(key, () => getSessionAnyDesdeDb(key));
	}
	const row = await getSessionAnyDesdeDb(key);
	if (SESSION_CACHE_MS > 0) {
		if (row) sessionCache.set(key, row);
		else sessionCache.delete(key);
	}
	return row;
}

async function getSession(sessionId) {
	const row = await getSessionAny(sessionId);
	if (!row || Number(row.Revoked) === 1) return null;
	return row;
}

function olvidarSesion(sessionId) {
	if (!sessionId) return;
	sessionCache.delete(String(sessionId));
	ultimoTouchPersistido.delete(String(sessionId));
}

/**
 * Marca actividad. Siempre actualiza la copia en memoria; escribe en MySQL
 * sólo si pasaron más de SESSION_TOUCH_MS desde el último UPDATE (o si se
 * pide `{ forzar: true }`).
 */
async function touchSession(sessionId, opts = {}) {
	if (!sessionId) return;
	const key = String(sessionId);
	const ahora = Date.now();
	const cached = sessionCache.get(key);
	if (cached) cached.LastActivityAt = new Date(ahora);

	const ultimo = ultimoTouchPersistido.get(key) || 0;
	if (!opts.forzar && SESSION_TOUCH_MS > 0 && ahora - ultimo < SESSION_TOUCH_MS) return;
	ultimoTouchPersistido.set(key, ahora);
	if (ultimoTouchPersistido.size > 50_000) {
		// Limpieza barata: descartar la mitad más vieja.
		const keys = [...ultimoTouchPersistido.keys()].slice(0, 25_000);
		for (const k of keys) ultimoTouchPersistido.delete(k);
	}
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthSessions SET LastActivityAt = NOW() WHERE SessionId = ?`, [key]);
}

function isIdleExpired(row, idleMinutes) {
	const idleMs = idleMinutes * 60 * 1000;
	return Date.now() - new Date(row.LastActivityAt).getTime() > idleMs;
}

/**
 * Evalúa la sesión sin ocultar el motivo (idle vs logout vs vencimiento absoluta).
 */
async function evaluateSession(sessionId) {
	if (!sessionId) return { ok: false, reason: 'missing', session: null };
	const row = await getSessionAny(sessionId);
	if (!row) return { ok: false, reason: 'missing', session: null };

	const idleMinutes = await getIdleTimeoutMinutes(row.IdEmpresa);
	if (Number(row.Revoked) === 1) {
		return { ok: false, reason: isIdleExpired(row, idleMinutes) ? 'idle' : 'revoked', session: row };
	}

	if (new Date(row.ExpiresAt).getTime() < Date.now()) {
		await revokeSession(sessionId);
		return { ok: false, reason: 'expired', session: row };
	}

	if (isIdleExpired(row, idleMinutes)) {
		await revokeSession(sessionId);
		return { ok: false, reason: 'idle', session: row };
	}

	await touchSession(sessionId);
	return { ok: true, reason: 'ok', session: row };
}

async function validateSession(sessionId) {
	const result = await evaluateSession(sessionId);
	return result.ok ? result.session : null;
}

async function revokeSession(sessionId) {
	if (!sessionId) return;
	olvidarSesion(sessionId);
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthSessions SET Revoked = 1 WHERE SessionId = ?`, [String(sessionId)]);
}

async function revokeByRefreshToken(refreshToken) {
	if (!refreshToken) return;
	const hash = hashToken(refreshToken);
	// Purga las entradas cacheadas con ese refresh (normalmente una).
	for (const [key, entry] of sessionCache.map) {
		if (entry?.valor?.RefreshTokenHash === hash) olvidarSesion(key);
	}
	const pool = await getAuthCentralPool();
	await pool.query(`UPDATE AuthSessions SET Revoked = 1 WHERE RefreshTokenHash = ?`, [hash]);
}

async function rotateRefresh(sessionId, oldRefreshToken) {
	await ensureTables();
	olvidarSesion(sessionId);
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
	setAccessCookie,
	clearAuthCookies,
	createSession,
	getSession,
	getSessionAny,
	evaluateSession,
	validateSession,
	revokeSession,
	revokeByRefreshToken,
	rotateRefresh,
	touchSession,
	olvidarSesion,
	COOKIE_ACCESS,
	COOKIE_REFRESH,
};
