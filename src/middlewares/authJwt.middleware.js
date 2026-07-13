const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');
const { middlewareFromAuth } = require('../context/tenantContext');
const sessionService = require('../services/session.service');
const { COOKIE_ACCESS } = require('../config/security');

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
}

function extractTokenFromRequest(req) {
	if (req.cookies?.[COOKIE_ACCESS]) {
		return String(req.cookies[COOKIE_ACCESS]).trim();
	}
	const h = req.headers.authorization;
	if (h && typeof h === 'string' && h.startsWith('Bearer ')) {
		const t = h.slice(7).trim();
		if (t) return t;
	}
	return null;
}

async function verifyBearerToken(req, res) {
	const token = extractTokenFromRequest(req);
	if (!token) {
		res.status(401).json({ success: false, mensaje: 'No autorizado' });
		return null;
	}
	let decoded;
	try {
		decoded = jwt.verify(token, JWT_SECRET);
	} catch {
		res.status(401).json({ success: false, mensaje: 'Token inválido o expirado' });
		return null;
	}

	if (decoded.sessionId) {
		const session = await sessionService.validateSession(decoded.sessionId);
		if (!session) {
			sessionService.clearAuthCookies(res);
			res.status(401).json({ success: false, mensaje: 'Sesión expirada por inactividad' });
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
