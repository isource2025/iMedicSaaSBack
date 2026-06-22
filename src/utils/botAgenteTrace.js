/**
 * Traza detallada del agente IA — siempre activa.
 * Buscar en logs: [agente-trace]
 * Al final de cada turno hay un bloque "REPORTE COPIABLE" para pegar en debug.
 */
const { AsyncLocalStorage } = require('async_hooks');

const turnStore = new AsyncLocalStorage();
let turnCounter = 0;

const MARK = '[agente-trace]';
const MAX_JSON = 8000;
const MAX_TEXT = 4000;

function enabled() {
	return true;
}

function getTurn() {
	return turnStore.getStore() || null;
}

function line(...parts) {
	console.log(MARK, ...parts);
}

function block(title, body) {
	line('');
	line(`━━━ ${title} ━━━`);
	const text = String(body ?? '').trim();
	if (!text) {
		line('(vacío)');
	} else {
		for (const row of text.split('\n')) {
			console.log(`${MARK}   ${row}`);
		}
	}
}

function trunc(s, max = MAX_TEXT) {
	const t = String(s ?? '');
	return t.length > max ? `${t.slice(0, max)}\n… [truncado, ${t.length} chars total]` : t;
}

function prettyJson(obj, max = MAX_JSON) {
	try {
		return trunc(JSON.stringify(obj, null, 2), max);
	} catch {
		return String(obj);
	}
}

function nowIso() {
	return new Date().toISOString();
}

/**
 * @param {object} meta
 * @param {() => Promise<any>} fn
 */
async function runTurn(meta, fn) {
	if (!enabled()) return fn();

	const turnId = ++turnCounter;
	const ctx = {
		turnId,
		idConversacion: meta.idConversacion,
		telefonoWhatsApp: meta.telefonoWhatsApp || null,
		textoEntrada: meta.textoEntrada,
		estadoInicial: meta.estadoInicial,
		estadoFinal: null,
		openAiCalls: 0,
		iteraciones: 0,
		tools: [],
		historialCount: meta.historialCount ?? 0,
		merged: meta.merged ?? false,
		mergeCount: meta.mergeCount ?? 1,
		textosMerged: meta.textosMerged || null,
		startMs: Date.now(),
		events: [],
	};

	const pushEvent = (tipo, detalle) => {
		ctx.events.push({ t: Date.now() - ctx.startMs, tipo, detalle });
	};

	ctx._push = pushEvent;

	line('');
	line('════════════════════════════════════════════════════════════════════');
	line(`TURNO #${turnId}  |  ${nowIso()}`);
	line(`conversacion: ${meta.idConversacion || '?'}`);
	if (meta.telefonoWhatsApp) line(`telefono: ${meta.telefonoWhatsApp}`);
	if (ctx.merged && ctx.mergeCount > 1) {
		line(`cola: ${ctx.mergeCount} mensajes fusionados`);
		block('TEXTOS FUSIONADOS', (ctx.textosMerged || []).map((t, i) => `${i + 1}. ${t}`).join('\n'));
	}
	block('PACIENTE', meta.textoEntrada);
	if (meta.estadoInicial) {
		block('ESTADO INICIAL', prettyJson(meta.estadoInicial, 3000));
	}
	line(`historial previo: ${ctx.historialCount} mensajes`);
	line('────────────────────────────────────────────────────────────────────');

	try {
		const result = await turnStore.run(ctx, fn);
		endTurn(result);
		return result;
	} catch (err) {
		line('');
		line('ERROR EN TURNO:', err.message);
		if (err.stack) block('STACK', err.stack);
		printCopiableReport(ctx, { error: err.message });
		line('════════════════════════════════════════════════════════════════════');
		throw err;
	}
}

function logIteracion(n, max) {
	const t = getTurn();
	if (t) {
		t.iteraciones = n;
		t._push?.('iteracion', `${n}/${max}`);
	}
	line('');
	line(`── iteración IA ${n}/${max} ──`);
}

