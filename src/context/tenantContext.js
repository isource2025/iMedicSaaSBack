const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runWithTenant(idEmpresa, fn) {
	return storage.run({ idEmpresa: idEmpresa != null ? Number(idEmpresa) : null }, fn);
}

function getTenantId() {
	const store = storage.getStore();
	return store?.idEmpresa ?? null;
}

function middlewareFromAuth(req, res, next) {
	const raw = req.idEmpresa ?? req.auth?.idEmpresa ?? req.auth?.empresa?.id ?? null;
	const idEmpresa =
		raw != null && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0
			? Number(raw)
			: null;
	return storage.run({ idEmpresa }, () => next());
}

/**
 * Re-entra al ALS con idEmpresa de `req` (ya seteado por JWT).
 * Obligatorio DESPUÉS de multer/busboy: el parseo multipart puede cortar el
 * contexto de AsyncLocalStorage y entonces getTenantId() queda null aunque
 * el login y el JWT tengan empresa (error "Se requiere empresa activa...").
 */
function restoreTenantFromRequest(req, res, next) {
	return middlewareFromAuth(req, res, next);
}

module.exports = {
	runWithTenant,
	getTenantId,
	middlewareFromAuth,
	restoreTenantFromRequest,
};
