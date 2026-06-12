/**
 * Clasificación de intención vía GPT → acciones sobre agenda/wizard (sin reglas estáticas de NLU).
 */
const botOpenai = require('./botOpenai.service');
const botConversacion = require('./botConversacion.service');
const botAgenda = require('./botAgenda.service');

const MAP_DIA = {
	domingo: 0,
	lunes: 1,
	martes: 2,
	miercoles: 3,
	jueves: 4,
	viernes: 5,
	sabado: 6,
};

function gptHabilitado() {
	if (process.env.BOT_GPT_ENABLED === '0' || process.env.BOT_GPT_ENABLED === 'false') {
		return false;
	}
	return botOpenai.isConfigured();
}

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

function _diasANumeros(lista) {
	const out = [];
	for (const d of lista || []) {
		const key = String(d || '')
			.trim()
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');
		if (MAP_DIA[key] != null) out.push(MAP_DIA[key]);
	}
	return [...new Set(out)];
}

function _normalizarFranja(v) {
	const f = String(v || '')
		.trim()
		.toLowerCase();
	if (f === 'manana' || f === 'mañana') return 'manana';
	if (f === 'tarde') return 'tarde';
	if (f === 'noche') return 'noche';
	return null;
}

/**
 * Convierte la salida GPT en estructura de búsqueda de turnos (infra botAgenda).
 */
function intencionAAjusteTurno(intencion, parametros = {}, sugerenciaActual = null) {
	const excluir = { slots: [], fechas: [], diasSemana: [] };
	const preferir = {
		fechas: [],
		diasSemana: [],
		franja: _normalizarFranja(parametros.preferirFranja),
		horaDesde: parametros.horaDesde || null,
		horaHasta: parametros.horaHasta || null,
	};

	if (sugerenciaActual?.matricula && sugerenciaActual?.fecha && sugerenciaActual?.hora) {
		excluir.slots.push({
			matricula: sugerenciaActual.matricula,
			fecha: String(sugerenciaActual.fecha).slice(0, 10),
			hora: String(sugerenciaActual.hora).slice(0, 5),
		});
	}

	for (const f of parametros.preferirFechas || []) {
		if (f) preferir.fechas.push(String(f).slice(0, 10));
	}
	preferir.diasSemana = _diasANumeros(parametros.preferirDiasSemana);
	excluir.diasSemana = _diasANumeros(parametros.excluirDiasSemana);

	for (const f of parametros.excluirFechas || []) {
		if (f) excluir.fechas.push(String(f).slice(0, 10));
	}

	if (intencion === 'rechazar_turno' && !preferir.diasSemana.length && !preferir.franja) {
		/* solo excluye el slot actual */
	}

	preferir.fechas = [...new Set(preferir.fechas)];
	preferir.diasSemana = [...new Set(preferir.diasSemana)];
	excluir.diasSemana = [...new Set(excluir.diasSemana)];
	excluir.fechas = [...new Set(excluir.fechas)];

	const resumen = String(parametros.resumen || '').trim() || _resumenPreferencia(preferir);

	return { excluir, preferir, resumen };
}

function _resumenPreferencia(preferir) {
	const partes = [];
	if (preferir.fechas?.length === 1) {
		partes.push(preferir.fechas[0]);
	} else if (preferir.diasSemana?.length) {
		const nombres = Object.entries(MAP_DIA)
			.filter(([, n]) => preferir.diasSemana.includes(n))
			.map(([k]) => k);
		if (nombres.length) partes.push(nombres.join(' y '));
	}
	if (preferir.franja === 'tarde') partes.push('por la tarde');
	else if (preferir.franja === 'manana') partes.push('por la mañana');
	else if (preferir.franja === 'noche') partes.push('por la noche');
	return partes.join(' ') || null;
}

async function _especialidadesContexto() {
	try {
		return await botAgenda.listarEspecialidadesBot();
	} catch {
		return [];
	}
}

async function _historialCorto(idConversacion) {
	if (!idConversacion) return [];
	try {
		const msgs = await botConversacion.listarMensajes(idConversacion, { limit: 10 });
		return (msgs || [])
			.slice(-8)
			.filter((m) => m.origen === 'PACIENTE' || m.origen === 'BOT')
			.map((m) => ({
				role: m.origen === 'BOT' ? 'assistant' : 'user',
				content: String(m.contenido || '').trim(),
			}))
			.filter((m) => m.content);
	} catch {
		return [];
	}
}

