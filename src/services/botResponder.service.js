/**
 * Respuesta automática del bot vía wizard + GPT + envío WhatsApp Meta.
 */
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botOpenai = require('./botOpenai.service');
const botWizard = require('./botWizard.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const whatsappMeta = require('./whatsappMeta.service');
const diag = require('../utils/diagLog');

function gptHabilitado() {
	if (process.env.BOT_GPT_ENABLED === '0' || process.env.BOT_GPT_ENABLED === 'false') {
		return false;
	}
	return botOpenai.isConfigured();
}

function mensajesParaOpenAi(mensajes) {
	return (mensajes || [])
		.filter((m) => m.origen === 'PACIENTE' || m.origen === 'BOT')
		.map((m) => ({
			role: m.origen === 'BOT' ? 'assistant' : 'user',
			content: String(m.contenido || '').trim(),
		}))
		.filter((m) => m.content);
}

async function buildSystemPrompt(config, flujo, conv) {
	const pasosActivos = botWizard.pasosActivos(flujo)
		.map((p) => `${p.paso}. ${p.titulo} (${p.id}): ${p.mensajeUsuario}`)
		.join('\n');

	const ctx = [];
	if (conv?.nombreContacto) ctx.push(`Nombre contacto: ${conv.nombreContacto}`);
	if (conv?.dniPaciente) ctx.push(`DNI confirmado: ${conv.dniPaciente}`);
	if (conv?.pasoBot) ctx.push(`Paso actual del flujo: ${conv.pasoBot}`);

	const pasoActual = conv?.pasoBot;
	const incluirEspecialidad = botWizard.pasosActivos(flujo).some((p) => p.id === 'ELEGIR_ESPECIALIDAD');
	const incluirProfesional = botWizard.pasosActivos(flujo).some((p) => p.id === 'ELEGIR_PROFESIONAL');

	const reglasFlujo = [
		'Si el paciente aún no confirmó identidad en RENAPER, no avances a especialidad.',
		incluirEspecialidad
			? 'Cuando corresponda, pedí especialidad.'
			: 'NO pidas especialidad (paso desactivado en el wizard).',
		incluirProfesional
			? 'Después de especialidad, pedí profesional si aplica.'
			: 'NO pidas profesional (paso desactivado en el wizard).',
	];

	return [
		config.promptSistema ||
			'Sos un asistente amable de turnos médicos por WhatsApp. Sé breve, claro y en español rioplatense.',
		`Institución: ${config.nombreInstitucion || 'iMedic'}.`,
		'Objetivo: ayudar a reservar turnos médicos siguiendo SOLO los pasos activos del wizard.',
		...reglasFlujo,
		'No inventes horarios ni médicos; si no tenés datos, pedí el siguiente dato del flujo.',
		'Respuestas cortas (máx. 2-3 párrafos). Sin markdown complejo.',
		ctx.length ? `Contexto:\n${ctx.join('\n')}` : '',
		pasosActivos ? `Pasos activos del wizard:\n${pasosActivos}` : '',
		pasoActual ? `Estás en el paso: ${pasoActual}` : '',
		`Mensaje bienvenida referencia: ${config.mensajes?.bienvenida || ''}`,
	].filter(Boolean).join('\n\n');
}

async function enviarTextoBot({
	idEmpresa,
	idConversacion,
	telefonoWhatsApp,
	texto,
	idMensajePaciente = null,
	metaMessageIdEntrante = null,
}) {
	if (metaMessageIdEntrante && (await botConversacion.yaRespondidoAMetaMessage(idConversacion, metaMessageIdEntrante))) {
		return { respondido: false, motivo: 'ya-respondido-wamid' };
	}
	if (idMensajePaciente && (await botConversacion.yaRespondidoAlMensaje(idConversacion, idMensajePaciente))) {
		return { respondido: false, motivo: 'ya-respondido' };
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
	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
	}

	const estado = await botConversacion.puedeResponderBot(idConversacion);
	if (!estado.puedeResponderBot) {
		return { respondido: false, motivo: `modo ${estado.modoControl}` };
	}

	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const historial = await botConversacion.listarMensajes(idConversacion, { limit: 24 });
	const ultimo = historial[historial.length - 1];
	if (!ultimo || ultimo.origen !== 'PACIENTE') {
		return { respondido: false, motivo: 'sin mensaje nuevo del paciente' };
	}

	const msgId = idMensajePaciente || ultimo.idMensaje;

	if (metaMessageIdEntrante && (await botConversacion.yaRespondidoAMetaMessage(idConversacion, metaMessageIdEntrante))) {
		diag.line('webhook', 'Ya respondido a este wamid de Meta', {
			idConversacion,
			metaMessageIdEntrante,
		});
		return { respondido: false, motivo: 'ya-respondido-wamid' };
	}

	if (msgId && (await botConversacion.yaRespondidoAlMensaje(idConversacion, msgId))) {
		diag.line('webhook', 'Ya respondido a este mensaje entrante', {
			idConversacion,
			idMensajePaciente: msgId,
			metaMessageIdEntrante,
		});
		return { respondido: false, motivo: 'ya-respondido' };
	}

	const textoEntrada = contenidoUltimo || ultimo.contenido;

	// 1) Wizard determinístico (RENAPER, confirmación, pasos activos)
	try {
		const wizard = await botWizard.intentarRespuestaWizard({
			idConversacion,
			telefonoWhatsApp,
			contenido: textoEntrada,
		});
		if (wizard.handled && wizard.texto) {
			return enviarTextoBot({
				idEmpresa,
				idConversacion,
				telefonoWhatsApp,
				texto: wizard.texto,
				idMensajePaciente: msgId,
				metaMessageIdEntrante,
			});
		}
	} catch (wizardErr) {
		diag.warn('webhook', 'Wizard error', { error: wizardErr.message, code: wizardErr.code });
		if (wizardErr.code === 'RENAPER_NO_ENCONTRADO') {
			return enviarTextoBot({
				idEmpresa,
				idConversacion,
				telefonoWhatsApp,
				texto: 'No encontramos ese DNI en RENAPER. Verificá el número e intentá de nuevo.',
				idMensajePaciente: msgId,
				metaMessageIdEntrante,
			});
		}
	}

	const flujo = await botConfigService.getFlujoPasos();
	const pasoActual = conv?.pasoBot || botWizard.pasoInicial(flujo);
	const dniDetectado = botWizard.extraerDni(textoEntrada);

	// DNI o confirmación RENAPER: solo wizard (GPT no debe inventar el paso de confirmación).
	if (pasoActual === 'CONFIRMAR_IDENTIDAD' || (dniDetectado && !conv?.idPaciente)) {
		return { respondido: false, motivo: 'identificacion-solo-wizard' };
	}

	// 2) GPT para el resto del flujo
	const config = await botConfigService.getBotConfig();
	const messages = mensajesParaOpenAi(historial);
	if (!messages.length) {
		return { respondido: false, motivo: 'sin historial' };
	}

	const system = await buildSystemPrompt(config, flujo, conv);
	const texto = await botOpenai.chat({ system, messages });

	return enviarTextoBot({
		idEmpresa,
		idConversacion,
		telefonoWhatsApp,
		texto,
		idMensajePaciente: msgId,
		metaMessageIdEntrante,
	});
}

module.exports = {
	gptHabilitado,
	responderMensajeEntrante,
	buildSystemPrompt,
};
