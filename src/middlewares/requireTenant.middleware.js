const { getTenantId } = require('../context/tenantContext');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

/**
 * En modo SaaS (MySQL auth) exige idEmpresa en el JWT / contexto ALS.
 */
function requireTenant(req, res, next) {
	if (!isAuthCentralEnabled()) return next();
	const id = getTenantId();
	if (id == null || !Number.isFinite(Number(id)) || Number(id) <= 0) {
		return res.status(400).json({
			success: false,
			mensaje: 'Se requiere empresa activa en la sesión (idEmpresa)',
		});
	}
	return next();
}

module.exports = { requireTenant };
