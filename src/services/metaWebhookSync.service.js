/**
 * Alinea el callback_url de Meta con este backend (Railway).
 * Meta solo entrega mensajes al dominio registrado en la app.
 */
const diag = require('../utils/diagLog');

function expectedCallbackUrl() {
	const domain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
	if (!domain) return null;
	const host = domain.replace(/^https?:\/\//, '');
	return `https://${host}/api/webhook/whatsapp`;
}

function autoSyncEnabled() {
	if (process.env.META_WEBHOOK_AUTO_SYNC === '0' || process.env.META_WEBHOOK_AUTO_SYNC === 'false') {
		return false;
	}
	// En Railway: corregir si Meta apunta a otro dominio (ej. chatbot-volt viejo).
	return Boolean(process.env.RAILWAY_PUBLIC_DOMAIN?.trim());
}

function webhookFields() {
	return String(process.env.META_WEBHOOK_FIELDS || 'messages,message_template_status_update').trim();
}

async function listAppSubscriptions(appId, appToken) {
	const url = `https://graph.facebook.com/v21.0/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`;
	const resp = await fetch(url);
	const data = await resp.json();
	if (data.error) throw new Error(data.error.message || 'Error listando subscriptions');
	return data.data || [];
}

async function registerAppWebhook({ appId, appToken, callbackUrl, verifyToken }) {
	const params = new URLSearchParams({
		object: 'whatsapp_business_account',
		callback_url: callbackUrl,
		verify_token: verifyToken,
		fields: webhookFields(),
		access_token: appToken,
	});
	const resp = await fetch(`https://graph.facebook.com/v21.0/${appId}/subscriptions`, {
		method: 'POST',
		body: params,
	});
	const data = await resp.json();
	if (data.error) throw new Error(data.error.message || 'Error registrando webhook');
	return data;
}

async function syncWebhookIfNeeded() {
	const appId = String(process.env.META_APP_ID || '').trim();
	const secret = String(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '')
		.trim()
		.replace(/^["']+|["']+$/g, '');
	const verifyToken = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
	const expected = expectedCallbackUrl();

	if (!appId || !secret || !verifyToken) {
		return { skipped: true, reason: 'falta META_APP_ID, META_APP_SECRET o WHATSAPP_VERIFY_TOKEN' };
	}
	if (!expected) {
		return { skipped: true, reason: 'sin RAILWAY_PUBLIC_DOMAIN' };
	}

	const appToken = `${appId}|${secret}`;
	let subs;
	try {
		subs = await listAppSubscriptions(appId, appToken);
	} catch (err) {
		diag.warn('startup', 'No se pudieron listar webhooks Meta', { error: err.message });
		return { ok: false, error: err.message };
	}

	const waSubs = subs.filter((s) => s.object === 'whatsapp_business_account' && s.active !== false);
	const current = waSubs[0]?.callback_url || null;
	const alreadyOk = waSubs.some((s) => String(s.callback_url || '').trim() === expected);

	diag.line('startup', 'Webhook Meta vs este servicio', { expected, current, autoSync: autoSyncEnabled() });

	if (alreadyOk) {
		console.log(`✓ Webhook Meta → este servidor (${expected})`);
		return { ok: true, updated: false, callbackUrl: expected };
	}

	console.warn('');
	console.warn('══════════════════════════════════════════════════════════════');
	console.warn('⚠ Meta envía WhatsApp a OTRO servidor — este backend no recibe nada');
	console.warn(`  Meta callback:  ${current || '(ninguno)'}`);
	console.warn(`  Este servicio:  ${expected}`);
	console.warn('  Por eso no hay logs de mensajes aquí.');
	console.warn('══════════════════════════════════════════════════════════════');

	if (!autoSyncEnabled()) {
		console.warn('  Activá META_WEBHOOK_AUTO_SYNC=1 o corregí la URL en Meta Developers.');
		return { ok: false, mismatch: true, expected, current };
	}

	try {
		const result = await registerAppWebhook({ appId, appToken, callbackUrl: expected, verifyToken });
		console.log(`✓ Webhook Meta actualizado → ${expected}`);
		diag.line('startup', 'Webhook Meta sincronizado', { expected, result });
		return { ok: true, updated: true, callbackUrl: expected, result };
	} catch (err) {
		console.error(`✗ No se pudo actualizar webhook Meta: ${err.message}`);
		console.error('  Corregilo manual: Meta Developers → WhatsApp → Configuración → Webhook');
		return { ok: false, error: err.message, expected, current };
	}
}

module.exports = { expectedCallbackUrl, syncWebhookIfNeeded, autoSyncEnabled };
