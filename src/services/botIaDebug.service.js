/**
 * Traza request/response de capas IA (OpenAI) cuando BOT_IA_DEBUG=1.
 * En Railway: ver logs con filtro [diag:ia].
 */
const diag = require('../utils/diagLog');

function enabled() {
	return process.env.BOT_IA_DEBUG === '1' || process.env.BOT_IA_DEBUG === 'true';
}

function trunc(s, max = 1200) {
	const t = String(s || '');
	return t.length > max ? `${t.slice(0, max)}…(${t.length} chars)` : t;
}

function logRequest({ capa, system, messages, extra }) {
	if (!enabled()) return;
	diag.line('ia', `→ ${capa} REQUEST`, {
		...(extra || {}),
		system: trunc(system, 800),
		messages: (messages || []).map((m) => ({
			role: m.role,
			content: trunc(m.content, 400),
		})),
	});
}

function logResponse({ capa, raw, parsed, extra }) {
	if (!enabled()) return;
	diag.line('ia', `← ${capa} RESPONSE`, {
		...(extra || {}),
		raw: trunc(raw, 600),
		parsed: parsed || undefined,
	});
}

function logDecision({ capa, decision, extra }) {
	if (!enabled()) return;
	diag.line('ia', `◆ ${capa} DECISION`, { decision, ...(extra || {}) });
}

module.exports = {
	enabled,
	logRequest,
	logResponse,
	logDecision,
};
