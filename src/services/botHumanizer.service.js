/**
 * Voz del bot: genera mensajes de atención al cliente (no plantillas).
 * Solo el ticket/comprobante queda estático fuera de esta capa.
 */
const botOpenai = require('./botOpenai.service');
const botInterpretacion = require('./botInterpretacion.service');

const TIPOS_HUMANIZAR = new Set([
	'SALIDA_FLUJO',
	'SUGERENCIA_TURNO',
	'CONFIRMACION_TURNO_OK',
	'PEDIR_DNI',
	'CONFIRMAR_IDENTIDAD',
	'LISTA_ESPECIALIDADES',
	'LISTA_PROFESIONALES',
	'SIN_DISPONIBILIDAD',
	'POST_TURNO',
	'INICIO_FLUJO',
	'ACLARACION',
	'RESUMEN_GESTION',
	'ERROR_AGENDA',
	'GENERICO',
]);

const PAUTAS_POR_TIPO = Object.freeze({
	SALIDA_FLUJO: 'Cerrar la gestión del turno con empatía; puede volver a escribir cuando quiera.',
		SUGERENCIA_TURNO:
			'Ofrecé el turno encontrado. Cerrá SOLO preguntando si lo confirma o prefiere otro día/horario. No listes otras opciones ni pidas DNI.',
	CONFIRMACION_TURNO_OK: 'Celebrar brevemente que el turno quedó confirmado (sin comprobante).',
	ERROR_IDENTIFICACION:
		'Explicar el problema con el DNI sin tecnicismos; indicar si falló la ficha del centro o RENAPER.',
	AVISO_BUSQUEDA: 'Avisar que estás buscando turnos en la agenda.',
	ERROR_RESERVA: 'Explicar que no se pudo reservar y orientar al siguiente paso.',
	COBERTURA: 'Pedir o confirmar obra social / cobertura.',
	PEDIR_DNI: 'Pedir el DNI para identificar al paciente y buscar su turno.',
	PEDIR_ESPECIALIDAD: 'Preguntar qué especialidad necesita o ofrecer mostrar las disponibles.',
	CONFIRMAR_IDENTIDAD: 'Mostrar los datos de la persona y pedir confirmación Sí/No.',
	LISTA_ESPECIALIDADES: 'Presentar especialidades con turno y preguntar cuál necesita.',
	LISTA_PROFESIONALES: 'Presentar profesionales con agenda y pedir que elija uno.',
	SIN_DISPONIBILIDAD: 'Informar que no hay turnos y proponer otro día u horario.',
	POST_TURNO: 'Cierre cordial después de un turno ya confirmado.',
	INICIO_FLUJO: 'Saludar y pedir el DNI para empezar a gestionar el turno.',
	RESUMEN_GESTION:
		'Resumí brevemente lo ya anotado en la gestión (médico, especialidad, preferencia de fecha) y pedí el DNI o el siguiente dato que falte. No repreguntes lo ya confirmado.',
	ACLARACION: 'Hacer una pregunta corta para desambiguar.',
	ERROR_AGENDA: 'Explicar un problema de agenda sin tecnicismos.',
	GENERICO: 'Responder de forma natural según el contexto.',
});

function _primerNombre(nombre) {
	const n = String(nombre || '').trim();
	return n ? n.split(/\s+/)[0] : null;
}

function _instruccionesPorTipo(tipo) {
	const map = {
		SALIDA_FLUJO:
			'Cerrá con empatía. Dejá claro que puede volver a escribir cuando quiera un turno.',
		SUGERENCIA_TURNO:
			'Presentá el turno. Una sola pregunta al final: ¿lo confirmás o preferís otro día/horario? Si el paciente pide otro día u horario, interpretá su pedido (no repitas menú). Fecha sin año si es el año en curso.',
		CONFIRMACION_TURNO_OK:
			'Celebrá brevemente. El comprobante oficial va aparte: NO lo incluyas.',
		ERROR_IDENTIFICACION:
			'Explicá el problema sin tecnicismos. Preservá si el fallo es ficha local o RENAPER.',
		AVISO_BUSQUEDA: 'Avisá brevemente que estás buscando en la agenda. NO pidas DNI si pacienteIdentificado es true.',
		ERROR_RESERVA: 'Explicá por qué no se pudo reservar.',
		COBERTURA: 'Pedí cobertura de forma amable.',
		PEDIR_DNI:
			'Pedí el DNI como lo haría una recepcionista: "necesito tu DNI", "así busco el turno". Nada robótico.',
		PEDIR_ESPECIALIDAD: 'Preguntá la especialidad de forma conversacional.',
		CONFIRMAR_IDENTIDAD: 'Mostrá solo datos de identidad (nombre, fecha nacimiento) y pedí Sí/No. NO menciones médico ni especialidad.',
		LISTA_ESPECIALIDADES: 'Listá especialidades de forma clara.',
		LISTA_PROFESIONALES: 'Listá profesionales de forma clara.',
		SIN_DISPONIBILIDAD: 'Empatía si no hay turnos; invitá a otro día u horario.',
		POST_TURNO: 'Cierre cordial tras turno confirmado.',
		INICIO_FLUJO: 'Saludo del día si corresponde y pedí el DNI para arrancar la gestión.',
		RESUMEN_GESTION:
			'Confirmá lo que ya quedó anotado (médico, especialidad, mes/fecha preferida) y pedí solo lo que falta (casi siempre el DNI). Tono natural, sin listar pasos del sistema.',
		ACLARACION: 'Una sola pregunta corta.',
		ERROR_AGENDA: 'Sin tecnicismos; orientá al siguiente paso.',
		GENERICO: 'Natural, breve, atención al cliente real.',
	};
	return map[tipo] || map.GENERICO;
}

