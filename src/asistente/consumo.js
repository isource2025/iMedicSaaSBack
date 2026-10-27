/**
 * Medidor de consumo de un pedido al asistente.
 *
 * Los tokens y el costo salen del `usage` real que devuelve OpenAI en cada llamada.
 * El tokenizador sólo se usa para repartir ese total entre las partes del prompt
 * (sistema, definiciones de herramientas, historial, resultados...) y entre herramientas:
 * la proporción es estimada, el total no.
 */
const tokens = require('./tokens');
const costos = require('./costos');

const OVERHEAD_MENSAJE = 3;
const OVERHEAD_PROMPT = 3;

const CATEGORIAS = [
	'sistema',
	'definicionesHerramientas',
	'historial',
	'mensaje',
	'argumentosHerramientas',
	'resultadosHerramientas',
];

const tokensMensaje = new WeakMap();
const tokensTools = new WeakMap();

function contarMensaje(m) {
	if (tokensMensaje.has(m)) return tokensMensaje.get(m);
	let n = OVERHEAD_MENSAJE + tokens.contar(m.content || '');
	if (Array.isArray(m.tool_calls)) {
		for (const c of m.tool_calls) n += tokens.contar(c.function?.name || '') + tokens.contar(c.function?.arguments || '');
	}
	tokensMensaje.set(m, n);
	return n;
}

function contarTools(tools) {
	if (!Array.isArray(tools) || !tools.length) return 0;
	if (tokensTools.has(tools)) return tokensTools.get(tools);
	const n = tokens.contar(JSON.stringify(tools));
	tokensTools.set(tools, n);
	return n;
}

/** Reparte el prompt de una llamada por categoría y por herramienta (tokens estimados). */
function componer(messages, tools) {
	const cats = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]));
	cats.definicionesHerramientas = contarTools(tools);
	const nombrePorId = new Map();
	const porHerramienta = {};
	const lista = Array.isArray(messages) ? messages : [];
	let ultimoUsuario = -1;
	lista.forEach((m, i) => {
		if (m?.role === 'user') ultimoUsuario = i;
	});
	lista.forEach((m, i) => {
		if (!m) return;
		const t = contarMensaje(m);
		if (m.role === 'system') cats.sistema += t;
		else if (m.role === 'tool') {
			cats.resultadosHerramientas += t;
			const nombre = nombrePorId.get(m.tool_call_id) || 'desconocida';
			porHerramienta[nombre] = (porHerramienta[nombre] || 0) + t;
		} else if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
			cats.argumentosHerramientas += t;
			for (const c of m.tool_calls) nombrePorId.set(c.id, c.function?.name || 'desconocida');
		} else if (i === ultimoUsuario) cats.mensaje += t;
		else cats.historial += t;
	});
	cats.sistema += OVERHEAD_PROMPT;
	const total = CATEGORIAS.reduce((s, c) => s + cats[c], 0);
	return { cats, porHerramienta, total };
}

