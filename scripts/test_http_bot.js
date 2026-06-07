/**
 * Pruebas HTTP: webhook, GPT, bot API.
 * Uso: node scripts/test_http_bot.js [baseUrl]
 */
require('dotenv').config();
const crypto = require('crypto');

const BASE = (process.argv[2] || 'http://localhost:5006').replace(/\/$/, '');
const API = `${BASE}/api`;
const BOT_KEY = process.env.BOT_API_KEY || 'dev-bot-key-local';
const EMPRESA = process.env.BOT_EMPRESA_ID || '1';

async function req(method, path, { headers = {}, body = null } = {}) {
	const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? '' : '/'}${path}`;
	const opts = { method, headers: { ...headers } };
	if (body != null) {
		opts.headers['Content-Type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	const resp = await fetch(url, opts);
	const text = await resp.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = text;
	}
	return { status: resp.status, body: json, raw: text };
}

function signMeta(bodyStr) {
	const secret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
	if (!secret) return {};
	return {
		'X-Hub-Signature-256':
			'sha256=' + crypto.createHmac('sha256', secret).update(bodyStr).digest('hex'),
	};
}

async function run() {
	console.log(`=== Pruebas HTTP bot @ ${BASE} ===\n`);
	const results = [];

	// 1. Health
	const health = await req('GET', `${BASE}/`);
	results.push(['Health', health.status === 200, health.status]);

	// 2. Webhook verify
	const verify = await req(
		'GET',
		`${API}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=imedic_verify_2026&hub.challenge=HTTPTEST`,
	);
	results.push([
		'Webhook GET verify',
		verify.status === 200 && verify.raw === 'HTTPTEST',
		`${verify.status} ${verify.raw}`,
	]);

	// 3. GPT estado
	const gptEstado = await req('GET', '/integrations/bot/gpt/estado', {
		headers: { 'X-API-Key': BOT_KEY, 'X-Empresa-Id': EMPRESA },
	});
	results.push([
		'GPT estado',
		gptEstado.status === 200 && gptEstado.body?.data?.gptHabilitado,
		JSON.stringify(gptEstado.body?.data || gptEstado.body),
	]);

	// 4. GPT responder (sin WhatsApp real si falta config)
	const tel = `54911${String(Date.now()).slice(-7)}`;
	const gptResp = await req('POST', '/integrations/bot/gpt/responder', {
		headers: { 'X-API-Key': BOT_KEY, 'X-Empresa-Id': EMPRESA },
		body: { telefono: tel, mensaje: 'Hola, quiero un turno de cardiología' },
	});
	results.push([
		'GPT responder',
		gptResp.status === 200 && gptResp.body?.data?.botReply?.respondido,
		gptResp.body?.data?.botReply?.texto?.slice(0, 120) || JSON.stringify(gptResp.body),
	]);

	// 5. Webhook POST simulado
	const waPayload = {
		object: 'whatsapp_business_account',
		entry: [
			{
				changes: [
					{
						field: 'messages',
						value: {
							metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '1130114823509506' },
							messages: [
								{
									from: tel,
									id: `wamid.http.${Date.now()}`,
									timestamp: String(Math.floor(Date.now() / 1000)),
									type: 'text',
									text: { body: 'Buenas, necesito turno' },
								},
							],
						},
					},
				],
			},
		],
	};
	const waBody = JSON.stringify(waPayload);
	const waPost = await fetch(`${API}/webhook/whatsapp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...signMeta(waBody) },
		body: waBody,
	});
	const waPostBody = await waPost.text();
	results.push([
		'Webhook POST + GPT',
		waPost.status === 200,
		`${waPost.status} ${waPostBody.slice(0, 80)}`,
	]);

	console.log('\n--- Resultados ---');
	for (const [name, ok, detail] of results) {
		console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
	}
	const failed = results.filter((r) => !r[1]).length;
	process.exit(failed ? 1 : 0);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
