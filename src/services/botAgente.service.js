/**
 * Agente conversacional de turnos — IA + function-calling.
 *
 * La IA actúa como secretaria: lee el ESTADO editable, usa herramientas (= API interna)
 * y redacta en natural. Sin clasificador ni árbol de reglas por frase.
 */
const botOpenai = require('./botOpenai.service');
const botAgenda = require('./botAgenda.service');
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botSesionIa = require('./botSesionIa.service');
const { extraerDniDesdeTexto } = require('../utils/botDni');
const diag = require('../utils/diagLog');
const agenteTrace = require('../utils/botAgenteTrace');

const MAX_ITERACIONES_TOOLS = 10;
const ULTIMA_RESERVA_VIGENTE_MS = 45 * 60 * 1000;

// ---------------------------------------------------------------------------
// Estado editable (borrador de la gestión)
// ---------------------------------------------------------------------------
function estadoInicial() {
	return {
		paciente: null,
		especialidad: null,
		profesional: null,
		preferencia: null,
		turnoOfrecido: null,
		candidatosProfesionales: [],
		turnosConsultados: [],
		ultimaReserva: null,
		notas: null,
	};
}

function leerEstado(conv) {
	const guardado = conv?.contextoBot?.agente;
	return { ...estadoInicial(), ...(guardado && typeof guardado === 'object' ? guardado : {}) };
}

function snapshotEstado(estado) {
	return {
		paciente: estado.paciente
			? { dni: estado.paciente.dni, nombre: estado.paciente.nombre, confirmado: estado.paciente.confirmado }
			: null,
		especialidad: estado.especialidad?.nombre || null,
		profesional: estado.profesional?.nombre || null,
		preferencia: estado.preferencia?.resumen || null,
		turnoOfrecido: estado.turnoOfrecido
			? `${estado.turnoOfrecido.medico} ${estado.turnoOfrecido.fechaLegible} ${estado.turnoOfrecido.hora}`
			: null,
		candidatos: estado.candidatosProfesionales?.length || 0,
		ultimaReserva: estado.ultimaReserva?.especialidad || null,
		notas: estado.notas || null,
	};
}

function reiniciarEstadoAgente(estado, { conservarUltimaReserva = true } = {}) {
	const ultima = conservarUltimaReserva ? estado.ultimaReserva : null;
	const limpio = estadoInicial();
	for (const k of Object.keys(estado)) delete estado[k];
	Object.assign(estado, limpio);
	if (ultima) estado.ultimaReserva = ultima;
}

async function guardarEstado(idConversacion, estado) {
	await botConversacion.guardarContextoBot(idConversacion, { agente: estado });
}

function esProfesionalHumano(nombre) {
	const n = String(nombre || '')
		.trim()
		.toUpperCase();
	if (!n || n.length < 3) return false;
	if (/^(ELECTRO|EKG|ECG|LABORATORIO|LAB\b|RADIO|TOMO|ECOGRAF|MAPA|HOLTER|RESONANCIA|PLACA)/.test(n)) {
		return false;
	}
	if (/^(CONSULTORIO|SALA|BOX|SECTOR)\b/.test(n)) return false;
	return true;
}

