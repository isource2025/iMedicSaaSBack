/**
 * Traza en consola del ida y vuelta con la IA del agente de turnos.
 *
 * Activar (default ON salvo BOT_AGENTE_TRACE=0):
 *   BOT_AGENTE_TRACE=1  node scripts/bot_consola.js
 *   BOT_AGENTE_TRACE=1  npm run dev
 *
 * Filtro en logs: [agente-trace]
 */
const { AsyncLocalStorage } = require('async_hooks');

const turnStore = new AsyncLocalStorage();
let turnCounter = 0;

const C = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	bold: '\x1b[1m',
	cyan: '\x1b[36m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	red: '\x1b[31m',
	gray: '\x1b[90m',
};

function enabled() {
	return process.env.BOT_AGENTE_TRACE !== '0';
}

function trunc(s, max = 900) {
	const t = String(s ?? '');
	return t.length > max ? `${t.slice(0, max)}… (${t.length} chars)` : t;
}

function prettyJson(obj, max = 1200) {
	try {
		return trunc(JSON.stringify(obj, null, 2), max);
	} catch {
		return String(obj);
	}
}

function hr(char = '─', width = 76) {
	return C.gray + char.repeat(width) + C.reset;
}

function nowLabel() {
	return new Date().toLocaleTimeString('es-AR', { hour12: false });
}

function getTurn() {
	return turnStore.getStore() || null;
}

/**
 * Ejecuta un turno del agente con contexto de traza (AsyncLocalStorage).
 */
async function runTurn(meta, fn) {
	if (!enabled()) return fn();

	const turnId = ++turnCounter;
	const ctx = {
		turnId,
		idConversacion: meta.idConversacion,
		textoEntrada: meta.textoEntrada,
		estadoInicial: meta.estadoInicial,
		openAiCalls: 0,
		tools: [],
		startMs: Date.now(),
	};

	console.log('');
	console.log(hr('═'));
	console.log(
		`${C.bold}${C.cyan}[agente-trace]${C.reset} ${C.bold}TURNO #${turnId}${C.reset} ${C.dim}${nowLabel()}${C.reset}`,
	);
	console.log(`${C.dim}conv:${C.reset} ${meta.idConversacion || '?'}`);
	console.log(`${C.green}👤 PACIENTE:${C.reset} ${trunc(meta.textoEntrada, 500)}`);
	if (meta.estadoInicial) {
		console.log(`${C.dim}ESTADO INICIAL:${C.reset}`);
		console.log(C.gray + prettyJson(meta.estadoInicial, 800) + C.reset);
	}
	console.log(hr());

	try {
		const result = await turnStore.run(ctx, fn);
		endTurn(result);
		return result;
	} catch (err) {
		console.log(`${C.red}✗ ERROR TURNO:${C.reset} ${err.message}`);
		console.log(hr('═'));
		throw err;
	}
}

function logOpenAiRequest({ capa, messages, tools, toolChoice, extra }) {
	if (!enabled()) return;
	const t = getTurn();
	if (t) t.openAiCalls += 1;
	const n = t?.openAiCalls ?? '?';

	console.log(`${C.blue}→ OpenAI #${n}${C.reset} ${C.bold}${capa || 'chat'}${C.reset}`);
	if (extra) console.log(C.dim + prettyJson(extra, 400) + C.reset);

	const sys = (messages || []).find((m) => m.role === 'system');
	if (sys?.content) {
		console.log(`${C.dim}  system:${C.reset} ${trunc(sys.content, 600)}`);
	}
	const tail = (messages || []).filter((m) => m.role !== 'system').slice(-4);
	for (const m of tail) {
		const role =
			m.role === 'user'
				? `${C.green}user${C.reset}`
				: m.role === 'assistant'
					? `${C.magenta}assistant${C.reset}`
					: m.role === 'tool'
						? `${C.yellow}tool${C.reset}`
						: m.role;
		let body = m.content;
		if (m.tool_calls?.length) {
			body = `[tool_calls: ${m.tool_calls.map((c) => c.function?.name).join(', ')}]`;
		}
		console.log(`  ${role}: ${trunc(body, 350)}`);
	}
	if (tools?.length) {
		console.log(
			`${C.dim}  tools:${C.reset} ${tools.map((t) => t.function?.name).filter(Boolean).join(', ')}`,
		);
	}
	if (toolChoice && toolChoice !== 'auto') {
		console.log(`${C.dim}  tool_choice:${C.reset} ${JSON.stringify(toolChoice)}`);
	}
}

function logOpenAiResponse({ capa, content, toolCalls, finishReason, extra }) {
	if (!enabled()) return;
	console.log(`${C.magenta}← OpenAI${C.reset} ${capa || ''} finish=${finishReason || '?'}`);
	if (content) console.log(`  ${C.bold}texto:${C.reset} ${trunc(content, 500)}`);
	if (toolCalls?.length) {
		for (const tc of toolCalls) {
			let args = tc.function?.arguments;
			try {
				args = JSON.stringify(JSON.parse(args || '{}'), null, 0);
			} catch {
				/* keep raw */
			}
			console.log(`  ${C.yellow}⚡ tool_call:${C.reset} ${tc.function?.name}(${trunc(args, 200)})`);
		}
	}
	if (extra) console.log(C.dim + prettyJson(extra, 300) + C.reset);
}

function logToolResult({ nombre, args, resultado, ms, estadoSnapshot }) {
	if (!enabled()) return;
	const t = getTurn();
	if (t) t.tools.push({ nombre, args, ok: !resultado?.error, ms });

	const ok = !resultado?.error;
	const icon = ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
	console.log(`${icon} ${C.yellow}TOOL${C.reset} ${C.bold}${nombre}${C.reset} ${C.dim}(${ms}ms)${C.reset}`);
	console.log(`  ${C.dim}args:${C.reset} ${trunc(JSON.stringify(args || {}), 300)}`);
	console.log(`  ${C.dim}result:${C.reset} ${trunc(JSON.stringify(resultado || {}), 500)}`);
	if (estadoSnapshot) {
		console.log(`  ${C.dim}estado:${C.reset} ${trunc(JSON.stringify(estadoSnapshot), 400)}`);
	}
}

function logNota(msg, extra) {
	if (!enabled()) return;
	console.log(`${C.cyan}ℹ${C.reset} ${msg}`, extra != null ? prettyJson(extra, 200) : '');
}

function endTurn(result) {
	if (!enabled()) return;
	const t = getTurn();
	const ms = t ? Date.now() - t.startMs : 0;

	console.log(hr());
	if (result?.texto) {
		console.log(`${C.green}📤 BOT:${C.reset} ${trunc(result.texto, 800)}`);
	}
	if (result?.ticket) {
		console.log(`${C.green}🎫 COMPROBANTE:${C.reset} ${trunc(result.ticket, 400)}`);
	}
	console.log(
		`${C.dim}resumen:${C.reset} ${ms}ms | openai=${t?.openAiCalls ?? 0} | tools=${t?.tools?.length ?? 0} | finalizar=${Boolean(result?.finalizar)}`,
	);
	if (t?.tools?.length) {
		console.log(
			`${C.dim}tools usadas:${C.reset} ${t.tools.map((x) => `${x.nombre}${x.ok ? '' : '!'}`).join(' → ')}`,
		);
	}
	console.log(hr('═'));
	console.log('');
}

module.exports = {
	enabled,
	runTurn,
	getTurn,
	logOpenAiRequest,
	logOpenAiResponse,
	logToolResult,
	logNota,
	endTurn,
};
