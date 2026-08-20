/**
 * Product analytics de plataforma (MySQL AUTH_DB).
 *
 * Separado de AuthAuditLog (seguridad) y de las tablas clínicas del tenant.
 * Identidad: UserHash (HMAC de ValorPersonal), nunca userId/username.
 */
const crypto = require('crypto');
const { isAuthCentralEnabled, getAuthCentralPool } = require('../config/authCentralDb');
const { JWT_SECRET } = require('../config/jwt');

const EVENT_TYPES = Object.freeze({
	SESSION_EXPIRED: 'SESSION_EXPIRED',
	MODAL_VIEWED: 'MODAL_VIEWED',
	LOGIN_CLICKED: 'LOGIN_CLICKED',
	MODAL_DISMISSED: 'MODAL_DISMISSED',
	SESSION_REAUTH: 'SESSION_REAUTH',
	LOGIN: 'LOGIN',
	LOGOUT: 'LOGOUT',
	SPONSOR_IMPRESSION: 'SPONSOR_IMPRESSION',
	SPONSOR_CLICK: 'SPONSOR_CLICK',
});

/** Eventos que el front puede emitir (funnel del modal de inactividad). */
const CLIENT_EVENT_TYPES = new Set([
	EVENT_TYPES.SESSION_EXPIRED,
	EVENT_TYPES.MODAL_VIEWED,
	EVENT_TYPES.LOGIN_CLICKED,
	EVENT_TYPES.MODAL_DISMISSED,
]);

/** Un evento de este tipo por SessionId (idempotencia del funnel). */
const ONCE_PER_SESSION = new Set([
	EVENT_TYPES.SESSION_EXPIRED,
	EVENT_TYPES.MODAL_VIEWED,
	EVENT_TYPES.LOGIN_CLICKED,
	EVENT_TYPES.MODAL_DISMISSED,
	EVENT_TYPES.LOGIN,
	EVENT_TYPES.LOGOUT,
	EVENT_TYPES.SESSION_REAUTH,
]);

let tablesReady = false;

function hashUser(valorPersonal) {
	if (valorPersonal == null || !Number.isFinite(Number(valorPersonal))) return null;
	const secret = process.env.ANALYTICS_HASH_SECRET || JWT_SECRET || 'imedic-analytics';
	return crypto.createHmac('sha256', String(secret)).update(`vp:${Number(valorPersonal)}`).digest('hex');
}

function classifyDevice(userAgent) {
	const s = String(userAgent || '').toLowerCase();
	if (!s) return 'unknown';
	if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
	if (/mobi|iphone|ipod|android.+mobile|windows phone/.test(s)) return 'mobile';
	return 'desktop';
}

function sanitizeMetadata(raw, userAgent) {
	const out = {};
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const dwell = Number(raw.dwellMs);
		if (Number.isFinite(dwell) && dwell >= 0 && dwell <= 24 * 60 * 60 * 1000) {
			out.dwellMs = Math.round(dwell);
		}
		const ver = String(raw.appVersion || '').trim().slice(0, 32);
		if (ver) out.appVersion = ver;
		if (raw.source === 'server' || raw.source === 'client') out.source = raw.source;
		if (raw.expiredSessionId && String(raw.expiredSessionId).length <= 36) {
			out.expiredSessionId = String(raw.expiredSessionId);
		}
	}
	out.device = classifyDevice(userAgent);
	return out;
}

function normalizeRole(role) {
	const r = String(role || '').trim().toUpperCase();
	return r ? r.slice(0, 40) : null;
}

