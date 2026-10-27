/**
 * Conversaciones en memoria por usuario+tenant.
 * Suficiente para el ciclo de vida de una sesión de trabajo.
 */
const crypto = require('crypto');

const TTL_MS = Number(process.env.ASISTENTE_SESION_TTL_MS) || 4 * 60 * 60 * 1000;
const MAX_MENSAJES = 24;
const store = new Map();

function userKey(idEmpresa, valorPersonal) {
	return `${Number(idEmpresa) || 0}:${Number(valorPersonal) || 0}`;
}

function ahora() {
	return Date.now();
}

function limpiarExpiradas() {
	const t = ahora();
	for (const [id, s] of store) {
		if (t - s.actualizado > TTL_MS) store.delete(id);
	}
}

function crear({ idEmpresa, valorPersonal, rutaActual }) {
	limpiarExpiradas();
	const id = crypto.randomUUID();
	const sesion = {
		id,
		userKey: userKey(idEmpresa, valorPersonal),
		idEmpresa: idEmpresa != null ? Number(idEmpresa) : null,
		valorPersonal: Number(valorPersonal) || null,
		rutaActual: rutaActual || null,
		mensajes: [],
		creado: ahora(),
		actualizado: ahora(),
	};
	store.set(id, sesion);
	return sesion;
}

function obtener(id, idEmpresa, valorPersonal) {
	if (!id) return null;
	const s = store.get(id);
	if (!s) return null;
	if (s.userKey !== userKey(idEmpresa, valorPersonal)) return null;
	if (ahora() - s.actualizado > TTL_MS) {
		store.delete(id);
		return null;
	}
	return s;
}

function obtenerOCrear({ idConversacion, idEmpresa, valorPersonal, rutaActual }) {
	const existente = obtener(idConversacion, idEmpresa, valorPersonal);
	if (existente) {
		if (rutaActual) existente.rutaActual = rutaActual;
		existente.actualizado = ahora();
		return existente;
	}
	return crear({ idEmpresa, valorPersonal, rutaActual });
}

function agregarMensaje(sesion, role, content, extra) {
	sesion.mensajes.push({
		role,
		content: String(content || '').slice(0, 8000),
		ts: ahora(),
		...(extra && typeof extra === 'object' ? extra : {}),
	});
	if (sesion.mensajes.length > MAX_MENSAJES) {
		sesion.mensajes = sesion.mensajes.slice(-MAX_MENSAJES);
	}
	sesion.actualizado = ahora();
}

const MAX_TURNOS_OPENAI = 6;
const MAX_TOOL_CHARS = 4000;
/**
 * Resultados de tools de turnos ya respondidos: se reenvían en cada turno, y completos
 * el modelo los mezclaba con la pregunta nueva (respondía estudios cuando pedían indicaciones).
 * La respuesta del asistente queda entera; si hace falta el dato, se vuelve a llamar la tool.
 */
const MAX_TOOL_CHARS_HISTORIAL = 700;
/** Respuestas largas (pase de guardia, listas) viajan en cada turno siguiente: con el comienzo alcanza. */
const MAX_ASISTENTE_HISTORIAL = 2000;
const MARCA_RECORTE = ' …[resultado de un turno anterior, recortado: si hace falta, volvé a llamar la tool]';

function recortarMsgOpenai(m) {
	if (!m || typeof m !== 'object') return m;
	const copy = { role: m.role };
	if (m.content != null) {
		const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
		const max = m.role === 'tool' ? MAX_TOOL_CHARS_HISTORIAL : m.role === 'assistant' ? MAX_ASISTENTE_HISTORIAL : MAX_TOOL_CHARS;
		copy.content = c.length > max ? `${c.slice(0, max)}${m.role === 'tool' ? MARCA_RECORTE : '…'}` : c;
	} else if (m.role === 'assistant') {
		copy.content = m.content ?? null;
	}
	if (m.tool_calls) copy.tool_calls = m.tool_calls;
	if (m.tool_call_id) copy.tool_call_id = m.tool_call_id;
	return copy;
}

