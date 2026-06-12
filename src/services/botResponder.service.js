/**
 * Respuesta automática del bot vía wizard + GPT + envío WhatsApp Meta.
 */
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botOpenai = require('./botOpenai.service');
const botWizard = require('./botWizard.service');
const botAgenda = require('./botAgenda.service');
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
			? 'Cuando corresponda, pedí especialidad. Interpretá lenguaje natural (ej. "gineco", "para gineco un turno" = GINECOLOGÍA). Si preguntan qué hay, listá las especialidades de forma amigable.'
			: 'NO pidas especialidad (paso desactivado en el wizard).',
		incluirProfesional
			? 'Después de especialidad, pedí profesional si aplica.'
			: 'NO pidas profesional (paso desactivado en el wizard).',
	].filter(Boolean);

	if (pasoActual === 'ELEGIR_ESPECIALIDAD') {
		try {
			const lista = await botAgenda.listarEspecialidadesBot();
			if (lista.length) {
				reglasFlujo.push(
					`Especialidades con turno: ${lista.map((e) => e.nombre).join(', ')}.`,
				);
				reglasFlujo.push(
					'Conversá de forma natural. Si el paciente elige o menciona una especialidad (aunque sea informal), pedile que confirme el nombre exacto para buscarle el turno más cercano.',
				);
			}
		} catch {
			/* sin catálogo */
		}
	}

	if (pasoActual === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') {
		const t = conv.contextoBot;
		reglasFlujo.push(
			`Turno en oferta: ${t.medico || ''} el ${t.diaSemana || ''} ${t.fechaLegible || t.fecha || ''} a las ${t.hora || ''}.`,
		);
		reglasFlujo.push(
			'Si el paciente pide otro día u horario (ej. "¿tenés el miércoles a la tarde?"), el sistema busca automáticamente; podés confirmar que estás buscando esa opción. No inventes horarios.',
		);
	}

	return [
		config.promptSistema ||
			'Sos un asistente amable de turnos médicos por WhatsApp. Sé breve, claro y en español rioplatense.',
		`Institución: ${config.nombreInstitucion || 'iMedic'}.`,
		'Objetivo: conversar de forma natural; las acciones de agenda (buscar turno, especialidad, confirmar) las ejecuta el sistema según la intención detectada.',
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
	/** Segundo (o más) mensaje del bot por el mismo mensaje entrante (ej. aviso + resultado de búsqueda). */
	seguimiento = false,
	/** No marcar el entrante como respondido (mensaje intermedio de una misma respuesta). */
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
		if (wizard.handled && wizard.accion === 'BUSCAR_TURNO' && wizard.aviso && wizard.buscarTurno) {
			await enviarTextoBot({ ...enviarOpts, texto: wizard.aviso, omitirMarcarRespondido: true });
			let textoResultado =
				'No pude completar la búsqueda a tiempo. Intentá de nuevo o indicá un día u horario más específico.';
			try {
				const resultado = await botWizard.ejecutarBusquedaTurno(wizard.buscarTurno);
				if (resultado?.texto) textoResultado = resultado.texto;
			} catch (buscarErr) {
				diag.warn('webhook', 'Búsqueda turno falló', {
					error: buscarErr.message,
					idConversacion,
				});
			}
			return enviarTextoBot({ ...enviarOpts, texto: textoResultado, seguimiento: true });
		}
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
		if (conv?.pasoBot === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') {
			return enviarTextoBot({
				...enviarOpts,
				texto:
					'No pude buscar otro turno ahora. Decime de nuevo qué día y horario te conviene (por ejemplo: jueves a la tarde).',
			});
		}
	}

	const flujo = await botConfigService.getFlujoPasos();
	const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	const pasoActual = convAct?.pasoBot || botWizard.pasoInicial(flujo);
	const config = await botConfigService.getBotConfig();
	const postTurno = await botWizard.esContextoPostTurno(convAct);

	const enPasoIdentificacion =
		(pasoActual === 'IDENTIFICAR' || pasoActual === 'inicio' || !pasoActual) &&
		!convAct?.idPaciente &&
		!postTurno;
	if (
		dniDetectado &&
		(pasoActual === 'CONFIRMAR_IDENTIDAD' ||
			enPasoIdentificacion ||
			convAct?.idPaciente ||
			['CONFIRMAR', 'ELEGIR_ESPECIALIDAD', 'ELEGIR_PROFESIONAL', 'ELEGIR_FECHA_HORA'].includes(
				pasoActual,
			))
	) {
		diag.warn('webhook', 'Wizard no respondió a identificación', {
			dniDetectado,
			pasoActual,
			idConversacion,
			idPaciente: convAct?.idPaciente || null,
		});
		return enviarTextoBot({
			...enviarOpts,
			texto: 'Recibimos tu DNI. Si no ves los datos de RENAPER, enviá el número de nuevo.',
		});
	}

	// Identificación: pedir DNI solo si aún no hay paciente ni turno reciente confirmado.
	if (enPasoIdentificacion) {
		const pasoId = (flujo || []).find((p) => p.id === 'IDENTIFICAR');
		return enviarTextoBot({
			...enviarOpts,
			texto:
				pasoId?.mensajeUsuario ||
				'Para comenzar, indicá el DNI de la persona que va a atenderse (sin puntos).',
		});
	}

	if (postTurno && botWizard.esCierreCordial(textoEntrada)) {
		return enviarTextoBot({
			...enviarOpts,
			texto: botWizard.resolverMensajePostTurno(flujo, config, convAct),
		});
	}

	// Profesional/fecha: el wizard resuelve turnos; GPT no debe listar médicos.
	if (
		config.reglas.sugerirPrimerTurnoDisponible &&
		(pasoActual === 'ELEGIR_PROFESIONAL' || pasoActual === 'ELEGIR_FECHA_HORA')
	) {
		const pasoEsp = (flujo || []).find((p) => p.id === 'ELEGIR_ESPECIALIDAD');
		return enviarTextoBot({
			...enviarOpts,
			texto:
				pasoEsp?.mensajeUsuario ||
				'¿Qué especialidad necesitás? Te propongo el turno libre más cercano.',
		});
	}

	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
	}

	// 2) GPT para el resto del flujo
	const messages = mensajesParaOpenAi(historial);
	if (!messages.length) {
		return { respondido: false, motivo: 'sin historial' };
	}

	const system = await buildSystemPrompt(config, flujo, convAct);
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
