#!/usr/bin/env node
/**
 * Diagnóstico completo bot WhatsApp (consola).
 *
 * Uso:
 *   node scripts/debug_whatsapp_console.js
 *   node scripts/debug_whatsapp_console.js https://imedicsaasback-production.up.railway.app
 *   node scripts/debug_whatsapp_console.js --send-hola --telefono=5493794946099
 *
 * Requiere en .env (o iMedicWSBack/.env vía DOTENV_CONFIG_PATH):
 *   AUTH_DB_* (MySQL), META_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID
 */
require('dotenv').config();

const crypto = require('crypto');
const path = require('path');

const BASE = (
	process.argv.find((a) => a.startsWith('http')) ||
	'https://imedicsaasback-production.up.railway.app'
).replace(/\/$/, '');
const API = `${BASE}/api`;
const SEND_HOLA = process.argv.includes('--send-hola');
const TELEFONO =
	process.argv.find((a) => a.startsWith('--telefono='))?.split('=')[1] ||
	process.env.SIM_TELEFONO ||
	'5493794946099';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1130114823509506';
const EMPRESA = Number(process.env.BOT_EMPRESA_ID || 1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function signMeta(bodyStr) {
	const secret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
	if (!secret) return {};
	return {
		'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')}`,
	};
}

async function httpGet(url, timeoutMs = 30000) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const r = await fetch(url, { signal: ctrl.signal });
		const text = await r.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = text;
		}
		return { status: r.status, body: json, raw: text };
	} finally {
		clearTimeout(t);
	}
}

function line(ok, name, detail = '') {
	console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
	return ok;
}

async function checkRemoteHealth() {
	console.log('\n── 1. Health Railway ──');
	const basic = await httpGet(`${API}/health`);
	line(basic.status === 200 && basic.body?.ok, 'GET /api/health', `HTTP ${basic.status}`);

	const deep = await httpGet(`${API}/health?deep=1`, 120000);
	const tenants = deep.body?.tenants || [];
	const e1 = tenants.find((t) => t.idEmpresa === EMPRESA);
	const e99 = tenants.find((t) => t.idEmpresa === 99);
	line(
		e1?.ok === true && !e1?.skipped,
		`SQL tenant empresa ${EMPRESA} (Railway)`,
		e1?.ok ? `${e1.ms}ms → ${e1.dbServer}/${e1.dbName}` : e1?.error || e1?.reason || 'N/A',
	);
	if (e99 && !e99.ok && !e99.skipped) {
		line(false, 'SQL tenant empresa 99 (demo)', e99.error || 'falló — causa 503 en /health?deep=1');
	}
	line(deep.status === 200, 'GET /api/health?deep=1 global', `HTTP ${deep.status} (503 si empresa 99 timeout)`);
}

async function checkWebhook() {
	console.log('\n── 2. Webhook Meta ──');
	const verify = await httpGet(
		`${API}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.WHATSAPP_VERIFY_TOKEN || 'imedic_verify_2026')}&hub.challenge=DEBUGCHK`,
	);
	line(verify.status === 200 && verify.raw === 'DEBUGCHK', 'GET verify', `HTTP ${verify.status}`);

	if (!process.env.META_APP_SECRET) {
		line(false, 'META_APP_SECRET local', 'falta — no se puede probar POST firmado');
		return;
	}

	const payload = {
		object: 'whatsapp_business_account',
		entry: [
			{
				changes: [
					{
						field: 'messages',
						value: {
							metadata: { phone_number_id: PHONE_NUMBER_ID },
							messages: [
								{
									from: TELEFONO,
									id: `wamid.debug.ping.${Date.now()}`,
									timestamp: String(Math.floor(Date.now() / 1000)),
									type: 'text',
									text: { body: '__DEBUG_PING__' },
								},
							],
						},
					},
				],
			},
		],
	};
	const bodyStr = JSON.stringify(payload);
	const post = await fetch(`${API}/webhook/whatsapp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...signMeta(bodyStr) },
		body: bodyStr,
	});
	const postText = await post.text();
	line(post.status === 200, 'POST webhook firmado', `HTTP ${post.status} ${postText.slice(0, 60)}`);
}

async function checkMetaSubscription() {
	console.log('\n── 3. Suscripción Meta (Graph API) ──');
	const appId = process.env.META_APP_ID;
	const secret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET;
	if (!appId || !secret) {
		line(false, 'Graph subscriptions', 'META_APP_ID / META_APP_SECRET faltan');
		return;
	}
	const token = `${appId}|${secret}`;
	const url = `https://graph.facebook.com/v21.0/${appId}/subscriptions?access_token=${encodeURIComponent(token)}`;
	const r = await httpGet(url);
	const subs = r.body?.data || [];
	const wa = subs.find((s) => s.object === 'whatsapp_business_account');
	const ok =
		wa?.active &&
		String(wa.callback_url || '').includes('imedicsaasback-production.up.railway.app');
	line(ok, 'Webhook en Meta', wa ? `${wa.callback_url} active=${wa.active}` : 'no encontrado');
}

async function checkLocalInfra() {
	console.log('\n── 4. Infra local (MySQL + SQL tenant desde esta PC) ──');
	if (process.env.AUTH_DB_ENABLED !== '1') {
		line(false, 'AUTH_DB', 'no habilitado en .env local');
		return;
	}
	const { testTenantConnection } = require('../src/config/tenantDb');
	const t0 = Date.now();
	try {
		await testTenantConnection(EMPRESA);
		line(true, `SQL tenant empresa ${EMPRESA} (local)`, `${Date.now() - t0}ms`);
	} catch (e) {
		line(false, `SQL tenant empresa ${EMPRESA} (local)`, e.message);
	}
}

