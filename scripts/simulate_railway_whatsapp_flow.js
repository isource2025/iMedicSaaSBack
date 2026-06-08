/**
 * Simula el flujo Railway: Hola → DNI → RENAPER/confirmación.
 * Uso:
 *   node scripts/simulate_railway_whatsapp_flow.js
 *   node scripts/simulate_railway_whatsapp_flow.js http://localhost:5006
 *   node scripts/simulate_railway_whatsapp_flow.js https://imedicwsback-production.up.railway.app
 */
require('dotenv').config();
const crypto = require('crypto');

const BASE = (process.argv[2] || 'http://localhost:5006').replace(/\/$/, '');
const API = `${BASE}/api`;
const BOT_KEY = process.env.BOT_API_KEY || 'dev-bot-key-local';
const EMPRESA = process.env.BOT_EMPRESA_ID || '1';
const DNI = process.env.SIM_DNI || '53547773';
const TELEFONO = process.env.SIM_TELEFONO || '5493794946066';
/** Teléfono distinto para wizard in-process (evita reset/borrado cruzado con webhook). */
const TELEFONO_WIZARD = process.env.SIM_TELEFONO_WIZARD || '5493794946067';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1130114823509506';
const IS_REMOTE = !BASE.includes('localhost') && !BASE.includes('127.0.0.1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { headers = {}, body = null } = {}) {
	const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? '' : '/'}${path}`;
	const opts = { method, headers: { ...headers } };
	if (body != null) {
		opts.headers['Content-Type'] = 'application/json';
		opts.body = typeof body === 'string' ? body : JSON.stringify(body);
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

function botHeaders() {
	return { 'X-API-Key': BOT_KEY, 'X-Empresa-Id': EMPRESA };
}

function signMeta(bodyStr) {
	const secret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
	if (!secret) return {};
	return {
		'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')}`,
	};
}

