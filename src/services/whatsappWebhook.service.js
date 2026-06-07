const botConversacion = require('./botConversacion.service');
const botResponder = require('./botResponder.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
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

async function procesarGrupoMensajes(idEmpresa, mensajes, sourceLabel) {
	const resultados = [];
	await runWithTenant(idEmpresa, async () => {
		for (const m of mensajes) {
			try {
				const r = await botConversacion.registrarMensajeEntrante({
					telefonoWhatsApp: m.telefono,
					contenido: m.contenido,
					idConversacion: m.idConversacion,
					nombreContacto: m.nombreContacto,
					metaMessageId: m.metaMessageId,
				});

				let botReply = null;
				if (botResponder.gptHabilitado()) {
					try {
						botReply = await botResponder.responderMensajeEntrante({
							idEmpresa,
							telefonoWhatsApp: m.telefono,
							idConversacion: r.conversacion.idConversacion,
						});
					} catch (gptErr) {
						console.warn('[whatsappWebhook] GPT:', gptErr.message);
						botReply = { respondido: false, motivo: gptErr.message };
					}
				}

				resultados.push({ ...r, botReply });
			} catch (err) {
				console.warn(
					`[whatsappWebhook] mensaje no registrado (empresa ${idEmpresa}, ${sourceLabel}):`,
					err.message,
				);
			}
		}
	});
	return resultados;
}

async function procesarWebhookEntrante(body) {
	const mensajes = extraerMensajesEntrantes(body);

	if (!mensajes.length) {
		return { procesados: 0, empresas: [] };
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
