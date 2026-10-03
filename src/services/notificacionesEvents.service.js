/**
 * Eventos SSE en memoria para la campanita (por empresa + usuario).
 * Solo llega a clientes conectados a esta instancia del backend: el front mantiene
 * un polling lento como respaldo.
 */
const { getTenantId } = require('../context/tenantContext');

const listeners = new Map();

function empresaKey(idEmpresa) {
	const n = Number(idEmpresa);
	return Number.isFinite(n) && n > 0 ? String(n) : '0';
}

function usuarioKey(idEmpresa, valorPersonal) {
	return `${empresaKey(idEmpresa)}:${Number(valorPersonal) || 0}`;
}

function subscribe(idEmpresa, valorPersonal, res) {
	const vp = Number(valorPersonal);
	if (!Number.isFinite(vp) || vp <= 0) return () => {};
	const key = usuarioKey(idEmpresa, vp);
	if (!listeners.has(key)) listeners.set(key, new Set());
	const set = listeners.get(key);
	set.add(res);
	return () => {
		set.delete(res);
		if (set.size === 0) listeners.delete(key);
	};
}

function writeAll(set, payload) {
	for (const res of set) {
		try {
			res.write(payload);
		} catch {
			set.delete(res);
		}
	}
}

function payloadDe(event, data) {
	return `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
}

function publicarAUsuario(valorPersonal, data = {}, idEmpresa = getTenantId()) {
	const set = listeners.get(usuarioKey(idEmpresa, valorPersonal));
	if (!set || !set.size) return;
	writeAll(set, payloadDe('cambio', { notificaciones: true, ...data }));
}

/** Avisa a todos los usuarios conectados de la empresa (p. ej. cambió la bandeja de pedidos). */
function publicarAEmpresa(data = {}, idEmpresa = getTenantId()) {
	const prefix = `${empresaKey(idEmpresa)}:`;
	const payload = payloadDe('cambio', data);
	for (const [key, set] of listeners) {
		if (key.startsWith(prefix)) writeAll(set, payload);
	}
}

function conexionesActivas() {
	let n = 0;
	for (const set of listeners.values()) n += set.size;
	return n;
}

module.exports = {
	subscribe,
	publicarAUsuario,
	publicarAEmpresa,
	conexionesActivas,
};
