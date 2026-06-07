/**
 * Cliente OpenAI Chat Completions para respuestas del bot WhatsApp.
 */
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

module.exports = {
	getApiKey,
	getModel,
	isConfigured,
	chat,
};
