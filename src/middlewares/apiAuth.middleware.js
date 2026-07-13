const { requireAuth } = require('./authJwt.middleware');

/**
 * Rutas bajo /api que no requieren JWT (login, descubrimiento de empresas, etc.).
 * Debe montarse después de app.use('/api/auth', authRoutes).
 */
function isPublicApiPath(req) {
	const path = (req.path || req.url || '').split('?')[0];
	return (
		path === '/health' ||
		path === '/empresa' ||
		path.startsWith('/auth') ||
		path.startsWith('/webhook/whatsapp') ||
		path.startsWith('/integrations/bot') ||
		path.startsWith('/turnero/display')
	);
}

function apiAuthUnlessPublic(req, res, next) {
	if (isPublicApiPath(req)) return next();
	return requireAuth(req, res, next);
}

module.exports = { apiAuthUnlessPublic, isPublicApiPath };
