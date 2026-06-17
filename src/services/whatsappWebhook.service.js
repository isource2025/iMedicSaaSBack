const botConversacion = require('./botConversacion.service');
const botResponder = require('./botResponder.service');
const botReset = require('./botReset.service');
const webhookDedup = require('./webhookDedup.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const audioTranscripcion = require('./audioTranscripcion.service');
const diag = require('../utils/diagLog');
const { runWithTenant } = require('../context/tenantContext');
const { isAuthCentralEnabled } = require('../config/authCentralDb');

const TIPOS_AUDIO = new Set(['audio', 'voice']);

function allowLegacyDefaultEmpresa() {
	if (process.env.WHATSAPP_ALLOW_DEFAULT_EMPRESA === '0') return false;
	if (process.env.WHATSAPP_ALLOW_DEFAULT_EMPRESA === '1') return true;
	// Bot hospital (BOT_EMPRESA_ID): fallback a empresa default si phone_number_id no está en MySQL
	if (process.env.BOT_EMPRESA_ID?.trim()) return true;
	return !isAuthCentralEnabled();
}

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
				let media = null;
				if (tipo === 'text') contenido = msg.text?.body || '';
				else if (tipo === 'button') contenido = msg.button?.text || msg.button?.payload || '';
				else if (tipo === 'interactive') {
					contenido =
						msg.interactive?.button_reply?.title ||
						msg.interactive?.list_reply?.title ||
						msg.interactive?.list_reply?.description ||
						'';
				} else if (TIPOS_AUDIO.has(tipo)) {
					// El contenido real se resuelve transcribiendo el audio más adelante.
					const audioNode = msg.audio || msg.voice || {};
					media = {
						tipo: 'audio',
						id: audioNode.id || null,
						mimeType: audioNode.mime_type || null,
					};
					contenido = '';
				} else {
					contenido = `[${tipo}]`;
				}
				if (!contenido.trim() && !media?.id) continue;

				mensajes.push({
					telefono: String(msg.from),
					contenido: contenido.trim(),
					media,
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

/** True solo si el body trae mensajes reales (no basta object+entry vacío). */
function esPayloadMetaConMensajes(body) {
	if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry) || body.entry.length === 0) {
		return false;
	}
	for (const entry of body.entry) {
		for (const change of entry.changes || []) {
			if (change.field === 'messages' && (change.value?.messages?.length ?? 0) > 0) {
				return true;
			}
		}
	}
	return false;
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

async function resolverContenidoAudio(m, idEmpresa, waCfg) {
	await audioTranscripcion.aplicarTranscripcionAMensaje(m, idEmpresa, waCfg);
}

async function procesarGrupoMensajes(idEmpresa, mensajes, sourceLabel, waCfg = null) {
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
				if (m.media?.id && !m.contenido) {
					await resolverContenidoAudio(m, idEmpresa, waCfg);
				}
				const claim = webhookDedup.tryClaimIncoming(m.metaMessageId, {
					telefono: m.telefono,
					timestamp: m.timestamp,
					contenido: m.contenido,
				});
				if (!claim.ok) {
					diag.line('webhook', 'Señal Meta ignorada (solo primera por mensaje)', {
						metaMessageId: m.metaMessageId,
						reason: claim.reason,
						telefono: m.telefono,
					});
					resultados.push({
						skipped: true,
						metaMessageId: m.metaMessageId,
						reason: claim.reason,
					});
					continue;
				}

				try {
					if (botReset.esComandoReset(m.contenido)) {
						const reset = await botReset.procesarComandoReset({
							idEmpresa,
							telefonoWhatsApp: m.telefono,
							contenido: m.contenido,
						});
						resultados.push({ reset, botReply: { respondido: false, motivo: 'comando-reset' } });
						webhookDedup.markCompleted(claim.key, true);
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
						webhookDedup.markCompleted(claim.key, true);
						continue;
					}

					diag.line('webhook', 'Mensaje registrado en tenant', {
						idEmpresa,
						idConversacion: r.conversacion?.idConversacion,
						telefono: m.telefono,
					});

					let botReply = null;
					const estadoBot = await botConversacion.puedeResponderBot(r.conversacion.idConversacion);
					if (estadoBot.puedeResponderBot) {
						try {
							botReply = await botResponder.responderMensajeEntrante({
								idEmpresa,
								telefonoWhatsApp: m.telefono,
								idConversacion: r.conversacion.idConversacion,
								contenidoUltimo: m.contenido,
								idMensajePaciente: r.mensaje?.idMensaje,
								metaMessageIdEntrante: m.metaMessageId,
							});
							diag.line('webhook', 'Bot respuesta', {
								respondido: botReply?.respondido,
								motivo: botReply?.motivo,
								textoLen: botReply?.texto?.length,
							});
						} catch (botErr) {
							diag.warn('webhook', 'Bot error', { error: botErr.message, code: botErr.code });
							console.warn('[whatsappWebhook] Bot:', botErr.message);
							botReply = { respondido: false, motivo: botErr.message };
						}
					} else {
						diag.line('webhook', 'Bot no responde (modo agente)', {
							modoControl: estadoBot.modoControl,
						});
					}

					resultados.push({ ...r, botReply });
					webhookDedup.markCompleted(claim.key, true);
				} catch (err) {
					webhookDedup.markFailed(claim.key);
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
		let idEmpresa = null;
		let sourceLabel = '';
		let waCfg = null;

		if (phoneKey === '__default__') {
			if (!allowLegacyDefaultEmpresa()) {
				console.warn('[whatsappWebhook] Mensaje sin phone_number_id — omitido (SaaS multi-tenant)');
				continue;
			}
			idEmpresa = getDefaultEmpresaId();
			sourceLabel = 'BOT_EMPRESA_ID default (legacy)';
		} else {
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
				waCfg = cfg;
			} else if (allowLegacyDefaultEmpresa()) {
				idEmpresa = getDefaultEmpresaId();
				sourceLabel = 'BOT_EMPRESA_ID fallback';
				console.warn(
					`[whatsappWebhook] phone_number_id ${phoneKey} sin mapeo; usando empresa ${idEmpresa} (legacy)`,
				);
			} else {
				console.warn(
					`[whatsappWebhook] phone_number_id ${phoneKey} sin mapeo en MySQL — mensaje omitido`,
				);
				continue;
			}
		}

		const batch = await procesarGrupoMensajes(idEmpresa, grupo, sourceLabel, waCfg);
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
	esPayloadMetaConMensajes,
};
