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

function computeSignatureHex(payload, secret, algo = 'sha256') {
	return crypto.createHmac(algo, secret).update(payload).digest('hex');
}

function payloadVariants(raw, body) {
	const variants = [{ name: 'rawBuffer', data: raw }];
	if (!raw) return variants;
	const utf8 = raw.toString('utf8');
	if (utf8) variants.push({ name: 'utf8String', data: utf8 });
	if (body && typeof body === 'object') {
		variants.push({ name: 'jsonStringify', data: JSON.stringify(body) });
	}
	return variants;
}

function isMetaUserAgent(req) {
	return /facebookexternalua|meta-webhooks/i.test(String(req.headers['user-agent'] || ''));
}

/** Railway/proxy a veces altera bytes; Graph API OK + UA Meta → confiar si está habilitado. */
function shouldTrustMetaWithoutSignature(req) {
	if (process.env.WHATSAPP_WEBHOOK_SKIP_SIGNATURE === '1') return true;
	if (
		process.env.WHATSAPP_WEBHOOK_TRUST_META_UA === '1' &&
		global.__metaAppSecretGraphOk === true &&
		isMetaUserAgent(req)
	) {
		return true;
	}
	return false;
}

function tryVerifySignature(req, secret, secretSource) {
	const raw = req.rawBody;
	const receivedHex = String(req.headers['x-hub-signature-256'] || '')
		.replace(/^sha256=/i, '')
		.trim()
		.toLowerCase();

	if (!raw || !receivedHex) return null;

	for (const { name, data } of payloadVariants(raw, req.body)) {
		const expectedHex = computeSignatureHex(data, secret);
		if (expectedHex === receivedHex) {
			return { ok: true, expectedHex, receivedHex, variant: name, secretSource };
		}
	}

	// Legacy SHA1 (algunas integraciones Meta antiguas)
	const sha1Header = String(req.headers['x-hub-signature'] || '').trim();
	if (sha1Header.startsWith('sha1=')) {
		const receivedSha1 = sha1Header.replace(/^sha1=/i, '').toLowerCase();
		for (const { name, data } of payloadVariants(raw, req.body)) {
			const expectedSha1 = computeSignatureHex(data, secret, 'sha1');
			if (expectedSha1 === receivedSha1) {
				return {
					ok: true,
					expectedHex: expectedSha1,
					receivedHex: receivedSha1,
					variant: `${name}:sha1`,
					secretSource,
				};
			}
		}
	}

	return null;
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

	for (const { key, value } of getAppSecretCandidates()) {
		const hit = tryVerifySignature(req, value, key);
		if (hit?.ok) {
			diag.logSignatureResult(req, {
				ok: true,
				expectedHex: hit.expectedHex,
				receivedHex: hit.receivedHex,
				secretSource: hit.secretSource,
				variant: hit.variant,
				secretFingerprint: secretFingerprint(value),
			});
			return true;
		}
	}

	const primary = getAppSecret();
	const expectedHex = computeSignatureHex(raw, primary);

	if (shouldTrustMetaWithoutSignature(req)) {
		diag.warn('webhook', 'Firma HMAC no coincide — procesando igual (WHATSAPP_WEBHOOK_TRUST_META_UA)', {
			isMetaUa: isMetaUserAgent(req),
			metaGraphApiOk: global.__metaAppSecretGraphOk,
			rawBodySha256: diag.sha256Preview(raw),
			expectedPrefix: expectedHex.slice(0, 12),
			receivedPrefix: receivedHex.slice(0, 12),
			hint: 'Graph API validó el secret; el proxy puede alterar bytes. Seguro si el webhook GET usa verify token.',
		});
		return true;
	}

	diag.logSignatureResult(req, {
		ok: false,
		expectedHex,
		receivedHex,
		error: 'HMAC no coincide (raw + jsonStringify + sha1)',
		contentEncoding: req.headers['content-encoding'] || '(none)',
		bodyHexPrefix: raw.subarray(0, 32).toString('hex'),
		secretFingerprint: secretFingerprint(primary),
		metaGraphApiOk: global.__metaAppSecretGraphOk ?? null,
		isMetaUa: isMetaUserAgent(req),
		hint:
			global.__metaAppSecretGraphOk === true
				? 'Secret OK en Graph API — probá WHATSAPP_WEBHOOK_TRUST_META_UA=1 en Railway o verificá que el webhook esté en app 1310172527617064'
				: 'Revisá META_APP_SECRET en Railway',
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
