/**
 * Agente conversacional de turnos (IA con function-calling).
 *
 * Marco MÍNIMO: la IA conversa con naturalidad y tacto; su ÚNICO objetivo es
 * ayudar a gestionar turnos (sacar / consultar / cancelar). No hay flujo por
 * pasos ni plantillas: la IA decide qué preguntar y qué herramienta usar.
 *
 * El "estado" (lo recolectado) vive en conv.contextoBot.agente y se le entrega
 * a la IA en cada turno, para que NUNCA vuelva a pedir algo que ya sabe.
 *
 * La capa de datos real (RENAPER, ficha, agenda, reserva) está en
 * botAgenda.service.js; este módulo solo orquesta la conversación.
 */
const botOpenai = require('./botOpenai.service');
const botAgenda = require('./botAgenda.service');
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botSesionIa = require('./botSesionIa.service');
const { extraerDniDesdeTexto } = require('../utils/botDni');
const diag = require('../utils/diagLog');

const MAX_ITERACIONES_TOOLS = 8;

// ---------------------------------------------------------------------------
// Estado del agente (los "parámetros" que necesita para sacar un turno)
// ---------------------------------------------------------------------------
function estadoInicial() {
	return {
		paciente: null, // { dni, idPaciente, nombre, fechaNacimiento, sexo, confirmado }
		especialidad: null, // { valor, nombre }
		profesional: null, // { matricula, nombre, especialidadNombre }
		preferencia: null, // { resumen, fechaDesde, fechaHasta, franja }
		turnoOfrecido: null, // { matricula, medico, fecha, fechaLegible, diaSemana, hora, especialidadNombre, sector }
		candidatosProfesionales: [], // [{ matricula, nombre, especialidadNombre }]
		turnosConsultados: [], // [{ idTurno, matricula, medico, fecha, hora, estado }]
	};
}

function leerEstado(conv) {
	const guardado = conv?.contextoBot?.agente;
	return { ...estadoInicial(), ...(guardado && typeof guardado === 'object' ? guardado : {}) };
}

/** Limpia por completo el estado del agente (nueva gestión tras reservar). */
function reiniciarEstadoAgente(estado) {
	const limpio = estadoInicial();
	for (const k of Object.keys(estado)) delete estado[k];
	Object.assign(estado, limpio);
}

async function guardarEstado(idConversacion, estado) {
	await botConversacion.guardarContextoBot(idConversacion, { agente: estado });
}

async function aplicarProfesionalElegido(estado, candidato) {
	estado.profesional = {
		matricula: candidato.matricula,
		nombre: candidato.nombre,
		especialidadNombre: candidato.especialidadNombre || null,
	};
	if (candidato.especialidadNombre) {
		const esp = await botAgenda.resolverEspecialidadDesdeTexto(candidato.especialidadNombre);
		if (esp) estado.especialidad = { valor: esp.valor, nombre: esp.nombre };
	} else if (!estado.especialidad?.valor && candidato.matricula) {
		const todos = await botAgenda.listarProfesionalesAgendaGlobal();
		const hit = todos.find((p) => Number(p.matricula) === Number(candidato.matricula));
		if (hit?.especialidad) {
			estado.especialidad = { valor: hit.especialidad, nombre: hit.especialidadNombre };
		}
	}
	estado.candidatosProfesionales = [];
}

// ---------------------------------------------------------------------------
// Clasificador de intención → endpoint obligatorio
// ---------------------------------------------------------------------------
const INTENCION_A_TOOL = {
	buscar_profesional: 'buscar_profesional',
	confirmar_profesional_elegido: 'confirmar_profesional_elegido',
	listar_profesionales_de_especialidad: 'listar_profesionales_de_especialidad',
	listar_especialidades: 'listar_especialidades',
	registrar_preferencia_horario: 'registrar_preferencia_horario',
	buscar_turno: 'buscar_turno',
	identificar_paciente: 'identificar_paciente',
	confirmar_paciente: 'confirmar_paciente',
	reservar_turno: 'reservar_turno',
	consultar_turnos_paciente: 'consultar_turnos_paciente',
	cancelar_turno: 'cancelar_turno',
};

function estadoResumidoParaClasificador(estado) {
	return {
		esperandoEleccionProfesional: Boolean(
			estado.candidatosProfesionales?.length && !estado.profesional?.matricula,
		),
		candidatosProfesionales: (estado.candidatosProfesionales || []).map((p, i) => ({
			indice: i + 1,
			matricula: p.matricula,
			nombre: p.nombre,
			especialidad: p.especialidadNombre,
		})),
		profesional: estado.profesional?.nombre || null,
		profesionalMatricula: estado.profesional?.matricula || null,
		especialidad: estado.especialidad?.nombre || null,
		preferenciaHorario: estado.preferencia?.resumen || null,
		pacienteIdentificado: Boolean(estado.paciente?.idPaciente),
		pacienteConfirmado: Boolean(estado.paciente?.confirmado),
		turnoOfrecido: Boolean(estado.turnoOfrecido),
		turnosConsultados: (estado.turnosConsultados || []).map((t) => ({
			idTurno: t.idTurno,
			medico: t.medico,
			fecha: t.fecha,
			hora: t.hora,
		})),
	};
}