/** Deja los últimos turnos de usuario, sin cortar un tool_call a la mitad. */
function compactarOpenai(messages) {
	const limpios = (messages || [])
		.filter((m) => m && m.role && m.role !== 'system')
		.map(recortarMsgOpenai);
	let users = 0;
	const out = [];
	for (let i = limpios.length - 1; i >= 0; i--) {
		out.unshift(limpios[i]);
		if (limpios[i].role === 'user') users += 1;
		if (users >= MAX_TURNOS_OPENAI) break;
	}
	while (out.length && (out[0].role === 'tool' || (out[0].role === 'assistant' && out[0].tool_calls))) {
		out.shift();
	}
	return out;
}

function guardarOpenai(sesion, messages) {
	sesion.openai = compactarOpenai(messages);
	sesion.actualizado = ahora();
}

function guardarFoco(sesion, ficha) {
	if (!sesion || !ficha) return;
	sesion.foco = ficha;
	sesion.actualizado = ahora();
}

function guardarAgente(sesion, agente, paquetes) {
	if (!sesion || !agente) return;
	sesion.agente = String(agente);
	if (Array.isArray(paquetes)) sesion.paquetes = paquetes.map(String);
	sesion.actualizado = ahora();
}

const MAX_ACCIONES = 6;

/** Resultado de una tarjeta (confirmada / cancelada) para el chat y para los próximos turnos del modelo. */
function anotarAccion(sesion, texto) {
	if (!sesion) return;
	agregarMensaje(sesion, 'assistant', texto, { accion: true });
	sesion.acciones = [...(sesion.acciones || []), String(texto || '').slice(0, 500)].slice(-MAX_ACCIONES);
}

/**
 * Va como system aparte y no en el historial: si el modelo lo ve como mensaje
 * propio, copia el formato «[Cancelado…]» en la respuesta de la tarjeta nueva.
 */
function notaAcciones(sesion) {
	const lista = sesion?.acciones || [];
	if (!lista.length) return null;
	return {
		role: 'system',
		content: [
			'Estado real de las tarjetas que el usuario ya resolvió (no las menciones como pendientes ni copies este formato):',
			...lista.map((a) => `- ${a}`),
		].join('\n'),
	};
}

function historialParaModelo(sesion) {
	if (Array.isArray(sesion.openai) && sesion.openai.length) return sesion.openai;
	return sesion.mensajes
		.filter((m) => m.role === 'user' || m.role === 'assistant')
		.filter((m) => m.content && !m.accion)
		.slice(-12)
		.map((m) => ({ role: m.role, content: m.content }));
}

const MAX_RESTAURAR = 8;

/**
 * La conversación vive en memoria: tras un reinicio del backend el front reenvía sus últimos
 * mensajes y se retoma con eso (sin resultados de tools; si hace falta un dato, se vuelve a leer).
 * Solo en una sesión vacía: nunca pisa lo que el servidor ya tiene.
 */
function restaurar(sesion, historial) {
	if (!sesion || sesion.mensajes.length || !Array.isArray(historial)) return false;
	const msgs = historial
		.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
		.slice(-MAX_RESTAURAR);
	for (const m of msgs) {
		sesion.mensajes.push({ role: m.role, content: m.content.slice(0, MAX_ASISTENTE_HISTORIAL), ts: ahora(), restaurado: true });
	}
	return msgs.length > 0;
}

function resetStore() {
	store.clear();
}

module.exports = {
	userKey,
	crear,
	obtener,
	obtenerOCrear,
	agregarMensaje,
	anotarAccion,
	notaAcciones,
	guardarOpenai,
	guardarFoco,
	guardarAgente,
	historialParaModelo,
	restaurar,
	resetStore,
	TTL_MS,
};