function logSystemPrompt(content) {
	const t = getTurn();
	t?._push?.('system_prompt', `${String(content || '').length} chars`);
	block('SYSTEM PROMPT (completo enviado a OpenAI)', trunc(content, MAX_JSON));
}

function logHistorialMensajes(messages, { label = 'MENSAJES A OPENAI' } = {}) {
	const t = getTurn();
	const list = messages || [];
	t?._push?.('mensajes', list.length);
	const rows = list.map((m, i) => {
		const role = m.role || '?';
		let body = m.content;
		if (m.tool_calls?.length) {
			const names = m.tool_calls.map((c) => c.function?.name).join(', ');
			body = `[tool_calls → ${names}]`;
			if (m.content) body += ` ${m.content}`;
		}
		if (role === 'tool' && m.tool_call_id) {
			body = `[tool_call_id=${m.tool_call_id}] ${trunc(m.content, 1500)}`;
		}
		return `${i + 1}. [${role}] ${trunc(body, 2000)}`;
	});
	block(label, rows.join('\n\n'));
}

function logOpenAiRequest({ capa, messages, tools, toolChoice, extra }) {
	const t = getTurn();
	if (t) t.openAiCalls += 1;
	const n = t?.openAiCalls ?? '?';

	line('');
	line(`→ OPENAI llamada #${n}  (${capa || 'chat'})`);
	if (extra) block('PARAMETROS', prettyJson(extra, 500));

	const sys = (messages || []).find((m) => m.role === 'system');
	if (sys?.content) {
		block('SYSTEM (en esta llamada)', trunc(sys.content, MAX_JSON));
	}

	logHistorialMensajes(
		(messages || []).filter((m) => m.role !== 'system'),
		{ label: 'HISTORIAL (sin system)' },
	);

	if (tools?.length) {
		line(`tools disponibles (${tools.length}): ${tools.map((x) => x.function?.name).filter(Boolean).join(', ')}`);
	}
	if (toolChoice && toolChoice !== 'auto') {
		line(`tool_choice: ${JSON.stringify(toolChoice)}`);
	}

	t?._push?.('openai_req', `#${n} ${capa}`);
}

function logOpenAiResponse({ capa, content, toolCalls, finishReason, extra, usage }) {
	const t = getTurn();
	line('');
	line(`← OPENAI respuesta  (${capa || ''})  finish_reason=${finishReason || '?'}`);
	if (usage) block('USAGE', prettyJson(usage, 300));
	if (content) block('TEXTO ASISTENTE', content);
	if (toolCalls?.length) {
		const rows = toolCalls.map((tc, i) => {
			let args = tc.function?.arguments;
			try {
				args = JSON.stringify(JSON.parse(args || '{}'), null, 2);
			} catch {
				/* raw */
			}
			return `${i + 1}. ${tc.function?.name}\n   id=${tc.id}\n   args=${args}`;
		});
		block('TOOL_CALLS', rows.join('\n\n'));
	}
	if (extra) block('EXTRA', prettyJson(extra, 500));

	const names = (toolCalls || []).map((c) => c.function?.name).join(', ') || '(ninguna)';
	t?._push?.('openai_res', `${finishReason} tools=[${names}] texto=${content ? 'sí' : 'no'}`);
}

function logToolResult({ nombre, args, resultado, ms, estadoSnapshot, estadoAntes }) {
	const t = getTurn();
	const ok = !resultado?.error;
	if (t) t.tools.push({ nombre, args, ok, ms, resultado });

	line('');
	line(`${ok ? '✓' : '✗'} TOOL ${nombre}  (${ms}ms)`);
	block('ARGS', prettyJson(args || {}, 1500));
	block('RESULTADO', prettyJson(resultado || {}, 3000));
	if (estadoAntes) block('ESTADO ANTES', prettyJson(estadoAntes, 2000));
	if (estadoSnapshot) block('ESTADO DESPUÉS', prettyJson(estadoSnapshot, 2000));

	t?._push?.('tool', `${nombre} ${ok ? 'OK' : 'FAIL'} ${ms}ms`);
}