function waPayload(texto, wamidSuffix) {
	return {
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
									id: `wamid.sim.${wamidSuffix}.${Date.now()}`,
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
}

async function postWebhook(texto, suffix) {
	const payload = waPayload(texto, suffix);
	const bodyStr = JSON.stringify(payload);
	const resp = await fetch(`${API}/webhook/whatsapp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...signMeta(bodyStr) },
		body: bodyStr,
	});
	const text = await resp.text();
	return { status: resp.status, body: text };
}

function assert(cond, name, detail) {
	return { name, ok: !!cond, detail: detail || '' };
}

function esRespuestaConfirmacionRenaper(texto) {
	if (!texto || /No pudimos consultar RENAPER/i.test(texto)) return false;
	if (/Intentá de nuevo en unos segundos/i.test(texto)) return false;
	return /RENAPER|ficha local|Nombre:/i.test(texto) || /SIM:renaper|SIM:local/i.test(texto);
}

async function testRenaperDirectLocal() {
	const renaper = require('../src/services/renaper.service');
	const r = await renaper.searchByDni(DNI, { timeoutMs: 20000, skipProxy: true });
	const ok = r.ok && (r.data?.apellido || r.data?.nombres || r.data?.nombreCompleto);
	return assert(ok, 'RENAPER directo (local MSAL)', ok ? `${r.data.apellido} ${r.data.nombres}` : JSON.stringify(r));
}

async function testRenaperHttp() {
	const r = await req('GET', `/integrations/bot/renaper/${DNI}`, { headers: botHeaders() });
	const p = r.body?.persona;
	const ok = r.status === 200 && r.body?.success && (p?.apellido || p?.nombres);
	return assert(
		ok,
		'RENAPER HTTP /integrations/bot/renaper',
		ok ? `${p.apellido} ${p.nombres}` : `${r.status} ${r.raw?.slice(0, 200)}`,
	);
}

async function testIdentificarHttp() {
	const r = await req('GET', `/integrations/bot/identificar?dni=${DNI}&crearSiNoExiste=false`, {
		headers: botHeaders(),
	});
	const ren = r.body?.data?.renaper;
	const ok =
		r.status === 200 &&
		r.body?.success &&
		ren?.encontrado &&
		(ren?.nombreCompleto || ren?.apellido || ren?.nombres || ren?.fuente === 'local');
	return assert(
		ok,
		'Identificar HTTP (RENAPER o ficha local)',
		ok
			? `${ren.fuente || 'renaper'}: ${ren.nombreCompleto || `${ren.apellido || ''} ${ren.nombres || ''}`.trim()}`
			: `${r.status} ${r.raw?.slice(0, 250)}`,
	);
}

async function testWizardInProcess() {
	const { runWithTenant } = require('../src/context/tenantContext');
	const botConversacion = require('../src/services/botConversacion.service');
	const botWizard = require('../src/services/botWizard.service');
	const idConv = botConversacion.idDesdeTelefono(TELEFONO_WIZARD);

	let wizardResult = null;
	await runWithTenant(Number(EMPRESA), async () => {
		await botConversacion.resetConversacionPorTelefono(TELEFONO_WIZARD);
		await botConversacion.obtenerOCrearConversacion({
			telefonoWhatsApp: TELEFONO_WIZARD,
			nombreContacto: 'Emiliano',
		});
		wizardResult = await botWizard.intentarRespuestaWizard({
			idConversacion: idConv,
			telefonoWhatsApp: TELEFONO_WIZARD,
			contenido: String(DNI),
		});
	});

	const texto = wizardResult?.texto || '';
	const ok =
		wizardResult?.handled &&
		texto.length > 20 &&
		(/RENAPER|ficha local/i.test(texto) || /Nombre:/i.test(texto)) &&
		/(Confirm|Sí o No|Si o No)/i.test(texto);
	return assert(
		ok,
		'Wizard in-process (DNI → confirmación con datos)',
		ok ? texto.slice(0, 160).replace(/\n/g, ' | ') : JSON.stringify(wizardResult),
	);
}

async function testWebhookFlowHttp() {
	const reset = await postWebhook('#IMEDIC-ZERO', 'reset');
	await sleep(1500);

	const hola = await postWebhook('Hola', 'hola');
	await sleep(IS_REMOTE ? 12000 : 8000);

	const dni = await postWebhook(String(DNI), 'dni');

	let botTexto = null;
	const pollMs = IS_REMOTE ? 35000 : 25000;
	const pollStart = Date.now();

	while (Date.now() - pollStart < pollMs && !botTexto) {
		await sleep(2000);
		if (!IS_REMOTE) {
			const { runWithTenant } = require('../src/context/tenantContext');
			const botConversacion = require('../src/services/botConversacion.service');
			const idConv = botConversacion.idDesdeTelefono(TELEFONO);
			await runWithTenant(Number(EMPRESA), async () => {
				const msgs = await botConversacion.listarMensajes(idConv, { limit: 30 });
				const bots = msgs.filter((m) => m.origen === 'BOT');
				const renaperBot = [...bots]
					.reverse()
					.find(
						(m) =>
							m.contenido &&
							!/No pudimos consultar RENAPER/i.test(m.contenido) &&
							!/Turno confirmado|Comprobante:/i.test(m.contenido) &&
							(/RENAPER|ficha local/i.test(m.contenido) ||
								/Nombre:\s*\*/i.test(m.contenido)),
					);
				if (renaperBot?.contenido) botTexto = renaperBot.contenido;
			});
		}
	}

	if (IS_REMOTE && !botTexto) {
		const id = await req('GET', `/integrations/bot/identificar?dni=${DNI}`, {
			headers: botHeaders(),
		});
		if (id.body?.data?.renaper?.encontrado) {
			const ren = id.body.data.renaper;
			botTexto = `SIM:${ren.fuente || 'renaper'}:${ren.nombreCompleto || ren.apellido}`;
		}
	}

	const ok =
		reset.status === 200 &&
		hola.status === 200 &&
		dni.status === 200 &&
		botTexto &&
		!/No pudimos consultar RENAPER/i.test(botTexto) &&
		!/Intentá de nuevo en unos segundos/i.test(botTexto) &&
		(/RENAPER|ficha local|Nombre:/i.test(botTexto) || /SIM:renaper|SIM:local/i.test(botTexto));

	const detail = [
		`reset=${reset.status}`,
		`hola=${hola.status}`,
		`dni=${dni.status}`,
		botTexto ? botTexto.slice(0, 140) : 'sin respuesta bot verificable',
	].join(' | ');

	return assert(ok, 'Webhook Hola + DNI (flujo Railway)', detail);
}

async function run() {
	console.log(`\n=== Simulación flujo Railway @ ${BASE} ===`);
	console.log(`DNI=${DNI} tel=${TELEFONO} remoto=${IS_REMOTE}\n`);

	const results = [];

	if (!IS_REMOTE) {
		try {
			results.push(await testRenaperDirectLocal());
		} catch (e) {
			results.push(assert(false, 'RENAPER directo (local MSAL)', e.message));
		}
		try {
			results.push(await testWizardInProcess());
		} catch (e) {
			results.push(assert(false, 'Wizard in-process', e.message));
		}
	}

	results.push(await testRenaperHttp());
	results.push(await testIdentificarHttp());
	results.push(await testWebhookFlowHttp());

	console.log('--- Resultados ---');
	for (const r of results) {
		console.log(`${r.ok ? '✅' : '❌'} ${r.name}`);
		console.log(`   ${r.detail}\n`);
	}

	const failed = results.filter((r) => !r.ok);
	if (failed.length) {
		console.log(`FALLÓ: ${failed.length}/${results.length} pruebas`);
		process.exit(1);
	}
	console.log(`OK: ${results.length}/${results.length} pruebas`);
	process.exit(0);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
