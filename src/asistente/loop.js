/**
 * Bucle genérico modelo → herramientas → modelo.
 * Independiente de WhatsApp y de iMedic: solo orquesta.
 */

const MAX_ITER_DEFAULT = Number(process.env.ASISTENTE_MAX_ITER || 6);

function parseArgs(raw) {
	if (!raw) return {};
	if (typeof raw === 'object') return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

/**
 * @param {{
 *   messages: object[],
 *   tools: object[],
 *   ejecutar: (nombre: string, args: object, call: object) => Promise<any>,
 *   chat: (opts: object) => Promise<{ content: string|null, toolCalls: object[] }>,
 *   maxIter?: number,
 *   onEvento?: (evt: object) => void,
 * }} opts
 */
async function agenteLoop({ messages, tools, ejecutar, chat, maxIter, onEvento }) {
	const limite = Math.max(1, Number(maxIter) || MAX_ITER_DEFAULT);
	const invocadas = [];
	const emit = typeof onEvento === 'function' ? onEvento : () => {};

	for (let i = 0; i < limite; i++) {
		emit({ tipo: 'iteracion', n: i + 1, max: limite });
		const salida = await chat({ messages, tools, toolChoice: 'auto' });

		if (!salida.toolCalls.length) {
			return {
				texto: salida.content || '',
				invocadas,
				messages,
				finishReason: salida.finishReason || 'stop',
				usage: salida.usage || null,
			};
		}

		messages.push({
			role: 'assistant',
			content: salida.content || null,
			tool_calls: salida.toolCalls,
		});

		for (const call of salida.toolCalls) {
			const nombre = call.function?.name || 'desconocida';
			const args = parseArgs(call.function?.arguments);
			invocadas.push({ nombre, args });
			emit({ tipo: 'herramienta', nombre, estado: 'ejecutando', args });
			let resultado;
			try {
				resultado = await ejecutar(nombre, args, call);
			} catch (err) {
				resultado = { error: err.message || 'Error ejecutando herramienta' };
			}
			emit({ tipo: 'herramienta', nombre, estado: resultado?.error ? 'error' : 'ok' });
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: JSON.stringify(resultado ?? {}),
			});
		}
	}

	emit({ tipo: 'cierre_forzado' });
	const cierre = await chat({
		messages: [
			...messages,
			{
				role: 'system',
				content: 'Respondé con la información disponible. No llames más herramientas.',
			},
		],
		tools,
		toolChoice: 'none',
	});

	return {
		texto: cierre.content || '',
		invocadas,
		messages,
		finishReason: 'max_iter',
		usage: cierre.usage || null,
	};
}

module.exports = { agenteLoop, parseArgs, MAX_ITER_DEFAULT };
