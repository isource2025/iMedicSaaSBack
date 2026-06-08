/**
 * Envío de mensajes vía Meta Graph API (WhatsApp Cloud API).
 * Credenciales por empresa vienen de whatsappEmpresa.service.
 */
const crypto = require('crypto');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const diag = require('../utils/diagLog');

function normalizeSecret(val) {
	return String(val || '')
		.trim()
		.replace(/^["']+|["']+$/g, '');
}

function getAppSecret() {
	return normalizeSecret(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET);
}

/** Candidatos para validar firma (por si hay typo en nombre de variable). */
function getAppSecretCandidates() {
	const out = [];
	const seen = new Set();
	for (const key of ['META_APP_SECRET', 'WHATSAPP_APP_SECRET']) {
		const value = normalizeSecret(process.env[key]);
		if (!value || seen.has(value)) continue;
		seen.add(value);
		out.push({ key, value });
	}
	return out;
}

function secretFingerprint(secret) {
	return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 8);
}

function computeSignatureHex(raw, secret) {
	return crypto.createHmac('sha256', secret).update(raw).digest('hex');
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
	if (!secret) {
		diag.warn('webhook', 'META_APP_SECRET no configurado — firma omitida');
		return true;
	}

	const signature = String(req.headers['x-hub-signature-256'] || '').trim();
	if (!signature) {
		diag.logSignatureResult(req, { ok: false, error: 'Falta cabecera X-Hub-Signature-256' });
		const err = new Error('Falta cabecera X-Hub-Signature-256');
		err.statusCode = 401;
		throw err;
	}

	const raw = req.rawBody;
	if (!raw) {
		diag.warn('webhook', 'rawBody no disponible — firma NO validada (riesgo)', {
			contentType: req.headers['content-type'],
			contentLength: req.headers['content-length'],
			contentEncoding: req.headers['content-encoding'] || '(none)',
		});
		return true;
	}

	const receivedHex = signature.replace(/^sha256=/i, '').trim().toLowerCase();
	const candidates = getAppSecretCandidates();

	for (const { key, value } of candidates) {
		const expectedHex = computeSignatureHex(raw, value);
		if (expectedHex === receivedHex) {
			diag.logSignatureResult(req, {
				ok: true,
				expectedHex,
				receivedHex,
				secretSource: key,
				secretFingerprint: secretFingerprint(value),
			});
			return true;
		}
	}

	const primary = getAppSecret();
	const expectedHex = primary ? computeSignatureHex(raw, primary) : null;

	diag.logSignatureResult(req, {
		ok: false,
		expectedHex,
		receivedHex,
		error: 'HMAC no coincide',
		contentEncoding: req.headers['content-encoding'] || '(none)',
		bodyHexPrefix: raw.subarray(0, 32).toString('hex'),
		secretFingerprint: primary ? secretFingerprint(primary) : null,
		candidatesChecked: candidates.map((c) => c.key),
		metaGraphApiOk: global.__metaAppSecretGraphOk ?? null,
	});

	const err = new Error(
		'Firma webhook inválida — revisá META_APP_SECRET en Railway (Meta Developers → App → Configuración básica → Clave secreta)',
	);
	err.statusCode = 401;
	throw err;
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
	getAppSecretCandidates,
	secretFingerprint,
	normalizarTelefonoWa,
	verificarFirmaWebhook,
	sendTextMessage,
};
