const { requireAuth } = require('./authJwt.middleware');
const { verifyMediaRequest } = require('../utils/mediaUrl');

/**
 * Fotos de pacientes: pasa con URL firmada vigente (<img src>) o con sesión
 * válida (cookie / Bearer). Sin ninguna de las dos, 401.
 */
function requireMediaAccess(req, res, next) {
	const pathname = `${req.baseUrl || ''}${req.path || ''}`;
	if (verifyMediaRequest(pathname, req.query)) {
		res.setHeader('Cache-Control', 'private, max-age=3600');
		return next();
	}
	res.setHeader('Cache-Control', 'private, no-store');
	return requireAuth(req, res, next);
}

/**
 * /uploads guarda también archivos que no son públicos (requisitos escaneados,
 * fotos de personal, temporales). Por este alias legado solo salen archivos
 * sueltos de la raíz o de patient-photos/.
 */
function onlyLegacyPhotoPaths(req, res, next) {
	const rel = String(req.path || '').replace(/^\/+/, '');
	const parts = rel.split('/').filter(Boolean);
	const ok =
		parts.length === 1 ||
		(parts.length === 2 && parts[0] === 'patient-photos');
	if (!ok || parts.some((p) => p.startsWith('.'))) {
		return res.status(404).json({ success: false, mensaje: 'Ruta no encontrada' });
	}
	return next();
}

module.exports = { requireMediaAccess, onlyLegacyPhotoPaths };
