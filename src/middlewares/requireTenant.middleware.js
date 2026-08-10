const { getTenantId, runWithTenant } = require('../context/tenantContext');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

/**
 * En modo SaaS (MySQL auth) exige idEmpresa en el JWT / contexto ALS.
 * Si el ALS se perdió (p. ej. después de multer) pero el JWT trae idEmpresa, lo restaura.
 */
function requireTenant(req, res, next) {
	if (!isAuthCentralEnabled()) return next();
	let id = getTenantId();
	if (id == null || !Number.isFinite(Number(id)) || Number(id) <= 0) {
		const raw = req.idEmpresa ?? req.auth?.idEmpresa ?? req.auth?.empresa?.id ?? null;
		const fromReq =
			raw != null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0
				? Number(raw)
				: null;
		if (fromReq) {
			req.idEmpresa = fromReq;
			return runWithTenant(fromReq, () => next());
		}
		return res.status(400).json({
			success: false,
			mensaje: 'Se requiere empresa activa en la sesión (idEmpresa)',
		});
	}
	return next();
}

module.exports = { requireTenant };
