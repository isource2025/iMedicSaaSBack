/**
 * Envío de mensajes vía Meta Graph API (WhatsApp Cloud API).
 * Credenciales por empresa vienen de whatsappEmpresa.service.
 */
const crypto = require('crypto');
const whatsappEmpresa = require('./whatsappEmpresa.service');

function getAppSecret() {
	return String(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '').trim();
}

function normalizarTelefonoWa(to) {
	return String(to || '').replace(/\D/g, '');
}

/**
 * Valida X-Hub-Signature-256 del webhook Meta.
 * Si META_APP_SECRET no está configurado, omite la validación (dev).
 */
function verificarFirmaWebhook(req) {
	const secret = getAppSecret();
	if (!secret) return true;

	const signature = req.headers['x-hub-signature-256'];
	if (!signature) {
		const err = new Error('Falta cabecera X-Hub-Signature-256');
		err.statusCode = 401;
		throw err;
	}

	const raw = req.rawBody;
	if (!raw) {
		console.warn('[whatsappMeta] rawBody no disponible; no se validó firma');
		return true;
	}

	const expected =
		'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

	try {
		const sigBuf = Buffer.from(String(signature));
		const expBuf = Buffer.from(expected);
		if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
			const err = new Error('Firma webhook inválida');
			err.statusCode = 401;
			throw err;
		}
	} catch (e) {
		if (e.statusCode) throw e;
		const err = new Error('Firma webhook inválida');
		err.statusCode = 401;
		throw err;
	}
	return true;
}

/**
 * @returns {Promise<{ messageId: string|null, waId: string|null }>}
 */
async function sendTextMessage({ phoneNumberId, accessToken, to, text }) {
	const phoneId = String(phoneNumberId || '').trim();
	const token = String(accessToken || '').trim();
	const body = String(text || '').trim();
	const toNorm = normalizarTelefonoWa(to);

	if (!phoneId || !token) {
		const err = new Error('WhatsApp no configurado para esta empresa (phoneNumberId / accessToken)');
		err.statusCode = 503;
		throw err;
	}
	if (!toNorm) {
		const err = new Error('Teléfono destino inválido');
		err.statusCode = 400;
		throw err;
	}
	if (!body) {
		const err = new Error('El mensaje no puede estar vacío');
		err.statusCode = 400;
		throw err;
	}

	const version = whatsappEmpresa.graphVersion();
	const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;

	const resp = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: toNorm,
			type: 'text',
			text: { preview_url: false, body },
		}),
	});

	const data = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		const err = new Error(data?.error?.message || `Graph API error ${resp.status}`);
		err.statusCode = resp.status >= 400 && resp.status < 500 ? resp.status : 502;
		err.metaError = data?.error || null;
		throw err;
	}

	return {
		messageId: data.messages?.[0]?.id || null,
		waId: data.contacts?.[0]?.wa_id || null,
	};
}

module.exports = {
	getAppSecret,
	normalizarTelefonoWa,
	verificarFirmaWebhook,
	sendTextMessage,
};
