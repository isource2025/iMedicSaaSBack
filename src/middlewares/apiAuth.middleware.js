const { requireAuth } = require('./authJwt.middleware');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

/**
 * Rutas bajo /api que no requieren JWT (login, descubrimiento de empresas, etc.).
 * Debe montarse después de app.use('/api/auth', authRoutes).
 */
function isPublicApiPath(req) {
	const path = (req.path || req.url || '').split('?')[0];
	return (
		path === '/health' ||
		path.startsWith('/auth') ||
		path.startsWith('/webhook/whatsapp') ||
		path.startsWith('/integrations/bot')
	);
}

/** Rutas que no requieren empresa tenant (catálogo plataforma / super admin). */
function isTenantExemptPath(req) {
	const path = (req.path || req.url || '').split('?')[0];
	return path.startsWith('/super-admin');
}

function apiAuthUnlessPublic(req, res, next) {
	if (isPublicApiPath(req)) return next();
	return requireAuth(req, res, (err) => {
		if (err) return next(err);
		if (isAuthCentralEnabled() && !req.idEmpresa && !isTenantExemptPath(req)) {
			return res.status(403).json({
				success: false,
				mensaje:
					'Sesión sin empresa activa. Cerrá sesión e iniciá de nuevo seleccionando una empresa.',
				code: 'TENANT_REQUIRED',
			});
		}
		return next();
	});
}

module.exports = { apiAuthUnlessPublic, isPublicApiPath };
