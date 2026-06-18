/**
 * Respuesta automática del bot vía wizard + GPT + envío WhatsApp Meta.
 */
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botOpenai = require('./botOpenai.service');
const botWizard = require('./botWizard.service');
const botAgenda = require('./botAgenda.service');
const botHumanizer = require('./botHumanizer.service');
const botInterpretacion = require('./botInterpretacion.service');
const botOrquestador = require('./botOrquestador.service');
const botGestionTurno = require('./botGestionTurno.service');
const botSesionIa = require('./botSesionIa.service');
const audioTranscripcion = require('./audioTranscripcion.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const whatsappMeta = require('./whatsappMeta.service');
const diag = require('../utils/diagLog');

function gptHabilitado() {
	return botInterpretacion.gptHabilitado();
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
			? 'Después de especialidad, pedí profesional si aplica. NUNCA inventes nombres: el sistema lista los médicos reales desde la agenda.'
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
		reglasFlujo.push(
			'Si el paciente quiere salir ("cancelar", "no quiero ningún turno", "dejá"), el sistema cancela la gestión; no sigas ofreciendo turnos.',
		);
	}

	return [
		config.promptSistema ||
			'Sos un asistente amable de turnos médicos por WhatsApp. Sé breve, claro y en español rioplatense.',
		`Institución: ${config.nombreInstitucion || 'iMedic'}.`,
		'Objetivo: conversar de forma natural; las acciones de agenda (buscar turno, especialidad, confirmar) las ejecuta el sistema según la intención detectada.',
		...reglasFlujo,
		'No inventes horarios ni médicos; si no tenés datos, pedí el siguiente dato del flujo.',
		'NUNCA inventes nombres de profesionales: el listado lo genera el sistema desde la agenda.',
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

function _extraerListaDesdeTexto(texto) {
	const lineas = String(texto || '')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => /^[•\d]/.test(l) || l.startsWith('•'));
	return lineas.length ? lineas.join('\n') : null;
}

function _prepararGeneracionWizard(wizard, conv) {
	const tipo = wizard.tipoRespuesta || 'GENERICO';
	const datos = { ...(wizard.datosOperativos || {}) };
	let pauta = wizard.pauta || wizard.avisoPauta;
	const saludo = botSesionIa.contextoSaludo(conv);
	datos.saludo = saludo;
	datos.pacienteIdentificado = !!conv?.idPaciente;
	datos.pasoBot = conv?.pasoBot || null;
	const skipTurnoEnDatos = ['CONFIRMAR_IDENTIDAD', 'INICIO_FLUJO', 'PEDIR_DNI'].includes(tipo);
	if (!skipTurnoEnDatos) {
		if (conv?.contextoBot?.profesionalPendiente?.nombre) {
			datos.medico = datos.medico || conv.contextoBot.profesionalPendiente.nombre;
		}
		if (conv?.contextoBot?.especialidadPendiente?.nombre) {
			datos.especialidad = datos.especialidad || conv.contextoBot.especialidadPendiente.nombre;
		}
	}

	if (!pauta && wizard.aviso) {
		pauta = botHumanizer.pautaPorTipo('AVISO_BUSQUEDA');
	}

	if (!pauta) {
		pauta = botHumanizer.pautaPorTipo(tipo);
	}

	if (wizard.texto && !wizard.ticketEstatico) {
		if (
			(tipo === 'LISTA_ESPECIALIDADES' || tipo === 'LISTA_PROFESIONALES') &&
			!datos.lista
		) {
			const lista = _extraerListaDesdeTexto(wizard.texto);
			if (lista) datos.lista = lista;
		}
		if (tipo === 'CONFIRMAR_IDENTIDAD' && !datos.detalleIdentidad) {
			const det = String(wizard.texto)
				.replace(/Respondé Sí o No.*/i, '')
				.replace(/¿Sos vos\?.*/i, '')
				.trim();
			if (det) datos.detalleIdentidad = det;
		}
	}

	return {
		tipo,
		pauta,
		datos,
		intencion: wizard.interpretacion?.intencion || wizard.intencion,
		marcarSaludo: saludo.debeSaludar,
	};
}

async function _enviarBotYMarcaSaludo({ enviarOpts, texto, idConversacion, conv, marcarSaludo, seguimiento, omitirMarcarRespondido }) {
	const res = await enviarTextoBot({
		...enviarOpts,
		texto,
		seguimiento,
		omitirMarcarRespondido,
	});
	if (res.respondido && marcarSaludo) {
		await botSesionIa.marcarSaludoEnviado(idConversacion, conv);
		if (conv?.contextoBot) {
			conv.contextoBot = {
				...conv.contextoBot,
				saludoDia: botSesionIa.fechaArgentinaHoy(),
			};
		}
	}
	return res;
}

async function humanizarSalidaWizard(wizard, conv, config) {
	if (!wizard?.texto && !wizard?.pauta && !wizard?.ticketEstatico && !wizard?.aviso && !wizard?.avisoPauta) {
		return wizard;
	}

	if (wizard.ticketEstatico) {
		const { tipo, pauta, datos, intencion, marcarSaludo } = _prepararGeneracionWizard(
			{
				...wizard,
				tipoRespuesta: 'CONFIRMACION_TURNO_OK',
				pauta:
					wizard.pauta ||
					'Confirmar que el turno quedó reservado (mensaje breve antes del comprobante).',
			},
			conv,
		);
		const intro = await botHumanizer.generarMensaje({
			conv,
			config,
			tipoRespuesta: tipo,
			pauta,
			interpretacion: wizard.interpretacion,
			datosOperativos: datos,
			soloIntro: true,
			intencion,
		});
		return { ...wizard, texto: `${intro}\n\n${wizard.ticketEstatico}`, marcarSaludo };
	}

	const avisoPayload = wizard.aviso || wizard.avisoPauta;
	if (avisoPayload && !wizard.texto && wizard.accion === 'BUSCAR_TURNO') {
		const gen = _prepararGeneracionWizard(
			{
				tipoRespuesta: 'AVISO_BUSQUEDA',
				pauta: wizard.avisoPauta || botHumanizer.pautaPorTipo('AVISO_BUSQUEDA'),
				interpretacion: wizard.interpretacion,
			},
			conv,
		);
		const texto = await botHumanizer.generarMensaje({
			conv,
			config,
			...gen,
			interpretacion: wizard.interpretacion,
		});
		return { ...wizard, texto, marcarSaludo: gen.marcarSaludo };
	}

	const { tipo, pauta, datos, intencion, marcarSaludo } = _prepararGeneracionWizard(wizard, conv);
	const texto = await botHumanizer.generarMensaje({
		conv,
		config,
		tipoRespuesta: tipo,
		pauta,
		interpretacion: wizard.interpretacion,
		datosOperativos: datos,
		intencion,
	});
	return { ...wizard, texto, marcarSaludo };
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

	const textoEntrada = audioTranscripcion.quitarMarcadorAudio(
		contenidoUltimo || ultimo.contenido,
	);
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
		const configBot = await botConfigService.getBotConfig();
		let convHum = (await botConversacion.obtenerConversacion(idConversacion)) || conv;

		if (wizard.handled && wizard.accion === 'BUSCAR_TURNO' && wizard.buscarTurno) {
			let textoResultado =
				'No pude completar la búsqueda a tiempo. Intentá de nuevo o indicá un día u horario más específico.';
			let pautaResultado = botHumanizer.pautaPorTipo('SIN_DISPONIBILIDAD');
			let tipoRespuesta = 'SIN_DISPONIBILIDAD';
			let datosOperativos = wizard.datosOperativos;
			try {
				const resultado = await botWizard.ejecutarBusquedaTurno(wizard.buscarTurno);
				if (resultado?.pauta) pautaResultado = resultado.pauta;
				if (resultado?.texto) textoResultado = resultado.texto;
				if (resultado?.tipoRespuesta) tipoRespuesta = resultado.tipoRespuesta;
				if (resultado?.datosOperativos) datosOperativos = resultado.datosOperativos;
			} catch (buscarErr) {
				diag.warn('webhook', 'Búsqueda turno falló', {
					error: buscarErr.message,
					idConversacion,
				});
			}
			const humanizado = await humanizarSalidaWizard(
				{
					pauta: pautaResultado,
					texto: textoResultado,
					tipoRespuesta,
					datosOperativos,
					interpretacion: wizard.interpretacion,
				},
				convHum,
				configBot,
			);
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: humanizado.texto,
				idConversacion,
				conv: convHum,
				marcarSaludo: humanizado.marcarSaludo,
			});
		}
		if (wizard.handled && wizard.texto) {
			const humanizado = await humanizarSalidaWizard(wizard, convHum, configBot);
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: humanizado.texto,
				idConversacion,
				conv: convHum,
				marcarSaludo: humanizado.marcarSaludo,
			});
		}
		if (wizard.handled && wizard.pauta) {
			const humanizado = await humanizarSalidaWizard(wizard, convHum, configBot);
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: humanizado.texto,
				idConversacion,
				conv: convHum,
				marcarSaludo: humanizado.marcarSaludo,
			});
		}
	} catch (wizardErr) {
		diag.warn('webhook', 'Wizard error', {
			error: wizardErr.message,
			code: wizardErr.code,
			fuente: wizardErr.fuente,
		});
		if (dniDetectado || conv?.pasoBot === 'CONFIRMAR_IDENTIDAD') {
			const configErr = await botConfigService.getBotConfig();
			const convErr = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
			const humanizado = await humanizarSalidaWizard(
				{
					pauta: botAgenda.mensajeErrorIdentificacion(wizardErr),
					tipoRespuesta: 'ERROR_IDENTIFICACION',
					datosOperativos: {
						errorCode: wizardErr.code,
						fuente: wizardErr.fuente,
					},
				},
				convErr,
				configErr,
			);
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: humanizado.texto,
				idConversacion,
				conv: convErr,
				marcarSaludo: humanizado.marcarSaludo,
			});
		}
		if (conv?.pasoBot === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') {
			const configErr = await botConfigService.getBotConfig();
			const convErr = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
			const humanizado = await humanizarSalidaWizard(
				{
					pauta: botHumanizer.pautaPorTipo('ERROR_RESERVA'),
					tipoRespuesta: 'ERROR_RESERVA',
				},
				convErr,
				configErr,
			);
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: humanizado.texto,
				idConversacion,
				conv: convErr,
				marcarSaludo: humanizado.marcarSaludo,
			});
		}
	}

	const flujo = await botConfigService.getFlujoPasos();
	const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	const pasoActual = convAct?.pasoBot || botWizard.pasoInicial(flujo);
	const config = await botConfigService.getBotConfig();
	const postTurno = await botWizard.esContextoPostTurno(convAct);

	// 2) Orquestador IA + herramientas de agenda (no hardcode de flujos por palabra clave)
	if (
		gptHabilitado() &&
		botOrquestador.debeUsarOrquestador(pasoActual, convAct, textoEntrada)
	) {
		const orch = await botOrquestador.procesarMensaje({
			texto: textoEntrada,
			conv: convAct,
			idConversacion,
			telefonoWhatsApp,
			historial,
		});
		if (orch.handled && orch.accion === 'BUSCAR_TURNO' && orch.buscarTurno) {
			let pautaResultado = botHumanizer.pautaPorTipo('SIN_DISPONIBILIDAD');
			let tipoRespuesta = 'SIN_DISPONIBILIDAD';
			let datosOperativos = null;
			try {
				const resultado = await botWizard.ejecutarBusquedaTurno(orch.buscarTurno);
				if (resultado?.pauta) pautaResultado = resultado.pauta;
				if (resultado?.tipoRespuesta) tipoRespuesta = resultado.tipoRespuesta;
				if (resultado?.datosOperativos) datosOperativos = resultado.datosOperativos;
			} catch (buscarErr) {
				diag.warn('webhook', 'Búsqueda turno (orquestador) falló', {
					error: buscarErr.message,
					idConversacion,
				});
			}
			const convHum = (await botConversacion.obtenerConversacion(idConversacion)) || convAct;
			const humanizado = await humanizarSalidaWizard(
				{ pauta: pautaResultado, tipoRespuesta, datosOperativos },
				convHum,
				config,
			);
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: humanizado.texto,
				idConversacion,
				conv: convHum,
				marcarSaludo: humanizado.marcarSaludo,
			});
		}
		if (orch.handled && orch.texto) {
			return _enviarBotYMarcaSaludo({
				enviarOpts,
				texto: orch.texto,
				idConversacion,
				conv: convAct,
				marcarSaludo: orch.marcarSaludo,
			});
		}
	}

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
		const humanizado = await humanizarSalidaWizard(
			{
				pauta: 'El DNI llegó pero no se pudo completar la identificación; pedir que lo reenvíe.',
				tipoRespuesta: 'ERROR_IDENTIFICACION',
			},
			convAct,
			config,
		);
		return _enviarBotYMarcaSaludo({
			enviarOpts,
			texto: humanizado.texto,
			idConversacion,
			conv: convAct,
			marcarSaludo: humanizado.marcarSaludo,
		});
	}

	// Identificación: pedir DNI solo si aún no hay paciente ni turno reciente confirmado.
	if (enPasoIdentificacion) {
		const pasoId = (flujo || []).find((p) => p.id === 'IDENTIFICAR');
		const interp = await botInterpretacion.interpretarMensaje({
			texto: textoEntrada,
			conv: convAct,
			idConversacion,
			pasoBot: pasoActual,
		});
		if (interp) {
			await botInterpretacion.registrarSesion(idConversacion, interp, convAct);
		}
		const gestion = botGestionTurno.obtenerGestionActiva(convAct);
		const datosGestion = botGestionTurno.aDatosOperativos(gestion, convAct);
		const tieneGestion =
			gestion?.profesional?.nombre || gestion?.preferenciaHorario?.resumen;
		const humanizado = await humanizarSalidaWizard(
			{
				pauta: tieneGestion
					? 'Resumí lo anotado en la gestión y pedí el DNI para continuar.'
					: pasoId?.mensajeUsuario ||
						botHumanizer.pautaPorTipo(
							interp?.flags?.es_saludo ? 'INICIO_FLUJO' : 'PEDIR_DNI',
						),
				tipoRespuesta: tieneGestion
					? 'RESUMEN_GESTION'
					: interp?.flags?.es_saludo
						? 'INICIO_FLUJO'
						: 'PEDIR_DNI',
				interpretacion: interp,
				datosOperativos: tieneGestion
					? datosGestion
					: convAct?.nombreContacto
						? { nombreSaludo: String(convAct.nombreContacto).trim().split(/\s+/)[0] }
						: null,
			},
			convAct,
			config,
		);
		return _enviarBotYMarcaSaludo({
			enviarOpts,
			texto: humanizado.texto,
			idConversacion,
			conv: convAct,
			marcarSaludo: humanizado.marcarSaludo,
		});
	}

	if (postTurno && botWizard.esCierreCordial(textoEntrada)) {
		const humanizado = await humanizarSalidaWizard(
			{
				pauta: botHumanizer.pautaPorTipo('POST_TURNO'),
				tipoRespuesta: 'POST_TURNO',
			},
			convAct,
			config,
		);
		return _enviarBotYMarcaSaludo({
			enviarOpts,
			texto: humanizado.texto,
			idConversacion,
			conv: convAct,
			marcarSaludo: humanizado.marcarSaludo,
		});
	}

	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
	}

	return { respondido: false, motivo: 'sin_accion_orquestador' };
}

module.exports = {
	gptHabilitado,
	responderMensajeEntrante,
	buildSystemPrompt,
};
