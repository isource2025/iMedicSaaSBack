/**
 * Traza compacta del agente IA — siempre activa.
 * Buscar: [agente-trace]
 * Al final de cada turno: un JSON "REPORTE" para copiar/pegar en debug.
 */
const { AsyncLocalStorage } = require('async_hooks');

const turnStore = new AsyncLocalStorage();
let turnCounter = 0;
let logChain = Promise.resolve();

const MARK = '[agente-trace]';

function enabled() {
	return true;
}

function getTurn() {
	return turnStore.getStore() || null;
}

/** Evita que líneas de dos turnos se intercalen en Railway. */
function emit(text) {
	logChain = logChain.then(() => {
		console.log(text);
	});
}

function emitBlock(lines) {
	const body = Array.isArray(lines) ? lines.join('\n') : String(lines);
	emit(`${MARK} ${body.replace(/\n/g, `\n${MARK} `)}`);
}

function trunc(s, max = 600) {
	const t = String(s ?? '');
	return t.length > max ? `${t.slice(0, max)}…[+${t.length - max}]` : t;
}

function prettyJson(obj, max = 4000) {
	try {
		return trunc(JSON.stringify(obj, null, 2), max);
	} catch {
		return String(obj);
	}
}

function nowIso() {
	return new Date().toISOString();
}

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

	emitBlock([
		`════ TURNO #${turnId} | ${nowIso()} | conv=${meta.idConversacion || '?'}`,
		`PACIENTE: ${trunc(meta.textoEntrada, 400)}`,
		meta.merged && meta.mergeCount > 1
			? `COLA: ${meta.mergeCount} msgs → ${trunc(meta.textosMerged?.join(' | '), 300)}`
			: null,
		`ESTADO_INICIAL: ${trunc(JSON.stringify(meta.estadoInicial), 500)}`,
		`historial=${ctx.historialCount} msgs`,
	].filter(Boolean));

	try {
		const result = await turnStore.run(ctx, fn);
		await endTurn(result);
		return result;
	} catch (err) {
		emitBlock([`ERROR: ${err.message}`, trunc(err.stack, 800)]);
		await printReport(ctx, { error: err.message });
		throw err;
	}
}

function logIteracion(n, max) {
	const t = getTurn();
	if (t) {
		t.iteraciones = n;
		t._push?.('iter', `${n}/${max}`);
	}
	emit(`${MARK} ── iter ${n}/${max} ──`);
}

function logSystemPrompt(content) {
	const t = getTurn();
	const len = String(content || '').length;
	t?._push?.('prompt', `${len} chars`);
	// Resumen, no dump completo (evita miles de líneas y lentitud).
	const lines = String(content || '').split('\n');
	const preview = [
		lines[0],
		lines.find((l) => l.includes('INTEGRIDAD')) || '',
		lines.find((l) => l.includes('candidatosProfesionales')) || '',
	].filter(Boolean);
	emit(`${MARK} PROMPT (${len} chars): ${preview.map((l) => trunc(l, 120)).join(' | ')}`);
}

function logHistorialMensajes(messages) {
	const t = getTurn();
	const list = (messages || []).filter((m) => m.role !== 'system');
	t?._push?.('historial', list.length);
	const tail = list.slice(-6).map((m, i) => {
		let body = m.content;
		if (m.tool_calls?.length) {
			body = `[tools: ${m.tool_calls.map((c) => c.function?.name).join(',')}]`;
		}
		if (m.role === 'tool') body = trunc(m.content, 200);
		return `${m.role}: ${trunc(body, 150)}`;
	});
	emit(`${MARK} HISTORIAL (${list.length}): ${tail.join(' → ')}`);
}

function logOpenAiRequest({ capa, messages, tools, extra }) {
	const t = getTurn();
	if (t) t.openAiCalls += 1;
	const n = t?.openAiCalls ?? '?';
	const hist = (messages || []).filter((m) => m.role !== 'system').length;
	emit(
		`${MARK} → OpenAI #${n} ${capa || ''} model=${extra?.model || '?'} msgs=${hist} tools=${tools?.length || 0}`,
	);
	t?._push?.('openai→', `#${n}`);
}

