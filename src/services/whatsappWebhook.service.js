const botConversacion = require('./botConversacion.service');
const botResponder = require('./botResponder.service');
const botReset = require('./botReset.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const diag = require('../utils/diagLog');
const { runWithTenant } = require('../context/tenantContext');

function getVerifyToken() {
	return String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
}

function getDefaultEmpresaId() {
	const id = Number(process.env.BOT_EMPRESA_ID || process.env.WHATSAPP_EMPRESA_ID || 1);
	return Number.isFinite(id) && id > 0 ? id : 1;
}

/**
 * Meta Cloud API — verificación del webhook (GET).
 */
function verificarSuscripcion(query = {}) {
	const mode = query['hub.mode'];
	const token = query['hub.verify_token'];
	const challenge = query['hub.challenge'];
	const expected = getVerifyToken();

	if (!expected) {
		const err = new Error('WHATSAPP_VERIFY_TOKEN no configurado en el servidor');
		err.statusCode = 503;
		throw err;
	}
	if (mode === 'subscribe' && token === expected) {
		return { ok: true, challenge: String(challenge || '') };
	}
	const err = new Error('Verify token inválido');
	err.statusCode = 403;
	throw err;
}

function esPayloadSoloEstados(body) {
	if (!body || body.object !== 'whatsapp_business_account') return false;
	let tieneEstados = false;
	let tieneMensajes = false;
	for (const entry of body.entry || []) {
		for (const change of entry.changes || []) {
			if (change.field !== 'messages') continue;
			const value = change.value || {};
			if (value.statuses?.length) tieneEstados = true;
			if (value.messages?.length) tieneMensajes = true;
		}
	}
	return tieneEstados && !tieneMensajes;
}

const TIPOS_MENSAJE_IGNORAR = new Set(['reaction', 'sticker', 'unsupported', 'system', 'unknown']);

function extraerMensajesEntrantes(body) {
	const mensajes = [];
	if (!body || body.object !== 'whatsapp_business_account') return mensajes;

	for (const entry of body.entry || []) {
		for (const change of entry.changes || []) {
			if (change.field !== 'messages') continue;
			const value = change.value || {};
			const phoneNumberId = value.metadata?.phone_number_id
				? String(value.metadata.phone_number_id)
				: null;
			const contacts = value.contacts || [];
			const contactByWaId = new Map(
				contacts.map((c) => [String(c.wa_id || ''), c.profile?.name || null]),
			);

			for (const msg of value.messages || []) {
				if (!msg.from) continue;
				const tipo = msg.type || 'unknown';
				if (TIPOS_MENSAJE_IGNORAR.has(tipo)) continue;
				// Eco de mensajes salientes (evita respuestas duplicadas)
				if (msg.from === value.metadata?.phone_number_id) continue;
				let contenido = '';
				if (tipo === 'text') contenido = msg.text?.body || '';
				else if (tipo === 'button') contenido = msg.button?.text || msg.button?.payload || '';
				else if (tipo === 'interactive') {
					contenido =
						msg.interactive?.button_reply?.title ||
						msg.interactive?.list_reply?.title ||
						msg.interactive?.list_reply?.description ||
						'';
				} else {
					contenido = `[${tipo}]`;
				}
				if (!contenido.trim()) continue;

				mensajes.push({
					telefono: String(msg.from),
					contenido: contenido.trim(),
					metaMessageId: msg.id || null,
					nombreContacto: contactByWaId.get(String(msg.from)) || null,
					idConversacion: botConversacion.idDesdeTelefono(msg.from),
					timestamp: msg.timestamp,
					phoneNumberId,
				});
			}
		}
	}
	return mensajes;
}

function describeSkippedPayload(body) {
	if (!body) return 'body vacío';
	if (body.object !== 'whatsapp_business_account') return `object=${body.object || '?'}`;
	const fields = [];
	for (const entry of body.entry || []) {
		for (const change of entry.changes || []) {
			fields.push(change.field || '?');
			const value = change.value || {};
			if (value.statuses?.length) fields.push(`statuses:${value.statuses.length}`);
			if (value.messages?.length) fields.push(`messages:${value.messages.length}`);
		}
	}
	return fields.length ? fields.join(',') : 'sin changes reconocibles';
}

async function procesarGrupoMensajes(idEmpresa, mensajes, sourceLabel) {
	const resultados = [];
	diag.logWhatsappEmpresa('procesarGrupo', {
		idEmpresa,
		sourceLabel,
		cantidad: mensajes.length,
		telefonos: mensajes.map((m) => m.telefono),
		phoneNumberId: mensajes[0]?.phoneNumberId,
	});
	try {
		await runWithTenant(idEmpresa, async () => {
			for (const m of mensajes) {
				try {
					if (botReset.esComandoReset(m.contenido)) {
						const reset = await botReset.procesarComandoReset({
							idEmpresa,
							telefonoWhatsApp: m.telefono,
							contenido: m.contenido,
						});
						resultados.push({ reset, botReply: { respondido: false, motivo: 'comando-reset' } });
						continue;
					}

					const r = await botConversacion.registrarMensajeEntrante({
						telefonoWhatsApp: m.telefono,
						contenido: m.contenido,
						idConversacion: m.idConversacion,
						nombreContacto: m.nombreContacto,
						metaMessageId: m.metaMessageId,
					});

					if (r.duplicado) {
						diag.line('webhook', 'Mensaje duplicado (MetaMessageId), skip GPT', {
							metaMessageId: m.metaMessageId,
						});
						resultados.push({ ...r, botReply: { respondido: false, motivo: 'duplicado' } });
						continue;
					}

					diag.line('webhook', 'Mensaje registrado en tenant', {
						idEmpresa,
						idConversacion: r.conversacion?.idConversacion,
						telefono: m.telefono,
					});

					let botReply = null;
					if (botResponder.gptHabilitado()) {
						try {
							botReply = await botResponder.responderMensajeEntrante({
								idEmpresa,
								telefonoWhatsApp: m.telefono,
								idConversacion: r.conversacion.idConversacion,
								contenidoUltimo: m.contenido,
							});
							diag.line('webhook', 'GPT respuesta', {
								respondido: botReply?.respondido,
								motivo: botReply?.motivo,
								textoLen: botReply?.texto?.length,
							});
						} catch (gptErr) {
							diag.warn('webhook', 'GPT error', { error: gptErr.message, code: gptErr.code });
							console.warn('[whatsappWebhook] GPT:', gptErr.message);
							botReply = { respondido: false, motivo: gptErr.message };
						}
					} else {
						diag.line('webhook', 'GPT deshabilitado', {
							BOT_GPT_ENABLED: process.env.BOT_GPT_ENABLED,
							openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
						});
					}

					resultados.push({ ...r, botReply });
				} catch (err) {
					diag.warn('webhook', 'mensaje no registrado', {
						idEmpresa,
						sourceLabel,
						error: err.message,
						code: err.code,
					});
					console.warn(
						`[whatsappWebhook] mensaje no registrado (empresa ${idEmpresa}, ${sourceLabel}):`,
						err.message,
					);
				}
			}
		});
	} catch (err) {
		diag.warn('webhook', 'runWithTenant falló', {
			idEmpresa,
			error: err.message,
			code: err.code,
		});
		throw err;
	}
	return resultados;
}

async function procesarWebhookEntrante(body) {
	if (esPayloadSoloEstados(body)) {
		return { procesados: 0, empresas: [], skipped: 'statuses-only' };
	}

	const mensajes = extraerMensajesEntrantes(body);

	if (!mensajes.length) {
		const skipped = describeSkippedPayload(body);
		return { procesados: 0, empresas: [], skipped };
	}

	/** @type {Map<string, typeof mensajes>} */
	const porPhone = new Map();
	for (const m of mensajes) {
		const key = m.phoneNumberId || '__default__';
		if (!porPhone.has(key)) porPhone.set(key, []);
		porPhone.get(key).push(m);
	}

	const resultados = [];
	const empresas = new Set();

	for (const [phoneKey, grupo] of porPhone) {
		let idEmpresa = getDefaultEmpresaId();
		let sourceLabel = 'BOT_EMPRESA_ID default';

		if (phoneKey !== '__default__') {
			const cfg = await whatsappEmpresa.resolveByPhoneNumberId(phoneKey);
			diag.logWhatsappEmpresa('resolveByPhoneNumberId', {
				phoneNumberId: phoneKey,
				found: Boolean(cfg?.idEmpresa),
				idEmpresa: cfg?.idEmpresa,
				source: cfg?.source,
				hasToken: Boolean(cfg?.accessToken),
			});
			if (cfg?.idEmpresa) {
				idEmpresa = cfg.idEmpresa;
				sourceLabel = cfg.source || 'phone_number_id';
			} else {
				console.warn(
					`[whatsappWebhook] phone_number_id ${phoneKey} sin mapeo; usando empresa ${idEmpresa}`,
				);
			}
		}

		const batch = await procesarGrupoMensajes(idEmpresa, grupo, sourceLabel);
		resultados.push(...batch);
		empresas.add(idEmpresa);
	}

	return {
		procesados: resultados.length,
		empresas: [...empresas],
		resultados,
	};
}

module.exports = {
	getVerifyToken,
	getDefaultEmpresaId,
	verificarSuscripcion,
	procesarWebhookEntrante,
	extraerMensajesEntrantes,
};
