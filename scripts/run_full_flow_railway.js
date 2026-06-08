/**
 * Flujo completo WhatsApp → Railway (consola).
 * Uso: node scripts/run_full_flow_railway.js [DNI] [especialidad]
 */
require('dotenv').config();
const crypto = require('crypto');

const API = 'https://imedicwsback-production.up.railway.app/api/webhook/whatsapp';
const DNI = process.argv[2] || process.env.SIM_DNI || '39863295';
const ESPECIALIDAD = process.argv[3] || 'Traumatología';
const TELEFONO = process.env.SIM_TELEFONO || '5493794946066';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1130114823509506';
const secret = process.env.META_APP_SECRET || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sign(bodyStr) {
	return {
		'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')}`,
	};
}

function payload(texto, suffix) {
	return JSON.stringify({
		object: 'whatsapp_business_account',
		entry: [
			{
				changes: [
					{
						field: 'messages',
						value: {
							metadata: { phone_number_id: PHONE_NUMBER_ID },
							contacts: [{ wa_id: TELEFONO, profile: { name: 'Emiliano' } }],
							messages: [
								{
									from: TELEFONO,
									id: `wamid.flow.${suffix}.${Date.now()}`,
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
	});
}

async function send(paso, texto, suffix, waitMs) {
	const body = payload(texto, suffix);
	const t0 = Date.now();
	const resp = await fetch(API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...sign(body) },
		body,
	});
	const ms = Date.now() - t0;
	console.log(`[${paso}] "${texto}" → HTTP ${resp.status} (${ms}ms)`);
	if (waitMs) {
		console.log(`     esperando ${waitMs / 1000}s para procesamiento async…`);
		await sleep(waitMs);
	}
	return resp.status;
}

(async () => {
	console.log('\n=== Flujo completo Railway (WhatsApp real) ===');
	console.log(`Tel: ${TELEFONO} | DNI: ${DNI} | Especialidad: ${ESPECIALIDAD}`);
	console.log('Corroborá cada mensaje en el teléfono.\n');

	await send('1/6 Reset', '#IMEDIC-ZERO', 'reset', 4000);
	await send('2/6 Hola', 'Hola', 'hola', 15000);
	await send('3/6 DNI', String(DNI), 'dni', 22000);
	await send('4/6 Confirmar identidad', 'Si', 'conf-id', 8000);
	await send('5/6 Especialidad', ESPECIALIDAD, 'esp', 30000);
	await send('6/6 Confirmar turno', 'Si', 'conf-turno', 5000);

	console.log('\n=== Fin envío webhook ===');
	console.log('En el teléfono deberías ver: reset → hola → RENAPER → confirmación → sugerencia turno → comprobante.');
})().catch((e) => {
	console.error('Error:', e.message);
	process.exit(1);
});