function logOpenAiResponse({ content, toolCalls, finishReason, usage }) {
	const t = getTurn();
	const names = (toolCalls || []).map((c) => c.function?.name).join(',') || '-';
	emit(
		`${MARK} ← OpenAI finish=${finishReason || '?'} tools=[${names}] texto=${content ? trunc(content, 120) : '(vacío)'} tokens=${usage?.total_tokens || '?'}`,
	);
	if (toolCalls?.length) {
		for (const tc of toolCalls) {
			let args = tc.function?.arguments;
			try {
				args = JSON.stringify(JSON.parse(args || '{}'));
			} catch {
				/* raw */
			}
			emit(`${MARK}   ⚡ ${tc.function?.name}(${trunc(args, 150)})`);
		}
	}
	t?._push?.('openai←', `${finishReason} [${names}]`);
}

function logToolResult({ nombre, args, resultado, ms, estadoSnapshot }) {
	const t = getTurn();
	const ok = !resultado?.error;
	if (t) t.tools.push({ nombre, args, ok, ms, resultado });
	const resumen = ok
		? trunc(JSON.stringify(resultado), 250)
		: `ERROR: ${resultado?.error || '?'}`;
	emit(`${MARK} ${ok ? '✓' : '✗'} TOOL ${nombre} (${ms}ms) args=${trunc(JSON.stringify(args), 100)} → ${resumen}`);
	if (estadoSnapshot) {
		emit(`${MARK}   estado: ${trunc(JSON.stringify(estadoSnapshot), 200)}`);
	}
	t?._push?.('tool', `${nombre} ${ok ? 'OK' : 'FAIL'}`);
}

function logNota(msg, extra) {
	emit(`${MARK} ℹ ${msg}${extra != null ? ` ${trunc(JSON.stringify(extra), 200)}` : ''}`);
	getTurn()?._push?.('nota', msg);
}

function logIntegridad({ textoFinal, toolsInvocadas }) {
	const tools = toolsInvocadas || [];
	if (!tools.includes('buscar_turno')) {
		const texto = String(textoFinal || '').toLowerCase();
		const habla =
			/no hay|sin turno|sin disponibilidad|lamentablemente/i.test(texto) ||
			/te ofrezco|disponible|turno para/i.test(texto) ||
			/\d{1,2}\/\d{1,2}/.test(texto);
		if (habla) {
			emit(`${MARK} ⚠ ALERTA: habla de cupo/fecha pero NO llamó buscar_turno`);
			getTurn()?._push?.('alerta', 'sin_buscar_turno');
		}
	}
}

async function printReport(ctx, result) {
	const tools = ctx?.tools || [];
	const report = {
		turno: ctx?.turnId,
		iso: nowIso(),
		conversacion: ctx?.idConversacion,
		telefono: ctx?.telefonoWhatsApp,
		paciente: ctx?.textoEntrada,
		ms: ctx ? Date.now() - ctx.startMs : 0,
		openai: ctx?.openAiCalls,
		iteraciones: ctx?.iteraciones,
		tools: tools.map((x) => ({
			n: x.nombre,
			ok: x.ok,
			ms: x.ms,
			args: x.args,
			resultado: x.resultado,
		})),
		estado_inicial: ctx?.estadoInicial,
		estado_final: ctx?.estadoFinal,
		bot: result?.texto ? trunc(result.texto, 500) : null,
		ticket: result?.ticket ? 'sí' : 'no',
		finalizar: Boolean(result?.finalizar),
		motivo: result?.motivo || result?.error || null,
		eventos: ctx?.events,
	};

	emit(`${MARK} ═══ REPORTE COPIABLE ═══`);
	emit(`${MARK} ${prettyJson(report, 8000)}`);
	emit(`${MARK} ═══════════════════════`);
	await logChain;
}

async function endTurn(result) {
	if (!enabled()) return;
	const t = getTurn();
	if (result?.estadoFinal) t.estadoFinal = result.estadoFinal;

	logIntegridad({
		textoFinal: result?.texto,
		toolsInvocadas: (t?.tools || []).map((x) => x.nombre),
	});

	const ms = t ? Date.now() - t.startMs : 0;
	const cadena = (t?.tools || []).map((x) => `${x.nombre}${x.ok ? '' : '!'}`).join('→') || '-';
	emitBlock([
		`RESULTADO (${ms}ms) openai=${t?.openAiCalls ?? 0} tools=${cadena} finalizar=${Boolean(result?.finalizar)}`,
		result?.texto ? `BOT: ${trunc(result.texto, 500)}` : `SIN_TEXTO motivo=${result?.motivo || '?'}`,
		result?.estadoFinal ? `ESTADO_FINAL: ${trunc(JSON.stringify(result.estadoFinal), 400)}` : null,
	].filter(Boolean));

	await printReport(t, result);
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
