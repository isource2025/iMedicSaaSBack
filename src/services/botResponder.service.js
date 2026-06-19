/**
 * Respuesta automática del bot: agente IA conversacional + envío WhatsApp Meta.
 *
 * Este módulo solo se encarga de la "tubería": deduplicación, obtención del
 * último mensaje, invocación del agente IA (botAgente) y envío por Meta.
 * Toda la inteligencia conversacional vive en botAgente.service.js.
 */
const botConversacion = require('./botConversacion.service');
const botAgente = require('./botAgente.service');
const botSesionIa = require('./botSesionIa.service');
const audioTranscripcion = require('./audioTranscripcion.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const whatsappMeta = require('./whatsappMeta.service');
const diag = require('../utils/diagLog');

function gptHabilitado() {
	return botAgente.gptHabilitado();
}

async function enviarTextoBot({
	idEmpresa,
	idConversacion,
	telefonoWhatsApp,
	texto,
	idMensajePaciente = null,
	metaMessageIdEntrante = null,
	seguimiento = false,
	omitirMarcarRespondido = false,
}) {
	if (!seguimiento) {
		if (
			metaMessageIdEntrante &&
			(await botConversacion.yaRespondidoAMetaMessage(idConversacion, metaMessageIdEntrante))
		) {
			return { respondido: false, motivo: 'ya-respondido-wamid' };
		}
		if (
			idMensajePaciente &&
			(await botConversacion.yaRespondidoAlMensaje(idConversacion, idMensajePaciente))
		) {
			return { respondido: false, motivo: 'ya-respondido' };
		}
	}

	const waCfg = await whatsappEmpresa.getConfigForEmpresa(idEmpresa);
	diag.logWhatsappEmpresa('botResponder waCfg', {
		idEmpresa,
		source: waCfg?.source,
		phoneNumberId: waCfg?.phoneNumberId,
		hasToken: Boolean(waCfg?.accessToken),
	});

	if (!waCfg?.phoneNumberId || !waCfg?.accessToken) {
		await botConversacion.registrarMensajeSaliente({
			idConversacion,
			contenido: texto,
			origen: 'BOT',
		});
		if (!omitirMarcarRespondido && idMensajePaciente) {
			await botConversacion.marcarEntranteRespondido(idConversacion, idMensajePaciente);
		}
		return { respondido: true, texto, motivo: 'guardado sin Meta (falta config WhatsApp)' };
	}

	const meta = await whatsappMeta.sendTextMessage({
		phoneNumberId: waCfg.phoneNumberId,
		accessToken: waCfg.accessToken,
		to: telefonoWhatsApp,
		text: texto,
	});

	await botConversacion.registrarMensajeSaliente({
		idConversacion,
		contenido: texto,
		origen: 'BOT',
		metaMessageId: meta.messageId,
	});

	if (!omitirMarcarRespondido && idMensajePaciente) {
		await botConversacion.marcarEntranteRespondido(idConversacion, idMensajePaciente);
	}

	return { respondido: true, texto, metaMessageId: meta.messageId };
}

/**
 * @returns {Promise<{ respondido: boolean, texto?: string, metaMessageId?: string, motivo?: string }>}
 */
async function responderMensajeEntrante({
	idEmpresa,
	telefonoWhatsApp,
	idConversacion,
	contenidoUltimo = null,
	idMensajePaciente = null,
	metaMessageIdEntrante = null,
}) {
	const estado = await botConversacion.puedeResponderBot(idConversacion);
	if (!estado.puedeResponderBot) {
		return { respondido: false, motivo: `modo ${estado.modoControl}` };
	}

	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const historial = await botSesionIa.listarMensajesParaIa(idConversacion, { limit: 24 });
	const ultimo = historial[historial.length - 1];
	if (!ultimo || ultimo.origen !== 'PACIENTE') {
		return { respondido: false, motivo: 'sin mensaje nuevo del paciente' };
	}

	const msgId = idMensajePaciente || ultimo.idMensaje;

	if (
		metaMessageIdEntrante &&
		(await botConversacion.yaRespondidoAMetaMessage(idConversacion, metaMessageIdEntrante))
	) {
		return { respondido: false, motivo: 'ya-respondido-wamid' };
	}
	if (msgId && (await botConversacion.yaRespondidoAlMensaje(idConversacion, msgId))) {
		return { respondido: false, motivo: 'ya-respondido' };
	}

	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
	}

	const textoEntrada = audioTranscripcion.quitarMarcadorAudio(contenidoUltimo || ultimo.contenido);

	const enviarOpts = {
		idEmpresa,
		idConversacion,
		telefonoWhatsApp,
		idMensajePaciente: msgId,
		metaMessageIdEntrante,
	};

	let agente;
	try {
		agente = await botAgente.responder({
			idConversacion,
			conv,
			telefonoWhatsApp,
			historial,
			textoEntrada,
		});
	} catch (err) {
		diag.warn('webhook', 'Agente IA error', { error: err.message, idConversacion });
		return { respondido: false, motivo: `agente: ${err.message}` };
	}

	if (!agente?.respondido || !agente.texto) {
		return { respondido: false, motivo: agente?.motivo || 'sin_respuesta_agente' };
	}

	// Mensaje principal del bot.
	const res = await enviarTextoBot({
		...enviarOpts,
		texto: agente.texto,
		// Si hay comprobante, no marcamos respondido aún (va un segundo mensaje).
		omitirMarcarRespondido: Boolean(agente.ticket),
	});

	if (res.respondido && agente.marcarSaludo) {
		await botSesionIa.marcarSaludoEnviado(idConversacion, conv);
	}

	// Segundo mensaje: comprobante del turno (si se reservó).
	if (res.respondido && agente.ticket) {
		await enviarTextoBot({
			...enviarOpts,
			texto: agente.ticket,
			seguimiento: true,
		});
	}

	// Tras reservar, reiniciar la gestión (el próximo turno puede ser para otra persona).
	if (res.respondido && agente.finalizar) {
		try {
			await botConversacion.finalizarTrasReservaExitosa(idConversacion);
		} catch (err) {
			diag.warn('webhook', 'finalizarTrasReservaExitosa falló', { error: err.message });
		}
	}

	return res;
}

module.exports = {
	gptHabilitado,
	responderMensajeEntrante,
};
