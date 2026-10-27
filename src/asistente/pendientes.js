/**
 * Acciones mutantes pendientes de confirmación explícita del usuario.
 * El modelo no puede ejecutar POST/PUT/PATCH/DELETE por sí mismo.
 */
const crypto = require('crypto');

const TTL_MS = Number(process.env.ASISTENTE_PENDIENTE_TTL_MS) || 15 * 60 * 1000;
const store = new Map();

function userKey(idEmpresa, valorPersonal) {
	return `${Number(idEmpresa) || 0}:${Number(valorPersonal) || 0}`;
}

function limpiar() {
	const t = Date.now();
	for (const [id, p] of store) {
		if (t > p.expira) store.delete(id);
	}
}

/**
 * tipo 'http': se ejecuta al confirmar. tipo 'insercion': texto para un campo
 * de la pantalla; al aplicarlo se marca y audita.
 * `generativo`: campos del body que redactó la IA y se marcan al confirmar.
 */
function crear({
	idEmpresa,
	valorPersonal,
	herramienta,
	args,
	http,
	resumen,
	detalle,
	link,
	tipo = 'http',
	generativo = [],
	insercion = null,
}) {
	limpiar();
	const id = crypto.randomUUID();
	const item = {
		id,
		userKey: userKey(idEmpresa, valorPersonal),
		tipo,
		herramienta,
		args: args || {},
		http,
		generativo: Array.isArray(generativo) ? generativo : [],
		insercion,
		resumen: String(resumen || herramienta),
		detalle: detalle ? String(detalle).slice(0, 8000) : null,
		link: link || null,
		creado: Date.now(),
		expira: Date.now() + TTL_MS,
	};
	store.set(id, item);
	return item;
}

function peek(id, idEmpresa, valorPersonal) {
	limpiar();
	const p = store.get(id);
	if (!p) return null;
	if (p.userKey !== userKey(idEmpresa, valorPersonal)) return null;
	if (Date.now() > p.expira) {
		store.delete(id);
		return null;
	}
	return p;
}

/** Consume la acción (un solo uso). */
function tomar(id, idEmpresa, valorPersonal) {
	const p = peek(id, idEmpresa, valorPersonal);
	if (!p) return null;
	store.delete(id);
	return p;
}

function cancelar(id, idEmpresa, valorPersonal) {
	const p = peek(id, idEmpresa, valorPersonal);
	if (!p) return false;
	store.delete(id);
	return true;
}

function activosDe(idEmpresa, valorPersonal) {
	limpiar();
	const k = userKey(idEmpresa, valorPersonal);
	return [...store.values()].filter((p) => p.userKey === k);
}

function paraUi(p) {
	if (!p) return null;
	return {
		id: p.id,
		herramienta: p.herramienta,
		metodo: p.http?.method || null,
		resumen: p.resumen,
		detalle: p.detalle,
		link: p.link,
		generativo: Array.isArray(p.generativo) && p.generativo.length > 0,
		expira: p.expira,
	};
}

function resetStore() {
	store.clear();
}

module.exports = {
	crear,
	peek,
	tomar,
	cancelar,
	activosDe,
	paraUi,
	resetStore,
	TTL_MS,
};
