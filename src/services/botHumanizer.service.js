/**
 * Capa de voz: humaniza respuestas del wizard sin alterar datos operativos.
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
	'ERROR_AGENDA',
	'GENERICO',
]);

function _primerNombre(nombre) {
	const n = String(nombre || '').trim();
	return n ? n.split(/\s+/)[0] : null;
}

function _instruccionesPorTipo(tipo) {
	const map = {
		SALIDA_FLUJO:
			'Cerrá la gestión con empatía. Dejá claro que puede volver a escribir cuando quiera un turno.',
		SUGERENCIA_TURNO:
			'Presentá el turno de forma conversacional. Terminá con una pregunta clara: confirmar, buscar otro horario o cancelar.',
		CONFIRMACION_TURNO_OK:
			'Celebrá brevemente la reserva. Incluí el comprobante tal cual. Tono cálido.',
		PEDIR_DNI: 'Pedí el DNI de forma amable, sin sonar robótico.',
		CONFIRMAR_IDENTIDAD:
			'Pedí confirmación de identidad con los datos mostrados. Pregunta simple Sí/No.',
		LISTA_ESPECIALIDADES: 'Presentá la lista de forma clara y amigable.',
		LISTA_PROFESIONALES: 'Presentá profesionales de forma clara.',
		SIN_DISPONIBILIDAD: 'Empatía si no hay turnos. Invitá a proponer otro día u horario.',
		POST_TURNO: 'Cierre cordial tras turno confirmado.',
		INICIO_FLUJO: 'Bienvenida breve y pedí el siguiente dato.',
		ACLARACION: 'Una sola pregunta corta para desambiguar.',
		ERROR_AGENDA: 'Explicá el problema sin tecnicismos y orientá al siguiente paso.',
		GENERICO: 'Sé natural y breve.',
	};
	return map[tipo] || map.GENERICO;
}

function _bloqueFactual(datosOperativos, textoBase) {
	const d = datosOperativos || {};
	const lineas = [];
	if (d.medico) lineas.push(`Médico: ${d.medico}`);
	if (d.especialidad) lineas.push(`Especialidad: ${d.especialidad}`);
	if (d.fechaLegible || d.fecha) lineas.push(`Fecha: ${d.fechaLegible || d.fecha}`);
	if (d.diaSemana) lineas.push(`Día: ${d.diaSemana}`);
	if (d.hora) lineas.push(`Hora: ${d.hora}`);
	if (d.comprobante) lineas.push(`Comprobante: ${d.comprobante}`);
	if (d.lista) lineas.push(`Listado:\n${d.lista}`);
	if (!lineas.length) return textoBase;
	return `${lineas.join('\n')}\n\n---\nMensaje base:\n${textoBase}`;
}

/**
 * @param {object} opts
 * @param {object} [opts.conv]
 * @param {object} [opts.config]
 * @param {string} opts.tipoRespuesta
 * @param {string} opts.textoBase
 * @param {object} [opts.interpretacion]
 * @param {object} [opts.datosOperativos]
 */
async function humanizar({
	conv,
	config,
	tipoRespuesta = 'GENERICO',
	textoBase,
	interpretacion,
	datosOperativos,
}) {
	const base = String(textoBase || '').trim();
	if (!base) return base;
	if (!botInterpretacion.humanizarHabilitado()) return base;
	if (!TIPOS_HUMANIZAR.has(tipoRespuesta)) return base;

	const nombre = _primerNombre(conv?.nombreContacto);
	const institucion = config?.nombreInstitucion || 'el centro de salud';
	const frustracion = botInterpretacion.nivelFrustracion(conv);
	const flags = interpretacion?.flags || {};
	const tono = flags.tono_sugerido || 'cercano';
	const hint = interpretacion?.mensaje_sugerido;

	const system = `Sos la voz del asistente de turnos de ${institucion} por WhatsApp.
Reescribí el mensaje de forma natural, cálida y breve (español rioplatense).
${_instruccionesPorTipo(tipoRespuesta)}

REGLAS ESTRICTAS:
- NO cambies, omitas ni inventes médicos, fechas, horas, especialidades ni comprobantes.
- Mantené *negritas* de WhatsApp en nombres, fechas y horarios importantes.
- Máximo 5 líneas salvo listados.
- No uses markdown complejo ni emojis excesivos (máx. 2 si el mensaje base los tiene).
${nombre ? `- Tratá al paciente como *${nombre}* (nombre de WhatsApp).` : ''}
${frustracion >= 2 ? '- El paciente mostró frustración: pedí disculpas breves y sé más directo.' : ''}
${flags.necesita_aclaracion ? '- Hacé una sola pregunta clara al final.' : ''}
${hint ? `- Tono emocional sugerido: ${hint}` : ''}
Tono: ${tono}.`;

	const user = `BLOQUE FACTUAL (preservar datos exactos):
${_bloqueFactual(datosOperativos, base)}

Reescribí solo el mensaje final para el paciente.`;

	try {
		const raw = await botOpenai.chat({
			system,
			messages: [{ role: 'user', content: user }],
		});
		const out = String(raw || '').trim();
		return out.length >= 20 ? out : base;
	} catch (err) {
		console.warn('[botHumanizer]', err.message);
		return base;
	}
}

/** Extrae datos estructurados de una sugerencia de turno para el humanizer. */
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

module.exports = {
	humanizar,
	datosDesdeSugerencia,
	TIPOS_HUMANIZAR,
};
