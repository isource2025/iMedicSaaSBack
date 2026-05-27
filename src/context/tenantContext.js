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

module.exports = {
	runWithTenant,
	getTenantId,
	middlewareFromAuth,
};