function construirPromptClasificador(estado) {
	const st = JSON.stringify(estadoResumidoParaClasificador(estado), null, 0);
	return [
		'Sos el clasificador de intenciones de un bot de turnos médicos por WhatsApp.',
		'Devolvé SOLO un JSON válido con exactamente estas claves:',
		'- intencion: string (una de la lista de endpoints, o "conversacion")',
		'- parametros: object (argumentos del endpoint; {} si conversacion)',
		'- requiere_endpoint: boolean (true si hay que ejecutar el endpoint antes de responder)',
		'',
		'ENDPOINTS (equivalen a acciones sobre la base de datos — usarlos cuando corresponda):',
		'- buscar_profesional → parametros: { "texto": "apellido o nombre mencionado" }',
		'- confirmar_profesional_elegido → parametros: { "matricula": N } o { "indice": N } según candidatosProfesionales',
		'- listar_profesionales_de_especialidad → parametros: { "especialidad": "nombre" }',
		'- listar_especialidades → parametros: {}',
		'- registrar_preferencia_horario → parametros: { "texto": "lo que dijo sobre fecha/hora" }',
		'- buscar_turno → parametros: { "especialidad"?: string, "profesional_matricula"?: number }',
		'- identificar_paciente → parametros: { "dni": "número" } — DNI de **quien se va a atender** (no necesariamente quien escribe)',
		'- confirmar_paciente → parametros: { "confirmado": true|false }',
		'- reservar_turno → parametros: {}',
		'- consultar_turnos_paciente → parametros: {}',
		'- cancelar_turno → parametros: { "idTurno": number }',
		'- conversacion → saludo, despedida o charla sin consultar datos. parametros: {}, requiere_endpoint: false',
		'',
		'REGLAS OBLIGATORIAS (requiere_endpoint: true):',
		'1. Si esperandoEleccionProfesional=true → intencion=confirmar_profesional_elegido (interpretá número, nombre, corrección, especialidad).',
		'2. Si el paciente nombra un médico/apellido y NO hay profesional fijado ni candidatos pendientes → intencion=buscar_profesional.',
		'3. Si pide médicos de una especialidad (sin candidatos pendientes) → listar_profesionales_de_especialidad.',
		'4. Si expresa cuándo quiere el turno → registrar_preferencia_horario.',
		'5. Si hay profesional/especialidad y quiere ver disponibilidad → buscar_turno.',
		'6. Si envía un DNI → identificar_paciente (es el DNI de quien será atendido, puede ser otra persona).',
		'7. Si confirma o rechaza los datos de identidad mostrados → confirmar_paciente.',
		'8. Si confirma el turno ofrecido y pacienteConfirmado=true → reservar_turno.',
		'9. Si pregunta por sus turnos → consultar_turnos_paciente (requiere paciente identificado).',
		'10. Si quiere cancelar un turno ya listado → cancelar_turno.',
		'11. Si pacienteIdentificado=false y avanzan en un turno nuevo → NO asumas identidad previa; pedí el DNI de quien se va a atender.',
		'',
		`ESTADO ACTUAL:\n${st}`,
	].join('\n');
}

async function clasificarIntencion({ texto, estado, historial }) {
	const ultimos = (historial || []).slice(-6);
	const messages = [
		...ultimos,
		{ role: 'user', content: String(texto || '').trim() },
	];
	const parsed = await botOpenai.chatJson({
		system: construirPromptClasificador(estado),
		messages,
		temperature: 0.1,
		maxTokens: 300,
	});
	const intencion = String(parsed?.intencion || 'conversacion').trim();
	const parametros =
		parsed?.parametros && typeof parsed.parametros === 'object' ? parsed.parametros : {};
	return {
		intencion,
		parametros,
		requiere_endpoint: Boolean(parsed?.requiere_endpoint) && intencion !== 'conversacion',
	};
}

async function ejecutarEndpointObligatorio(clasificacion, ctx, messages) {
	if (!clasificacion?.requiere_endpoint) return false;
	const toolName = INTENCION_A_TOOL[clasificacion.intencion];
	if (!toolName) return false;

	let resultado;
	try {
		resultado = await ejecutarHerramienta(toolName, clasificacion.parametros || {}, ctx);
	} catch (err) {
		resultado = { error: err.message };
	}

	diag.line('agente', 'endpoint_obligatorio', {
		intencion: clasificacion.intencion,
		tool: toolName,
		ok: !resultado?.error,
	});

	messages.push({
		role: 'system',
		content: [
			`ENDPOINT EJECUTADO (obligatorio — intención: ${clasificacion.intencion}):`,
			`Tool: ${toolName}`,
			`Argumentos: ${JSON.stringify(clasificacion.parametros || {})}`,
			`Resultado: ${JSON.stringify(resultado)}`,
			'Usá este resultado para redactar la respuesta al paciente. No repitas la búsqueda si ya hay datos.',
		].join('\n'),
	});
	return true;
}

