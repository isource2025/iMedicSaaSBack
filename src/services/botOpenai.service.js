/**
 * Cliente OpenAI Chat Completions para respuestas del bot WhatsApp.
 */
const agenteTrace = require('../utils/botAgenteTrace');

function getApiKey() {
	return String(process.env.OPENAI_API_KEY || '').trim();
}

function getModel() {
	return String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
}

function isConfigured() {
	return Boolean(getApiKey());
}

/**
 * @param {{ system: string, messages: Array<{ role: 'user'|'assistant', content: string }> }} opts
 * @returns {Promise<string>}
 */
async function chat({ system, messages }) {
	const apiKey = getApiKey();
	if (!apiKey) {
		const err = new Error('OPENAI_API_KEY no configurada');
		err.statusCode = 503;
		throw err;
	}

	const payload = {
		model: getModel(),
		messages: [{ role: 'system', content: system }, ...(messages || [])],
		temperature: Number(process.env.OPENAI_TEMPERATURE || 0.4),
		max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 500),
	};

	const resp = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	const data = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		const err = new Error(data?.error?.message || `OpenAI error ${resp.status}`);
		err.statusCode = resp.status >= 400 && resp.status < 500 ? resp.status : 502;
		err.openaiError = data?.error || null;
		throw err;
	}

	const text = data.choices?.[0]?.message?.content?.trim();
	if (!text) {
		const err = new Error('OpenAI no devolvió contenido');
		err.statusCode = 502;
		throw err;
	}
	return text;
}

/**
 * Chat Completions con function-calling (tools). Devuelve el mensaje crudo del
 * modelo (content + tool_calls) para que el llamador ejecute el bucle de
 * herramientas. No lanza si content viene vacío (puede venir solo tool_calls).
 *
 * @param {{
 *   messages: Array<object>,
 *   tools?: Array<object>,
 *   toolChoice?: 'auto'|'none'|object,
 *   temperature?: number,
 *   maxTokens?: number,
 * }} opts
 * @returns {Promise<{ content: string|null, toolCalls: Array<object>, finishReason: string }>}
 */
async function chatConHerramientas({ messages, tools, toolChoice = 'auto', temperature, maxTokens }) {
	const apiKey = getApiKey();
	if (!apiKey) {
		const err = new Error('OPENAI_API_KEY no configurada');
		err.statusCode = 503;
		throw err;
	}

	const payload = {
		model: getModel(),
		messages: messages || [],
		temperature:
			temperature != null ? temperature : Number(process.env.OPENAI_TEMPERATURE || 0.5),
		max_tokens: maxTokens != null ? maxTokens : Number(process.env.OPENAI_MAX_TOKENS || 600),
	};
	if (Array.isArray(tools) && tools.length) {
		payload.tools = tools;
		payload.tool_choice = toolChoice;
	}

	agenteTrace.logOpenAiRequest({
		capa: 'chatConHerramientas',
		messages: payload.messages,
		tools: payload.tools,
		toolChoice,
		extra: {
			model: payload.model,
			temperature: payload.temperature,
			max_tokens: payload.max_tokens,
		},
	});

	const resp = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	const data = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		const err = new Error(data?.error?.message || `OpenAI error ${resp.status}`);
		err.statusCode = resp.status >= 400 && resp.status < 500 ? resp.status : 502;
		err.openaiError = data?.error || null;
		throw err;
	}

	const choice = data.choices?.[0] || {};
	const msg = choice.message || {};
	const out = {
		content: msg.content ? String(msg.content).trim() : null,
		toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
		finishReason: choice.finish_reason || null,
		rawMessage: msg,
	};

	agenteTrace.logOpenAiResponse({
		capa: 'chatConHerramientas',
		content: out.content,
		toolCalls: out.toolCalls,
		finishReason: out.finishReason,
		usage: data.usage || null,
	});

	return out;
}

/**
 * Chat Completions con respuesta JSON estructurada (clasificación de intención, etc.).
 *
 * @param {{ system: string, messages?: Array<object>, temperature?: number, maxTokens?: number }} opts
 * @returns {Promise<object>}
 */
async function chatJson({ system, messages, temperature, maxTokens }) {
	const apiKey = getApiKey();
	if (!apiKey) {
		const err = new Error('OPENAI_API_KEY no configurada');
		err.statusCode = 503;
		throw err;
	}

	const payload = {
		model: getModel(),
		messages: [{ role: 'system', content: system }, ...(messages || [])],
		temperature: temperature != null ? temperature : 0.1,
		max_tokens: maxTokens != null ? maxTokens : 400,
		response_format: { type: 'json_object' },
	};

	const resp = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	const data = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		const err = new Error(data?.error?.message || `OpenAI error ${resp.status}`);
		err.statusCode = resp.status >= 400 && resp.status < 500 ? resp.status : 502;
		err.openaiError = data?.error || null;
		throw err;
	}

	const raw = data.choices?.[0]?.message?.content?.trim();
	if (!raw) {
		const err = new Error('OpenAI no devolvió JSON');
		err.statusCode = 502;
		throw err;
	}
	try {
		return JSON.parse(raw);
	} catch {
		const err = new Error('OpenAI devolvió JSON inválido');
		err.statusCode = 502;
		throw err;
	}
}

module.exports = {
	getApiKey,
	getModel,
	isConfigured,
	chat,
	chatConHerramientas,
	chatJson,
};