function _bloqueFactual(datosOperativos) {
	const d = datosOperativos || {};
	const lineas = [];
	if (d.nombreSaludo) lineas.push(`Nombre contacto: ${d.nombreSaludo}`);
	if (d.medico) lineas.push(`Médico: ${d.medico}`);
	if (d.especialidad) lineas.push(`Especialidad: ${d.especialidad}`);
	if (d.fechaLegible || d.fecha) lineas.push(`Fecha: ${d.fechaLegible || d.fecha}`);
	if (d.diaSemana) lineas.push(`Día: ${d.diaSemana}`);
	if (d.hora) lineas.push(`Hora: ${d.hora}`);
	if (d.detalleIdentidad) lineas.push(`Datos identidad:\n${d.detalleIdentidad}`);
	if (d.fuenteIdentidad) lineas.push(`Fuente: ${d.fuenteIdentidad}`);
	if (d.errorCode) lineas.push(`Código error interno: ${d.errorCode}`);
	if (d.preferencia) lineas.push(`Preferencia paciente: ${d.preferencia}`);
	if (d.gestionResumen) lineas.push(`Gestión activa: ${d.gestionResumen}`);
	if (d.saludo?.debeSaludar && d.saludo.pautaInstruccion) {
		lineas.push(`Saludo del día: ${d.saludo.pautaInstruccion}`);
		const franjaHint = {
			manana: 'usar saludo de mañana (ej. buen día), NUNCA buenas noches',
			tarde: 'usar saludo de tarde (ej. buenas tardes)',
			noche: 'usar saludo de noche (ej. buenas noches), NUNCA buen día',
			madrugada: 'usar saludo nocturno/madrugada (ej. buenas noches)',
		};
		lineas.push(`Franja horaria AR: ${d.saludo.franjaHoraria}`);
		if (franjaHint[d.saludo.franjaHoraria]) {
			lineas.push(`OBLIGATORIO: ${franjaHint[d.saludo.franjaHoraria]}`);
		}
	} else if (d.saludo && d.saludo.debeSaludar === false) {
		lineas.push('NO incluir saludo de bienvenida: ya saludaste hoy en esta conversación.');
	}
	if (d.pacienteIdentificado) {
		lineas.push('Paciente ya identificado en esta sesión: NO pedir DNI ni repetir confirmación de identidad.');
	}
	if (d.pasoBot) lineas.push(`Paso del flujo: ${d.pasoBot}`);
	if (d.fechaLegible || d.fecha) {
		lineas.push('Fecha del turno: usar formato provisto SIN agregar el año si ya viene sin año.');
	}
	if (d.lista) lineas.push(`Listado (copiar ítems exactos):\n${d.lista}`);
	if (!lineas.length) return '(sin datos adicionales)';
	return lineas.join('\n');
}

function _fallbackMensaje(tipo, datos, conv) {
	const nom = _primerNombre(conv?.nombreContacto);
	const n = nom ? `${nom}, ` : '';
	switch (tipo) {
		case 'PEDIR_DNI':
		case 'INICIO_FLUJO':
			return nom
				? `Hola ${nom}, ¿me pasás tu DNI? Así busco el turno.`
				: '¿Me pasás tu DNI? Así busco el turno.';
		case 'AVISO_BUSQUEDA':
			return 'Dame un segundito, busco disponibilidad en la agenda.';
		case 'SUGERENCIA_TURNO':
			if (datos?.medico && datos?.hora) {
				return `${n}tengo turno con *${datos.medico}* el ${datos.diaSemana || ''} ${datos.fechaLegible || datos.fecha || ''} a las *${datos.hora}*. ¿Te sirve?`;
			}
			break;
		case 'LISTA_ESPECIALIDADES':
			if (datos?.lista) return `Estas son las especialidades con turno:\n\n${datos.lista}\n\n¿Cuál necesitás?`;
			break;
		default:
			break;
	}
	return null;
}

/**
 * Genera mensaje para el paciente desde pauta + datos (no reescribe plantillas).
 */
