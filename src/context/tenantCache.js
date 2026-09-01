/**
 * Estado de módulo separado por tenant.
 *
 * Cada empresa tiene su propia base, así que cualquier metadato de esquema o
 * guarda de DDL que se cachee a nivel de módulo debe estar particionado por
 * tenant: si no, la primera empresa atendida define el estado para todas las
 * demás (la tabla nunca se crea en el resto, o se les aplica el mapeo de
 * columnas de otra base).
 */
const { getTenantId } = require('./tenantContext');

function tenantCacheKey() {
	const id = getTenantId();
	return id != null && Number.isFinite(Number(id)) && Number(id) > 0
		? String(id)
		: 'platform';
}

/**
 * Devuelve un accesor al estado del tenant actual, creándolo con `crearEstado`
 * la primera vez.
 */
function createTenantCache(crearEstado) {
	const porTenant = new Map();
	const accesor = () => {
		const key = tenantCacheKey();
		if (!porTenant.has(key)) porTenant.set(key, crearEstado());
		return porTenant.get(key);
	};
	accesor.reset = () => porTenant.delete(tenantCacheKey());
	accesor.resetAll = () => porTenant.clear();
	return accesor;
}

/**
 * Ejecuta `iniciar` una sola vez por tenant (p. ej. CREATE TABLE IF NOT EXISTS).
 * A diferencia de un flag booleano, deduplica las llamadas concurrentes del
 * arranque en frío y reintenta si la inicialización falla.
 */
function createTenantOnce(iniciar) {
	const porTenant = new Map();
	const once = (...args) => {
		const key = tenantCacheKey();
		let pendiente = porTenant.get(key);
		if (!pendiente) {
			pendiente = Promise.resolve()
				.then(() => iniciar(...args))
				.catch((e) => {
					porTenant.delete(key);
					throw e;
				});
			porTenant.set(key, pendiente);
		}
		return pendiente;
	};
	once.reset = () => porTenant.delete(tenantCacheKey());
	once.resetAll = () => porTenant.clear();
	return once;
}

module.exports = { tenantCacheKey, createTenantCache, createTenantOnce };
