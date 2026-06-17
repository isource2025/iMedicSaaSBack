const botConversacion = require('../services/botConversacion.service');
const botResponder = require('../services/botResponder.service');
const botReset = require('../services/botReset.service');
const audioTranscripcion = require('../services/audioTranscripcion.service');

/**
 * Webhook entrante — Meta / middleware WhatsApp → iMedic
 * POST /api/integrations/bot/webhook/mensaje
 */
async function webhookMensajeEntrante(req, res) {
	try {
		const body = req.body || {};
		const whatsappWebhook = require('../services/whatsappWebhook.service');

		// Solo payload Meta con mensajes reales (evita tragar { entry: [] } del gateway)
		if (whatsappWebhook.payloadMetaTieneMensajes(body)) {
			const result = await whatsappWebhook.procesarWebhookEntrante(body);
			return res.json({ success: true, data: result });
		}

		const telefono =
			body.telefono ?? body.telefonoWhatsApp ?? body.from ?? body.wa_id ?? body.phone;
		const contenido = await audioTranscripcion.resolverContenidoDesdeIntegrationBody(
			body,
			req.idEmpresa,
		);
		const idConversacion = body.idConversacion ?? body.conversationId ?? null;
		const nombreContacto = body.nombreContacto ?? body.profileName ?? body.nombre ?? null;
		const metaMessageId = body.metaMessageId ?? body.messageId ?? body.id ?? null;
		const idPaciente = body.idPaciente != null ? Number(body.idPaciente) : null;
		const dniPaciente = body.dniPaciente ?? body.numeroDocumento ?? null;

		if (!telefono) {
			return res.status(400).json({
				success: false,
				mensaje: 'telefono es obligatorio',
				codigo: 'PAYLOAD_INVALIDO',
			});
		}

		const contenidoCmd = audioTranscripcion.quitarMarcadorAudio(contenido);
		if (botReset.esComandoReset(contenidoCmd)) {
			const reset = await botReset.procesarComandoReset({
				idEmpresa: req.idEmpresa,
				telefonoWhatsApp: telefono,
				contenido: contenidoCmd,
			});
			return res.json({
				success: true,
				data: { reset, botReply: { respondido: false, motivo: 'comando-reset' } },
			});
		}

		if (!contenido) {
			return res.status(400).json({
				success: false,
				mensaje: 'telefono y mensaje/contenido son obligatorios',
				codigo: 'PAYLOAD_INVALIDO',
			});
		}

		const webhookDedup = require('../services/webhookDedup.service');
		const claim = webhookDedup.tryClaimIncoming(metaMessageId, {
			telefono,
			timestamp: body.timestamp,
			contenido,
		});
		if (!claim.ok) {
			return res.json({
				success: true,
				data: { skipped: true, reason: claim.reason, metaMessageId },
			});
		}

		const result = await botConversacion.registrarMensajeEntrante({
			telefonoWhatsApp: telefono,
			contenido,
			idConversacion,
			nombreContacto,
			idPaciente: Number.isFinite(idPaciente) ? idPaciente : null,
			dniPaciente,
			metaMessageId,
		});

		const estado = await botConversacion.puedeResponderBot(result.conversacion.idConversacion);

		let botReply = null;
		if (result.duplicado) {
			webhookDedup.markCompleted(claim.key, true);
		} else if (estado.puedeResponderBot) {
			try {
				botReply = await botResponder.responderMensajeEntrante({
					idEmpresa: req.idEmpresa,
					telefonoWhatsApp: telefono,
					idConversacion: result.conversacion.idConversacion,
					contenidoUltimo: contenido,
					idMensajePaciente: result.mensaje?.idMensaje,
					metaMessageIdEntrante: metaMessageId,
				});
			} catch (gptErr) {
				botReply = { respondido: false, motivo: gptErr.message };
			}
			webhookDedup.markCompleted(claim.key, true);
		} else {
			webhookDedup.markCompleted(claim.key, true);
		}

		res.json({
			success: true,
			data: {
				...result,
				puedeResponderBot: estado.puedeResponderBot,
				modoControl: estado.modoControl,
				botReply,
			},
		});
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

/**
 * Registra mensaje saliente del bot externo (n8n, Meta, etc.)
 */
async function webhookMensajeSaliente(req, res) {
	try {
		const body = req.body || {};
		const idConversacion =
			body.idConversacion ??
			(body.telefono ? botConversacion.idDesdeTelefono(body.telefono) : null);
		const contenido = body.mensaje ?? body.contenido ?? body.text;
		const metaMessageId = body.metaMessageId ?? body.messageId ?? null;
		const pasoBot = body.pasoBot ?? null;

		if (!idConversacion || !contenido) {
			return res.status(400).json({
				success: false,
				mensaje: 'idConversacion (o telefono) y mensaje son obligatorios',
			});
		}

		const result = await botConversacion.registrarMensajeSaliente({
			idConversacion,
			contenido,
			origen: 'BOT',
			metaMessageId,
		});

		if (pasoBot) {
			await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot });
		}

		res.json({ success: true, data: result });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

/**
 * El bot externo consulta si puede auto-responder
 */
async function consultarEstado(req, res) {
	try {
		const idConversacion = req.query.idConversacion ?? req.query.id ?? null;
		const telefono = req.query.telefono ?? req.query.telefonoWhatsApp ?? null;

		let estado;
		if (idConversacion) {
			estado = await botConversacion.puedeResponderBot(idConversacion);
		} else if (telefono) {
			estado = await botConversacion.puedeResponderBotPorTelefono(telefono);
		} else {
			return res.status(400).json({
				success: false,
				mensaje: 'Indique idConversacion o telefono',
			});
		}

		res.json({ success: true, data: estado });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

/**
 * Actualiza contexto de conversación desde el flujo del bot
 */
async function actualizarContexto(req, res) {
	try {
		const body = req.body || {};
		const idConversacion =
			body.idConversacion ??
			(body.telefono ? botConversacion.idDesdeTelefono(body.telefono) : null);

		if (!idConversacion) {
			return res.status(400).json({ success: false, mensaje: 'idConversacion o telefono requerido' });
		}

		const conv = await botConversacion.actualizarContextoPaciente(idConversacion, {
			idPaciente: body.idPaciente != null ? Number(body.idPaciente) : null,
			dniPaciente: body.dniPaciente ?? body.numeroDocumento ?? null,
			nombreContacto: body.nombreContacto ?? null,
			pasoBot: body.pasoBot ?? null,
		});

		res.json({ success: true, data: conv });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

/**
 * POST /api/integrations/bot/webhook/meta
 * Gateway reenvía el body Meta sin transformar → transcribe audios + responde igual que texto.
 */
async function webhookMetaEntrante(req, res) {
	try {
		const body = req.body || {};
		const whatsappWebhook = require('../services/whatsappWebhook.service');
		if (!whatsappWebhook.payloadMetaTieneMensajes(body)) {
			return res.status(400).json({
				success: false,
				mensaje: 'Se espera payload Meta con mensajes (object=whatsapp_business_account, entry[].changes[].value.messages)',
				codigo: 'PAYLOAD_INVALIDO',
			});
		}
		const result = await whatsappWebhook.procesarWebhookEntrante(body);
		res.json({ success: true, data: result });
	} catch (err) {
		res.status(err.statusCode || 500).json({ success: false, mensaje: err.message });
	}
}

module.exports = {
	webhookMensajeEntrante,
	webhookMensajeSaliente,
	webhookMetaEntrante,
	consultarEstado,
	actualizarContexto,
};