function crearMedidor() {
	const llamadas = [];
	const externos = [];
	const composicion = Object.fromEntries(CATEGORIAS.map((c) => [c, { tokens: 0, usd: 0 }]));
	const herramientas = new Map();
	let estimadoTotal = 0;
	let realTotal = 0;
	const inicio = Date.now();

	function herr(nombre) {
		if (!herramientas.has(nombre)) {
			herramientas.set(nombre, { nombre, veces: 0, tokensReenviados: 0, usd: 0 });
		}
		return herramientas.get(nombre);
	}

	/**
	 * @param {{ messages: object[], tools?: object[], salida: object, ms?: number, error?: boolean }} p
	 */
	function registrarLlamada({ messages, tools, salida, ms, error }) {
		const comp = componer(messages, tools);
		const modelo = salida?.modelo || null;
		let usage = salida?.usage;
		if (!usage) {
			const salidaEst =
				tokens.contar(salida?.content || '') +
				(salida?.toolCalls || []).reduce((s, c) => s + tokens.contar(c.function?.arguments || ''), 0);
			usage = { prompt_tokens: comp.total, completion_tokens: salidaEst, estimado: true };
		}
		const c = costos.costoDe(usage, modelo);
		const escala = comp.total ? c.entrada / comp.total : 1;
		estimadoTotal += comp.total;
		realTotal += c.entrada;

		for (const cat of CATEGORIAS) {
			const parte = comp.total ? comp.cats[cat] / comp.total : 0;
			composicion[cat].tokens += comp.cats[cat] * escala;
			composicion[cat].usd += c.entradaUsd * parte;
		}
		for (const [nombre, t] of Object.entries(comp.porHerramienta)) {
			const h = herr(nombre);
			h.tokensReenviados += t * escala;
			h.usd += comp.total ? c.entradaUsd * (t / comp.total) : 0;
		}
		const pidio = (salida?.toolCalls || []).map((tc) => tc.function?.name || 'desconocida');
		for (const nombre of pidio) {
			const h = herr(nombre);
			h.veces += 1;
			h.usd += c.salidaUsd / pidio.length;
		}

		llamadas.push({
			n: llamadas.length + 1,
			modelo: c.precio.modelo,
			entrada: c.entrada,
			cacheadas: c.cacheadas,
			salida: c.salida,
			usd: c.usd,
			ms: ms || null,
			fin: salida?.finishReason || (error ? 'error' : null),
			pidio,
			estimado: Boolean(usage.estimado),
		});
	}

	/** Llamadas a OpenAI hechas por un endpoint que usó una herramienta (ej. epicrisis IA). */
	function registrarExterno({ origen, herramienta, modelo, usage }) {
		if (!usage) return;
		const c = costos.costoDe(usage, modelo);
		externos.push({ origen, herramienta: herramienta || null, modelo: c.precio.modelo, ...pickTokens(c), usd: c.usd });
		if (herramienta) herr(herramienta).usd += c.usd;
	}

	function resumen() {
		const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);
		const todos = [...llamadas, ...externos];
		const usd = sum(todos, 'usd');
		const ars = costos.cotizacionArs();
		const totalComp = CATEGORIAS.reduce((s, cat) => s + composicion[cat].tokens, 0) || 1;
		return {
			modelo: llamadas[0]?.modelo || null,
			llamadas: llamadas.length,
			llamadasExternas: externos.length,
			ms: Date.now() - inicio,
			tokens: {
				entrada: sum(todos, 'entrada'),
				cacheadas: sum(todos, 'cacheadas'),
				salida: sum(todos, 'salida'),
				total: sum(todos, 'entrada') + sum(todos, 'salida'),
			},
			costoUsd: costos.redondear(usd),
			costoArs: ars ? Math.round(usd * ars * 100) / 100 : null,
			composicionEntrada: Object.fromEntries(
				CATEGORIAS.map((cat) => [
					cat,
					{
						tokens: Math.round(composicion[cat].tokens),
						pct: Math.round((composicion[cat].tokens / totalComp) * 1000) / 10,
						costoUsd: costos.redondear(composicion[cat].usd),
					},
				]),
			),
			porHerramienta: [...herramientas.values()]
				.map((h) => ({
					nombre: h.nombre,
					veces: h.veces,
					tokensReenviados: Math.round(h.tokensReenviados),
					costoUsd: costos.redondear(h.usd),
				}))
				.sort((a, b) => b.costoUsd - a.costoUsd),
			porLlamada: llamadas.map((l) => ({ ...l, usd: costos.redondear(l.usd) })),
			externos: externos.map((e) => ({ ...e, usd: costos.redondear(e.usd) })),
			tokenizador: tokens.nombreTokenizador(),
			calibracion: estimadoTotal ? Math.round((realTotal / estimadoTotal) * 1000) / 1000 : null,
		};
	}

	return { registrarLlamada, registrarExterno, resumen, get llamadas() { return llamadas.length; } };
}

function pickTokens(c) {
	return { entrada: c.entrada, cacheadas: c.cacheadas, salida: c.salida };
}

/** Envuelve una función `chat` del loop para medir cada llamada sin tocar el loop. */
function medirChat(chat, medidor) {
	return async (opts) => {
		const t0 = Date.now();
		try {
			const salida = await chat(opts);
			medidor.registrarLlamada({ messages: opts.messages, tools: opts.tools, salida, ms: Date.now() - t0 });
			return salida;
		} catch (err) {
			if (err?.usage) {
				medidor.registrarLlamada({ messages: opts.messages, tools: opts.tools, salida: { usage: err.usage }, ms: Date.now() - t0, error: true });
			}
			throw err;
		}
	};
}

function lineaLog(r) {
	if (!r?.llamadas && !r?.llamadasExternas) return null;
	const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
	return `[asistente] US$${r.costoUsd.toFixed(5)} · ${r.llamadas} llamadas${r.llamadasExternas ? ` +${r.llamadasExternas} ext` : ''} · ${k(r.tokens.entrada)} in (${k(r.tokens.cacheadas)} cache) · ${k(r.tokens.salida)} out · ${r.modelo} · ${r.ms}ms`;
}

module.exports = { crearMedidor, medirChat, componer, lineaLog, CATEGORIAS };
