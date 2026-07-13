const geoPolicy = require('../services/geoPolicy.service');
const authAudit = require('../services/authAudit.service');
const { getClientIp } = require('../config/security');

async function geoBlockAuth(req, res, next) {
	try {
		const ip = getClientIp(req);
		const country = await geoPolicy.assertIpPermitida(ip);
		req.geoCountry = country;
		return next();
	} catch (e) {
		await authAudit.logEvent({
			ip: getClientIp(req),
			userAgent: req.headers['user-agent'],
			username: req.body?.username,
			evento: 'GEO_BLOCKED',
			resultado: 'DENEGADO',
			detalle: e.country || e.message,
		});
		return res.status(e.statusCode || 403).json({
			success: false,
			mensaje: e.message || 'Acceso no disponible desde su región',
		});
	}
}

module.exports = { geoBlockAuth };