async function generarMensaje({
	conv,
	config,
	tipoRespuesta = 'GENERICO',
	pauta,
	interpretacion,
	datosOperativos,
	soloIntro = false,
	intencion,
}) {
	const tipo = tipoRespuesta || 'GENERICO';
	const objetivo = String(pauta || PAUTAS_POR_TIPO[tipo] || PAUTAS_POR_TIPO.GENERICO).trim();

	if (!botInterpretacion.humanizarHabilitado()) {
		return (
			_fallbackMensaje(tipo, datosOperativos, conv) ||
			objetivo.slice(0, 280)
		);
	}

	const nombre = _primerNombre(conv?.nombreContacto);
	const institucion = config?.nombreInstitucion || 'el centro de salud';
	const frustracion = botInterpretacion.nivelFrustracion(conv);
	const flags = interpretacion?.flags || {};
	const tono = flags.tono_sugerido || 'cercano';
	const hint = interpretacion?.mensaje_sugerido;
	const intencionEf =
		intencion || interpretacion?.intencion || interpretacion?.parametros?.resumen || null;

	const system = `Sos la recepcionista de turnos de ${institucion} por WhatsApp.
Tu rol es ATENCIÓN AL CLIENTE: generás cada mensaje desde cero, como una persona real.
NO reescribas plantillas. NO suenes a bot.

${_instruccionesPorTipo(soloIntro ? 'CONFIRMACION_TURNO_OK' : tipo)}

PROHIBIDO (nunca uses):
- "Para continuar, indicá el DNI..."
- "persona que va a atenderse"
- "sin puntos"
- "por favor" en cada mensaje
- "~" antes del nombre
- "Soy un asistente" / "soy un bot"

PREFERÍ:
- "¿me pasás tu DNI?", "así busco el turno", "¿con qué especialidad?"
- Tono rioplatense, cálido, breve (1-4 líneas salvo listados)

REGLAS ESTRICTAS:
- NO inventes médicos, fechas, horas, especialidades ni códigos de comprobante.
- Mantené *negritas* de WhatsApp en nombres, fechas y horarios del bloque factual.
- Si hay listado, incluí todos los ítems exactos.
${soloIntro ? '- NO incluyas comprobante ni ticket; solo mensaje introductorio.' : ''}
${nombre ? `- Tratá al paciente como *${nombre}* (nombre WhatsApp).` : ''}
${frustracion >= 2 ? '- Hubo frustración: disculpá brevemente y sé directo.' : ''}
${flags.necesita_aclaracion ? '- Una sola pregunta clara al final.' : ''}
${hint ? `- Tono sugerido: ${hint}` : ''}
${intencionEf ? `- Intención del paciente: ${intencionEf}` : ''}
Tono: ${tono}.`;

	const user = `PAUTA INTERNA (objetivo del mensaje, no copiar literal):
${objetivo}

DATOS EXACTOS A INCLUIR:
${_bloqueFactual(datosOperativos)}

Paso del flujo: ${conv?.pasoBot || '—'}

Escribí SOLO el mensaje para WhatsApp.`;

	try {
		const raw = await botOpenai.chat({
			system,
			messages: [{ role: 'user', content: user }],
		});
		const out = String(raw || '').trim();
		if (out.length >= 12) return out;
		return _fallbackMensaje(tipo, datosOperativos, conv) || objetivo.slice(0, 280);
	} catch (err) {
		console.warn('[botHumanizer]', err.message);
		return _fallbackMensaje(tipo, datosOperativos, conv) || objetivo.slice(0, 280);
	}
}

/** @deprecated Usar generarMensaje. Mantiene compatibilidad con orquestador. */
async function humanizar(opts) {
	const forzar = opts.forzar === true;
	const soloIntro = opts.soloIntro === true;
	if (forzar || opts.pauta) {
		return generarMensaje({
			conv: opts.conv,
			config: opts.config,
			tipoRespuesta: opts.tipoRespuesta,
			pauta: opts.pauta || opts.textoBase,
			interpretacion: opts.interpretacion,
			datosOperativos: opts.datosOperativos,
			soloIntro,
			intencion: opts.intencion,
		});
	}
	const base = String(opts.textoBase || '').trim();
	if (!base || !botInterpretacion.humanizarHabilitado()) return base;
	if (!TIPOS_HUMANIZAR.has(opts.tipoRespuesta || 'GENERICO')) return base;
	return generarMensaje({
		...opts,
		pauta: PAUTAS_POR_TIPO[opts.tipoRespuesta] || opts.textoBase,
	});
}

function datosDesdeSugerencia(sugerencia) {
	if (!sugerencia) return null;
	return {
		medico: sugerencia.medico,
		especialidad: sugerencia.especialidadNombre,
		fecha: sugerencia.fecha,
		fechaLegible: sugerencia.fechaLegible,
		diaSemana: sugerencia.diaSemana,
		hora: sugerencia.hora,
	};
}

function pautaPorTipo(tipo) {
	return PAUTAS_POR_TIPO[tipo] || PAUTAS_POR_TIPO.GENERICO;
}

module.exports = {
	generarMensaje,
	humanizar,
	datosDesdeSugerencia,
	pautaPorTipo,
	PAUTAS_POR_TIPO,
	TIPOS_HUMANIZAR,
};
