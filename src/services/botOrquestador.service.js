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
const diag = require('../utils/diagLog');

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

function _construirSystemPrompt(config, conv) {
	const nombre = _primerNombre(conv?.nombreContacto);
	const institucion = config?.nombreInstitucion || 'el centro de salud';

	return `Sos el coordinador del asistente de turnos de ${institucion} por WhatsApp.
Tu trabajo NO es inventar médicos, fechas u horarios: usás HERRAMIENTAS del sistema para obtener datos reales y decidís el siguiente paso operativo.

HERRAMIENTAS DISPONIBLES:
${botHerramientas.catalogoParaPrompt()}

ACCIONES (campo "siguiente"):
- pedir_dni — falta identificar al paciente antes de reservar
- sugerir_turno — ya hay paciente identificado y médico/especialidad definidos (el sistema buscará el turno libre)
- preguntar — falta un dato o hay ambigüedad (varios médicos, etc.)
- cancelar — el paciente quiere abandonar la gestión
- solo_informar — respondé con datos obtenidos, sin avanzar paso crítico
- delegar_confirmacion — el paciente confirma/rechaza un turno ya ofrecido (el wizard lo maneja)

REGLAS:
- Llamá las herramientas que necesites ANTES de decidir (ej. buscar_profesional si nombran un médico).
- Si buscar_profesional devuelve 1 match → anotá especialidad y médico; si no hay paciente → pedir_dni.
- Si hay varios matches → preguntar cuál, listando solo los devueltos por la herramienta.
- No listes todos los médicos de una especialidad salvo que el paciente lo pida o uses listar_profesionales_especialidad.
- Si mencionan turno con médico en el primer mensaje, buscá el médico primero.
${nombre ? `- Tratá al paciente como "${nombre}" (nombre WhatsApp).` : ''}

Respondé ÚNICAMENTE un JSON en una línea:
{"herramientas":[{"nombre":"...","argumentos":{}}],"siguiente":"pedir_dni|sugerir_turno|preguntar|cancelar|solo_informar|delegar_confirmacion","notas":"breve","pregunta_sugerida":"opcional si siguiente=preguntar"}`;
}

function _bloqueFactual(resultados) {
	return JSON.stringify(
		(resultados || []).map((r) => ({ herramienta: r.nombre, resultado: r.ok ? r.datos : r.error })),
		null,
		2,
	);
}

function _textoBaseDesdePlan(plan, resultados, conv, config) {
	const nombre = _primerNombre(conv?.nombreContacto);
	const saludo = nombre ? `${nombre}, ` : '';

	const buscarProf = (resultados || []).find((r) => r.nombre === 'buscar_profesional' && r.ok);
	const d = buscarProf?.datos;
	const pasoId =
		config?.mensajes?.pedirDni ||
		'Para continuar, indicá el DNI de la persona que va a atenderse (sin puntos).';

	if (plan.siguiente === 'cancelar') {
		return (
			config?.mensajes?.cancelacionFlujo ||
			'Entendido, cancelamos la gestión. Cuando quieras un turno, escribinos.'
		);
	}

	if (plan.siguiente === 'pedir_dni') {
		if (d?.tipo === 'unico') {
			return `Perfecto, ${saludo}anoté turno con *${d.profesional.nombre}* en *${d.especialidad.nombre}*. ${pasoId}`;
		}
		if (d?.tipo === 'multiples') {
			return `${botAgenda.mensajeListaProfesionalesCoincidencias(d.matches)}\n\nLuego indicá el DNI para continuar.`;
		}
		return pasoId;
	}

	if (plan.siguiente === 'preguntar') {
		if (plan.pregunta_sugerida) return String(plan.pregunta_sugerida).trim();
		if (d?.tipo === 'multiples') {
			return botAgenda.mensajeListaProfesionalesCoincidencias(d.matches);
		}
		if (d?.tipo === 'no_encontrado') {
			return 'No encontré ese profesional en la agenda. ¿Podés repetir el apellido o indicar la especialidad?';
		}
		return '¿Podés contarme un poco más para ayudarte con el turno?';
	}

	if (plan.siguiente === 'solo_informar') {
		const lista = (resultados || []).find((r) => r.nombre === 'listar_especialidades');
		if (lista?.datos?.especialidades?.length) {
			return botAgenda.mensajeEspecialidadesDisponibles(
				lista.datos.especialidades.map((n) => ({ nombre: n })),
			);
		}
	}

	return plan.pregunta_sugerida || '¿En qué puedo ayudarte con tu turno?';
}

function _tipoHumanizar(siguiente) {
	const map = {
		pedir_dni: 'PEDIR_DNI',
		preguntar: 'ACLARACION',
		cancelar: 'SALIDA_FLUJO',
		solo_informar: 'GENERICO',
		sugerir_turno: 'SUGERENCIA_TURNO',
	};
	return map[siguiente] || 'GENERICO';
}

