/**
 * Reapunta el webhook de la app Meta (WhatsApp Cloud API) al backend de iMedic.
 *
 * Por qué: la app "ChatBot Volt" quedó con el callback_url apuntando a otro
 * servicio (chatbot-volt-production), así que los mensajes de WhatsApp nunca
 * llegan a iMedic. Este script vuelve a registrar el callback en este backend.
 *
 * Uso (cualquiera de las dos formas):
 *
 *   # 1) Con variables ya cargadas (ej. en Railway):
 *   railway run node scripts/fix_meta_webhook.js
 *
 *   # 2) Pasando credenciales por flag (correr local):
 *   node scripts/fix_meta_webhook.js \
 *     --app-id=1310172527617064 \
 *     --app-secret=EL_APP_SECRET \
 *     --verify=imedic_verify_2026 \
 *     --url=https://imedicsaasback-production.up.railway.app
 *
 *   # Solo ver el estado actual sin cambiar nada:
 *   node scripts/fix_meta_webhook.js --dry
 *
 * Flags (todas opcionales si están en el entorno):
 *   --app-id      META_APP_ID
 *   --app-secret  META_APP_SECRET (o WHATSAPP_APP_SECRET)
 *   --verify      WHATSAPP_VERIFY_TOKEN
 *   --url         Base del backend (default: RAILWAY_PUBLIC_DOMAIN o imedicsaasback)
 *   --fields      campos a suscribir (default messages,message_template_status_update)
 *   --dry         no modifica, solo lista
 */
require('dotenv').config();

const GRAPH = 'https://graph.facebook.com/v21.0';

function arg(name) {
	const pref = `--${name}=`;
	const hit = process.argv.find((a) => a.startsWith(pref));
	return hit ? hit.slice(pref.length) : null;
}
function hasFlag(name) {
	return process.argv.includes(`--${name}`);
}

function cleanSecret(s) {
	return String(s || '').trim().replace(/^["']+|["']+$/g, '');
}

function resolveConfig() {
	const appId = (arg('app-id') || process.env.META_APP_ID || '').trim();
	const appSecret = cleanSecret(
		arg('app-secret') || process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET,
	);
	const verifyToken = (arg('verify') || process.env.WHATSAPP_VERIFY_TOKEN || '').trim();

	let base = (arg('url') || '').trim();
	if (!base) {
		const domain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
		base = domain
			? `https://${domain.replace(/^https?:\/\//, '')}`
			: 'https://imedicsaasback-production.up.railway.app';
	}
	base = base.replace(/\/+$/, '');
	const callbackUrl = base.endsWith('/api/webhook/whatsapp')
		? base
		: `${base}/api/webhook/whatsapp`;

	const fields = (arg('fields') || 'messages,message_template_status_update').trim();
	return { appId, appSecret, verifyToken, callbackUrl, fields, dry: hasFlag('dry') };
}

async function listSubscriptions(appId, appToken) {
	const url = `${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`;
	const resp = await fetch(url);
	const data = await resp.json();
	if (data.error) throw new Error(`listar: ${data.error.message}`);
	return data.data || [];
}

async function setWebhook({ appId, appToken, callbackUrl, verifyToken, fields }) {
	const params = new URLSearchParams({
		object: 'whatsapp_business_account',
		callback_url: callbackUrl,
		verify_token: verifyToken,
		fields,
		access_token: appToken,
	});
	const resp = await fetch(`${GRAPH}/${appId}/subscriptions`, { method: 'POST', body: params });
	const data = await resp.json();
	if (data.error) {
		const e = new Error(`registrar: ${data.error.message}`);
		e.meta = data.error;
		throw e;
	}
	return data;
}

function printSubs(label, subs) {
	console.log(`\n${label}:`);
	if (!subs.length) {
		console.log('  (sin suscripciones)');
		return;
	}
	for (const s of subs) {
		console.log(`  object=${s.object} active=${s.active} callback_url=${s.callback_url}`);
	}
}

(async () => {
	const cfg = resolveConfig();

	console.log('=== fix_meta_webhook ===');
	console.log('App ID:        ', cfg.appId || '(FALTA)');
	console.log('App Secret:    ', cfg.appSecret ? `set(len=${cfg.appSecret.length})` : '(FALTA)');
	console.log('Verify token:  ', cfg.verifyToken ? 'set' : '(FALTA)');
	console.log('Callback nuevo:', cfg.callbackUrl);
	console.log('Fields:        ', cfg.fields);
	console.log('Modo:          ', cfg.dry ? 'DRY (solo listar)' : 'APLICAR cambios');

	if (!cfg.appId || !cfg.appSecret || !cfg.verifyToken) {
		console.error(
			'\n✗ Faltan credenciales. Definí META_APP_ID, META_APP_SECRET y WHATSAPP_VERIFY_TOKEN,\n' +
				'  o pasalas con --app-id= --app-secret= --verify=',
		);
		process.exit(1);
	}

	const appToken = `${cfg.appId}|${cfg.appSecret}`;

	try {
		const before = await listSubscriptions(cfg.appId, appToken);
		printSubs('Webhook ACTUAL en Meta', before);

		if (cfg.dry) {
			console.log('\n(DRY) No se modificó nada.');
			return;
		}

		console.log('\n→ Registrando callback_url en la app Meta...');
		await setWebhook({
			appId: cfg.appId,
			appToken,
			callbackUrl: cfg.callbackUrl,
			verifyToken: cfg.verifyToken,
			fields: cfg.fields,
		});

		const after = await listSubscriptions(cfg.appId, appToken);
		printSubs('Webhook DESPUÉS', after);

		const ok = after.some(
			(s) => s.object === 'whatsapp_business_account' && s.callback_url === cfg.callbackUrl,
		);
		console.log(
			ok
				? `\n✓ Webhook apuntando a ${cfg.callbackUrl}`
				: '\n⚠ No se confirmó el cambio; revisá manualmente en Meta Developers.',
		);
		console.log(
			'\nNota: cada WABA (número) debe estar suscripta a esta app. Si un número no recibe,\n' +
				'verificá en Meta → WhatsApp → API Setup que la cuenta esté suscripta a la app.',
		);
	} catch (err) {
		console.error('\n✗ Error:', err.message);
		if (err.meta) console.error('  Meta:', JSON.stringify(err.meta));
		process.exit(1);
	}
})();