function ultimaReservaVigente(estado) {
	const u = estado.ultimaReserva;
	if (!u?.reservadoEn) return null;
	const t = Date.parse(u.reservadoEn);
	if (!Number.isFinite(t) || Date.now() - t > ULTIMA_RESERVA_VIGENTE_MS) return null;
	return u;
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

async function resolverEspecialidadArg(args, estado) {
	const texto = String(args.especialidad || '').trim();
	if (!texto) return null;
	let esp = await botAgenda.resolverEspecialidadDesdeTexto(texto);
	if (!esp) {
		const intel = await botAgenda.resolverEspecialidadInteligente(texto);
		if (intel?.tipo === 'especialidad') esp = intel.especialidad;
	}
	if (esp) estado.especialidad = { valor: esp.valor, nombre: esp.nombre };
	return esp;
}

async function ejecutarBuscarTurno(args, estado) {
	if (args.especialidad) await resolverEspecialidadArg(args, estado);

	const liberar = args.liberar_profesional === true;
	if (liberar) {
		estado.profesional = null;
		estado.turnoOfrecido = null;
	}

	let matricula = null;
	if (!liberar) {
		matricula = Number(args.profesional_matricula) || estado.profesional?.matricula || null;
	}

	let espValor = estado.especialidad?.valor || null;
	if (!espValor && matricula) {
		const todos = await botAgenda.listarProfesionalesAgendaGlobal();
		const hit = todos.find((p) => Number(p.matricula) === Number(matricula));
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

	const intentos = [];
	const probar = async (opts) => {
		let turno = await botAgenda.sugerirPrimerTurnoDisponible(espValor, opts);
		turno = turno ? await botAgenda.validarSugerenciaTurno(turno, espValor) : null;
		if (turno && !esProfesionalHumano(turno.medico)) {
			intentos.push({ descartado: turno.medico, motivo: 'no_es_medico_humano' });
			return null;
		}
		return turno;
	};

	let turno = await probar(opciones);

	if (!turno && (opciones.preferir?.fechaDesde || opciones.preferir?.fechas?.length)) {
		const sinFecha = {
			...opciones,
			preferir: { ...opciones.preferir, fechaDesde: null, fechaHasta: null, fechas: [] },
		};
		turno = await probar(sinFecha);
	}

	if (!turno && matricula) {
		const sinMedico = { ...opciones, matricula: undefined };
		delete sinMedico.matricula;
		turno = await probar(sinMedico);
		if (turno) intentos.push({ fallback: 'otro_profesional_misma_especialidad' });
	}

	if (!turno) {
		estado.turnoOfrecido = null;
		return { encontrado: false, preferencia: estado.preferencia?.resumen || null, intentos };
	}

	estado.turnoOfrecido = turno;
	if (turno.matricula && !estado.profesional?.matricula) {
		estado.profesional = {
			matricula: turno.matricula,
			nombre: turno.medico,
			especialidadNombre: turno.especialidadNombre || estado.especialidad?.nombre,
		};
	}

	return {
		encontrado: true,
		turno: {
			medico: turno.medico,
			especialidad: turno.especialidadNombre,
			dia: turno.diaSemana,
			fecha: turno.fechaLegible,
			hora: turno.hora,
		},
		intentos: intentos.length ? intentos : undefined,
	};
}

// ---------------------------------------------------------------------------
// Catálogo de herramientas
// ---------------------------------------------------------------------------
const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'listar_especialidades',
			description: 'Lista especialidades con agenda. Efecto: ninguno en estado.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'buscar_profesional',
			description:
				'Busca médicos por apellido/nombre. Efecto: puede setear profesional (único) o candidatosProfesionales (varios).',
			parameters: {
				type: 'object',
				properties: {
					texto: { type: 'string', description: 'Apellido o nombre del médico.' },
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
				'Confirma elección desde candidatosProfesionales (indice o matricula). Efecto: fija profesional y limpia candidatos.',
			parameters: {
				type: 'object',
				properties: {
					indice: { type: 'integer' },
					matricula: { type: 'integer' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'listar_profesionales_de_especialidad',
			description:
				'Lista médicos humanos con agenda en una especialidad. Efecto: setea especialidad y candidatosProfesionales.',
			parameters: {
				type: 'object',
				properties: {
					especialidad: { type: 'string', description: 'Ej: cardiología, clínica, odontología.' },
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
				'Interpreta y guarda preferencia de fecha/hora/urgencia ("martes", "lo antes posible", "para antes no hay"). Efecto: setea preferencia.',
			parameters: {
				type: 'object',
				properties: {
					texto: { type: 'string' },
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
				'Busca el turno libre más cercano según estado. Parámetro liberar_profesional=true busca en TODA la especialidad (otro médico). Efecto: setea turnoOfrecido.',
			parameters: {
				type: 'object',
				properties: {
					especialidad: { type: 'string' },
					profesional_matricula: { type: 'number' },
					liberar_profesional: {
						type: 'boolean',
						description: 'true = no filtrar por médico elegido; buscar el más cercano en la especialidad.',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'reutilizar_paciente_reciente',
			description:
				'Si ultimaReserva en ESTADO es reciente y el paciente pide otro turno para la misma persona, carga identidad confirmada sin pedir DNI otra vez.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'identificar_paciente',
			description: 'Valida DNI en RENAPER/ficha. Efecto: setea paciente (confirmado=false).',
			parameters: {
				type: 'object',
				properties: { dni: { type: 'string' } },
				required: ['dni'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'confirmar_paciente',
			description: 'Confirma o rechaza identidad mostrada. Efecto: paciente.confirmado.',
			parameters: {
				type: 'object',
				properties: { confirmado: { type: 'boolean' } },
				required: ['confirmado'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'reservar_turno',
			description: 'Reserva turnoOfrecido para paciente confirmado. Efecto: reinicia gestión conservando ultimaReserva.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'consultar_turnos_paciente',
			description: 'Lista turnos vigentes del paciente identificado.',
			parameters: { type: 'object', properties: {} },
		},
	},
	{
		type: 'function',
		function: {
			name: 'cancelar_turno',
			description: 'Cancela un turno listado previamente.',
			parameters: {
				type: 'object',
				properties: { idTurno: { type: 'number' } },
				required: ['idTurno'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'actualizar_notas',
			description: 'Guarda contexto libre en estado.notas (síntomas, urgencia, aclaraciones).',
			parameters: {
				type: 'object',
				properties: { texto: { type: 'string' } },
				required: ['texto'],
			},
		},
	},
];

// ---------------------------------------------------------------------------
// Ejecución de herramientas
// ---------------------------------------------------------------------------
async function ejecutarHerramienta(nombre, args, ctx) {
	const { estado, telefonoWhatsApp, idConversacion } = ctx;
	const t0 = Date.now();

	let resultado;
	switch (nombre) {
		case 'listar_especialidades': {
			const lista = await botAgenda.listarEspecialidadesBot();
			resultado = { especialidades: lista.map((e) => e.nombre) };
			break;
		}

		case 'actualizar_notas': {
			estado.notas = String(args.texto || '').trim() || null;
			resultado = { ok: true, notas: estado.notas };
			break;
		}

		case 'reutilizar_paciente_reciente': {
			const u = ultimaReservaVigente(estado);
			if (!u?.dni) {
				resultado = { error: 'No hay reserva reciente para reutilizar identidad.' };
				break;
			}
			estado.paciente = {
				dni: u.dni,
				idPaciente: u.idPaciente,
				nombre: u.nombre,
				confirmado: true,
			};
			if (u.idPaciente) {
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					idPaciente: u.idPaciente,
					dniPaciente: u.dni,
				});
			}
			resultado = { reutilizado: true, nombre: u.nombre, dni: u.dni };
			break;
		}

		case 'buscar_profesional': {
			const texto = String(args.texto || '').trim();
			if (!texto) {
				resultado = { error: 'Falta el nombre a buscar.' };
				break;
			}
			if (estado.candidatosProfesionales?.length && !estado.profesional?.matricula) {
				resultado = {
					error: 'Hay candidatos pendientes. Usá confirmar_profesional_elegido.',
					candidatos: estado.candidatosProfesionales.map((c, i) => ({
						indice: i + 1,
						matricula: c.matricula,
						nombre: c.nombre,
					})),
				};
				break;
			}
			const analisis = await botAgenda.analizarPedidoTurnoConProfesional(texto, {
				especialidadValor: estado.especialidad?.valor ?? null,
			});
			if (analisis.tipo === 'unico') {
				await aplicarProfesionalElegido(estado, {
					matricula: analisis.profesional.matricula,
					nombre: analisis.profesional.nombre,
					especialidadNombre: analisis.especialidad?.nombre || null,
				});
				resultado = { encontrado: 'unico', profesional: estado.profesional };
				break;
			}
			if (analisis.tipo === 'multiples') {
				estado.candidatosProfesionales = analisis.matches
					.filter((m) => esProfesionalHumano(m.nombre))
					.slice(0, 8)
					.map((m) => ({
						matricula: m.matricula,
						nombre: m.nombre,
						especialidadNombre: m.especialidadNombre || null,
					}));
				resultado = { encontrado: 'multiples', coincidencias: estado.candidatosProfesionales };
				break;
			}
			resultado = { encontrado: 'ninguno', busqueda: analisis.busqueda || texto };
			break;
		}

		case 'confirmar_profesional_elegido': {
			if (!estado.candidatosProfesionales?.length) {
				resultado = { error: 'No hay candidatos pendientes.' };
				break;
			}
			let elegido = null;
			if (args.matricula != null) {
				elegido = estado.candidatosProfesionales.find(
					(c) => Number(c.matricula) === Number(args.matricula),
				);
			}
			if (!elegido && args.indice != null) {
				const idx = Number(args.indice) - 1;
				if (idx >= 0 && idx < estado.candidatosProfesionales.length) elegido = estado.candidatosProfesionales[idx];
			}
			if (!elegido) {
				resultado = {
					error: 'Indice o matricula inválidos.',
					candidatos: estado.candidatosProfesionales.map((c, i) => ({
						indice: i + 1,
						matricula: c.matricula,
						nombre: c.nombre,
					})),
				};
				break;
			}
			await aplicarProfesionalElegido(estado, elegido);
			resultado = { confirmado: true, profesional: estado.profesional };
			break;
		}

		case 'listar_profesionales_de_especialidad': {
			const esp = await resolverEspecialidadArg(args, estado);
			if (!esp) {
				resultado = { error: 'No reconocí esa especialidad.' };
				break;
			}
			const { profesionales } = await botAgenda.listarProfesionalesBot(esp.valor);
			estado.candidatosProfesionales = profesionales
				.filter((p) => esProfesionalHumano(p.nombre))
				.slice(0, 12)
				.map((p) => ({
					matricula: p.matricula,
					nombre: p.nombre,
					especialidadNombre: esp.nombre,
				}));
			resultado = {
				especialidad: esp.nombre,
				profesionales: estado.candidatosProfesionales.map((p) => p.nombre),
			};
			break;
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
			if (/urgent|antes|lo antes|apenas|dolor|fiebre/i.test(texto)) {
				estado.notas = [estado.notas, texto].filter(Boolean).join(' | ');
			}
			resultado = {
				registrada: true,
				resumen: estado.preferencia.resumen,
				fechaDesde: estado.preferencia.fechaDesde,
			};
			break;
		}

		case 'buscar_turno':
			resultado = await ejecutarBuscarTurno(args, estado);
			break;

		case 'identificar_paciente': {
			const dni = extraerDniDesdeTexto(String(args.dni || '')) || String(args.dni || '').replace(/\D/g, '');
			if (!dni) {
				resultado = { error: 'El DNI no es válido.' };
				break;
			}
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
				resultado = {
					encontrado: Boolean(nombre),
					nombre,
					fechaNacimiento: estado.paciente.fechaNacimiento,
				};
			} catch (err) {
				resultado = { error: botAgenda.mensajeErrorIdentificacion(err) };
			}
			break;
		}

		case 'confirmar_paciente': {
			if (!estado.paciente) {
				resultado = { error: 'No hay identidad para confirmar.' };
				break;
			}
			if (args.confirmado === false) {
				estado.paciente = null;
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					dniPaciente: null,
					idPaciente: null,
				});
				resultado = { confirmado: false };
				break;
			}
			estado.paciente.confirmado = true;
			if (estado.paciente.idPaciente) {
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					idPaciente: estado.paciente.idPaciente,
					dniPaciente: estado.paciente.dni,
				});
			}
			resultado = { confirmado: true, nombre: estado.paciente.nombre };
			break;
		}

		case 'reservar_turno': {
			if (!estado.paciente?.confirmado || !estado.paciente?.idPaciente) {
				resultado = { error: 'Falta identificar y confirmar al paciente.' };
				break;
			}
			if (!estado.turnoOfrecido?.matricula) {
				resultado = { error: 'No hay turno ofrecido. Usá buscar_turno primero.' };
				break;
			}
			if (!esProfesionalHumano(estado.turnoOfrecido.medico)) {
				resultado = {
					error: 'El turno ofrecido no tiene un médico válido. Buscá con listar_profesionales_de_especialidad.',
				};
				break;
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
				const ultimaReserva = {
					dni: estado.paciente.dni,
					idPaciente: estado.paciente.idPaciente,
					nombre: estado.paciente.nombre,
					especialidad: estado.especialidad?.nombre || t.especialidadNombre,
					medico: reserva?.medico || t.medico,
					reservadoEn: new Date().toISOString(),
				};
				reiniciarEstadoAgente(estado, { conservarUltimaReserva: false });
				estado.ultimaReserva = ultimaReserva;
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					idPaciente: null,
					dniPaciente: null,
				});
				resultado = {
					reservado: true,
					comprobante: reserva?.ticket?.codigo || null,
					ultimaReserva,
				};
			} catch (err) {
				diag.warn('agente', 'reservar_turno falló', { error: err.message });
				resultado = { error: err.message || 'No se pudo reservar.' };
			}
			break;
		}

		case 'consultar_turnos_paciente': {
			if (!estado.paciente?.idPaciente) {
				resultado = { requiere_identidad: true };
				break;
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
				resultado = { cantidad: turnos.length, turnos: estado.turnosConsultados };
			} catch (err) {
				resultado = { error: err.message };
			}
			break;
		}

		case 'cancelar_turno': {
			if (!estado.paciente?.idPaciente) {
				resultado = { requiere_identidad: true };
				break;
			}
			const idTurno = Number(args.idTurno);
			const hit = (estado.turnosConsultados || []).find((t) => Number(t.idTurno) === idTurno);
			if (!hit?.matricula) {
				resultado = { error: 'Turno no encontrado entre los consultados.' };
				break;
			}
			try {
				await botAgenda.cancelarTurnoBot({
					idTurno,
					matricula: Number(hit.matricula),
					idPaciente: estado.paciente.idPaciente,
					telefonoWhatsApp,
					idConversacion,
				});
				estado.turnosConsultados = estado.turnosConsultados.filter(
					(t) => Number(t.idTurno) !== idTurno,
				);
				resultado = { cancelado: true, idTurno };
			} catch (err) {
				resultado = { error: err.message };
			}
			break;
		}

		default:
			resultado = { error: `Herramienta desconocida: ${nombre}` };
	}

	agenteTrace.logToolResult({
		nombre,
		args,
		resultado,
		ms: Date.now() - t0,
		estadoSnapshot: snapshotEstado(estado),
	});

	return resultado;
}

// ---------------------------------------------------------------------------
// Prompt — manual del secretario + catálogo + estado editable
// ---------------------------------------------------------------------------
function catalogoToolsParaPrompt() {
	return TOOLS.map((t) => {
		const f = t.function;
		return `- **${f.name}**: ${f.description}`;
	}).join('\n');
}

function construirSystemPrompt({ config, conv, estado }) {
	const saludo = botSesionIa.contextoSaludo(conv);
	const hoy = botSesionIa.fechaArgentinaHoy();
	const nombreContacto = conv?.nombreContacto ? String(conv.nombreContacto).trim() : null;
	const u = ultimaReservaVigente(estado);

	const estadoCompleto = {
		paciente: estado.paciente,
		especialidad: estado.especialidad,
		profesional: estado.profesional,
		preferencia: estado.preferencia,
		turnoOfrecido: estado.turnoOfrecido,
		candidatosProfesionales: estado.candidatosProfesionales,
		turnosConsultados: estado.turnosConsultados,
		ultimaReserva: u,
		notas: estado.notas,
	};

	return [
		`Sos la secretaria de turnos de *${config.nombreInstitucion}* por WhatsApp. Hoy: ${hoy} (Argentina).`,
		'',
		'Tu trabajo: ayudar a sacar, consultar o cancelar turnos. Hablá natural, breve y empática.',
		'',
		'ESTADO (borrador editable — las herramientas lo modifican; el paciente puede corregir cualquier dato en cualquier momento):',
		'```json',
		JSON.stringify(estadoCompleto, null, 2),
		'```',
		'',
		'INFRAESTRUCTURA (usala como una recepcionista usa el sistema — no inventes turnos ni identidad):',
		catalogoToolsParaPrompt(),
		'',
		'INTEGRIDAD (mínimo indispensable):',
		'- Antes de decir que hay o no hay turno, llamá buscar_turno.',
		'- Antes de reservar, llamá reservar_turno (solo con paciente confirmado).',
		'- No afirmes datos de agenda o identidad sin haber llamado la herramienta.',
		'',
		'COMPORTAMIENTO natural:',
		'- Si habla en primera persona de síntomas ("me duele la cabeza"), asumí que el turno es para quien escribe.',
		'- Solo pedí DNI explícito si menciona a otra persona o necesitás validar identidad para reservar.',
		'- Si rechaza un turno, pide "antes" o "más cercano", usá registrar_preferencia_horario y buscar_turno con liberar_profesional=true si hace falta otro médico.',
		'- Si pide otro turno justo después de confirmar uno, usá reutilizar_paciente_reciente si ultimaReserva es reciente.',
		'- Podés sobreescribir especialidad, profesional o preferencia cuando el paciente corrige.',
		nombreContacto ? `- Quien escribe se llama ${nombreContacto} (WhatsApp); eso no es identidad clínica.` : '',
		saludo.pautaInstruccion ? `Saludo: ${saludo.pautaInstruccion}` : '',
	]
		.filter(Boolean)
		.join('\n');
}

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------
function gptHabilitado() {
	return botOpenai.isConfigured();
}

async function _responderCore({ idConversacion, conv, telefonoWhatsApp, historial, textoEntrada }) {
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
		toolsInvocadas: [],
	};

	const previos = botSesionIa.mensajesParaOpenAi(historial || []);
	const messages = [
		{ role: 'system', content: construirSystemPrompt({ config, conv, estado }) },
		...previos,
	];
	if (!previos.length || previos[previos.length - 1].role !== 'user') {
		messages.push({ role: 'user', content: texto });
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
				ctx.toolsInvocadas.push(nombre);
				let resultado;
				try {
					resultado = await ejecutarHerramienta(nombre, args, ctx);
				} catch (err) {
					resultado = { error: err.message };
				}
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: JSON.stringify(resultado ?? {}),
				});
			}
			messages[0] = {
				role: 'system',
				content: construirSystemPrompt({ config, conv, estado }),
			};
			continue;
		}

		textoFinal = salida.content;
		break;
	}

	if (!textoFinal) {
		try {
			const cierre = await botOpenai.chatConHerramientas({
				messages: [
					...messages,
					{
						role: 'system',
						content: 'Respondé al paciente con la info disponible. No llames más herramientas.',
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
		_tools: ctx.toolsInvocadas,
	};
}

async function responder(opts) {
	const { idConversacion, conv, textoEntrada } = opts;
	const estado = leerEstado(conv);

	if (agenteTrace.enabled()) {
		return agenteTrace.runTurn(
			{
				idConversacion,
				textoEntrada,
				estadoInicial: snapshotEstado(estado),
			},
			() => _responderCore(opts),
		);
	}
	return _responderCore(opts);
}

module.exports = {
	gptHabilitado,
	responder,
	estadoInicial,
	reiniciarEstadoAgente,
	leerEstado,
	snapshotEstado,
};
