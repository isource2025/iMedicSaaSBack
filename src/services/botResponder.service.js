/**
 * Respuesta automática del bot: agente IA conversacional + envío WhatsApp Meta.
 */
const botConversacion = require('./botConversacion.service');
const botAgente = require('./botAgente.service');
const botSesionIa = require('./botSesionIa.service');
const botMensajeCola = require('./botMensajeCola.service');
const audioTranscripcion = require('./audioTranscripcion.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const whatsappMeta = require('./whatsappMeta.service');
const agenteTrace = require('../utils/botAgenteTrace');
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

async function marcarMensajesRespondidos(idConversacion, msgIds) {
	for (const id of msgIds || []) {
		if (id) await botConversacion.marcarEntranteRespondido(idConversacion, id);
	}
}

/**
 * Procesa uno o más mensajes (posible merge por cola) y responde una sola vez.
 */
async function procesarMensajeEntrante({
	idEmpresa,
	telefonoWhatsApp,
	idConversacion,
	contenidoUltimo = null,
	textoEntrada = null,
	idMensajePaciente = null,
	metaMessageIdEntrante = null,
	_merged = false,
	_mergeCount = 1,
	_textos = null,
	_msgIds = null,
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
	const msgIds = _msgIds?.length ? _msgIds : [msgId];

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

	const texto =
		textoEntrada ||
		audioTranscripcion.quitarMarcadorAudio(contenidoUltimo || ultimo.contenido);

	if (_merged && _mergeCount > 1) {
		agenteTrace.logNota(`Cola: ${_mergeCount} mensajes fusionados`, { textos: _textos });
	}

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
			textoEntrada: texto,
			_merged: _merged,
			_mergeCount: _mergeCount,
			_textos: _textos,
		});
	} catch (err) {
		diag.warn('webhook', 'Agente IA error', { error: err.message, idConversacion });
		agenteTrace.logNota('Agente excepción', { error: err.message });
		return { respondido: false, motivo: `agente: ${err.message}` };
	}

	if (!agente?.respondido || !agente.texto) {
		agenteTrace.logNota('Agente sin respuesta', { motivo: agente?.motivo });
		return { respondido: false, motivo: agente?.motivo || 'sin_respuesta_agente' };
	}

	const res = await enviarTextoBot({
		...enviarOpts,
		texto: agente.texto,
		omitirMarcarRespondido: Boolean(agente.ticket) || msgIds.length > 1,
	});

	agenteTrace.logNota(
		res.respondido ? 'WhatsApp enviado OK' : `WhatsApp NO enviado: ${res.motivo || '?'}`,
		{ textoLen: agente.texto?.length, metaMessageId: res.metaMessageId },
	);

	if (res.respondido && agente.marcarSaludo) {
		await botSesionIa.marcarSaludoEnviado(idConversacion, conv);
	}

	if (res.respondido && agente.ticket) {
		await enviarTextoBot({
			...enviarOpts,
			texto: agente.ticket,
			seguimiento: true,
		});
	}

	if (res.respondido && msgIds.length > 1) {
		await marcarMensajesRespondidos(idConversacion, msgIds);
	}

	if (res.respondido && agente.finalizar) {
		try {
			await botConversacion.finalizarTrasReservaExitosa(idConversacion);
		} catch (err) {
			diag.warn('webhook', 'finalizarTrasReservaExitosa falló', { error: err.message });
		}
	}

	return { ...res, merged: _merged, mergeCount: _mergeCount };
}

async function responderMensajeEntrante(opts) {
	const item = {
		...opts,
		textoEntrada: audioTranscripcion.quitarMarcadorAudio(
			opts.contenidoUltimo || opts.textoEntrada || '',
		),
	};

	return botMensajeCola.encolar(opts.idConversacion, item, async (merged) => {
		const msgIds = (merged._textos || []).map((_, i) => merged._msgIds?.[i]).filter(Boolean);
		if (!msgIds.length && merged.idMensajePaciente) msgIds.push(merged.idMensajePaciente);

		return procesarMensajeEntrante({
			...merged,
			_msgIds: msgIds.length ? msgIds : [merged.idMensajePaciente].filter(Boolean),
		});
	});
}

module.exports = {
	gptHabilitado,
	responderMensajeEntrante,
	procesarMensajeEntrante,
};
