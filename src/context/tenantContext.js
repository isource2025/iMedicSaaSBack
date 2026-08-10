const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runWithTenant(idEmpresa, fn) {
	return storage.run({ idEmpresa: idEmpresa != null ? Number(idEmpresa) : null }, fn);
}

function getTenantId() {
	const store = storage.getStore();
	return store?.idEmpresa ?? null;
}

function resolveIdEmpresaFromReq(req) {
	const raw = req?.idEmpresa ?? req?.auth?.idEmpresa ?? req?.auth?.empresa?.id ?? null;
	if (raw == null || raw === '') return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function middlewareFromAuth(req, res, next) {
	const idEmpresa = resolveIdEmpresaFromReq(req);
	if (idEmpresa != null) req.idEmpresa = idEmpresa;
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

/**
 * Ejecuta `fn` dentro del ALS del tenant del request.
 * Usar alrededor de awaits largos (axios al file server) que a veces
 * dejan getTenantId() en null antes del INSERT clínico.
 */
function ensureTenantFromReq(req, fn) {
	const idEmpresa = resolveIdEmpresaFromReq(req);
	if (idEmpresa != null) {
		req.idEmpresa = idEmpresa;
		return runWithTenant(idEmpresa, fn);
	}
	return fn();
}

module.exports = {
	runWithTenant,
	getTenantId,
	resolveIdEmpresaFromReq,
	middlewareFromAuth,
	restoreTenantFromRequest,
	ensureTenantFromReq,
};
