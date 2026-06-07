const { runWithTenant } = require('../context/tenantContext');

function parseApiKeys() {
	const raw = process.env.BOT_API_KEYS;
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') return parsed;
		} catch {
			/* fallback below */
		}
	}
	const singleKey = process.env.BOT_API_KEY;
	const singleEmpresa = process.env.BOT_EMPRESA_ID;
	if (singleKey && singleEmpresa) {
		return { [String(singleEmpresa)]: singleKey };
	}
	return {};
}

function resolveEmpresaFromRequest(req, apiKeys) {
	const headerEmpresa = req.headers['x-empresa-id'];
	const queryEmpresa = req.query?.idEmpresa;
	const raw = headerEmpresa ?? queryEmpresa ?? process.env.BOT_EMPRESA_ID ?? null;
	if (raw == null || raw === '') return null;
	const id = Number(raw);
	return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Autenticación por API Key para integraciones externas (chatbot WhatsApp).
 * Headers: X-API-Key, X-Empresa-Id (opcional si BOT_EMPRESA_ID está definido).
 */
function requireBotApiKey(req, res, next) {
	const apiKeys = parseApiKeys();
	if (!Object.keys(apiKeys).length) {
		return res.status(503).json({
			success: false,
			code: 'BOT_API_NOT_CONFIGURED',
			mensaje: 'API de bot no configurada (BOT_API_KEY / BOT_API_KEYS)',
		});
	}

	const provided = req.headers['x-api-key'] || req.headers['x-bot-api-key'];
	if (!provided || typeof provided !== 'string') {
		return res.status(401).json({
			success: false,
			code: 'API_KEY_REQUERIDA',
			mensaje: 'Header X-API-Key requerido',
		});
	}

	const idEmpresa = resolveEmpresaFromRequest(req, apiKeys);
	if (!idEmpresa) {
		return res.status(400).json({
			success: false,
			code: 'EMPRESA_REQUERIDA',
			mensaje: 'Header X-Empresa-Id o query idEmpresa requerido',
		});
	}

	const expected = apiKeys[String(idEmpresa)];
	if (!expected || expected !== provided.trim()) {
		return res.status(401).json({
			success: false,
			code: 'API_KEY_INVALIDA',
			mensaje: 'API Key inválida para la empresa indicada',
		});
	}

	req.botContext = {
		idEmpresa,
		codOperador: Number(process.env.BOT_COD_OPERADOR) || 0,
	};
	req.idEmpresa = idEmpresa;

	return runWithTenant(idEmpresa, () => next());
}

module.exports = { requireBotApiKey, parseApiKeys };
