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
	if (conv?.nombreContacto) {
		ctx.push(
			`Nombre del contacto WhatsApp (siempre tratá al paciente con este nombre): ${conv.nombreContacto}`,
		);
	}
	if (conv?.dniPaciente) ctx.push(`DNI confirmado: ${conv.dniPaciente}`);
	if (conv?.pasoBot) ctx.push(`Paso actual del flujo: ${conv.pasoBot}`);

	const pasoActual = conv?.pasoBot;
	const incluirEspecialidad = botWizard.pasosActivos(flujo).some((p) => p.id === 'ELEGIR_ESPECIALIDAD');
	const incluirProfesional = botWizard.pasosActivos(flujo).some((p) => p.id === 'ELEGIR_PROFESIONAL');

	const reglasFlujo = [
		'Si el paciente aún no confirmó identidad en RENAPER, no avances a especialidad.',
		config.reglas.sugerirPrimerTurnoDisponible
			? 'Con "sugerir primer turno" activo: al elegir especialidad el wizard propone UN solo turno (el más cercano) con médico y horario; NO listes profesionales ni pidas elegir manualmente. Si el paciente rechaza ("no", "el lunes no puedo"), el wizard busca el siguiente turno libre.'
			: null,
		incluirEspecialidad
			? 'Cuando corresponda, pedí especialidad.'
			: 'NO pidas especialidad (paso desactivado en el wizard).',
		incluirProfesional
			? 'Después de especialidad, pedí profesional si aplica.'
			: 'NO pidas profesional (paso desactivado en el wizard).',
	].filter(Boolean);

	return [
		config.promptSistema ||
			'Sos un asistente amable de turnos médicos por WhatsApp. Sé breve, claro y en español rioplatense.',
		`Institución: ${config.nombreInstitucion || 'iMedic'}.`,
		'Objetivo: ayudar a reservar turnos médicos siguiendo SOLO los pasos activos del wizard.',
		...reglasFlujo,
		'No inventes horarios ni médicos; si no tenés datos, pedí el siguiente dato del flujo.',
		'Respuestas cortas (máx. 2-3 párrafos). Sin markdown complejo.',
		conv?.nombreContacto
			? `Siempre dirigite al paciente como *${String(conv.nombreContacto).trim().split(/\s+/)[0]}* (nombre del contacto WhatsApp), no uses el nombre legal de RENAPER.`
			: '',
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
	const dniDetectado = botWizard.extraerDni(textoEntrada);
	const enviarOpts = {
		idEmpresa,
		idConversacion,
		telefonoWhatsApp,
		idMensajePaciente: msgId,
		metaMessageIdEntrante,
	};

	// 1) Wizard determinístico (RENAPER, confirmación) — siempre, con o sin GPT
	try {
		const wizard = await botWizard.intentarRespuestaWizard({
			idConversacion,
			telefonoWhatsApp,
			contenido: textoEntrada,
		});
		if (wizard.handled && wizard.texto) {
			return enviarTextoBot({ ...enviarOpts, texto: wizard.texto });
		}
	} catch (wizardErr) {
		diag.warn('webhook', 'Wizard error', { error: wizardErr.message, code: wizardErr.code });
		if (dniDetectado || conv?.pasoBot === 'CONFIRMAR_IDENTIDAD') {
			const texto =
				wizardErr.code === 'RENAPER_NO_ENCONTRADO'
					? 'No encontramos ese DNI en RENAPER. Verificá el número e intentá de nuevo.'
					: wizardErr.code === 'RENAPER_TIMEOUT'
						? 'La consulta a RENAPER tardó demasiado. Intentá enviar tu DNI de nuevo.'
						: 'No pudimos validar tu DNI en este momento. Intentá de nuevo en unos segundos.';
			return enviarTextoBot({ ...enviarOpts, texto });
		}
	}

	const flujo = await botConfigService.getFlujoPasos();
	const pasoActual = conv?.pasoBot || botWizard.pasoInicial(flujo);

	if (pasoActual === 'CONFIRMAR_IDENTIDAD' || (dniDetectado && !conv?.idPaciente)) {
		diag.warn('webhook', 'Wizard no respondió a identificación', {
			dniDetectado,
			pasoActual,
			idConversacion,
		});
		return enviarTextoBot({
			...enviarOpts,
			texto: 'Recibimos tu DNI. Si no ves los datos de RENAPER, enviá el número de nuevo.',
		});
	}

	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
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
