const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');
const { middlewareFromAuth } = require('../context/tenantContext');

/** Resuelve ValorPersonal desde JWT (Render legacy + Railway actual). */
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

function verifyBearerToken(req, res) {
	const h = req.headers.authorization;
	if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) {
		res.status(401).json({ success: false, mensaje: 'No autorizado' });
		return null;
	}
	const token = h.slice(7).trim();
	if (!token) {
		res.status(401).json({ success: false, mensaje: 'No autorizado' });
		return null;
	}
	try {
		return jwt.verify(token, JWT_SECRET);
	} catch {
		res.status(401).json({ success: false, mensaje: 'Token inválido o expirado' });
		return null;
	}
}

/**
 * Requiere Authorization: Bearer <token> válido (mismo secret que /api/auth/login).
 * Asigna req.auth (payload) y req.valorPersonal (imPassword / imPersonal.Valor).
 * Contexto tenant: idEmpresa en JWT (null = solo plataforma, p. ej. SUPER_ADMIN).
 */
function requireAuth(req, res, next) {
	const decoded = verifyBearerToken(req, res);
	if (!decoded) return;

	assignAuthFromDecoded(req, decoded);
	if (req.valorPersonal == null || !Number.isFinite(req.valorPersonal)) {
		return res.status(401).json({ success: false, mensaje: 'Token sin identificador de usuario' });
	}
	return middlewareFromAuth(req, res, next);
}

/**
 * JWT válido sin cambiar el tenant AsyncLocalStorage.
 * Render legacy (AUTH_DB_ENABLED=0): imHCI vive en la BD plataforma (.env DB_*).
 */
function requireAuthPlatform(req, res, next) {
	const decoded = verifyBearerToken(req, res);
	if (!decoded) return;

	assignAuthFromDecoded(req, decoded);
	if (req.valorPersonal == null || !Number.isFinite(req.valorPersonal)) {
		return res.status(401).json({ success: false, mensaje: 'Token sin identificador de usuario' });
	}
	return next();
}

module.exports = { requireAuth, requireAuthPlatform };
