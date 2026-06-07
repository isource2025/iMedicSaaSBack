/**
 * Respuesta automática del bot vía GPT + envío WhatsApp Meta.
 */
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botOpenai = require('./botOpenai.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const whatsappMeta = require('./whatsappMeta.service');

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
	const pasosActivos = (flujo || [])
		.filter((p) => p.activo)
		.map((p) => `${p.paso}. ${p.titulo}: ${p.mensajeUsuario}`)
		.join('\n');

	const ctx = [];
	if (conv?.nombreContacto) ctx.push(`Nombre contacto: ${conv.nombreContacto}`);
	if (conv?.dniPaciente) ctx.push(`DNI conocido: ${conv.dniPaciente}`);
	if (conv?.pasoBot) ctx.push(`Paso actual del flujo: ${conv.pasoBot}`);

	return [
		config.promptSistema ||
			'Sos un asistente amable de turnos médicos por WhatsApp. Sé breve, claro y en español rioplatense.',
		`Institución: ${config.nombreInstitucion || 'iMedic'}.`,
		'Objetivo: ayudar a reservar turnos médicos. Pedí DNI si no lo tenés, luego especialidad, profesional, fecha/hora.',
		'No inventes horarios ni médicos; si no tenés datos, pedí el siguiente dato del flujo.',
		'Respuestas cortas (máx. 2-3 párrafos). Sin markdown complejo.',
		ctx.length ? `Contexto:\n${ctx.join('\n')}` : '',
		pasosActivos ? `Flujo configurado:\n${pasosActivos}` : '',
		`Mensaje bienvenida referencia: ${config.mensajes?.bienvenida || ''}`,
	].filter(Boolean).join('\n\n');
}

/**
 * Genera y envía respuesta GPT si el modo es BOT.
 * @returns {Promise<{ respondido: boolean, texto?: string, metaMessageId?: string, motivo?: string }>}
 */
async function responderMensajeEntrante({ idEmpresa, telefonoWhatsApp, idConversacion }) {
	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
	}

	const estado = await botConversacion.puedeResponderBot(idConversacion);
	if (!estado.puedeResponderBot) {
		return { respondido: false, motivo: `modo ${estado.modoControl}` };
	}

	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const config = await botConfigService.getBotConfig();
	const flujo = await botConfigService.getFlujoPasos();
	const historial = await botConversacion.listarMensajes(idConversacion, { limit: 24 });

	const system = await buildSystemPrompt(config, flujo, conv);
	const messages = mensajesParaOpenAi(historial);
	if (!messages.length) {
		return { respondido: false, motivo: 'sin historial' };
	}

	const texto = await botOpenai.chat({ system, messages });

	const waCfg = await whatsappEmpresa.getConfigForEmpresa(idEmpresa);
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

module.exports = {
	gptHabilitado,
	responderMensajeEntrante,
	buildSystemPrompt,
};