async function ensureTables() {
	if (!isAuthCentralEnabled() || tablesReady) return;
	const pool = await getAuthCentralPool();
	await pool.query(`
    CREATE TABLE IF NOT EXISTS AnalyticsEvents (
      Id BIGINT AUTO_INCREMENT PRIMARY KEY,
      EventType VARCHAR(64) NOT NULL,
      UserHash VARCHAR(64) NULL,
      IdEmpresa INT NULL,
      Role VARCHAR(40) NULL,
      SessionId VARCHAR(36) NULL,
      Metadata JSON NULL,
      UserAgent VARCHAR(512) NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_analytics_type_created (EventType, CreatedAt),
      INDEX idx_analytics_empresa_created (IdEmpresa, CreatedAt),
      INDEX idx_analytics_session_type (SessionId, EventType),
      INDEX idx_analytics_userhash (UserHash),
      INDEX idx_analytics_role (Role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
	tablesReady = true;
}

async function findExisting(pool, eventType, sessionId) {
	if (!sessionId || !ONCE_PER_SESSION.has(eventType)) return null;
	const [rows] = await pool.query(
		`SELECT Id, UserHash, IdEmpresa, Role FROM AnalyticsEvents
     WHERE EventType = ? AND SessionId = ? LIMIT 1`,
		[eventType, String(sessionId).slice(0, 36)],
	);
	return rows[0] || null;
}

async function copyContextFromSession(pool, sessionId) {
	if (!sessionId) return {};
	const [rows] = await pool.query(
		`SELECT UserHash, IdEmpresa, Role FROM AnalyticsEvents
     WHERE SessionId = ? AND UserHash IS NOT NULL
     ORDER BY Id ASC LIMIT 1`,
		[String(sessionId).slice(0, 36)],
	);
	return rows[0] || {};
}

/**
 * Inserta un evento. Nunca lanza: analytics no debe romper login/timeout.
 */
async function trackEvent({
	eventType,
	sessionId = null,
	valorPersonal = null,
	idEmpresa = null,
	role = null,
	metadata = null,
	userAgent = null,
}) {
	if (!isAuthCentralEnabled()) return { ok: false, skipped: true };
	const type = String(eventType || '').trim().toUpperCase();
	if (!Object.values(EVENT_TYPES).includes(type)) return { ok: false, skipped: true };

	try {
		await ensureTables();
		const pool = await getAuthCentralPool();
		const sid = sessionId ? String(sessionId).slice(0, 36) : null;
		if (sid && ONCE_PER_SESSION.has(type)) {
			const existing = await findExisting(pool, type, sid);
			if (existing) return { ok: true, duplicate: true, id: existing.Id };
		}

		const prior = sid ? await copyContextFromSession(pool, sid) : {};
		const userHash = hashUser(valorPersonal) || prior.UserHash || null;
		const empresa =
			idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0
				? Number(idEmpresa)
				: prior.IdEmpresa != null
					? Number(prior.IdEmpresa)
					: null;
		const rol = normalizeRole(role) || normalizeRole(prior.Role);
		const meta = sanitizeMetadata(metadata, userAgent);
		const ua = userAgent ? String(userAgent).slice(0, 512) : null;

		const [result] = await pool.query(
			`INSERT INTO AnalyticsEvents
        (EventType, UserHash, IdEmpresa, Role, SessionId, Metadata, UserAgent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[type, userHash, empresa, rol, sid, JSON.stringify(meta), ua],
		);
		return { ok: true, id: result.insertId };
	} catch (e) {
		console.warn('[analytics] trackEvent:', e.message);
		return { ok: false, error: e.message };
	}
}

async function trackIdleExpiration({ decoded, session, userAgent }) {
	const vpCandidates = [];
	const u = decoded?.usuario || {};
	for (const c of [u.id, u.idValorpersonal, u.idValorPersonal, u.valorPersonal, session?.ValorPersonal]) {
		const n = c != null && c !== '' ? Number(c) : NaN;
		if (Number.isFinite(n) && n > 0) vpCandidates.push(n);
	}
	return trackEvent({
		eventType: EVENT_TYPES.SESSION_EXPIRED,
		sessionId: decoded?.sessionId || session?.SessionId,
		valorPersonal: vpCandidates[0] || null,
		idEmpresa: session?.IdEmpresa ?? decoded?.idEmpresa,
		role: decoded?.rol?.nombre,
		userAgent: userAgent || session?.UserAgent,
		metadata: { source: 'server' },
	});
}

async function trackReauthIfExpired({ valorPersonal, sessionId, idEmpresa, role, userAgent }) {
	if (!isAuthCentralEnabled()) return;
	const userHash = hashUser(valorPersonal);
	if (!userHash) return;
	try {
		await ensureTables();
		const pool = await getAuthCentralPool();
		const [expired] = await pool.query(
			`SELECT SessionId, CreatedAt FROM AnalyticsEvents
       WHERE EventType = ? AND UserHash = ?
         AND CreatedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY CreatedAt DESC LIMIT 1`,
			[EVENT_TYPES.SESSION_EXPIRED, userHash],
		);
		const last = expired[0];
		if (!last) return;
		if (sessionId && String(last.SessionId) === String(sessionId)) return;

		const [already] = await pool.query(
			`SELECT Id FROM AnalyticsEvents
       WHERE EventType = ? AND UserHash = ? AND CreatedAt >= ?
       LIMIT 1`,
			[EVENT_TYPES.SESSION_REAUTH, userHash, last.CreatedAt],
		);
		if (already[0]) return;

		await trackEvent({
			eventType: EVENT_TYPES.SESSION_REAUTH,
			sessionId,
			valorPersonal,
			idEmpresa,
			role,
			userAgent,
			metadata: { expiredSessionId: last.SessionId, source: 'server' },
		});
	} catch (e) {
		console.warn('[analytics] trackReauth:', e.message);
	}
}

