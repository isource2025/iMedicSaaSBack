const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');
const { middlewareFromAuth } = require('../context/tenantContext');
const sessionService = require('../services/session.service');
const { COOKIE_ACCESS } = require('../config/security');
const { sectoresFromDecoded } = require('../utils/sectoresSesion');

function resolveValorPersonal(decoded) {
	const u = decoded?.usuario || {};
	const candidates = [
		u.id,
		u.idValorpersonal,
		u.idValorPersonal,
		u.valorPersonal,
		u.ValorPersonal,
	];
	for (const c of candidates) {
		const n = c != null && c !== '' ? Number(c) : NaN;
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

function resolveMatricula(decoded) {
	const u = decoded?.usuario || {};
	const candidates = [u.matricula, u.Matricula];
	for (const c of candidates) {
		const n = c != null && c !== '' ? Number(c) : NaN;
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

function resolveCodOperador(decoded) {
	const u = decoded?.usuario || {};
	const candidates = [u.codOperador, u.idCodOperador, u.CodOperador];
	for (const c of candidates) {
		if (c == null || c === '') continue;
		const n = Number(c);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

function assignAuthFromDecoded(req, decoded) {
	req.auth = decoded;
	req.auth.sessionId = decoded.sessionId || null;

	const valorPersonal = resolveValorPersonal(decoded);
	req.valorPersonal = valorPersonal;
	if (decoded?.usuario && valorPersonal != null) {
		decoded.usuario.id = valorPersonal;
	}

	req.matricula = resolveMatricula(decoded);
	const codOp = resolveCodOperador(decoded);
	if (decoded?.usuario && codOp != null) {
		decoded.usuario.codOperador = codOp;
	}

	req.rolNombre = decoded?.rol?.nombre ? String(decoded.rol.nombre).toUpperCase() : null;
	const idEmp = decoded?.idEmpresa;
	req.idEmpresa =
		idEmp != null && idEmp !== '' && Number.isFinite(Number(idEmp)) && Number(idEmp) > 0
			? Number(idEmp)
			: null;
	req.idSector = String(decoded?.idSector || decoded?.usuario?.idSector || '').trim() || null;
	req.sectores = sectoresFromDecoded(decoded);
}

/** Tokens candidatos en orden de preferencia: cookie httpOnly y luego header Bearer. */
function extractTokenCandidates(req) {
	const out = [];
	const cookie = req.cookies?.[COOKIE_ACCESS] ? String(req.cookies[COOKIE_ACCESS]).trim() : '';
	if (cookie) out.push(cookie);
	const h = req.headers.authorization;
	if (h && typeof h === 'string' && h.startsWith('Bearer ')) {
		const t = h.slice(7).trim();
		if (t && t !== cookie) out.push(t);
	}
	return out;
}

function extractTokenFromRequest(req) {
	return extractTokenCandidates(req)[0] || null;
}

async function verifyBearerToken(req, res) {
	const candidates = extractTokenCandidates(req);
	if (candidates.length === 0) {
		res.status(401).json({ success: false, mensaje: 'No autorizado' });
		return null;
	}

	// Una cookie vieja (otra sesión, proxy que la conserva) no debe tapar un Bearer válido.
	let decoded = null;
	let result = null;
	for (const token of candidates) {
		let d;
		try {
			d = jwt.verify(token, JWT_SECRET);
		} catch {
			continue;
		}
		const r = d.sessionId ? await sessionService.evaluateSession(d.sessionId) : { ok: true };
		decoded = d;
		result = r;
		if (r.ok) break;
	}

	if (!decoded) {
		res.status(401).json({ success: false, mensaje: 'Token inválido o expirado' });
		return null;
	}

	if (decoded.sessionId) {
		if (!result.ok) {
			sessionService.clearAuthCookies(res);
			if (result.reason === 'idle') {
				try {
					const analyticsService = require('../services/analytics.service');
					await analyticsService.trackIdleExpiration({
						decoded,
						session: result.session,
						userAgent: req.headers['user-agent'],
					});
				} catch {
					/* analytics no debe bloquear el 401 */
				}
				res.status(401).json({ success: false, mensaje: 'Sesión expirada por inactividad' });
			} else {
				res.status(401).json({ success: false, mensaje: 'Sesión expirada' });
			}
			return null;
		}
	}

	return decoded;
}

async function requireAuth(req, res, next) {
	const decoded = await verifyBearerToken(req, res);
	if (!decoded) return;

	assignAuthFromDecoded(req, decoded);
	if (req.valorPersonal == null || !Number.isFinite(req.valorPersonal)) {
		return res.status(401).json({ success: false, mensaje: 'Token sin identificador de usuario' });
	}
	return middlewareFromAuth(req, res, next);
}

async function requireAuthPlatform(req, res, next) {
	const decoded = await verifyBearerToken(req, res);
	if (!decoded) return;

	assignAuthFromDecoded(req, decoded);
	if (req.valorPersonal == null || !Number.isFinite(req.valorPersonal)) {
		return res.status(401).json({ success: false, mensaje: 'Token sin identificador de usuario' });
	}
	return next();
}

module.exports = { requireAuth, requireAuthPlatform, extractTokenFromRequest };
