/**
 * Precios de lista de OpenAI en USD por 1M de tokens.
 * Se pueden pisar sin tocar código con ASISTENTE_PRECIOS (JSON), por ejemplo:
 *   ASISTENTE_PRECIOS={"gpt-4o-mini":{"entrada":0.15,"cache":0.075,"salida":0.6}}
 * El modelo se busca por prefijo más largo ("gpt-4o-mini-2024-07-18" → "gpt-4o-mini").
 */
const PRECIOS_BASE = {
	'gpt-4o-mini': { entrada: 0.15, cache: 0.075, salida: 0.6 },
	'gpt-4o': { entrada: 2.5, cache: 1.25, salida: 10 },
	'gpt-4.1-nano': { entrada: 0.1, cache: 0.025, salida: 0.4 },
	'gpt-4.1-mini': { entrada: 0.4, cache: 0.1, salida: 1.6 },
	'gpt-4.1': { entrada: 2, cache: 0.5, salida: 8 },
	'gpt-5-nano': { entrada: 0.05, cache: 0.005, salida: 0.4 },
	'gpt-5-mini': { entrada: 0.25, cache: 0.025, salida: 2 },
	'gpt-5': { entrada: 1.25, cache: 0.125, salida: 10 },
	'o4-mini': { entrada: 1.1, cache: 0.275, salida: 4.4 },
};

let cache = null;

function tabla() {
	if (cache) return cache;
	let extra = {};
	try {
		extra = process.env.ASISTENTE_PRECIOS ? JSON.parse(process.env.ASISTENTE_PRECIOS) : {};
	} catch (e) {
		console.warn('[asistente] ASISTENTE_PRECIOS inválido, se usan precios base:', e.message);
	}
	cache = { ...PRECIOS_BASE, ...extra };
	return cache;
}

function precioDe(modelo) {
	const t = tabla();
	const m = String(modelo || '').toLowerCase();
	const clave = Object.keys(t)
		.filter((k) => m === k || m.startsWith(`${k}-`))
		.sort((a, b) => b.length - a.length)[0];
	return clave ? { modelo: clave, ...t[clave], conocido: true } : { modelo: m, ...t['gpt-4o-mini'], conocido: false };
}

/** Normaliza el `usage` de Chat Completions. */
function tokensDe(usage) {
	const entrada = Number(usage?.prompt_tokens) || 0;
	const cacheadas = Math.min(Number(usage?.prompt_tokens_details?.cached_tokens) || 0, entrada);
	const salida = Number(usage?.completion_tokens) || 0;
	return { entrada, cacheadas, salida, total: entrada + salida };
}

function costoDe(usage, modelo) {
	const p = precioDe(modelo);
	const t = tokensDe(usage);
	const entradaUsd = ((t.entrada - t.cacheadas) * p.entrada + t.cacheadas * p.cache) / 1e6;
	const salidaUsd = (t.salida * p.salida) / 1e6;
	return { ...t, entradaUsd, salidaUsd, usd: entradaUsd + salidaUsd, precio: p };
}

function cotizacionArs() {
	const v = Number(process.env.ASISTENTE_USD_ARS);
	return Number.isFinite(v) && v > 0 ? v : null;
}

function redondear(usd) {
	return Math.round((Number(usd) || 0) * 1e6) / 1e6;
}

function _reiniciar() {
	cache = null;
}

module.exports = { PRECIOS_BASE, precioDe, tokensDe, costoDe, cotizacionArs, redondear, _reiniciar };