/**
 * @returns {Promise<{ handled: boolean, motivo?: string, accion?: string, texto?: string, buscarTurno?: object, aviso?: string, tipoRespuesta?: string }>}
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
	const estadoInicial = await botHerramientas.ejecutar('estado_sesion', {}, { conv });
	const system = _construirSystemPrompt(config, conv);

	const messages = (historial || [])
		.filter((m) => m.origen === 'PACIENTE' || m.origen === 'BOT')
		.slice(-8)
		.map((m) => ({
			role: m.origen === 'BOT' ? 'assistant' : 'user',
			content: String(m.contenido || '').trim(),
		}))
		.filter((m) => m.content);

	const userContent = `Estado sesión (referencia):\n${JSON.stringify(estadoInicial.datos)}\n\nMensaje del paciente:\n${String(texto || '').trim()}`;
	if (!messages.length || messages[messages.length - 1].content !== String(texto || '').trim()) {
		messages.push({ role: 'user', content: userContent });
	} else {
		messages[messages.length - 1] = { role: 'user', content: userContent };
	}

	let raw;
	try {
		raw = await botOpenai.chat({ system, messages });
	} catch (e) {
		diag.warn('orquestador', 'OpenAI falló', { error: e.message });
		return { handled: false, motivo: 'openai_error' };
	}

	const plan = _parsearJson(raw);
	if (!plan?.siguiente) {
		diag.warn('orquestador', 'JSON inválido', { raw: raw?.slice(0, 200) });
		return { handled: false, motivo: 'plan_invalido' };
	}

	diag.line('orquestador', 'Plan IA', {
		siguiente: plan.siguiente,
		herramientas: (plan.herramientas || []).map((h) => h.nombre),
		notas: plan.notas,
	});

	if (plan.siguiente === 'delegar_confirmacion') {
		return { handled: false, motivo: 'delegar_wizard' };
	}

	let llamadas = Array.isArray(plan.herramientas) ? plan.herramientas : [];
	if (!llamadas.length && /buscar|profesional|medico|doctor|biasi|turno/i.test(texto)) {
		llamadas = [{ nombre: 'buscar_profesional', argumentos: { texto } }];
	}

	let convAct = conv;
	const resultados = await botHerramientas.ejecutarLote(llamadas, { conv: convAct });
	convAct = await botHerramientas.aplicarContextoDesdeResultados(
		idConversacion,
		convAct,
		resultados,
	);

	const ctx = convAct?.contextoBot || {};
	const esp = ctx.especialidadPendiente;
	const prof = ctx.profesionalPendiente;

	if (plan.siguiente === 'sugerir_turno' && convAct?.idPaciente && esp?.valor) {
		const prefijo = _primerNombre(convAct.nombreContacto)
			? `Perfecto, ${_primerNombre(convAct.nombreContacto)}. `
			: '';
		return {
			handled: true,
			accion: 'BUSCAR_TURNO',
			aviso: `${prefijo}${botAgenda.mensajeAvisoBusquedaDisponibilidad()}`,
			buscarTurno: {
				tipo: 'inicial',
				idConversacion,
				telefonoWhatsApp,
				especialidadValor: esp.valor,
				especialidadNombre: esp.nombre,
				matricula: prof?.matricula,
				medico: prof?.nombre,
				pasoConfirmarId: 'CONFIRMAR',
			},
			tipoRespuesta: 'SUGERENCIA_TURNO',
			resultados,
		};
	}

	if (plan.siguiente === 'sugerir_turno' && !convAct?.idPaciente) {
		plan.siguiente = 'pedir_dni';
	}

	const textoBase = _textoBaseDesdePlan(plan, resultados, convAct, config);
	const factual = _bloqueFactual(resultados);

	let textoFinal = textoBase;
	try {
		textoFinal = await botHumanizer.humanizar({
			conv: convAct,
			config,
			tipoRespuesta: _tipoHumanizar(plan.siguiente),
			textoBase,
			datosOperativos: { lista: factual },
		});
	} catch {
		textoFinal = textoBase;
	}

	if (plan.siguiente === 'cancelar') {
		await botConversacion.guardarContextoBot(idConversacion, null);
		await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot: 'inicio' });
	}

	return {
		handled: true,
		texto: textoFinal,
		tipoRespuesta: _tipoHumanizar(plan.siguiente),
		resultados,
	};
}

function debeUsarOrquestador(pasoActual, conv, texto) {
	if (pasoActual === 'CONFIRMAR_IDENTIDAD') return false;
	if (pasoActual === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') return false;
	if (/\b(\d{7,8})\b/.test(String(texto || ''))) return false;
	return true;
}

module.exports = {
	procesarMensaje,
	debeUsarOrquestador,
};