function logNota(msg, extra) {
	line(`ℹ ${msg}`);
	if (extra != null) block('DETALLE', prettyJson(extra, 1500));
	getTurn()?._push?.('nota', msg);
}

function logIntegridad({ textoFinal, toolsInvocadas }) {
	const tools = toolsInvocadas || [];
	const llamoBuscar = tools.includes('buscar_turno');
	const texto = String(textoFinal || '').toLowerCase();
	const hablaDisponibilidad =
		/no hay|sin turno|sin disponibilidad|no encontr|lamentablemente/i.test(texto) ||
		/te ofrezco|te agend|turno para el|disponible el/i.test(texto) ||
		/\d{1,2}\/\d{1,2}|\d{1,2}:\d{2}/.test(texto);

	if (hablaDisponibilidad && !llamoBuscar) {
		line('');
		line('⚠ ALERTA INTEGRIDAD: la respuesta habla de disponibilidad/fecha pero NO se llamó buscar_turno en este turno');
		getTurn()?._push?.('alerta', 'disponibilidad_sin_buscar_turno');
	}
}

function printCopiableReport(ctx, result) {
	const tools = ctx?.tools || [];
	const report = {
		turno: ctx?.turnId,
		iso: nowIso(),
		conversacion: ctx?.idConversacion,
		telefono: ctx?.telefonoWhatsApp,
		paciente: ctx?.textoEntrada,
		merged: ctx?.merged ? ctx.mergeCount : 1,
		ms: ctx ? Date.now() - ctx.startMs : 0,
		openai_llamadas: ctx?.openAiCalls,
		iteraciones: ctx?.iteraciones,
		tools_ejecutadas: tools.map((x) => ({
			nombre: x.nombre,
			ok: x.ok,
			ms: x.ms,
			args: x.args,
			resultado: x.resultado,
		})),
		estado_inicial: ctx?.estadoInicial,
		estado_final: ctx?.estadoFinal,
		bot_texto: result?.texto || null,
		bot_ticket: result?.ticket ? '(comprobante enviado)' : null,
		finalizar: Boolean(result?.finalizar),
		motivo: result?.motivo || null,
		eventos: ctx?.events,
	};

	line('');
	line('╔════════════════════════════════════════════════════════════════════╗');
	line('║  REPORTE COPIABLE — pegar en chat de debug                         ║');
	line('╚════════════════════════════════════════════════════════════════════╝');
	console.log(prettyJson(report, 12000));
	line('════════════════════════════════════════════════════════════════════');
}

function endTurn(result) {
	if (!enabled()) return;
	const t = getTurn();
	if (result?.estadoFinal) t.estadoFinal = result.estadoFinal;

	logIntegridad({
		textoFinal: result?.texto,
		toolsInvocadas: (t?.tools || []).map((x) => x.nombre),
	});

	line('');
	line('── RESULTADO TURNO ──');
	if (result?.texto) block('BOT RESPONDE', result.texto);
	if (result?.ticket) block('COMPROBANTE', result.ticket);
	if (result?.motivo && !result?.respondido) line(`motivo fallo: ${result.motivo}`);

	if (t?.estadoFinal) {
		block('ESTADO FINAL', prettyJson(t.estadoFinal, 3000));
	}

	const ms = t ? Date.now() - t.startMs : 0;
	const cadenaTools = (t?.tools || []).map((x) => `${x.nombre}${x.ok ? '' : '!'}`).join(' → ') || '(ninguna)';
	line(
		`resumen: ${ms}ms | openai=${t?.openAiCalls ?? 0} | iter=${t?.iteraciones ?? 0} | tools: ${cadenaTools} | finalizar=${Boolean(result?.finalizar)}`,
	);

	printCopiableReport(t, result);
}

module.exports = {
	enabled,
	runTurn,
	getTurn,
	logIteracion,
	logSystemPrompt,
	logHistorialMensajes,
	logOpenAiRequest,
	logOpenAiResponse,
	logToolResult,
	logNota,
	logIntegridad,
	endTurn,
};