function _promptConfirmarTurno(conv, especialidades) {
	const ctx = conv?.contextoBot || {};
	return `Clasificador de intenciones — bot de turnos médicos (español rioplatense).

Paso: CONFIRMAR turno sugerido.
Turno ofrecido: ${ctx.medico || '?'} — ${ctx.diaSemana || ''} ${ctx.fechaLegible || ctx.fecha || ''} ${ctx.hora || ''} (${ctx.especialidadNombre || ''}).
Paciente identificado: ${conv?.idPaciente ? 'sí' : 'no'}.

Intenciones válidas:
- confirmar_turno: acepta y quiere reservar ese turno
- buscar_turno: pide otro horario/día (con preferencias)
- rechazar_turno: no quiere ese turno, sin preferencia clara
- cambiar_especialidad: quiere otra área médica
- conversacion: charla o pregunta que no implica acción de agenda

Respondé ÚNICAMENTE JSON (una línea):
{"intencion":"...","parametros":{"preferirDiasSemana":[],"excluirDiasSemana":[],"preferirFranja":null,"preferirFechas":[],"excluirFechas":[],"resumen":""}}

Reglas:
- Interpretá el significado en lenguaje natural, no palabras exactas.
- "perfecto", "genial", "dale", "listo", "buenísimo", "confirmo", "de acuerdo" → confirmar_turno
- "puedo jueves y viernes" → buscar_turno, preferirDiasSemana ["jueves","viernes"]
- "¿tenés el jueves a la tarde?" → buscar_turno, preferir jueves + franja tarde
- "el lunes no puedo" → buscar_turno, excluirDiasSemana ["lunes"]
- No inventes fechas ni médicos.`;
}

function _promptElegirEspecialidad(especialidades) {
	const lista = (especialidades || []).map((e) => e.nombre).join(', ');
	return `Clasificador de intenciones — bot de turnos médicos.

Paso: elegir especialidad médica.
Especialidades válidas (nombre EXACTO): ${lista || '(sin catálogo)'}

Intenciones:
- elegir_especialidad: el paciente elige o menciona un área (ej. "gineco", "para cardio")
- listar_especialidades: pregunta qué hay / "mostrame"
- conversacion: no elige especialidad todavía

JSON:
{"intencion":"...","parametros":{"especialidad":"NOMBRE EXACTO O null","resumen":""}}`;
}

function _promptConfirmarIdentidad(conv) {
	return `Clasificador — confirmación identidad RENAPER.

Paso: CONFIRMAR_IDENTIDAD (¿es esta persona?).

Intenciones: confirmar_identidad | rechazar_identidad | elegir_especialidad (si menciona especialidad en vez de sí/no) | conversacion

Interpretá lenguaje natural: "perfecto", "genial", "dale", "soy yo", "correcto" → confirmar_identidad.
"no", "otra persona", "incorrecto" → rechazar_identidad.

JSON: {"intencion":"...","parametros":{"especialidad":"NOMBRE EXACTO O null","resumen":""}}`;
}

function _promptTurnoCompletado(conv, especialidades) {
	const lista = (especialidades || []).map((e) => e.nombre).join(', ');
	return `Clasificador — post turno confirmado.

El paciente ya tiene un turno reservado en esta sesión.
Paciente identificado: ${conv?.idPaciente ? 'sí' : 'no'}.

Intenciones:
- agradecimiento: agradece o cierra cordialmente ("gracias", "genial", "perfecto")
- solicitar_turno: pide otro turno (para sí u otra persona)
- elegir_especialidad: menciona un área médica
- listar_especialidades: pregunta qué hay disponible
- conversacion: charla sin pedir turno nuevo

Especialidades válidas: ${lista || '(sin catálogo)'}

JSON: {"intencion":"...","parametros":{"especialidad":"NOMBRE EXACTO O null","resumen":""}}`;
}

