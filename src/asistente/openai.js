/**
 * Cliente OpenAI propio del asistente de plataforma.
 * No comparte estado ni prompts con el bot de WhatsApp.
 */
const TIMEOUT_MS = Number(process.env.ASISTENTE_OPENAI_TIMEOUT_MS) || 90000;

function getApiKey() {
	return String(process.env.ASISTENTE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
}

function getModel() {
	return String(process.env.ASISTENTE_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
}

function isConfigured() {
	return Boolean(getApiKey());
}

async function chatConHerramientas({
	messages,
	tools,
	toolChoice = 'auto',
	temperature,
	maxTokens,
}) {
	const apiKey = getApiKey();
	if (!apiKey) {
		const err = new Error('ASISTENTE_OPENAI_API_KEY / OPENAI_API_KEY no configurada');
		err.statusCode = 503;
		throw err;
	}

	const payload = {
		model: getModel(),
		messages: messages || [],
		temperature:
			temperature != null ? temperature : Number(process.env.ASISTENTE_OPENAI_TEMPERATURE || 0.3),
		max_tokens: maxTokens != null ? maxTokens : Number(process.env.ASISTENTE_OPENAI_MAX_TOKENS || 2500),
	};
	if (Array.isArray(tools) && tools.length) {
		payload.tools = tools;
		payload.tool_choice = toolChoice;
	}

	const resp = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(TIMEOUT_MS),
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
	return {
		content: msg.content ? String(msg.content).trim() : null,
		toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
		finishReason: choice.finish_reason || null,
		usage: data.usage || null,
		modelo: data.model || payload.model,
	};
}

module.exports = {
	getApiKey,
	getModel,
	isConfigured,
	chatConHerramientas,
};
