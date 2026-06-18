/**
 * Orquestador: la IA planifica qué herramientas del backend usar;
 * el sistema ejecuta búsquedas reales y redacta con datos verificados.
 */
const botOpenai = require('./botOpenai.service');
const botHerramientas = require('./botHerramientas.service');
const botConversacion = require('./botConversacion.service');
const botHumanizer = require('./botHumanizer.service');
const botConfigService = require('./botConfig.service');
const botAgenda = require('./botAgenda.service');
const botGestionTurno = require('./botGestionTurno.service');
const diag = require('../utils/diagLog');
const botSesionIa = require('./botSesionIa.service');

function _parsearJson(raw) {
	const s = String(raw || '')
		.trim()
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

function _primerNombre(contacto) {
	const n = String(contacto || '').trim();
	return n ? n.split(/\s+/)[0] : null;
}

function _construirSystemPrompt(config, conv, gestion) {
	const nombre = _primerNombre(conv?.nombreContacto);
	const institucion = config?.nombreInstitucion || 'el centro de salud';
	const resumenGestion = botGestionTurno.resumenParaPrompt(gestion);

	return `Sos el coordinador del asistente de turnos de ${institucion} por WhatsApp.
Tu trabajo NO es inventar médicos, fechas u horarios: usás HERRAMIENTAS del sistema para obtener datos reales y decidís el siguiente paso operativo.

GESTIÓN EN CURSO (fuente de verdad — no repreguntes lo ya anotado):
${resumenGestion}

HERRAMIENTAS DISPONIBLES:
${botHerramientas.catalogoParaPrompt()}

ACCIONES (campo "siguiente"):
- pedir_dni — falta identificar al paciente antes de reservar
- sugerir_turno — buscar turno con datos ya anotados (profesional/especialidad/preferencia)
- preguntar — solo si hay ambigüedad real (varios médicos, dato imposible de inferir)
- cancelar — el paciente quiere abandonar la gestión
- solo_informar — respondé con datos obtenidos, sin avanzar paso crítico
- delegar_confirmacion — el paciente confirma/rechaza un turno ya ofrecido (el wizard lo maneja)

REGLAS CRÍTICAS:
- SIEMPRE incluí estado_gestion en herramientas.
- Si el paciente nombró médico en el mensaje → buscar_profesional + interpretar_preferencia_horario.
- Si gestión ya tiene profesional ✓ → NO pidas especialidad ni listes otros médicos.
- Si gestión ya tiene especialidad ✓ inferida del médico → NO preguntes especialidad.
- Si mencionan mes/fecha ("agosto", "semana que viene") → interpretar_preferencia_horario.
- Si hay profesional + (paciente identificado o falta DNI) y preferencia → pedir_dni o sugerir_turno según identidad.
- No uses listar_profesionales_especialidad salvo que el paciente pida ver la lista.
${nombre ? `- Tratá al paciente como "${nombre}" (nombre WhatsApp).` : ''}

Respondé ÚNICAMENTE un JSON en una línea:
{"herramientas":[{"nombre":"...","argumentos":{}}],"siguiente":"pedir_dni|sugerir_turno|preguntar|cancelar|solo_informar|delegar_confirmacion","notas":"breve","pregunta_sugerida":"opcional si siguiente=preguntar"}`;
}

function _tipoHumanizar(siguiente, gestion) {
	if (siguiente === 'pedir_dni' && gestion?.profesional?.nombre) return 'RESUMEN_GESTION';
	const map = {
		pedir_dni: 'PEDIR_DNI',
		preguntar: 'ACLARACION',
		cancelar: 'SALIDA_FLUJO',
		solo_informar: 'GENERICO',
		sugerir_turno: 'SUGERENCIA_TURNO',
	};
	return map[siguiente] || 'GENERICO';
}

function _pautaYDatosDesdePlan(plan, resultados, conv, config, gestion) {
	const buscarProf = (resultados || []).find((r) => r.nombre === 'buscar_profesional' && r.ok);
	const prefH = (resultados || []).find(
		(r) => r.nombre === 'interpretar_preferencia_horario' && r.ok,
	);
	const d = buscarProf?.datos;
	const nombre = _primerNombre(conv?.nombreContacto);
	const datosGestion = botGestionTurno.aDatosOperativos(gestion, conv);

	if (plan.siguiente === 'cancelar') {
		return {
			pauta: config?.mensajes?.cancelacionFlujo || botHumanizer.pautaPorTipo('SALIDA_FLUJO'),
		};
	}

	if (plan.siguiente === 'pedir_dni') {
		if (gestion?.profesional?.nombre || gestion?.preferenciaHorario?.resumen) {
			return {
				pauta:
					'Confirmá lo ya anotado en la gestión (médico, especialidad, preferencia de fecha si hay) y pedí el DNI para seguir. No repreguntes especialidad.',
				datosOperativos: datosGestion,
			};
		}
		if (d?.tipo === 'unico') {
			return {
				pauta: 'Confirmar el médico elegido y pedir el DNI para buscar el turno.',
				datosOperativos: {
					medico: d.profesional.nombre,
					especialidad: d.especialidad.nombre,
					preferencia: prefH?.datos?.resumen || gestion?.preferenciaHorario?.resumen,
					nombreSaludo: nombre,
				},
			};
		}
		if (d?.tipo === 'multiples') {
			return {
				pauta: 'Mostrar profesionales encontrados y pedir el DNI para continuar.',
				datosOperativos: {
					lista: botAgenda.mensajeListaProfesionalesCoincidencias(d.matches),
					nombreSaludo: nombre,
				},
			};
		}
		return {
			pauta: config?.mensajes?.pedirDni || botHumanizer.pautaPorTipo('PEDIR_DNI'),
			datosOperativos: { ...datosGestion, nombreSaludo: nombre },
		};
	}

	if (plan.siguiente === 'preguntar') {
		if (gestion?.profesional?.confirmada && plan.pregunta_sugerida?.match(/especialidad/i)) {
			return {
				pauta: 'El profesional ya está definido. Pedí DNI o confirmá preferencia de fecha, no especialidad.',
				datosOperativos: datosGestion,
			};
		}
		if (plan.pregunta_sugerida) {
			return {
				pauta: `Responder o preguntar: ${String(plan.pregunta_sugerida).trim()}`,
				datosOperativos: datosGestion,
			};
		}
		if (d?.tipo === 'multiples') {
			return {
				pauta: 'Pedir que aclare con qué profesional quiere el turno.',
				datosOperativos: {
					lista: botAgenda.mensajeListaProfesionalesCoincidencias(d.matches),
				},
			};
		}
		return { pauta: 'Pedir más detalle para ayudar con el turno.', datosOperativos: datosGestion };
	}

	if (plan.siguiente === 'solo_informar') {
		const lista = (resultados || []).find((r) => r.nombre === 'listar_especialidades');
		if (lista?.datos?.especialidades?.length) {
			return {
				pauta: botHumanizer.pautaPorTipo('LISTA_ESPECIALIDADES'),
				datosOperativos: {
					lista: lista.datos.especialidades.map((n) => `• ${n}`).join('\n'),
				},
			};
		}
	}

	return {
		pauta: plan.pregunta_sugerida
			? String(plan.pregunta_sugerida).trim()
			: 'Ofrecer ayuda con el turno.',
		datosOperativos: datosGestion,
	};
}

function _inferirPlanDesdeGestion(conv, gestion) {
	if (botGestionTurno.necesitaIdentidad(conv, gestion)) {
		if (botGestionTurno.puedeBuscarTurno(conv, gestion)) return 'pedir_dni';
		return 'preguntar';
	}
	if (botGestionTurno.puedeBuscarTurno(conv, gestion)) return 'sugerir_turno';
	return null;
}

/**
 * @returns {Promise<{ handled: boolean, motivo?: string, accion?: string, texto?: string, buscarTurno?: object }>}
 */
async function procesarMensaje({
	texto,
	conv,
	idConversacion,
	telefonoWhatsApp,
	historial = [],
}) {
	if (!botOpenai.isConfigured()) {
		return { handled: false, motivo: 'sin_openai' };
	}

	const config = await botConfigService.getBotConfig();
	let gestion = await botGestionTurno.cargarOAsegurar(idConversacion, conv);

	const estadoInicial = await botHerramientas.ejecutar('estado_gestion', {}, { conv });
	const system = _construirSystemPrompt(config, conv, gestion);

	const messages = (historial || [])
		.filter((m) => m.origen === 'PACIENTE' || m.origen === 'BOT')
		.slice(-8)
		.map((m) => ({
			role: m.origen === 'BOT' ? 'assistant' : 'user',
			content: String(m.contenido || '').trim(),
		}))
		.filter((m) => m.content);

	const userContent = `Estado gestión:\n${JSON.stringify(estadoInicial.datos)}\n\nMensaje del paciente:\n${String(texto || '').trim()}`;
	if (!messages.length || messages[messages.length - 1].content !== String(texto || '').trim()) {
		messages.push({ role: 'user', content: userContent });
	} else {
		messages[messages.length - 1] = { role: 'user', content: userContent };
	}

	let raw;
	let plan;
	try {
		raw = await botOpenai.chat({ system, messages });
		plan = _parsearJson(raw);
	} catch (e) {
		diag.warn('orquestador', 'OpenAI falló', { error: e.message });
		return { handled: false, motivo: 'openai_error' };
	}

	if (!plan?.siguiente) {
		diag.warn('orquestador', 'JSON inválido', { raw: raw?.slice(0, 200) });
		plan = { siguiente: _inferirPlanDesdeGestion(conv, gestion) || 'preguntar', herramientas: [] };
	}

	diag.line('orquestador', 'Plan IA', {
		siguiente: plan.siguiente,
		herramientas: (plan.herramientas || []).map((h) => h.nombre),
		notas: plan.notas,
		gestion: botGestionTurno.resumenParaPrompt(gestion),
	});

	if (plan.siguiente === 'delegar_confirmacion') {
		return { handled: false, motivo: 'delegar_wizard' };
	}

	let llamadas = Array.isArray(plan.herramientas) ? plan.herramientas : [];
	const tieneEstadoGestion = llamadas.some((h) => h.nombre === 'estado_gestion');
	if (!tieneEstadoGestion) {
		llamadas = [{ nombre: 'estado_gestion', argumentos: {} }, ...llamadas];
	}

	if (!llamadas.some((h) => h.nombre === 'buscar_profesional')) {
		const sugeridas = botGestionTurno.herramientasSugeridasParaTexto(texto, gestion);
		for (const s of sugeridas) {
			if (s.nombre !== 'estado_gestion' && !llamadas.some((l) => l.nombre === s.nombre)) {
				llamadas.push(s);
			}
		}
	}

	let convAct = conv;
	const resultados = await botHerramientas.ejecutarLote(llamadas, { conv: convAct });
	convAct = await botHerramientas.aplicarContextoDesdeResultados(
		idConversacion,
		convAct,
		resultados,
	);
	gestion = botGestionTurno.obtenerGestionActiva(convAct) || gestion;

	const esp = gestion.especialidad || convAct?.contextoBot?.especialidadPendiente;
	const prof = gestion.profesional || convAct?.contextoBot?.profesionalPendiente;

	if (plan.siguiente === 'pedir_dni' && convAct?.idPaciente) {
		plan.siguiente = prof?.matricula || esp?.valor ? 'sugerir_turno' : 'preguntar';
	}

	if (plan.siguiente === 'sugerir_turno' && !convAct?.idPaciente) {
		plan.siguiente = 'pedir_dni';
	}

	if (
		plan.siguiente === 'preguntar' &&
		gestion.profesional?.confirmada &&
		/\bespecialidad\b/i.test(String(plan.pregunta_sugerida || plan.notas || ''))
	) {
		plan.siguiente = convAct?.idPaciente ? 'sugerir_turno' : 'pedir_dni';
	}

	if (
		plan.siguiente === 'sugerir_turno' &&
		convAct?.idPaciente &&
		(esp?.valor || prof?.matricula)
	) {
		const { excluir, preferir } = botGestionTurno.aPreferenciasBusqueda(gestion);
		return {
			handled: true,
			accion: 'BUSCAR_TURNO',
			buscarTurno: {
				tipo: 'inicial',
				idConversacion,
				telefonoWhatsApp,
				especialidadValor: esp?.valor,
				especialidadNombre: esp?.nombre,
				matricula: prof?.matricula,
				medico: prof?.nombre,
				pasoConfirmarId: 'CONFIRMAR',
				idGestion: gestion.id,
				preferir,
				excluir,
			},
			tipoRespuesta: 'SUGERENCIA_TURNO',
			resultados,
		};
	}

	if (plan.siguiente === 'sugerir_turno' && !convAct?.idPaciente && (esp?.valor || prof?.matricula)) {
		plan.siguiente = 'pedir_dni';
	}

	const { pauta, datosOperativos } = _pautaYDatosDesdePlan(
		plan,
		resultados,
		convAct,
		config,
		gestion,
	);
	const tipoResp = _tipoHumanizar(plan.siguiente, gestion);
	const saludo = botSesionIa.contextoSaludo(convAct);
	const datosConSaludo = {
		...(datosOperativos || {}),
		saludo,
		pacienteIdentificado: !!convAct?.idPaciente,
		pasoBot: convAct?.pasoBot || null,
	};

	let textoFinal = '';
	try {
		textoFinal = await botHumanizer.generarMensaje({
			conv: convAct,
			config,
			tipoRespuesta: tipoResp,
			pauta,
			datosOperativos: datosConSaludo,
			intencion: plan.intencion || plan.siguiente,
		});
	} catch {
		textoFinal = pauta;
	}

	if (plan.siguiente === 'cancelar') {
		botGestionTurno.cerrarGestion(gestion, 'cancelada');
		await botGestionTurno.persistir(idConversacion, convAct, gestion);
		await botSesionIa.resetearSesionIa(idConversacion);
		const convC = await botConversacion.obtenerConversacion(idConversacion);
		const meta = botSesionIa.extraerMetaPersistente(convC?.contextoBot);
		await botConversacion.guardarContextoBot(
			idConversacion,
			Object.keys(meta).length ? meta : null,
			{ reemplazar: true },
		);
		await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot: 'inicio' });
	}

	return {
		handled: true,
		texto: textoFinal,
		marcarSaludo: saludo.debeSaludar,
		tipoRespuesta: tipoResp,
		resultados,
	};
}

function debeUsarOrquestador(pasoActual, conv, texto) {
	if (pasoActual === 'CONFIRMAR_IDENTIDAD') return false;
	if (pasoActual === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') return false;
	if (/\b(\d{7,8})\b/.test(String(texto || ''))) return false;
	const gestion = botGestionTurno.obtenerGestionActiva(conv);
	if (gestion) return true;
	if (pasoActual === 'inicio' || pasoActual === 'IDENTIFICAR' || !pasoActual) return true;
	if (pasoActual === 'ELEGIR_ESPECIALIDAD' || pasoActual === 'ELEGIR_PROFESIONAL') return true;
	return true;
}

module.exports = {
	procesarMensaje,
	debeUsarOrquestador,
};
