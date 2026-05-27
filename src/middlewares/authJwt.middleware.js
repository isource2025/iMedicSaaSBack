const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');
const { middlewareFromAuth } = require('../context/tenantContext');

/**
 * Requiere Authorization: Bearer <token> válido (mismo secret que /api/auth/login).
 * Asigna req.auth (payload) y req.valorPersonal (imPassword / imPersonal.Valor).
 * Contexto tenant: idEmpresa en JWT (null = solo plataforma, p. ej. SUPER_ADMIN).
 */
function requireAuth(req, res, next) {
	const h = req.headers.authorization;
	if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) {
		return res.status(401).json({ success: false, mensaje: 'No autorizado' });
	}
	const token = h.slice(7).trim();
	if (!token) {
		return res.status(401).json({ success: false, mensaje: 'No autorizado' });
	}
	try {
		const decoded = jwt.verify(token, JWT_SECRET);
		req.auth = decoded;
		const id = decoded?.usuario?.id;
		req.valorPersonal = id != null ? Number(id) : null;
		const mat = decoded?.usuario?.matricula;
		req.matricula = mat != null && Number.isFinite(Number(mat)) && Number(mat) > 0 ? Number(mat) : null;
		req.rolNombre = decoded?.rol?.nombre ? String(decoded.rol.nombre).toUpperCase() : null;
		const idEmp = decoded?.idEmpresa;
		req.idEmpresa =
			idEmp != null && idEmp !== '' && Number.isFinite(Number(idEmp)) && Number(idEmp) > 0
				? Number(idEmp)
				: null;
		if (req.valorPersonal == null || !Number.isFinite(req.valorPersonal)) {
			return res.status(401).json({ success: false, mensaje: 'Token sin identificador de usuario' });
		}
		return middlewareFromAuth(req, res, next);
	} catch {
		return res.status(401).json({ success: false, mensaje: 'Token inválido o expirado' });
	}
}

module.exports = { requireAuth };