async function checkBotApiKey() {
	console.log('\n── 5. BOT_API_KEY (integraciones /integrations/bot/*) ──');
	const resp = await fetch(`${API}/integrations/bot/gpt/estado`, {
		headers: { 'X-API-Key': 'probe', 'X-Empresa-Id': String(EMPRESA) },
	});
	const body = await resp.json().catch(() => ({}));
	const missing = body?.code === 'BOT_API_NOT_CONFIGURED';
	line(
		!missing,
		'BOT_API_KEY en Railway',
		missing ? 'MISSING — solo afecta /integrations/bot/*' : `HTTP ${resp.status}`,
	);
}

async function checkConversationSql(telefono, label) {
	const { runWithTenant } = require('../src/context/tenantContext');
	const botConversacion = require('../src/services/botConversacion.service');
	const id = botConversacion.idDesdeTelefono(telefono);
	await runWithTenant(EMPRESA, async () => {
		const conv = await botConversacion.obtenerConversacion(id);
		const estado = await botConversacion.puedeResponderBot(id);
		const msgs = conv ? await botConversacion.listarMensajes(id, { limit: 8 }) : [];
		console.log(`\n── 6. Conversación SQL (${label}: ${telefono}) ──`);
		line(estado.puedeResponderBot, 'Modo BOT activo', `modo=${estado.modoControl} paso=${estado.pasoBot || '—'}`);
		if (!msgs.length) {
			line(false, 'Mensajes en imBotChat', 'vacío');
			return;
		}
		line(true, 'Mensajes en imBotChat', `${msgs.length} últimos`);
		for (const m of msgs.slice(-5)) {
			const txt = String(m.contenido || '').slice(0, 72).replace(/\n/g, ' ');
			console.log(`     ${m.origen} [${m.estadoEntrega}] ${txt}`);
		}
		const lastBot = [...msgs].reverse().find((m) => m.origen === 'BOT');
		line(Boolean(lastBot), 'Última respuesta BOT en BD', lastBot ? lastBot.estadoEntrega : 'ninguna');
	});
}

async function sendHolaFlow() {
	if (!SEND_HOLA || !process.env.META_APP_SECRET) return;
	console.log('\n── 7. Simulación Hola + DNI (webhook) ──');
	const texts = [
		['#IMEDIC-ZERO', 'reset'],
		['Hola', 'hola'],
		[process.env.SIM_DNI || '53547773', 'dni'],
	];
	for (const [texto, suffix] of texts) {
		const payload = {
			object: 'whatsapp_business_account',
			entry: [
				{
					changes: [
						{
							field: 'messages',
							value: {
								metadata: { phone_number_id: PHONE_NUMBER_ID },
								contacts: [{ wa_id: TELEFONO, profile: { name: 'Debug' } }],
								messages: [
									{
										from: TELEFONO,
										id: `wamid.debug.${suffix}.${Date.now()}`,
										timestamp: String(Math.floor(Date.now() / 1000)),
										type: 'text',
										text: { body: texto },
									},
								],
							},
						},
					],
				},
			],
		};
		const bodyStr = JSON.stringify(payload);
		const r = await fetch(`${API}/webhook/whatsapp`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...signMeta(bodyStr) },
			body: bodyStr,
		});
		console.log(`   POST "${texto}" → HTTP ${r.status}`);
		await sleep(texto === 'Hola' ? 12000 : texto.startsWith('#') ? 2000 : 18000);
	}
	await checkConversationSql(TELEFONO, 'post-sim');
}

async function checkGptLocal() {
	console.log('\n── 8. GPT / OpenAI (config local .env) ──');
	const botOpenai = require('../src/services/botOpenai.service');
	line(process.env.BOT_GPT_ENABLED !== '0', 'BOT_GPT_ENABLED', process.env.BOT_GPT_ENABLED || '(default on)');
	line(botOpenai.isConfigured(), 'OpenAI API key', botOpenai.isConfigured() ? 'set' : 'MISSING');
	const groq = Boolean(process.env.GROQ_API_KEY?.trim());
	line(groq, 'GROQ_API_KEY (audio)', groq ? 'set' : 'MISSING');
}

async function main() {
	// Cargar secretos de iMedicWSBack si faltan localmente
	const wsEnv = path.join(__dirname, '../../../iMedicWs/iMedicWSBack/.env');
	if (!process.env.META_APP_SECRET) {
		require('dotenv').config({ path: wsEnv, override: false });
	}

	console.log('══════════════════════════════════════════════════');
	console.log('  DEBUG WhatsApp Bot — iMedic SaaS');
	console.log(`  Backend: ${BASE}`);
	console.log(`  Empresa: ${EMPRESA} | Tel prueba: ${TELEFONO}`);
	console.log('══════════════════════════════════════════════════');

	await checkRemoteHealth();
	await checkWebhook();
	await checkMetaSubscription();
	await checkLocalInfra();
	await checkBotApiKey();
	await checkConversationSql(TELEFONO, 'actual');
	await checkGptLocal();
	if (SEND_HOLA) await sendHolaFlow();

	console.log('\n══════════════════════════════════════════════════');
	console.log('  Resumen');
	console.log('  • Webhook Meta → imedicsaasback: OK si sección 2 y 3 en verde');
	console.log('  • Bot responde si sección 6 muestra mensajes BOT ENVIADO');
	console.log('  • BOT_API_KEY MISSING solo rompe /integrations/bot/*, no el webhook');
	console.log('  • /health?deep=1 puede dar 503 por empresa 99 (demo) aunque empresa 1 OK');
	console.log('══════════════════════════════════════════════════\n');
}

main().catch((e) => {
	console.error('FATAL:', e.message);
	process.exit(1);
});