// ---------------------------------------------------------------------------
// Catálogo de herramientas (function-calling)
// ---------------------------------------------------------------------------
const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'listar_especialidades',
			description:
				'Devuelve las especialidades con agenda disponible. Usar SOLO si el paciente pide ver el listado o no logra decidir.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'buscar_profesional',
			description:
				'Busca médicos en la agenda por apellido o nombre (tolera errores de transcripción de audio). Devuelve coincidencias con su especialidad. Usar cuando el paciente menciona un profesional.',
			parameters: {
				type: 'object',
				properties: {
					texto: { type: 'string', description: 'Apellido o nombre del médico (ej. "Gómez", "de biasi").' },
				},
				required: ['texto'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'confirmar_profesional_elegido',
			description:
				'Confirma cuál profesional eligió el paciente de la lista pendiente en candidatosProfesionales del ESTADO ACTUAL. Vos interpretás el mensaje (número, nombre parcial, corrección, especialidad, audio mal transcrito, etc.) y pasás matricula o indice. NO busques de nuevo ni listes la especialidad entera.',
			parameters: {
				type: 'object',
				properties: {
					indice: {
						type: 'integer',
						description:
							'Posición en candidatosProfesionales (1, 2, 3...) según interpretaste lo que dijo el paciente.',
					},
					matricula: {
						type: 'integer',
						description:
							'Matrícula del profesional elegido, copiada de candidatosProfesionales en el ESTADO ACTUAL.',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'listar_profesionales_de_especialidad',
			description:
				'Lista los profesionales con agenda en una especialidad. NO usar si ya hay candidatos pendientes de elección o si el paciente acaba de elegir uno de una lista.',
			parameters: {
				type: 'object',
				properties: {
					especialidad: { type: 'string', description: 'Nombre de la especialidad (ej. "cardiología").' },
				},
				required: ['especialidad'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'registrar_preferencia_horario',
			description:
				'Interpreta y guarda la preferencia de fecha/horario del paciente (ej. "el jueves de la semana que viene", "para agosto", "por la tarde"). Llamar cuando expresa cuándo quiere el turno.',
			parameters: {
				type: 'object',
				properties: {
					texto: { type: 'string', description: 'Texto del paciente sobre cuándo quiere el turno.' },
				},
				required: ['texto'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'buscar_turno',
			description:
				'Busca el turno libre más cercano según lo recolectado (especialidad y/o profesional y preferencia horaria). Requiere tener al menos especialidad o profesional. Llamar cuando ya hay suficiente info para ofrecer un turno.',
			parameters: {
				type: 'object',
				properties: {
					especialidad: { type: 'string', description: 'Opcional: nombre de especialidad si aún no está fijada.' },
					profesional_matricula: { type: 'number', description: 'Opcional: matrícula del médico elegido.' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'identificar_paciente',
			description:
				'Valida el DNI de la PERSONA QUE SE VA A ATENDER en el consultorio (puede NO ser quien escribe por WhatsApp). Devuelve nombre y datos para confirmar. Llamar apenas den un DNI para el turno.',
			parameters: {
				type: 'object',
				properties: {
					dni: { type: 'string', description: 'Número de DNI de la persona que tendrá el turno.' },
				},
				required: ['dni'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'confirmar_paciente',
			description:
				'Confirma que los datos de identidad devueltos por identificar_paciente son correctos según el paciente. Llamar cuando el paciente confirma que el nombre/datos son suyos (o de la persona del turno).',
			parameters: {
				type: 'object',
				properties: {
					confirmado: { type: 'boolean', description: 'true si el paciente confirma los datos, false si los rechaza.' },
				},
				required: ['confirmado'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'reservar_turno',
			description:
				'Reserva el turno ofrecido para el paciente ya identificado y confirmado. Devuelve el comprobante. Llamar SOLO cuando el paciente confirma que quiere el turno ofrecido y su identidad ya está confirmada.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'consultar_turnos_paciente',
			description:
				'Lista los turnos vigentes del paciente identificado. Usar cuando pregunta por sus turnos o quiere cancelar/reprogramar.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'cancelar_turno',
			description:
				'Cancela un turno del paciente. Antes hay que haberlos listado con consultar_turnos_paciente. Indicá el idTurno elegido.',
			parameters: {
				type: 'object',
				properties: {
					idTurno: { type: 'number', description: 'Id del turno a cancelar (de consultar_turnos_paciente).' },
				},
				required: ['idTurno'],
			},
		},
	},
];

// ---------------------------------------------------------------------------
// Ejecución de herramientas (mutan el estado y devuelven datos a la IA)
// ---------------------------------------------------------------------------
async function ejecutarHerramienta(nombre, args, ctx) {
	const { estado, conv, telefonoWhatsApp, idConversacion } = ctx;

	switch (nombre) {
		case 'listar_especialidades': {
			const lista = await botAgenda.listarEspecialidadesBot();
			return { especialidades: lista.map((e) => e.nombre) };
		}

		case 'buscar_profesional': {
			const texto = String(args.texto || '').trim();
			if (!texto) return { error: 'Falta el nombre a buscar.' };
			if (estado.candidatosProfesionales?.length && !estado.profesional?.matricula) {
				return {
					error:
						'Hay candidatos pendientes de elección. Interpretá la respuesta del paciente contra candidatosProfesionales y usá confirmar_profesional_elegido con matricula o indice.',
					candidatos: estado.candidatosProfesionales.map((c, i) => ({
						indice: i + 1,
						matricula: c.matricula,
						nombre: c.nombre,
						especialidad: c.especialidadNombre,
					})),
				};
			}
			const analisis = await botAgenda.analizarPedidoTurnoConProfesional(texto, {
				especialidadValor: estado.especialidad?.valor ?? null,
			});
			if (analisis.tipo === 'unico') {
				estado.profesional = {
					matricula: analisis.profesional.matricula,
					nombre: analisis.profesional.nombre,
					especialidadNombre: analisis.especialidad?.nombre || null,
				};
				if (analisis.especialidad?.valor) {
					estado.especialidad = {
						valor: analisis.especialidad.valor,
						nombre: analisis.especialidad.nombre,
					};
				}
				estado.candidatosProfesionales = [];
				return { encontrado: 'unico', profesional: estado.profesional };
			}
			if (analisis.tipo === 'multiples') {
				estado.candidatosProfesionales = analisis.matches.slice(0, 8).map((m) => ({
					matricula: m.matricula,
					nombre: m.nombre,
					especialidadNombre: m.especialidadNombre || null,
				}));
				return { encontrado: 'multiples', coincidencias: estado.candidatosProfesionales };
			}
			return { encontrado: 'ninguno', busqueda: analisis.busqueda || texto };
		}

		case 'confirmar_profesional_elegido': {
			if (!estado.candidatosProfesionales?.length) {
				return { error: 'No hay candidatos pendientes de elección.' };
			}
			let elegido = null;
			if (args.matricula != null) {
				elegido = estado.candidatosProfesionales.find(
					(c) => Number(c.matricula) === Number(args.matricula),
				);
			}
			if (!elegido && args.indice != null) {
				const idx = Number(args.indice) - 1;
				if (idx >= 0 && idx < estado.candidatosProfesionales.length) {
					elegido = estado.candidatosProfesionales[idx];
				}
			}
			if (!elegido) {
				return {
					error:
						'Indice o matricula inválidos. Revisá candidatosProfesionales en el ESTADO ACTUAL e interpretá de nuevo el mensaje del paciente.',
					candidatos: estado.candidatosProfesionales.map((c, i) => ({
						indice: i + 1,
						matricula: c.matricula,
						nombre: c.nombre,
						especialidad: c.especialidadNombre,
					})),
				};
			}
			await aplicarProfesionalElegido(estado, elegido);
			return { confirmado: true, profesional: estado.profesional };
		}

		case 'listar_profesionales_de_especialidad': {
			if (estado.candidatosProfesionales?.length && !estado.profesional?.matricula) {
				return {
					error:
						'Hay candidatos pendientes de elección. Interpretá la respuesta del paciente y usá confirmar_profesional_elegido con matricula o indice del ESTADO ACTUAL.',
					candidatos: estado.candidatosProfesionales.map((c, i) => ({
						indice: i + 1,
						matricula: c.matricula,
						nombre: c.nombre,
						especialidad: c.especialidadNombre,
					})),
				};
			}
			const esp = await botAgenda.resolverEspecialidadDesdeTexto(String(args.especialidad || ''));
			if (!esp) return { error: 'No reconocí esa especialidad.' };
			const { profesionales } = await botAgenda.listarProfesionalesBot(esp.valor);
			estado.especialidad = { valor: esp.valor, nombre: esp.nombre };
			estado.candidatosProfesionales = profesionales.slice(0, 12).map((p) => ({
				matricula: p.matricula,
				nombre: p.nombre,
				especialidadNombre: esp.nombre,
			}));
			return {
				especialidad: esp.nombre,
				profesionales: estado.candidatosProfesionales.map((p) => p.nombre),
			};
		}

		case 'registrar_preferencia_horario': {
			const texto = String(args.texto || '').trim();
			const sugerencia = estado.turnoOfrecido || null;
			const pref = await botAgenda.interpretarAjusteTurnoInteligente(texto, sugerencia);
			const p = pref?.preferir || {};
			estado.preferencia = {
				resumen: pref?.resumen || null,
				fechaDesde: p.fechaDesde || (p.fechas?.[0] ?? null),
				fechaHasta: p.fechaHasta || null,
				franja: p.franja || null,
				diasSemana: p.diasSemana || [],
				_excluir: pref?.excluir || null,
				_preferir: p,
			};
			return {
				registrada: true,
				resumen: estado.preferencia.resumen,
				fechaDesde: estado.preferencia.fechaDesde,
				fechaHasta: estado.preferencia.fechaHasta,
				franja: estado.preferencia.franja,
			};
		}

		case 'buscar_turno': {
			if (args.especialidad && !estado.especialidad) {
				const esp = await botAgenda.resolverEspecialidadDesdeTexto(String(args.especialidad));
				if (esp) estado.especialidad = { valor: esp.valor, nombre: esp.nombre };
			}
			const matricula =
				Number(args.profesional_matricula) || estado.profesional?.matricula || null;
			let espValor = estado.especialidad?.valor || null;
			if (!espValor && estado.profesional?.matricula) {
				// inferir especialidad desde el profesional
				const todos = await botAgenda.listarProfesionalesAgendaGlobal();
				const hit = todos.find((p) => Number(p.matricula) === Number(estado.profesional.matricula));
				if (hit?.especialidad) {
					espValor = hit.especialidad;
					estado.especialidad = { valor: hit.especialidad, nombre: hit.especialidadNombre };
				}
			}
			if (!espValor) {
				return { error: 'Falta la especialidad o el profesional para buscar turno.' };
			}

			const opciones = {};
			if (matricula) opciones.matricula = matricula;
			if (estado.preferencia?._preferir) opciones.preferir = estado.preferencia._preferir;
			if (estado.preferencia?._excluir) opciones.excluir = estado.preferencia._excluir;

			let turno = await botAgenda.sugerirPrimerTurnoDisponible(espValor, opciones);
			turno = turno ? await botAgenda.validarSugerenciaTurno(turno, espValor) : null;

			// Si con preferencia de fecha no hubo, reintenta sin ventana de fecha.
			if (!turno && (opciones.preferir?.fechaDesde || opciones.preferir?.fechas?.length)) {
				const sinFecha = {
					...opciones,
					preferir: { ...opciones.preferir, fechaDesde: null, fechaHasta: null, fechas: [] },
				};
				turno = await botAgenda.sugerirPrimerTurnoDisponible(espValor, sinFecha);
				turno = turno ? await botAgenda.validarSugerenciaTurno(turno, espValor) : null;
			}

			if (!turno) {
				estado.turnoOfrecido = null;
				return { encontrado: false, preferencia: estado.preferencia?.resumen || null };
			}
			estado.turnoOfrecido = turno;
			return {
				encontrado: true,
				turno: {
					medico: turno.medico,
					especialidad: turno.especialidadNombre,
					dia: turno.diaSemana,
					fecha: turno.fechaLegible,
					hora: turno.hora,
				},
			};
		}

		case 'identificar_paciente': {
			const dni = extraerDniDesdeTexto(String(args.dni || '')) || String(args.dni || '').replace(/\D/g, '');
			if (!dni) return { error: 'El DNI no es válido.' };
			try {
				const r = await botAgenda.identificarPaciente({
					numeroDocumento: dni,
					telefonoWhatsApp,
					idConversacion,
					crearSiNoExiste: true,
					omitirAvancePaso: true,
				});
				const nombre =
					r.pacienteLocal?.existe ? r.pacienteLocal.nombre : r.renaper?.nombreCompleto || null;
				estado.paciente = {
					dni,
					idPaciente: r.idPaciente || null,
					nombre: nombre || null,
					fechaNacimiento: r.renaper?.fechaNacimiento || r.pacienteLocal?.fechaNacimiento || null,
					sexo: r.renaper?.sexo || r.pacienteLocal?.sexo || null,
					confirmado: false,
				};
				await botConversacion.actualizarContextoPaciente(idConversacion, { dniPaciente: dni });
				return {
					encontrado: Boolean(nombre),
					nombre,
					fechaNacimiento: estado.paciente.fechaNacimiento,
					fuente: r.renaper?.fuente || (r.pacienteLocal?.existe ? 'ficha' : null),
				};
			} catch (err) {
				return { error: botAgenda.mensajeErrorIdentificacion(err) };
			}
		}

		case 'confirmar_paciente': {
			if (!estado.paciente) return { error: 'Todavía no hay datos de identidad para confirmar.' };
			if (args.confirmado === false) {
				estado.paciente = null;
				await botConversacion.actualizarContextoPaciente(idConversacion, { dniPaciente: null, idPaciente: null });
				return { confirmado: false };
			}
			estado.paciente.confirmado = true;
			if (estado.paciente.idPaciente) {
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					idPaciente: estado.paciente.idPaciente,
					dniPaciente: estado.paciente.dni,
				});
			}
			return { confirmado: true, nombre: estado.paciente.nombre };
		}

		case 'reservar_turno': {
			if (!estado.paciente?.confirmado || !estado.paciente?.idPaciente) {
				return { error: 'Falta identificar y confirmar al paciente antes de reservar.' };
			}
			if (!estado.turnoOfrecido?.matricula) {
				return { error: 'No hay un turno ofrecido para reservar. Buscá un turno primero.' };
			}
			try {
				const t = estado.turnoOfrecido;
				const reserva = await botAgenda.reservarTurno({
					matricula: t.matricula,
					idPaciente: estado.paciente.idPaciente,
					fecha: t.fecha,
					hora: t.hora,
					sector: t.sector || '',
					especialidad: estado.especialidad?.valor ?? t.especialidad,
					telefonoWhatsApp,
					idConversacion,
				});
				ctx.ticket = reserva?.ticket?.mensajeWhatsApp || null;
				ctx.reservaOk = true;
				const resultado = {
					reservado: true,
					comprobante: reserva?.ticket?.codigo || null,
					medico: reserva?.medico || t.medico,
					fecha: t.fechaLegible,
					hora: t.hora,
					gestion_reiniciada: true,
				};
				// Nueva gestión: el próximo turno puede ser para otra persona → resetear identidad.
				reiniciarEstadoAgente(estado);
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					idPaciente: null,
					dniPaciente: null,
				});
				return resultado;
			} catch (err) {
				diag.warn('agente', 'reservar_turno falló', { error: err.message });
				return { error: err.message || 'No se pudo reservar el turno.' };
			}
		}

		case 'consultar_turnos_paciente': {
			if (!estado.paciente?.idPaciente) {
				return { requiere_identidad: true };
			}
			try {
				const { turnos } = await botAgenda.consultarTurnosPaciente({
					idPaciente: estado.paciente.idPaciente,
					proximos: true,
				});
				estado.turnosConsultados = turnos.map((t) => ({
					idTurno: t.idTurno,
					matricula: t.matricula,
					medico: t.medico,
					fecha: t.fecha,
					hora: t.hora,
					estado: t.estado,
				}));
				return { cantidad: turnos.length, turnos: estado.turnosConsultados };
			} catch (err) {
				return { error: err.message };
			}
		}

		case 'cancelar_turno': {
			if (!estado.paciente?.idPaciente) return { requiere_identidad: true };
			const idTurno = Number(args.idTurno);
			if (!Number.isFinite(idTurno) || idTurno <= 0) return { error: 'Falta el turno a cancelar.' };
			const hit = (estado.turnosConsultados || []).find((t) => Number(t.idTurno) === idTurno);
			const matricula = hit ? Number(hit.matricula) : null;
			if (!matricula) return { error: 'No encontré ese turno entre los consultados.' };
			try {
				await botAgenda.cancelarTurnoBot({
					idTurno,
					matricula,
					idPaciente: estado.paciente.idPaciente,
					telefonoWhatsApp,
					idConversacion,
				});
				estado.turnosConsultados = (estado.turnosConsultados || []).filter(
					(t) => Number(t.idTurno) !== idTurno,
				);
				return { cancelado: true, idTurno };
			} catch (err) {
				return { error: err.message };
			}
		}

		default:
			return { error: `Herramienta desconocida: ${nombre}` };
	}
}

// ---------------------------------------------------------------------------
// Prompt del sistema (marco mínimo + persona + estado actual)
// ---------------------------------------------------------------------------
function construirSystemPrompt({ config, conv, estado }) {
	const saludo = botSesionIa.contextoSaludo(conv);
	const hoy = botSesionIa.fechaArgentinaHoy();
	const nombreContacto = conv?.nombreContacto ? String(conv.nombreContacto).trim() : null;

	const estadoTxt = JSON.stringify(
		{
			paciente: estado.paciente
				? {
						dni: estado.paciente.dni,
						nombre: estado.paciente.nombre,
						identificado: Boolean(estado.paciente.idPaciente),
						confirmado: Boolean(estado.paciente.confirmado),
					}
				: null,
			especialidad: estado.especialidad?.nombre || null,
			profesional: estado.profesional?.nombre || null,
			preferenciaHorario: estado.preferencia?.resumen || null,
			turnoOfrecido: estado.turnoOfrecido
				? `${estado.turnoOfrecido.medico} — ${estado.turnoOfrecido.diaSemana} ${estado.turnoOfrecido.fechaLegible} ${estado.turnoOfrecido.hora}`
				: null,
			candidatosProfesionales: (estado.candidatosProfesionales || []).map((p, i) => ({
				indice: i + 1,
				nombre: p.nombre,
				especialidad: p.especialidadNombre,
				matricula: p.matricula,
			})),
			esperandoEleccionProfesional: Boolean(
				estado.candidatosProfesionales?.length && !estado.profesional?.matricula,
			),
			turnosVigentes: (estado.turnosConsultados || []).map(
				(t) => `#${t.idTurno} ${t.medico} ${t.fecha} ${t.hora}`,
			),
		},
		null,
		0,
	);

	const esperandoEleccion = Boolean(
		estado.candidatosProfesionales?.length && !estado.profesional?.matricula,
	);

	return [
		`Sos el asistente de turnos de *${config.nombreInstitucion}* y atendés por WhatsApp.`,
		`Hoy es ${hoy} (hora de Argentina, GMT-3).`,
		'',
		'TU ÚNICO OBJETIVO es ayudar a la persona a **gestionar turnos médicos**: sacar un turno nuevo, consultar sus turnos o cancelarlos. Si te piden algo fuera de esto (recetas, resultados, urgencias, etc.), explicá con amabilidad que solo gestionás turnos y, si corresponde, sugerí contactar al centro.',
		'',
		'CÓMO HABLÁS:',
		'- Como una recepcionista humana: cálida, natural, con tacto y breve. Nunca suenes robótica.',
		'- Respondé puntualmente a lo que dice la persona en cada mensaje. Si pregunta algo, contestá eso.',
		'- No recites listas largas salvo que te las pidan explícitamente. Mejor sugerí o preguntá.',
		'- Un solo tema por mensaje; no abrumes con muchas preguntas juntas.',
		'- Usá el nombre de la persona si lo conocés, sin exagerar.',
		'',
		'QUÉ NECESITÁS PARA SACAR UN TURNO (pedilo de forma conversacional, no como formulario):',
		'1. La especialidad o el profesional con quien quiere atenderse.',
		'2. Una preferencia de día/horario (si no la dice, ofrecé el más cercano).',
		'3. El DNI de **la persona que se va a atender en el consultorio** — puede ser otra persona distinta de quien escribe por WhatsApp (ej. madre saca turno para hijo). Preguntá explícitamente "¿Cuál es el DNI de la persona que se va a atender?" si hace falta.',
		'4. Confirmación de la identidad (mostrás el nombre que figura y pedís un Sí) y confirmación final del turno.',
		'',
		'REGLAS IMPORTANTES:',
		'- El sistema ejecuta endpoints de forma OBLIGATORIA cuando detecta intención (buscar médico, confirmar elección, DNI, etc.). Vos redactás la respuesta humana con esos resultados.',
		'- Tras reservar y enviar el comprobante, la gestión **termina** y se borra la identidad del paciente. Si piden otro turno, es gestión nueva: volvé a pedir el DNI de quien se va a atender aunque sea la misma persona de antes.',
		'- NUNCA volvás a pedir un dato que ya figura en el ESTADO ACTUAL. Si ya elegiste profesional y especialidad, no vuelvas a preguntarlos.',
		'- Interpretá el lenguaje natural del paciente con flexibilidad: correcciones ("me refería a...", "era con...", "no, el otro"), números ("el 2", "la segunda"), nombres parciales, especialidades mezcladas, audios mal transcritos. Vos deducís la intención; el código no parsea frases.',
		'- Cuando la persona menciona un médico por primera vez, usá buscar_profesional. Si hay varias coincidencias, ofrecelas numeradas y quedan en candidatosProfesionales.',
		'- Si esperandoEleccionProfesional es true, el paciente está respondiendo a esa lista. Interpretá su mensaje contra candidatosProfesionales (nombre, apellido, número, especialidad, contexto del chat) y llamá confirmar_profesional_elegido pasando matricula o indice. NO uses listar_profesionales_de_especialidad ni buscar_profesional en ese momento.',
		'- Una vez confirmado el profesional, pasá a preferencia de horario o buscar_turno. No re-preguntes con quién quiere atenderse.',
		'- Cuando exprese cuándo quiere el turno, usá registrar_preferencia_horario, y luego buscar_turno.',
		'- Apenas tengas el DNI, usá identificar_paciente; mostrá el nombre devuelto y pedí confirmación. Cuando confirme, usá confirmar_paciente.',
		'- Ofrecé el turno encontrado con día, fecha, hora y profesional, y pedí confirmación. Si lo confirma y la identidad está confirmada, usá reservar_turno.',
		'- Tras reservar, el sistema envía el comprobante automáticamente: solo dale una despedida breve y cordial, sin repetir todos los datos.',
		'- Si una herramienta devuelve un error, explicá el problema con naturalidad y proponé el siguiente paso.',
		saludo.pautaInstruccion ? `\nSALUDO: ${saludo.pautaInstruccion}` : '',
		nombreContacto
			? `\nLa persona que escribe por WhatsApp se llama: ${nombreContacto}. Eso NO identifica al paciente del turno: siempre pedí el DNI de quien se va a atender.`
			: '',
		esperandoEleccion
			? '\n⚠️ ATENCIÓN: Hay candidatosProfesionales pendientes. El último mensaje del paciente casi seguro es su elección. Interpretalo con inteligencia y confirmá con confirmar_profesional_elegido (matricula o indice). No reinicies la búsqueda.'
			: '',
		'',
		`ESTADO ACTUAL de esta gestión (no lo repitas literal, usalo para no re-preguntar):\n${estadoTxt}`,
	]
		.filter(Boolean)
		.join('\n');
}

// ---------------------------------------------------------------------------
// Bucle principal del agente
// ---------------------------------------------------------------------------
function gptHabilitado() {
	return botOpenai.isConfigured();
}

/**
 * Procesa el último mensaje del paciente y devuelve la respuesta del bot.
 * @returns {Promise<{ respondido: boolean, texto?: string, ticket?: string, finalizar?: boolean, motivo?: string }>}
 */
async function responder({ idConversacion, conv, telefonoWhatsApp, historial, textoEntrada }) {
	if (!gptHabilitado()) {
		return { respondido: false, motivo: 'GPT deshabilitado o sin OPENAI_API_KEY' };
	}

	const config = await botConfigService.getBotConfig();
	const estado = leerEstado(conv);
	const texto = String(textoEntrada || '').trim();

	const ctx = {
		estado,
		conv,
		idConversacion,
		telefonoWhatsApp,
		ticket: null,
		reservaOk: false,
	};

	const previos = botSesionIa.mensajesParaOpenAi(historial || []);

	// Paso 1: clasificar intención → ejecutar endpoint obligatorio antes de conversar.
	let clasificacion = null;
	try {
		clasificacion = await clasificarIntencion({ texto, estado, historial: previos });
		diag.line('agente', 'intencion', {
			intencion: clasificacion.intencion,
			requiere_endpoint: clasificacion.requiere_endpoint,
		});
	} catch (err) {
		diag.warn('agente', 'clasificador falló', { error: err.message });
	}

	const system = construirSystemPrompt({ config, conv, estado });
	const messages = [{ role: 'system', content: system }, ...previos];
	if (!previos.length || previos[previos.length - 1].role !== 'user') {
		messages.push({ role: 'user', content: texto });
	}

	if (clasificacion) {
		const ejecuto = await ejecutarEndpointObligatorio(clasificacion, ctx, messages);
		if (ejecuto) {
			// Actualizar system prompt con estado post-endpoint.
			messages[0] = {
				role: 'system',
				content: construirSystemPrompt({ config, conv, estado }),
			};
		}
	}

	let textoFinal = null;

	for (let i = 0; i < MAX_ITERACIONES_TOOLS; i++) {
		let salida;
		try {
			salida = await botOpenai.chatConHerramientas({ messages, tools: TOOLS });
		} catch (err) {
			diag.warn('agente', 'OpenAI falló', { error: err.message, iter: i });
			return { respondido: false, motivo: `openai: ${err.message}` };
		}

		if (salida.toolCalls.length) {
			// Registrar el turno del asistente con sus tool_calls.
			messages.push({
				role: 'assistant',
				content: salida.content || null,
				tool_calls: salida.toolCalls,
			});
			for (const call of salida.toolCalls) {
				const nombre = call.function?.name;
				let args = {};
				try {
					args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
				} catch {
					args = {};
				}
				let resultado;
				try {
					resultado = await ejecutarHerramienta(nombre, args, ctx);
				} catch (err) {
					resultado = { error: err.message };
				}
				diag.line('agente', 'tool', { nombre, ok: !resultado?.error });
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: JSON.stringify(resultado ?? {}),
				});
			}
			continue; // volver a pedir respuesta al modelo con los resultados
		}

		textoFinal = salida.content;
		break;
	}

	// Si se agotaron las iteraciones sin texto final, forzar una respuesta
	// natural (sin más herramientas) usando los resultados ya obtenidos.
	if (!textoFinal) {
		try {
			const cierre = await botOpenai.chatConHerramientas({
				messages: [
					...messages,
					{
						role: 'system',
						content:
							'Respondé ahora al paciente en lenguaje natural con la información disponible. No llames más herramientas.',
					},
				],
				tools: TOOLS,
				toolChoice: 'none',
			});
			textoFinal = cierre.content;
		} catch (err) {
			diag.warn('agente', 'cierre forzado falló', { error: err.message });
		}
	}

	// Persistir el estado actualizado por las herramientas.
	await guardarEstado(idConversacion, estado);

	if (!textoFinal) {
		textoFinal =
			'Disculpá, no pude completar eso ahora. ¿Me lo repetís o probamos de nuevo en unos segundos?';
	}

	return {
		respondido: true,
		texto: textoFinal,
		ticket: ctx.ticket || null,
		finalizar: Boolean(ctx.reservaOk),
		marcarSaludo: botSesionIa.contextoSaludo(conv).debeSaludar,
	};
}

module.exports = {
	gptHabilitado,
	responder,
	estadoInicial,
	reiniciarEstadoAgente,
	leerEstado,
};
