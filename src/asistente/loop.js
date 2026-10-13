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
 * Un resultado con `respuestaDirecta` (texto ya armado) no necesita que el modelo lo
 * redacte: si todas las tools de la iteración la traen, se responde con eso y se ahorra
 * la segunda llamada. Al modelo le queda el resultado sin ese texto, y el texto como respuesta suya.
 */
function separarDirecta(resultado) {
	if (!resultado || typeof resultado !== 'object' || typeof resultado.respuestaDirecta !== 'string') {
		return { directa: null, paraModelo: resultado };
	}
	const { respuestaDirecta, ...resto } = resultado;
	return { directa: respuestaDirecta.trim() || null, paraModelo: resto };
}

/**
 * @param {{
 *   messages: object[],
 *   tools: object[] | (() => object[]),
 *   ejecutar: (nombre: string, args: object, call: object) => Promise<any>,
 *   chat: (opts: object) => Promise<{ content: string|null, toolCalls: object[] }>,
 *   maxIter?: number,
 *   onEvento?: (evt: object) => void,
 * }} opts
 * tools como función: se vuelve a leer en cada iteración (una tool puede habilitar otras).
 */
async function agenteLoop({ messages, tools, ejecutar, chat, maxIter, onEvento }) {
	const limite = Math.max(1, Number(maxIter) || MAX_ITER_DEFAULT);
	const invocadas = [];
	const emit = typeof onEvento === 'function' ? onEvento : () => {};
	const toolsActuales = typeof tools === 'function' ? tools : () => tools;

	for (let i = 0; i < limite; i++) {
		emit({ tipo: 'iteracion', n: i + 1, max: limite });
		const salida = await chat({ messages, tools: toolsActuales(), toolChoice: 'auto' });

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

		const directas = [];
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
			const { directa, paraModelo } = separarDirecta(resultado);
			directas.push(directa);
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: JSON.stringify(paraModelo ?? {}),
			});
		}

		if (directas.length && directas.every(Boolean)) {
			const texto = [salida.content, ...directas].filter(Boolean).join('\n\n');
			messages.push({ role: 'assistant', content: texto });
			emit({ tipo: 'respuesta_directa' });
			return { texto, invocadas, messages, finishReason: 'directa', usage: salida.usage || null };
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
		tools: toolsActuales(),
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