function _promptIdentificarInicio(conv, especialidades) {
	const lista = (especialidades || []).map((e) => e.nombre).join(', ');
	const ctx = [];
	if (conv?.nombreContacto) ctx.push(`Contacto WhatsApp: ${conv.nombreContacto}`);
	if (conv?.dniPaciente) ctx.push(`DNI en curso (sin confirmar): ${conv.dniPaciente}`);
	if (conv?.idPaciente) ctx.push('Ya hay un paciente identificado en esta sesión.');
	if (conv?.contextoBot?.especialidadPendiente?.nombre) {
		ctx.push(`Especialidad ya mencionada: ${conv.contextoBot.especialidadPendiente.nombre}`);
	}

	return `Clasificador de intenciones — bot de turnos médicos (español rioplatense).

Paso: inicio / identificación / post-turno. El paciente escribe en lenguaje natural libre.
${ctx.length ? `Contexto:\n${ctx.join('\n')}\n` : ''}
Especialidades válidas (usar nombre EXACTO de la lista si corresponde): ${lista || '(sin catálogo)'}

Intenciones:
- solicitar_turno: quiere sacar, pedir o gestionar un turno (para sí o para otra persona: tío, hermanita, hijo, etc.). Incluye seguimientos como "puede ser?", "ahora", "otro turno".
- elegir_especialidad: menciona un área médica concreta (ej. traumato, cardio, clínica)
- listar_especialidades: pregunta qué especialidades hay / "mostrame"
- agradecimiento: agradece o cierra cordialmente tras un turno ya confirmado, sin pedir turno nuevo todavía
- conversacion: charla sin pedir turno nuevo

JSON (una sola línea):
{"intencion":"...","parametros":{"especialidad":"NOMBRE EXACTO O null","resumen":""}}

Reglas:
- Interpretá el significado, no frases exactas.
- Si en el historial reciente el bot envió comprobante o "Turno confirmado", "muchas gracias" / "gracias" → agradecimiento (NO solicitar_turno).
- "un turno para mi tío", "puede ser?", "holaa otro turno" → solicitar_turno
- "me gustaría saber las especialidades", "qué tienen", "mostrame las áreas" → listar_especialidades (NO solicitar_turno)
- Preguntar qué especialidades hay NO implica pedir turno todavía → listar_especialidades
- "gracias", "genial" tras comprobante → agradecimiento
- Si menciona especialidad junto con pedir turno → solicitar_turno y completar parametros.especialidad
- No inventes especialidades fuera de la lista.`;
}

function _esPasoIdentificacionLibre(paso, conv) {
	if (paso === 'TURNO_COMPLETADO') return false;
	if (conv?.idPaciente && paso === 'CONFIRMAR' && !conv?.contextoBot) return false;
	if (paso === 'IDENTIFICAR' || paso === 'inicio' || !paso) return true;
	if (paso === 'CONFIRMAR' && conv?.contextoBot?.tipo !== 'turno_sugerido') return true;
	return false;
}

async function interpretarIntencion({ texto, conv, idConversacion, pasoBot }) {
	if (!gptHabilitado()) return null;

	const paso = pasoBot || conv?.pasoBot;
	let system;
	const especialidades = await _especialidadesContexto();

	if (paso === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') {
		system = _promptConfirmarTurno(conv, especialidades);
	} else if (paso === 'ELEGIR_ESPECIALIDAD') {
		system = _promptElegirEspecialidad(especialidades);
	} else if (paso === 'CONFIRMAR_IDENTIDAD') {
		system = _promptConfirmarIdentidad(conv);
	} else if (paso === 'TURNO_COMPLETADO') {
		system = _promptTurnoCompletado(conv, especialidades);
	} else if (_esPasoIdentificacionLibre(paso, conv)) {
		system = _promptIdentificarInicio(conv, especialidades);
	} else {
		return null;
	}

	const historial = await _historialCorto(idConversacion);
	const messages = [...historial];
	const ultimo = String(texto || '').trim();
	if (!ultimo) return null;
	if (!messages.length || messages[messages.length - 1].content !== ultimo) {
		messages.push({ role: 'user', content: ultimo });
	}

	let raw;
	try {
		raw = await botOpenai.chat({ system, messages });
	} catch (err) {
		console.warn('[botIntencion] GPT:', err.message);
		return null;
	}

	const j = _parsearJson(raw);
	if (!j?.intencion) return null;

	return {
		intencion: String(j.intencion).trim().toLowerCase(),
		parametros: j.parametros || {},
		paso,
	};
}

async function resolverEspecialidadDesdeIntencion(intencion) {
	if (!intencion) return { tipo: 'no_encontrada' };
	if (intencion.intencion === 'listar_especialidades') {
		return { tipo: 'listar', lista: await botAgenda.listarEspecialidadesBot() };
	}
	if (intencion.intencion === 'conversacion') {
		return { tipo: 'conversacion' };
	}
	const puedeElegir =
		intencion.intencion === 'elegir_especialidad' || intencion.intencion === 'solicitar_turno';
	if (!puedeElegir) {
		return { tipo: 'no_encontrada' };
	}

	const nombre = String(intencion.parametros?.especialidad || '').trim();
	if (!nombre) return { tipo: 'no_encontrada' };

	const lista = await botAgenda.listarEspecialidadesBot();
	const buscado = nombre
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	let match = lista.find(
		(e) =>
			String(e.nombre || '')
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '') === buscado,
	);
	if (!match) {
		match = lista.find((e) =>
			String(e.nombre || '')
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '')
				.includes(buscado),
		);
	}
	if (!match) return { tipo: 'no_encontrada' };
	return { tipo: 'especialidad', especialidad: match };
}

module.exports = {
	gptHabilitado,
	interpretarIntencion,
	intencionAAjusteTurno,
	resolverEspecialidadDesdeIntencion,
	esPasoIdentificacionLibre: _esPasoIdentificacionLibre,
};