function parseDateBound(value, endOfDay) {
	if (!value) return null;
	const s = String(value).trim();
	if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
	const day = s.slice(0, 10);
	return endOfDay ? `${day} 23:59:59` : `${day} 00:00:00`;
}

function defaultRange() {
	const to = new Date();
	const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
	const iso = (d) => d.toISOString().slice(0, 10);
	return { from: iso(from), to: iso(to) };
}

function pct(part, total) {
	if (!total) return 0;
	return Math.round((Number(part) / Number(total)) * 10000) / 100;
}

async function getSessionExpirationStats({ from, to, idEmpresa, role } = {}) {
	if (!isAuthCentralEnabled()) {
		const err = new Error('Analítica requiere la base de plataforma (AUTH_DB)');
		err.statusCode = 503;
		throw err;
	}
	await ensureTables();
	const pool = await getAuthCentralPool();
	const range = defaultRange();
	const fromBound = parseDateBound(from, false) || `${range.from} 00:00:00`;
	const toBound = parseDateBound(to, true) || `${range.to} 23:59:59`;
	const empresaFilter =
		idEmpresa != null && String(idEmpresa).trim() !== '' && Number.isFinite(Number(idEmpresa))
			? Number(idEmpresa)
			: null;
	const roleFilter = normalizeRole(role);

	function buildWhere(alias = '') {
		const col = (name) => (alias ? `${alias}.${name}` : name);
		const parts = [`${col('CreatedAt')} >= ?`, `${col('CreatedAt')} <= ?`];
		const values = [fromBound, toBound];
		if (empresaFilter != null) {
			parts.push(`${col('IdEmpresa')} = ?`);
			values.push(empresaFilter);
		}
		if (roleFilter) {
			parts.push(`${col('Role')} = ?`);
			values.push(roleFilter);
		}
		return { sql: parts.join(' AND '), values };
	}

	const where = buildWhere();
	const whereSql = where.sql;
	const params = where.values;

	const [[kpis]] = await pool.query(
		`SELECT
        SUM(EventType = 'SESSION_EXPIRED') AS totalExpirations,
        COUNT(DISTINCT CASE WHEN EventType = 'SESSION_EXPIRED' THEN UserHash END) AS uniqueUsers,
        COUNT(DISTINCT CASE WHEN EventType = 'SESSION_EXPIRED' THEN IdEmpresa END) AS uniqueEmpresas,
        SUM(EventType = 'MODAL_VIEWED') AS modalViews,
        SUM(EventType = 'LOGIN_CLICKED') AS loginClicks,
        SUM(EventType = 'MODAL_DISMISSED') AS modalDismissals,
        SUM(EventType = 'SESSION_REAUTH') AS reauthCount,
        SUM(EventType = 'LOGIN') AS logins,
        SUM(EventType = 'LOGOUT') AS logouts,
        AVG(CASE
          WHEN EventType IN ('LOGIN_CLICKED', 'MODAL_DISMISSED')
            AND JSON_EXTRACT(Metadata, '$.dwellMs') IS NOT NULL
          THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(Metadata, '$.dwellMs')) AS UNSIGNED)
        END) AS avgModalDwellMs
      FROM AnalyticsEvents
      WHERE ${whereSql}`,
		params,
	);

	const totalExpirations = Number(kpis?.totalExpirations || 0);
	const uniqueUsers = Number(kpis?.uniqueUsers || 0);
	const uniqueEmpresas = Number(kpis?.uniqueEmpresas || 0);
	const modalViews = Number(kpis?.modalViews || 0);
	const loginClicks = Number(kpis?.loginClicks || 0);
	const modalDismissals = Number(kpis?.modalDismissals || 0);
	const reauthCount = Number(kpis?.reauthCount || 0);
	const logins = Number(kpis?.logins || 0);
	const logouts = Number(kpis?.logouts || 0);
	const avgModalDwellMs = kpis?.avgModalDwellMs != null ? Math.round(Number(kpis.avgModalDwellMs)) : 0;

	const [byDayRows] = await pool.query(
		`SELECT DATE_FORMAT(CreatedAt, '%Y-%m-%d') AS dia,
        SUM(EventType = 'SESSION_EXPIRED') AS expirations,
        SUM(EventType = 'LOGIN_CLICKED') AS loginClicks,
        SUM(EventType = 'LOGIN') AS logins
      FROM AnalyticsEvents
      WHERE ${whereSql}
      GROUP BY DATE_FORMAT(CreatedAt, '%Y-%m-%d')
      ORDER BY dia ASC`,
		params,
	);

	const [byRoleRows] = await pool.query(
		`SELECT COALESCE(NULLIF(Role, ''), 'OTROS') AS role,
        SUM(EventType = 'SESSION_EXPIRED') AS count
      FROM AnalyticsEvents
      WHERE ${whereSql} AND EventType = 'SESSION_EXPIRED'
      GROUP BY COALESCE(NULLIF(Role, ''), 'OTROS')
      ORDER BY count DESC`,
		params,
	);

	const whereE = buildWhere('e');
	const [byEmpresaRows] = await pool.query(
		`SELECT e.IdEmpresa AS idEmpresa,
        COALESCE(emp.DESCRIPCION, CONCAT('Empresa ', e.IdEmpresa)) AS nombre,
        SUM(e.EventType = 'SESSION_EXPIRED') AS expirations,
        COUNT(DISTINCT CASE WHEN e.EventType = 'SESSION_EXPIRED' THEN e.UserHash END) AS uniqueUsers
      FROM AnalyticsEvents e
      LEFT JOIN Empresas emp ON emp.IDEMPRESA = e.IdEmpresa
      WHERE ${whereE.sql}
        AND e.EventType = 'SESSION_EXPIRED'
        AND e.IdEmpresa IS NOT NULL
      GROUP BY e.IdEmpresa, emp.DESCRIPCION
      ORDER BY expirations DESC
      LIMIT 50`,
		whereE.values,
	);

	const [byDeviceRows] = await pool.query(
		`SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(Metadata, '$.device')), 'unknown') AS device,
        SUM(EventType = 'SESSION_EXPIRED') AS count
      FROM AnalyticsEvents
      WHERE ${whereSql} AND EventType = 'SESSION_EXPIRED'
      GROUP BY COALESCE(JSON_UNQUOTE(JSON_EXTRACT(Metadata, '$.device')), 'unknown')
      ORDER BY count DESC`,
		params,
	);

	const roleTotal = byRoleRows.reduce((acc, r) => acc + Number(r.count || 0), 0);
	const byRole = byRoleRows.map((r) => ({
		role: String(r.role || 'OTROS'),
		count: Number(r.count || 0),
		pct: pct(r.count, roleTotal || totalExpirations),
	}));

	let activeNow = { sessions: 0, users: 0, empresas: 0 };
	try {
		const sessionService = require('./session.service');
		const idleMinutes = await sessionService.getIdleTimeoutMinutes(empresaFilter);
		const activeWhere = ['Revoked = 0', 'LastActivityAt >= DATE_SUB(NOW(), INTERVAL ? MINUTE)'];
		const activeParams = [idleMinutes];
		if (empresaFilter != null) {
			activeWhere.push('IdEmpresa = ?');
			activeParams.push(empresaFilter);
		}
		const [[active]] = await pool.query(
			`SELECT COUNT(*) AS sessions,
          COUNT(DISTINCT ValorPersonal) AS users,
          COUNT(DISTINCT IdEmpresa) AS empresas
        FROM AuthSessions
        WHERE ${activeWhere.join(' AND ')}`,
			activeParams,
		);
		activeNow = {
			sessions: Number(active?.sessions || 0),
			users: Number(active?.users || 0),
			empresas: Number(active?.empresas || 0),
		};
	} catch (e) {
		console.warn('[analytics] activeNow:', e.message);
	}

	return {
		from: fromBound.slice(0, 10),
		to: toBound.slice(0, 10),
		totalExpirations,
		uniqueUsers,
		uniqueEmpresas,
		modalViews,
		loginClicks,
		modalDismissals,
		conversionRate: pct(loginClicks, totalExpirations || modalViews),
		reauthCount,
		reauthRate: pct(reauthCount, totalExpirations),
		avgModalDwellMs,
		potentialImpressions: totalExpirations,
		logins,
		logouts,
		activeNow,
		byDay: byDayRows.map((r) => ({
			date: r.dia,
			expirations: Number(r.expirations || 0),
			loginClicks: Number(r.loginClicks || 0),
			logins: Number(r.logins || 0),
		})),
		byRole,
		byEmpresa: byEmpresaRows.map((r) => ({
			idEmpresa: Number(r.idEmpresa),
			nombre: String(r.nombre || `Empresa ${r.idEmpresa}`),
			expirations: Number(r.expirations || 0),
			uniqueUsers: Number(r.uniqueUsers || 0),
		})),
		byDevice: byDeviceRows.map((r) => ({
			device: String(r.device || 'unknown'),
			count: Number(r.count || 0),
		})),
	};
}

module.exports = {
	EVENT_TYPES,
	CLIENT_EVENT_TYPES,
	ensureTables,
	hashUser,
	trackEvent,
	trackIdleExpiration,
	trackReauthIfExpired,
	getSessionExpirationStats,
};
