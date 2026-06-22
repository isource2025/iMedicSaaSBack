/**
 * Agrupa mensajes consecutivos del mismo paciente antes de invocar al agente.
 * Ventana fija en código (6 s) — evita doble respuesta cuando mandan texto en ráfaga.
 */
const diag = require('../utils/diagLog');
const agenteTrace = require('../utils/botAgenteTrace');

/** @type {Map<string, { items: object[], timer: NodeJS.Timeout|null, processing: boolean, waiters: Array<{resolve:Function,reject:Function}> }>} */
const colas = new Map();

const DEBOUNCE_MS = 6000;

function debounceMs() {
	return DEBOUNCE_MS;
}

function enabled() {
	return DEBOUNCE_MS > 0;
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

	if (!items.length) {
		cola.processing = false;
		return;
	}

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
	agenteTrace.logNota(`Cola: fusionando ${items.length} mensaje(s) del paciente`, {
		textos,
		merged: mergedTexto,
	});

	try {
		const result = await processor(payload);
		for (const w of waiters) w.resolve(result);
	} catch (err) {
		for (const w of waiters) w.reject(err);
	} finally {
		cola.processing = false;
		if (cola.items.length > 0) {
			cola.timer = setTimeout(() => void flush(key, processor), debounceMs());
		} else if (!cola.waiters.length) {
			colas.delete(key);
		}
	}
}

module.exports = {
	enabled,
	debounceMs,
	encolar,
};
