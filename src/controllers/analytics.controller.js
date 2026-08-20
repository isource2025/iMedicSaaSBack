const analyticsService = require('../services/analytics.service');
const sessionService = require('../services/session.service');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');
const { extractTokenFromRequest } = require('../middlewares/authJwt.middleware');

function tryDecodeAuth(req) {
	const token = extractTokenFromRequest(req);
	if (!token) return null;
	try {
		return jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
	} catch {
		return null;
	}
}

function resolveValorPersonal(decoded, sessionRow) {
	if (sessionRow?.ValorPersonal != null && Number.isFinite(Number(sessionRow.ValorPersonal))) {
		return Number(sessionRow.ValorPersonal);
	}
	const u = decoded?.usuario || {};
	const candidates = [u.id, u.idValorpersonal, u.idValorPersonal, u.valorPersonal, u.ValorPersonal];
	for (const c of candidates) {
		const n = c != null && c !== '' ? Number(c) : NaN;
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

/**
 * POST /api/analytics/events
 * El front solo manda event + sessionId. Identidad sale de JWT y/o AuthSessions
 * (incluye sesiones ya revocadas por idle).
 */
async function registrarEvento(req, res) {
	try {
		const event = String(req.body?.event || req.body?.eventType || '')
			.trim()
			.toUpperCase();
		if (!analyticsService.CLIENT_EVENT_TYPES.has(event)) {
			return res.status(400).json({ success: false, mensaje: 'Evento no permitido' });
		}

		const sessionId = String(req.body?.sessionId || '').trim().slice(0, 36);
		if (!sessionId) {
			return res.status(400).json({ success: false, mensaje: 'sessionId requerido' });
		}

		const decoded = tryDecodeAuth(req);
		const sessionRow = await sessionService.getSessionAny(sessionId);
		if (!sessionRow && !decoded) {
			return res.status(401).json({ success: false, mensaje: 'Sesión no reconocida' });
		}

		const valorPersonal = resolveValorPersonal(decoded, sessionRow);
		const idEmpresa =
			sessionRow?.IdEmpresa != null
				? Number(sessionRow.IdEmpresa)
				: decoded?.idEmpresa != null
					? Number(decoded.idEmpresa)
					: null;
		const role = decoded?.rol?.nombre || null;

		await analyticsService.trackEvent({
			eventType: event,
			sessionId,
			valorPersonal,
			idEmpresa: Number.isFinite(idEmpresa) && idEmpresa > 0 ? idEmpresa : null,
			role,
			metadata: {
				...(req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}),
				source: 'client',
			},
			userAgent: req.headers['user-agent'] || sessionRow?.UserAgent,
		});

		return res.json({ success: true });
	} catch (e) {
		console.warn('[analytics.events]', e.message);
		return res.json({ success: true });
	}
}

async function estadisticasSesion(req, res) {
	try {
		const data = await analyticsService.getSessionExpirationStats({
			from: req.query.from,
			to: req.query.to,
			idEmpresa: req.query.idEmpresa ?? req.query.clinicId,
			role: req.query.role,
		});
		return res.json({ success: true, data });
	} catch (e) {
		console.error('[analytics.session-expiration]', e);
		return res.status(e.statusCode === 503 ? 503 : 500).json({
			success: false,
			mensaje: e.statusCode === 503 ? e.message : 'Error al obtener estadísticas',
		});
	}
}

module.exports = { registrarEvento, estadisticasSesion };
