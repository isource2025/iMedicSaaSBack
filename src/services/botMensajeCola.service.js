/**
 * Agrupa mensajes consecutivos del mismo paciente antes de invocar al agente.
 * Evita doble respuesta cuando mandan "martes" + DNI en ráfaga.
 *
 * BOT_MSG_DEBOUNCE_MS=6000  (default 6000, rango sugerido 5000–7000)
 * BOT_MSG_DEBOUNCE=0        desactiva
 */
const diag = require('../utils/diagLog');

/** @type {Map<string, { items: object[], timer: NodeJS.Timeout|null, processing: boolean, waiters: Array<{resolve:Function,reject:Function}> }>} */
const colas = new Map();

function debounceMs() {
	if (process.env.BOT_MSG_DEBOUNCE === '0') return 0;
	const n = Number(process.env.BOT_MSG_DEBOUNCE_MS || 6000);
	return Number.isFinite(n) && n >= 0 ? n : 6000;
}

function enabled() {
	return debounceMs() > 0;
}

function clave(idConversacion) {
	return String(idConversacion || 'default');
}

/**
 * Encola un mensaje y ejecuta `processor` una sola vez tras la ventana de silencio.
 * @param {string} idConversacion
 * @param {object} item — payload del mensaje (se mergea texto en processor wrapper)
 * @param {(merged: object) => Promise<any>} processor
 */
function encolar(idConversacion, item, processor) {
	if (!enabled()) {
		return processor({ ...item, _merged: false, _textos: [item.textoEntrada || item.contenidoUltimo || ''] });
	}

	const key = clave(idConversacion);

	return new Promise((resolve, reject) => {
		let cola = colas.get(key);
		if (!cola) {
			cola = { items: [], timer: null, processing: false, waiters: [] };
			colas.set(key, cola);
		}

		cola.items.push(item);
		cola.waiters.push({ resolve, reject });

		diag.line('agente-cola', 'mensaje encolado', {
			idConversacion: key,
			pending: cola.items.length,
			waitMs: debounceMs(),
		});

		if (cola.timer) clearTimeout(cola.timer);

		cola.timer = setTimeout(() => {
			void flush(key, processor);
		}, debounceMs());
	});
}

async function flush(key, processor) {
	const cola = colas.get(key);
	if (!cola || cola.processing) return;

	cola.processing = true;
	if (cola.timer) {
		clearTimeout(cola.timer);
		cola.timer = null;
	}

	const items = cola.items.splice(0);
	const waiters = cola.waiters.splice(0);
	cola.processing = false;

	if (!items.length) return;

	const textos = items
		.map((it) => String(it.textoEntrada || it.contenidoUltimo || '').trim())
		.filter(Boolean);
	const mergedTexto = textos.join('\n');
	const last = items[items.length - 1];

	const payload = {
		...last,
		textoEntrada: mergedTexto,
		contenidoUltimo: mergedTexto,
		_merged: items.length > 1,
		_mergeCount: items.length,
		_textos: textos,
		_msgIds: items.map((it) => it.idMensajePaciente).filter(Boolean),
	};

	diag.line('agente-cola', 'procesando lote', {
		idConversacion: key,
		count: items.length,
		textoLen: mergedTexto.length,
	});

	try {
		const result = await processor(payload);
		for (const w of waiters) w.resolve(result);
	} catch (err) {
		for (const w of waiters) w.reject(err);
	} finally {
		if (!cola.items.length && !cola.waiters.length) {
			colas.delete(key);
		}
	}
}

module.exports = {
	enabled,
	debounceMs,
	encolar,
};
