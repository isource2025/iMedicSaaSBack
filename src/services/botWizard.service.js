/**
 * Wizard determinístico del bot (RENAPER, confirmación, pasos activos).
 * GPT complementa solo cuando el wizard no resuelve el turno.
 */
const botAgenda = require('./botAgenda.service');
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botIntencion = require('./botIntencion.service');
const botInterpretacion = require('./botInterpretacion.service');
const botHumanizer = require('./botHumanizer.service');
const diag = require('../utils/diagLog');
const { extraerDniDesdeTexto } = require('../utils/botDni');
const botSesionIa = require('./botSesionIa.service');
const botGestionTurno = require('./botGestionTurno.service');

function gptHabilitado() {
	return botInterpretacion.gptHabilitado();
}

const RENAPER_TIMEOUT_MS = Number(process.env.BOT_RENAPER_TIMEOUT_MS || 40_000);

function withTimeout(promise, ms, label = 'operación') {
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => {
				const err = new Error(`${label} timeout (${ms}ms)`);
				err.code = 'RENAPER_TIMEOUT';
				reject(err);
			}, ms);
		}),
	]);
}

function pasosActivos(flujo) {
	return (flujo || []).filter((p) => p.activo !== false);
}

function pasoPorId(flujo, id) {
	return (flujo || []).find((p) => p.id === id) || null;
}

function siguientePasoActivo(flujo, pasoActualId) {
	const activos = pasosActivos(flujo);
	if (!activos.length) return null;
	const idx = activos.findIndex((p) => p.id === pasoActualId);
	if (idx < 0) return activos[0]?.id || null;
	return activos[idx + 1]?.id || null;
}

function pasoInicial(flujo) {
	return pasosActivos(flujo)[0]?.id || 'IDENTIFICAR';
}

function extraerDni(texto) {
	return extraerDniDesdeTexto(texto);
}

function interpretarConfirmacion(texto) {
	const t = String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (/^(si|s|yes|ok|dale|confirmo|correcto|exacto|soy yo|afirmativo|su)$/.test(t)) return true;
	if (/^dale\b/.test(t)) return true;
	if (/^(no|n|nop|incorrecto|otra persona|negativo)$/.test(t)) return false;
	// "no tenés para el miércoles" es pregunta de disponibilidad, no rechazo binario
	if (/\bno\s+tenes?\b/.test(t) || /\bno\s+hay\b/.test(t)) return null;
	if (/\b(si|confirmo|correcto)\b/.test(t)) return true;
	if (/\b(incorrecto|otra persona)\b/.test(t)) return false;
	if (/\b(no confirmo|no quiero|no gracias|no me sirve)\b/.test(t)) return false;
	if (/^no\b/.test(t) && t.length <= 12) return false;
	return null;
}

/** Confirmación binaria: GPT primero; reglas mínimas solo si GPT está apagado. */
async function resolverConfirmacionBinaria({
	texto,
	conv,
	idConversacion,
	pasoBot,
	intencionSi,
	intencionNo,
}) {
	if (gptHabilitado()) {
		const intent = await botIntencion.interpretarIntencion({
			texto,
			conv,
			idConversacion,
			pasoBot,
		});
		if (intent?.intencion === intencionSi) return { conf: true, intent };
		if (intent?.intencion === intencionNo) return { conf: false, intent };
		// Respaldo mínimo solo si GPT no clasificó (p. ej. timeout): sí/no explícito, no lenguaje libre.
		return { conf: interpretarConfirmacion(texto), intent };
	}
	return { conf: interpretarConfirmacion(texto), intent: null };
}

/** Rechazo de turno sugerido: "No", "el lunes no puedo", "otro horario", etc. */
function interpretarRechazoTurno(texto, _sugerencia = null) {
	const conf = interpretarConfirmacion(texto);
	if (conf === true) return false;
	if (conf === false) return true;

	const t = String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (!t) return null;

	if (
		/\b(no puedo|no me sirve|no me conviene|otro dia|otra fecha|otro horario|prefiero otro|buscar otro|siguiente turno|otra opcion|imposible ese|ese horario no|a esa hora no|semana que viene|proxima semana)\b/.test(
			t,
		)
	) {
		return true;
	}

	if (
		/\b(puede ser|podria ser|podes ser|podés ser|preferiria|me vendria bien)\b/.test(t) &&
		/\b(turno|dia|fecha|semana|horario)\b/.test(t)
	) {
		return true;
	}

	if (
		/\b(tenes|tenes|hay|podes|podes|disponible|alguno|alguna)\b/.test(t) &&
		/\b(para|tarde|manana|noche|miercoles|lunes|martes|jueves|viernes|sabado|domingo|horario|turno)\b/.test(
			t,
		)
	) {
		return true;
	}

	if (/\b(a la tarde|por la tarde|por la manana|a la manana|mismo dia|otra hora)\b/.test(t)) {
		return true;
	}

	const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
	const mencionaDia = dias.some((d) => t.includes(d));
	if (mencionaDia && /\b(puedo|podria|me viene bien|disponible)\b/.test(t)) {
		return true;
	}

	for (const dia of dias) {
		if (
			t.includes(dia) &&
			/\b(no puedo|no podria|no voy|imposible|ese dia no|no me sirve)\b/.test(t)
		) {
			return true;
		}
	}

	return null;
}

function nombreCompletoRenaper(renaper, pacienteLocal = null) {
	const apellido = String(renaper?.apellido || '').trim();
	const nombres = String(renaper?.nombres || '').trim();
	return (
		renaper?.nombreCompleto ||
		(apellido && nombres ? `${apellido} ${nombres}` : null) ||
		apellido ||
		nombres ||
		pacienteLocal?.nombre ||
		null
	);
}

/** Confirmación RENAPER: solo nombre completo y fecha de nacimiento. */
function fechaLegibleBot(iso) {
	if (!iso) return null;
	const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return String(iso).trim();
	return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatearPersonaRenaper(renaper, _dni, pacienteLocal = null) {
	const lineas = [];
	const nombre = nombreCompletoRenaper(renaper, pacienteLocal);
	if (nombre) lineas.push(`Nombre: *${nombre}*`);
	const fn =
		renaper?.fechaNacimiento || pacienteLocal?.fechaNacimiento
			? fechaLegibleBot(renaper?.fechaNacimiento || pacienteLocal?.fechaNacimiento)
			: null;
	if (fn) lineas.push(`Fecha de nacimiento: ${fn}`);
	return lineas.join('\n');
}

function primerNombre(nombre) {
	const n = String(nombre || '').trim();
	if (!n) return null;
	return n.split(/\s+/)[0];
}

function nombreWhatsApp(conv) {
	return conv?.nombreContacto ? String(conv.nombreContacto).trim() : null;
}

function aplicarPlantillaMensaje(template, conv) {
	const nombre = primerNombre(nombreWhatsApp(conv));
	let msg = String(template || '');
	if (nombre) {
		msg = msg.replace(/\{nombre\}/gi, nombre);
	} else {
		msg = msg
			.replace(/Perfecto,\s*\{nombre\}\.\s*/gi, 'Perfecto. ')
			.replace(/\{nombre\}/gi, '')
			.replace(/\s{2,}/g, ' ')
			.trim();
	}
	return msg;
}

function pautaPasoFlujo(flujo, pasoId, fallbackPauta = '') {
	const pasoCfg = pasoPorId(flujo, pasoId);
	return (
		pasoCfg?.mensajeUsuario ||
		fallbackPauta ||
		botHumanizer.pautaPorTipo('GENERICO')
	);
}

/** @deprecated Usar pautaPasoFlujo; el texto al paciente lo genera la IA. */
function mensajePasoFlujo(flujo, pasoId, conv, fallback = '') {
	return pautaPasoFlujo(flujo, pasoId, fallback);
}

function resolverMensajePostTurno(flujo, config, conv) {
	const pasoCfg = pasoPorId(flujo, 'TURNO_COMPLETADO');
	return (
		pasoCfg?.mensajeUsuario ||
		config?.mensajes?.agradecimiento ||
		botHumanizer.pautaPorTipo('POST_TURNO')
	);
}

function normalizarTextoBot(texto) {
	return String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

/** El paciente quiere abandonar la gestión de turno (no buscar otra opción). */
function interpretarSalidaFlujo(texto) {
	const t = normalizarTextoBot(texto);
	if (!t) return false;

	if (
		/^(cancela|cancelar|cancelalo|cancel|salir|chau|deja|dejalo|olvida|olvidate|basta|alcanza|no gracias)$/.test(
			t,
		)
	) {
		return true;
	}

	if (
		/\b(no quiero|no necesito|no busco|no voy a sacar|no saco|no reservo)\b/.test(t) &&
		/\b(ningun|ningún|turno|turnos|cita|reserva)\b/.test(t)
	) {
		return true;
	}

	if (/\b(cancelar|cancela|anular|abandonar)\b/.test(t) && /\b(turno|todo|flujo|gestion)\b/.test(t)) {
		return true;
	}

	if (/\b(no quiero|deja|dejá)\b/.test(t) && /\b(nada|seguir|continuar)\b/.test(t)) {
		return true;
	}

	return false;
}

function esSaludoSimple(texto) {
	const t = normalizarTextoBot(texto);
	return /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)[!.?\s]*$/.test(t);
}

function esPasoReservaActivo(pasoActual, conv) {
	if (pasoActual === 'CONFIRMAR' && conv?.contextoBot?.tipo === 'turno_sugerido') return true;
	return [
		'ELEGIR_ESPECIALIDAD',
		'ELEGIR_PROFESIONAL',
		'ELEGIR_FECHA_HORA',
		'ELEGIR_COBERTURA',
	].includes(pasoActual);
}

function mensajeSalidaFlujo(config, conv) {
	return (
		config?.mensajes?.cancelacionFlujo || botHumanizer.pautaPorTipo('SALIDA_FLUJO')
	);
}

async function cancelarFlujoTurnoActivo(idConversacion) {
	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const gestion = botGestionTurno.obtenerGestionActiva(conv);
	if (gestion) {
		botGestionTurno.cerrarGestion(gestion, 'cancelada');
		await botGestionTurno.persistir(idConversacion, conv, gestion);
	}
	await botSesionIa.resetearSesionIa(idConversacion);
	const conv2 = await botConversacion.obtenerConversacion(idConversacion);
	const meta = botSesionIa.extraerMetaPersistente(conv2?.contextoBot);
	await botConversacion.guardarContextoBot(
		idConversacion,
		Object.keys(meta).length ? meta : null,
		{ reemplazar: true },
	);
	await botConversacion.actualizarContextoPaciente(idConversacion, {
		pasoBot: 'inicio',
	});
}

async function procesarSalidaFlujo({
	idConversacion,
	conv,
	config,
	texto,
	pasoActual,
	interpretacion,
}) {
	if (!esPasoReservaActivo(pasoActual, conv)) return null;
	if (!botInterpretacion.debeSalirFlujo(interpretacion, texto)) return null;

	await cancelarFlujoTurnoActivo(idConversacion);
	return {
		handled: true,
		tipoRespuesta: 'SALIDA_FLUJO',
		pauta: mensajeSalidaFlujo(config, conv),
		interpretacion,
	};
}

function withInterpretacion(payload, interpretacion) {
	if (!interpretacion) return payload;
	return { ...payload, interpretacion };
}

/** Cierre cordial (gracias, perfecto solo, etc.) — no reinicia el flujo a DNI. */
function esCierreCordial(texto) {
	const t = normalizarTextoBot(texto);
	if (!t || t.length > 120) return false;
	if (/\b(muchas\s+gracias|mil\s+gracias|gracias|thank\s*you|thanks)\b/.test(t)) return true;
	if (/^(ok|listo|genial|perfecto|excelente|buenisimo|de\s+10|bien|dale)[!.?\s]*$/.test(t)) {
		return true;
	}
	return false;
}

function mensajeBotIndicaTurnoConfirmado(contenido) {
	const t = String(contenido || '');
	return (
		/turno confirmado/i.test(t) ||
		/comprobante\s*:/i.test(t) ||
		/\bT-\d+-\d{8}\b/i.test(t)
	);
}

/**
 * Detecta sesión post-reserva aunque PasoBot quedó desincronizado (CONFIRMAR/inicio).
 */
async function esContextoPostTurno(conv, historialOpcional = null) {
	if (!conv) return false;
	if (conv.pasoBot === 'TURNO_COMPLETADO') return true;

	if (conv.idPaciente && conv.pasoBot === 'CONFIRMAR' && !conv.contextoBot) {
		return true;
	}

	let msgs = historialOpcional;
	if (!msgs && conv.idConversacion) {
		try {
			msgs = await botConversacion.listarMensajes(conv.idConversacion, { limit: 10 });
		} catch {
			msgs = [];
		}
	}
	const ultimosBot = (msgs || []).filter((m) => m.origen === 'BOT').slice(-5);
	return ultimosBot.some((m) => mensajeBotIndicaTurnoConfirmado(m.contenido));
}

async function sincronizarPasoTurnoCompletado(idConversacion, conv) {
	if (conv?.pasoBot === 'TURNO_COMPLETADO') return conv;
	await botConversacion.finalizarTrasReservaExitosa(idConversacion);
	return (await botConversacion.obtenerConversacion(idConversacion)) || conv;
}

function datosConfirmacionRenaper({ renaper, dni, pacienteLocal, pasoCfg }) {
	const fuente = renaper?.fuente === 'local' ? 'ficha local' : 'RENAPER';
	const detalle = formatearPersonaRenaper(renaper, dni, pacienteLocal);
	return {
		fuenteIdentidad: fuente,
		detalleIdentidad: `Encontramos en *${fuente}*:\n${detalle}`,
		pauta:
			pasoCfg?.mensajeUsuario || botHumanizer.pautaPorTipo('CONFIRMAR_IDENTIDAD'),
	};
}

/** @deprecated Usar datosConfirmacionRenaper + generación IA */
function mensajeConfirmacionRenaper(opts) {
	const d = datosConfirmacionRenaper(opts);
	return `${d.detalleIdentidad}\n\n${d.pauta}`;
}

function mensajeErrorAltaPaciente(err) {
	if (err?.code === 'PACIENTE_SIN_SEXO') {
		return 'No pudimos registrar la ficha del paciente: RENAPER no informó el sexo. Contactá admisión para completar el alta.';
	}
	return 'Confirmamos los datos en RENAPER pero no pudimos dar de alta la ficha en el sistema. Intentá de nuevo o contactá admisión.';
}

async function confirmarIdentidadConAlta({ idConversacion, telefonoWhatsApp, dniPaciente }) {
	return botAgenda.identificarPaciente({
		numeroDocumento: dniPaciente,
		telefonoWhatsApp,
		crearSiNoExiste: true,
		forzarAltaLocal: true,
		idConversacion,
		omitirAvancePaso: true,
	});
}

async function consultarRenaperPorDni(dni, telefonoWhatsApp, idConversacion, pasoConfirmarActivo) {
	return botAgenda.identificarPaciente({
		numeroDocumento: dni,
		telefonoWhatsApp,
		crearSiNoExiste: !pasoConfirmarActivo,
		idConversacion,
		omitirAvancePaso: pasoConfirmarActivo,
	});
}

function debeProcesarDni(conv, pasoActual, pasoIdentificar, pasoConfirmarActivo, dni) {
	if (!dni) return false;

	const mismoDni =
		conv?.dniPaciente && String(conv.dniPaciente) === String(dni);

	// Paciente ya vinculado con el mismo DNI: no repetir identificación
	if (conv?.idPaciente && mismoDni) return false;

	if (!conv?.idPaciente) return true;

	if (conv.dniPaciente && !mismoDni) return true;

	if (
		pasoActual === 'IDENTIFICAR' ||
		pasoActual === 'inicio' ||
		pasoActual === 'CONFIRMAR_IDENTIDAD' ||
		!pasoActual
	) {
		return true;
	}

	return false;
}

function necesitaReinicioPorNuevoPaciente(conv, pasoActual, dniEnMensaje) {
	if (!dniEnMensaje) return false;
	return conv.dniPaciente && String(conv.dniPaciente) !== String(dniEnMensaje);
}

async function resolverEspecialidadDesdeIntencionGpt(texto, conv, idConversacion, pasoBot) {
	if (!gptHabilitado()) return null;
	const intent = await botIntencion.interpretarIntencion({
		texto,
		conv,
		idConversacion,
		pasoBot,
	});
	if (!intent) return null;
	const res = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
	if (res?.tipo !== 'especialidad') return null;
	return { valor: res.especialidad.valor, nombre: res.especialidad.nombre };
}

async function iniciarFlujoNuevoTurno({ idConversacion, conv, flujo, espPend = null, conSaludo = true }) {
	const pasoIdentificar = pasoPorId(flujo, 'IDENTIFICAR');
	await botConversacion.reiniciarFlujoNuevoTurno(idConversacion, 'IDENTIFICAR');
	if (espPend) {
		await botConversacion.guardarContextoBot(idConversacion, { especialidadPendiente: espPend });
	}
	const saludo = conSaludo ? primerNombre(nombreWhatsApp(conv)) : null;
	const tipo = conSaludo ? 'INICIO_FLUJO' : 'PEDIR_DNI';
	return {
		tipoRespuesta: tipo,
		pauta:
			pasoIdentificar?.mensajeUsuario || botHumanizer.pautaPorTipo(tipo),
		datosOperativos: saludo ? { nombreSaludo: saludo } : null,
	};
}

async function responderListaEspecialidades() {
	const lista = await botAgenda.listarEspecialidadesBot();
	return {
		handled: true,
		tipoRespuesta: 'LISTA_ESPECIALIDADES',
		pauta: botHumanizer.pautaPorTipo('LISTA_ESPECIALIDADES'),
		datosOperativos: {
			lista: (lista || []).map((e) => `• ${e.nombre}`).join('\n'),
		},
	};
}

async function procesarIntencionGptEntrada({
	idConversacion,
	telefonoWhatsApp,
	conv,
	flujo,
	texto,
	pasoActual,
	pasoIdentificar,
	interpretacion: interpretacionPrecalculada,
}) {
	if (pasoIdentificar?.activo === false) return null;

	if (!gptHabilitado()) return null;

	if ((await esContextoPostTurno(conv)) && esCierreCordial(texto)) {
		await sincronizarPasoTurnoCompletado(idConversacion, conv);
		return {
			handled: true,
			tipoRespuesta: 'POST_TURNO',
			pauta: resolverMensajePostTurno(flujo, await botConfigService.getBotConfig(), conv),
		};
	}

	const pasoGpt =
		pasoActual === 'CONFIRMAR' && conv?.contextoBot?.tipo !== 'turno_sugerido'
			? 'IDENTIFICAR'
			: pasoActual;
	if (!botIntencion.esPasoIdentificacionLibre(pasoActual, conv)) return null;

	const intent =
		interpretacionPrecalculada ||
		(await botIntencion.interpretarIntencion({
			texto,
			conv,
			idConversacion,
			pasoBot: pasoGpt,
		}));
	if (!intent?.intencion) return null;

	diag.line('wizard', 'Intención GPT', {
		idConversacion,
		paso: pasoActual,
		intencion: intent.intencion,
		resumen: intent.parametros?.resumen || null,
	});

	if (intent.intencion === 'solicitar_turno') {
		if ((await esContextoPostTurno(conv)) && esCierreCordial(texto)) {
			await sincronizarPasoTurnoCompletado(idConversacion, conv);
			return {
				handled: true,
				tipoRespuesta: 'POST_TURNO',
				pauta: resolverMensajePostTurno(
					flujo,
					await botConfigService.getBotConfig(),
					conv,
				),
			};
		}

		const configTurno = await botConfigService.getBotConfig();
		if (intent.parametros?.profesional || intent.parametros?.medico) {
			const pedidoProf = await procesarPedidoConProfesional({
				idConversacion,
				telefonoWhatsApp,
				conv,
				flujo,
				config: configTurno,
				texto,
				interpretacion: intent,
			});
			if (pedidoProf) {
				return { ...pedidoProf, interpretacion: intent };
			}
		}

		let espPend = null;
		const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
		if (resEsp?.tipo === 'especialidad') {
			espPend = { valor: resEsp.especialidad.valor, nombre: resEsp.especialidad.nombre };
		}
		const inicio = await iniciarFlujoNuevoTurno({ idConversacion, conv, flujo, espPend });
		return {
			handled: true,
			interpretacion: intent,
			...inicio,
		};
	}

	if (intent.intencion === 'agradecimiento' || esCierreCordial(texto)) {
		const config = await botConfigService.getBotConfig();
		await sincronizarPasoTurnoCompletado(idConversacion, conv);
		return {
			handled: true,
			tipoRespuesta: 'POST_TURNO',
			pauta: resolverMensajePostTurno(flujo, config, conv),
			interpretacion: intent,
		};
	}

	if (intent.intencion === 'listar_especialidades') {
		return responderListaEspecialidades();
	}

	if (intent.intencion === 'listar_profesionales') {
		const resProf = await botIntencion.resolverProfesionalesDesdeIntencion(intent);
		if (resProf.tipo === 'profesionales') {
			await botConversacion.guardarContextoBot(idConversacion, {
				especialidadPendiente: {
					valor: resProf.especialidad.valor,
					nombre: resProf.especialidad.nombre,
				},
			});
			return {
				handled: true,
				texto: await mostrarProfesionalesEspecialidad(idConversacion, resProf.especialidad.valor),
			};
		}
		return {
			handled: true,
			texto:
				'¿En qué especialidad querés ver los profesionales? Por ejemplo: *Traumatología*, *Cardiología*…',
		};
	}

	if (intent.intencion === 'elegir_especialidad') {
		const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
		if (resEsp?.tipo === 'especialidad') {
			const espPend = { valor: resEsp.especialidad.valor, nombre: resEsp.especialidad.nombre };
			await botConversacion.guardarContextoBot(idConversacion, { especialidadPendiente: espPend });
			const configEsp = await botConfigService.getBotConfig();
			if (configEsp.reglas.sugerirPrimerTurnoDisponible && conv.idPaciente) {
				return withInterpretacion(
					await armarRespuestaBuscarTurnoInicial({
						idConversacion,
						telefonoWhatsApp,
						flujo,
						esp: espPend,
						conv,
					}),
					intent,
				);
			}
			if (pasoPorId(flujo, 'ELEGIR_PROFESIONAL')?.activo !== false) {
				return {
					handled: true,
					texto: await mostrarProfesionalesEspecialidad(idConversacion, espPend.valor),
				};
			}
			if (botIntencion.esPasoIdentificacionLibre(pasoActual, conv)) {
				const inicio = await iniciarFlujoNuevoTurno({
					idConversacion,
					conv,
					flujo,
					espPend,
					conSaludo: false,
				});
				return { handled: true, ...inicio };
			}
			return null;
		}
	}

	if (intent.intencion === 'conversacion') {
		return { handled: false, motivo: 'gpt-conversacion' };
	}

	return null;
}

async function detectarEspecialidadEnTexto(texto, conv, idConversacion, pasoBot) {
	if (!texto || extraerDni(texto)) return null;

	const esp = await botAgenda.resolverEspecialidadDesdeTexto(texto);
	if (esp) return { valor: esp.valor, nombre: esp.nombre };

	return resolverEspecialidadDesdeIntencionGpt(texto, conv, idConversacion, pasoBot);
}

async function capturarEspecialidadPendienteDesdeMensaje(idConversacion, conv, texto, pasoBot) {
	const esp = await detectarEspecialidadEnTexto(texto, conv, idConversacion, pasoBot);
	if (!esp) return null;

	let gestion = botGestionTurno.ensureGestion(conv);
	if (!gestion.profesional?.confirmada) {
		gestion.especialidad = {
			valor: esp.valor,
			nombre: esp.nombre,
			origen: 'paciente',
			confirmada: true,
		};
	} else if (!gestion.especialidad?.valor) {
		gestion.especialidad = {
			valor: esp.valor,
			nombre: esp.nombre,
			origen: 'inferida_profesional',
			confirmada: true,
		};
	}

	const ctx = botGestionTurno.sincronizarLegacy(conv?.contextoBot, gestion);
	await botConversacion.guardarContextoBot(idConversacion, ctx);
	botGestionTurno.dbg('especialidad capturada sin perder profesional', {
		esp: esp.nombre,
		prof: gestion.profesional?.nombre,
	});
	return esp;
}

function preservarContextoTurnoPendiente(conv) {
	const ctx = conv?.contextoBot || {};
	const meta = botSesionIa.extraerMetaPersistente(ctx);
	const out = { ...meta };
	if (ctx.sesionInterpretacion) out.sesionInterpretacion = ctx.sesionInterpretacion;
	if (ctx.gestionTurno && !['completada', 'cancelada'].includes(ctx.gestionTurno.estado)) {
		out.gestionTurno = ctx.gestionTurno;
	}
	if (ctx.especialidadPendiente?.valor) out.especialidadPendiente = ctx.especialidadPendiente;
	if (ctx.profesionalPendiente?.matricula) out.profesionalPendiente = ctx.profesionalPendiente;
	return out;
}

async function guardarContextoTurnoPendiente(idConversacion, conv) {
	const ctx = preservarContextoTurnoPendiente(conv);
	await botConversacion.guardarContextoBot(idConversacion, Object.keys(ctx).length ? ctx : null);
	return ctx;
}

function esSeleccionNumerada(texto) {
	return /^\d{1,2}\.?\s*$/.test(String(texto || '').trim());
}

function esRespuestaConfirmacionBinaria(texto, pasoActual) {
	if (pasoActual !== 'CONFIRMAR_IDENTIDAD') return false;
	if (esSeleccionNumerada(texto)) return false;
	return interpretarConfirmacion(texto) !== null;
}

async function mostrarProfesionalesEspecialidad(idConversacion, espValor) {
	await botConversacion.actualizarContextoPaciente(idConversacion, {
		pasoBot: 'ELEGIR_PROFESIONAL',
	});
	return botAgenda.mensajeProfesionalesDisponibles(espValor);
}

async function procesarEleccionProfesional({
	idConversacion,
	telefonoWhatsApp,
	conv,
	flujo,
	texto,
}) {
	const espPend = conv?.contextoBot?.especialidadPendiente;
	const candidatos = conv?.contextoBot?.candidatosProfesionales;
	if (!texto || extraerDni(texto)) return null;

	const numMatch = String(texto || '')
		.trim()
		.match(/^(\d{1,2})\.?\s*$/);
	if (numMatch && Array.isArray(candidatos) && candidatos.length) {
		const idx = Number(numMatch[1]) - 1;
		const elegido = candidatos[idx];
		if (elegido) {
			await botConversacion.guardarContextoBot(idConversacion, {
				especialidadPendiente: {
					valor: elegido.especialidad,
					nombre: elegido.especialidadNombre,
				},
				profesionalPendiente: { matricula: elegido.matricula, nombre: elegido.nombre },
				candidatosProfesionales: null,
			});
			const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
			const config = await botConfigService.getBotConfig();
			const saludo = primerNombre(nombreWhatsApp(convAct));
			const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';
			if (convAct.idPaciente && config.reglas.sugerirPrimerTurnoDisponible) {
				return await armarRespuestaBuscarTurnoInicial({
					idConversacion,
					telefonoWhatsApp,
					flujo,
					esp: { valor: elegido.especialidad, nombre: elegido.especialidadNombre },
					avisoPrefijo: prefijoSaludo,
					matricula: elegido.matricula,
					medico: elegido.nombre,
					conv: convAct,
				});
			}
		}
	}

	if (!espPend?.valor || !texto) return null;

	const pasoActual = conv?.pasoBot;
	if (pasoActual === 'CONFIRMAR_IDENTIDAD' || esRespuestaConfirmacionBinaria(texto, pasoActual)) {
		return null;
	}

	const pasoProf = pasoPorId(flujo, 'ELEGIR_PROFESIONAL');
	if (pasoProf?.activo === false) return null;

	const enPasoProf = pasoActual === 'ELEGIR_PROFESIONAL';
	if (!enPasoProf && !esSeleccionNumerada(texto) && textoPideTurnoExplicito(texto)) return null;

	const prof = await botAgenda.resolverProfesionalDesdeTexto(texto, espPend.valor);
	if (!prof) return null;

	await botConversacion.guardarContextoBot(idConversacion, {
		especialidadPendiente: espPend,
		profesionalPendiente: { matricula: prof.matricula, nombre: prof.nombre },
	});

	const saludo = primerNombre(nombreWhatsApp(conv));
	const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';
	const config = await botConfigService.getBotConfig();

	if (conv.idPaciente) {
		if (config.reglas.sugerirPrimerTurnoDisponible) {
			return await armarRespuestaBuscarTurnoInicial({
				idConversacion,
				telefonoWhatsApp,
				flujo,
				esp: espPend,
				avisoPrefijo: prefijoSaludo,
				matricula: prof.matricula,
				medico: prof.nombre,
				conv,
			});
		}
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			idPaciente: conv.idPaciente,
			pasoBot: 'ELEGIR_FECHA_HORA',
		});
		return {
			handled: true,
			texto: `${prefijoSaludo}Continuemos con *${prof.nombre}*. Indicá qué día preferís o escribí *disponibilidad* para ver horarios.`,
		};
	}

	await botConversacion.actualizarContextoPaciente(idConversacion, {
		pasoBot: 'IDENTIFICAR',
	});

	const pasoId = pasoPorId(flujo, 'IDENTIFICAR');
	const msg =
		pasoId?.mensajeUsuario ||
		'Indicá el DNI de la persona que va a atenderse.';
	return {
		handled: true,
		texto: `${prefijoSaludo}Elegiste *${prof.nombre}*. ${msg}`,
	};
}

function textoPideTurnoExplicito(texto) {
	return /\b(turno|reserv|reserva|sacar|pedir|agendar|solicit|sacame|sacarle)\b/i.test(
		String(texto || ''),
	);
}

function textoSugierePedidoConProfesional(texto) {
	if (!texto) return false;
	if (textoPideTurnoExplicito(texto)) return true;
	if (/\b(dr|dra|doctor|doctora|profesional|medico|medicos)\b/i.test(texto)) return true;
	if (/\bcon\s+[a-záéíóúñ]{2,}/i.test(texto)) return true;
	return false;
}

async function procesarPedidoConProfesional({
	idConversacion,
	telefonoWhatsApp,
	conv,
	flujo,
	config,
	texto,
	interpretacion,
}) {
	if (!texto || extraerDni(texto)) return null;

	let analisis = null;
	if (textoSugierePedidoConProfesional(texto)) {
		analisis = await botAgenda.analizarPedidoTurnoConProfesional(texto, {
			especialidadCtx: conv?.contextoBot?.especialidadPendiente,
			interpretacion,
		});
	} else {
		const probe = await botAgenda.buscarProfesionalesPorNombre(texto);
		if (!probe.length) return null;
		analisis = await botAgenda.analizarPedidoTurnoConProfesional(texto, {
			especialidadCtx: conv?.contextoBot?.especialidadPendiente,
			interpretacion,
		});
	}

	if (!analisis || analisis.tipo === 'sin_datos') return null;

	const saludo = primerNombre(nombreWhatsApp(conv));
	const prefijo = saludo ? `Perfecto, ${saludo}. ` : '';

	if (analisis.tipo === 'unico') {
		const esp = analisis.especialidad;
		const prof = analisis.profesional;
		let gestion = botGestionTurno.ensureGestion(conv);
		gestion = botGestionTurno.mergeDesdeHerramientas(gestion, [
			{ ok: true, nombre: 'buscar_profesional', datos: analisis },
		]);
		const prefLocal = botAgenda.interpretarAjusteTurno(texto, null);
		if (prefLocal.resumen || prefLocal.preferir?.fechaDesde || prefLocal.preferir?.franja) {
			gestion = botGestionTurno.mergeDesdeHerramientas(gestion, [
				{
					ok: true,
					nombre: 'interpretar_preferencia_horario',
					datos: {
						resumen: prefLocal.resumen,
						fechaDesde: prefLocal.preferir?.fechaDesde || prefLocal.preferir?.fechas?.[0] || null,
						fechaHasta: prefLocal.preferir?.fechaHasta || null,
						franja: prefLocal.preferir?.franja || null,
						diasSemana: prefLocal.preferir?.diasSemana || [],
					},
				},
			]);
		}
		const ctx = botGestionTurno.sincronizarLegacy(conv?.contextoBot, gestion);
		await botConversacion.guardarContextoBot(idConversacion, ctx);
		botGestionTurno.dbg('pedido con profesional', botGestionTurno.resumenParaPrompt(gestion));

		if (conv.idPaciente && config.reglas.sugerirPrimerTurnoDisponible) {
			const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
			return withInterpretacion(
				await armarRespuestaBuscarTurnoInicial({
					idConversacion,
					telefonoWhatsApp,
					flujo,
					esp,
					avisoPrefijo: prefijo,
					matricula: prof.matricula,
					medico: prof.nombre,
					conv: convAct,
				}),
				interpretacion,
			);
		}

		const pasoId = pasoPorId(flujo, 'IDENTIFICAR');
		const msg =
			pasoId?.mensajeUsuario ||
			'Para continuar, indicá el DNI de la persona que va a atenderse.';
		return withInterpretacion(
			{
				handled: true,
				tipoRespuesta: 'INICIO_FLUJO',
				texto: `${prefijo}Anoté turno con *${prof.nombre}* en *${esp.nombre}*. ${msg}`,
			},
			interpretacion,
		);
	}

	if (analisis.tipo === 'multiples') {
		await botConversacion.guardarContextoBot(idConversacion, {
			candidatosProfesionales: analisis.matches.slice(0, 8),
		});
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: 'ELEGIR_PROFESIONAL',
		});
		return withInterpretacion(
			{
				handled: true,
				tipoRespuesta: 'LISTA_PROFESIONALES',
				texto: botAgenda.mensajeListaProfesionalesCoincidencias(analisis.matches),
			},
			interpretacion,
		);
	}

	if (analisis.tipo === 'no_encontrado') {
		return withInterpretacion(
			{
				handled: true,
				tipoRespuesta: 'ACLARACION',
				texto: analisis.especialidad
					? `No encontré un profesional con ese nombre en *${analisis.especialidad.nombre}*. ¿Podés repetir el apellido?`
					: 'No encontré ese profesional en la agenda. ¿Podés indicar el apellido completo o la especialidad?',
			},
			interpretacion,
		);
	}

	return null;
}

async function armarRespuestaBuscarTurnoInicial({
	idConversacion,
	telefonoWhatsApp,
	flujo,
	esp,
	avisoPrefijo = '',
	matricula = null,
	medico = null,
	conv = null,
}) {
	const pasoConfirmar = pasoPorId(flujo, 'CONFIRMAR');
	const buscarTurno = {
		tipo: 'inicial',
		idConversacion,
		telefonoWhatsApp,
		especialidadValor: esp.valor,
		especialidadNombre: esp.nombre,
		matricula: matricula || undefined,
		medico: medico || undefined,
		pasoConfirmarId: pasoConfirmar?.id || 'CONFIRMAR',
	};
	const convUse =
		conv || (idConversacion ? await botConversacion.obtenerConversacion(idConversacion) : null);
	if (convUse) {
		const gestion =
			botGestionTurno.obtenerGestionActiva(convUse) || botGestionTurno.ensureGestion(convUse);
		const { excluir, preferir } = botGestionTurno.aPreferenciasBusqueda(gestion);
		if (preferir.fechaDesde || preferir.fechas?.length || preferir.franja) {
			buscarTurno.preferir = preferir;
		}
		if (excluir.slots?.length || excluir.fechas?.length) {
			buscarTurno.excluir = excluir;
		}
	}
	return {
		handled: true,
		accion: 'BUSCAR_TURNO',
		avisoPauta: botHumanizer.pautaPorTipo('AVISO_BUSQUEDA'),
		buscarTurno,
	};
}

function mensajeErrorRenaper(err) {
	if (err?.code === 'RENAPER_TIMEOUT') {
		return 'La consulta a RENAPER tardó demasiado. Intentá enviar tu DNI de nuevo en unos segundos.';
	}
	if (err?.code === 'RENAPER_NO_ENCONTRADO') {
		return 'No encontramos ese DNI en el sistema. Verificá el número e intentá de nuevo.';
	}
	if (err?.code === 'RENAPER_UNAVAILABLE' || err?.code === 'RENAPER_HTTP') {
		return 'No pudimos consultar RENAPER en este momento. Intentá de nuevo en unos segundos.';
	}
	if (err?.code === 'DNI_INVALIDO') {
		return 'El DNI indicado no es válido. Verificá el número e intentá de nuevo.';
	}
	return 'No pudimos validar tu DNI en este momento. Intentá de nuevo en unos segundos.';
}

async function _respuestaIdentificacionOk({
	data,
	dni,
	conv,
	flujo,
	idConversacion,
	pasoConfirmarActivo,
}) {
	const identificado = data.renaper?.encontrado || data.pacienteLocal?.existe;
	if (!identificado) return null;

	if (pasoConfirmarActivo) {
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD');
		const ctxPreservar = preservarContextoTurnoPendiente(conv);
		let gestion = ctxPreservar.gestionTurno || botGestionTurno.ensureGestion(conv);
		gestion = botGestionTurno.mergeIdentidadRenaper(gestion, {
			dni: String(dni),
			nombre: nombreCompletoRenaper(data.renaper, data.pacienteLocal),
			fechaNacimiento:
				data.renaper?.fechaNacimiento || data.pacienteLocal?.fechaNacimiento || null,
			fuente: data.renaper?.fuente === 'local' ? 'local' : 'renaper',
		});
		ctxPreservar.gestionTurno = gestion;
		if (conv.idPaciente || conv.contextoBot) {
			await botConversacion.limpiarEstadoWizard(idConversacion);
			if (Object.keys(ctxPreservar).length) {
				await botConversacion.guardarContextoBot(idConversacion, ctxPreservar);
			}
		} else {
			await botConversacion.guardarContextoBot(
				idConversacion,
				Object.keys(ctxPreservar).length ? ctxPreservar : null,
			);
		}
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			dniPaciente: String(dni),
			pasoBot: 'CONFIRMAR_IDENTIDAD',
			idPaciente: null,
		});
		const conf = datosConfirmacionRenaper({
			renaper: data.renaper,
			dni,
			pacienteLocal: data.pacienteLocal,
			pasoCfg,
		});
		return {
			handled: true,
			tipoRespuesta: 'CONFIRMAR_IDENTIDAD',
			pauta: conf.pauta,
			datosOperativos: {
				fuenteIdentidad: conf.fuenteIdentidad,
				detalleIdentidad: conf.detalleIdentidad,
			},
		};
	}

	const siguiente = siguientePasoActivo(flujo, 'IDENTIFICAR');
	const pasoCfg = pasoPorId(flujo, siguiente);
	const tipoSig =
		siguiente === 'ELEGIR_ESPECIALIDAD' ? 'PEDIR_ESPECIALIDAD' : 'GENERICO';
	return {
		handled: true,
		tipoRespuesta: tipoSig,
		pauta: pasoCfg?.mensajeUsuario || botHumanizer.pautaPorTipo(tipoSig),
		datosOperativos: saludoIdentidad(conv),
	};
}

function saludoIdentidad(conv) {
	const saludo = primerNombre(nombreWhatsApp(conv));
	return saludo ? { nombreSaludo: saludo } : null;
}

async function avanzarTrasIdentidadConfirmada({
	idConversacion,
	telefonoWhatsApp,
	flujo,
	config,
	conv,
	espPend,
	profPend,
	idPaciente,
}) {
	const saludo = primerNombre(nombreWhatsApp(conv));
	const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';
	const gestion = botGestionTurno.obtenerGestionActiva(conv);
	const prof =
		profPend ||
		conv?.contextoBot?.profesionalPendiente ||
		(gestion?.profesional?.confirmada ? gestion.profesional : null) ||
		null;
	const esp =
		espPend ||
		conv?.contextoBot?.especialidadPendiente ||
		(gestion?.especialidad?.confirmada
			? { valor: gestion.especialidad.valor, nombre: gestion.especialidad.nombre }
			: null) ||
		null;

	if (botAgenda.coberturaPasoHabilitado(flujo, config)) {
		const pasoCob = pasoPorId(flujo, 'ELEGIR_COBERTURA');
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			idPaciente,
			pasoBot: 'ELEGIR_COBERTURA',
		});
		const msg = await botAgenda.mensajePasoCobertura(pasoCob, idPaciente);
		return {
			handled: true,
			texto: `${prefijoSaludo}${msg}`,
		};
	}

	if (
		esp?.valor &&
		config.reglas.sugerirPrimerTurnoDisponible &&
		pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false &&
		!prof
	) {
		return await armarRespuestaBuscarTurnoInicial({
			idConversacion,
			telefonoWhatsApp,
			flujo,
			esp,
			avisoPrefijo: prefijoSaludo,
			conv,
		});
	}

	if (esp?.valor && prof) {
		await botConversacion.guardarContextoBot(idConversacion, {
			especialidadPendiente: esp,
			profesionalPendiente: prof,
			...(gestion ? { gestionTurno: gestion } : {}),
		});
		if (config.reglas.sugerirPrimerTurnoDisponible) {
			return await armarRespuestaBuscarTurnoInicial({
				idConversacion,
				telefonoWhatsApp,
				flujo,
				esp,
				avisoPrefijo: prefijoSaludo,
				matricula: prof.matricula,
				medico: prof.nombre,
				conv,
			});
		}
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			idPaciente,
			pasoBot: 'ELEGIR_FECHA_HORA',
		});
		return {
			handled: true,
			texto: `${prefijoSaludo}Continuemos con *${prof.nombre}*. Indicá qué día preferís o escribí *disponibilidad* para ver horarios.`,
		};
	}

	let siguiente = siguientePasoActivo(flujo, 'CONFIRMAR_IDENTIDAD');
	if (
		config.reglas.sugerirPrimerTurnoDisponible &&
		pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
	) {
		siguiente = 'ELEGIR_ESPECIALIDAD';
	}
	await botConversacion.actualizarContextoPaciente(idConversacion, {
		idPaciente,
		pasoBot: siguiente,
	});
	return {
		handled: true,
		texto:
			siguiente === 'ELEGIR_ESPECIALIDAD'
				? mensajePasoFlujo(flujo, siguiente, conv, '¿Qué especialidad necesitás?')
				: mensajePasoFlujo(flujo, siguiente, conv, 'Continuemos con tu turno.'),
	};
}

async function avanzarTrasCobertura({
	idConversacion,
	telefonoWhatsApp,
	flujo,
	config,
	conv,
	espPend,
	idPaciente,
	nombreCobertura,
}) {
	const saludo = primerNombre(nombreWhatsApp(conv));
	const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';
	const coberturaMsg = nombreCobertura
		? `Registramos cobertura: *${nombreCobertura}*.\n\n`
		: '';

	if (
		espPend?.valor &&
		config.reglas.sugerirPrimerTurnoDisponible &&
		pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
	) {
		return await armarRespuestaBuscarTurnoInicial({
			idConversacion,
			telefonoWhatsApp,
			flujo,
			esp: espPend,
			avisoPrefijo: `${prefijoSaludo}${coberturaMsg}`,
			conv,
		});
	}

	let siguiente = siguientePasoActivo(flujo, 'ELEGIR_COBERTURA');
	if (
		config.reglas.sugerirPrimerTurnoDisponible &&
		pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
	) {
		siguiente = 'ELEGIR_ESPECIALIDAD';
	}
	await botConversacion.actualizarContextoPaciente(idConversacion, {
		idPaciente,
		pasoBot: siguiente,
	});
	const msgEsp =
		siguiente === 'ELEGIR_ESPECIALIDAD'
			? mensajePasoFlujo(flujo, siguiente, conv, '¿Qué especialidad necesitás?')
			: mensajePasoFlujo(flujo, siguiente, conv, '¿Qué especialidad necesitás?');
	return {
		handled: true,
		texto: coberturaMsg ? `${prefijoSaludo}${coberturaMsg}${msgEsp}` : msgEsp,
	};
}

async function procesarPasoTurnoCompletado({
	idConversacion,
	telefonoWhatsApp,
	conv,
	flujo,
	config,
	texto,
}) {
	if (esCierreCordial(texto)) {
		return { handled: true, texto: resolverMensajePostTurno(flujo, config, conv) };
	}

	if (!gptHabilitado()) {
		return { handled: true, texto: resolverMensajePostTurno(flujo, config, conv) };
	}

	const intent = await botIntencion.interpretarIntencion({
		texto,
		conv,
		idConversacion,
		pasoBot: 'TURNO_COMPLETADO',
	});

	if (
		intent?.intencion === 'agradecimiento' ||
		intent?.intencion === 'conversacion' ||
		esCierreCordial(texto)
	) {
		return { handled: true, texto: resolverMensajePostTurno(flujo, config, conv) };
	}

	if (intent?.intencion === 'listar_especialidades') {
		return {
			handled: true,
			texto: botAgenda.mensajeEspecialidadesDisponibles(await botAgenda.listarEspecialidadesBot()),
		};
	}

	if (intent?.intencion === 'solicitar_turno' || intent?.intencion === 'elegir_especialidad') {
		let espPend = null;
		const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
		if (resEsp?.tipo === 'especialidad') {
			espPend = { valor: resEsp.especialidad.valor, nombre: resEsp.especialidad.nombre };
		}

		if (conv.idPaciente) {
			await botConversacion.guardarContextoBot(
				idConversacion,
				espPend ? { especialidadPendiente: espPend } : null,
			);
			if (
				espPend?.valor &&
				config.reglas.sugerirPrimerTurnoDisponible &&
				pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
			) {
				return await armarRespuestaBuscarTurnoInicial({
					idConversacion,
					telefonoWhatsApp,
					flujo,
					esp: espPend,
					conv,
				});
			}
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: 'ELEGIR_ESPECIALIDAD',
			});
			return {
				handled: true,
				tipoRespuesta: 'PEDIR_ESPECIALIDAD',
				pauta: pautaPasoFlujo(flujo, 'ELEGIR_ESPECIALIDAD'),
			};
		}

		const inicio = await iniciarFlujoNuevoTurno({
			idConversacion,
			conv,
			flujo,
			espPend,
		});
		return { handled: true, ...inicio };
	}

	return {
		handled: true,
		tipoRespuesta: 'POST_TURNO',
		pauta: resolverMensajePostTurno(flujo, config, conv),
	};
}

async function procesarIdentificacionDni({
	idConversacion,
	telefonoWhatsApp,
	dni,
	conv,
	flujo,
	pasoConfirmarActivo,
}) {
	if (conv.dniPaciente && String(conv.dniPaciente) !== String(dni)) {
		const ctxPreservar = preservarContextoTurnoPendiente(conv);
		await botConversacion.reiniciarFlujoNuevoTurno(idConversacion, 'IDENTIFICAR');
		if (Object.keys(ctxPreservar).length) {
			await botConversacion.guardarContextoBot(idConversacion, ctxPreservar);
		}
		conv = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	}

	let errLocal = null;

	try {
		diag.line('wizard', '[ficha_local] Buscando por DNI', { dni, idConversacion });
		const dataLocal = await botAgenda.identificarPaciente({
			numeroDocumento: dni,
			telefonoWhatsApp,
			crearSiNoExiste: false,
			idConversacion,
			omitirAvancePaso: pasoConfirmarActivo,
			fase: 'local',
		});
		diag.line('wizard', '[ficha_local] Resultado', {
			dni,
			existe: !!dataLocal.pacienteLocal?.existe,
			nombre: dataLocal.pacienteLocal?.nombre || null,
		});

		const respLocal = await _respuestaIdentificacionOk({
			data: dataLocal,
			dni,
			conv,
			flujo,
			idConversacion,
			pasoConfirmarActivo,
		});
		if (respLocal) return respLocal;
	} catch (err) {
		errLocal = err;
		diag.warn('wizard', '[ficha_local] Error', {
			dni,
			code: err.code,
			fuente: err.fuente,
			error: err.message,
		});
	}

	try {
		diag.line('wizard', '[renaper] Consultando', { dni, idConversacion });
		const dataRenaper = await withTimeout(
			botAgenda.identificarPaciente({
				numeroDocumento: dni,
				telefonoWhatsApp,
				crearSiNoExiste: !pasoConfirmarActivo,
				idConversacion,
				omitirAvancePaso: pasoConfirmarActivo,
				fase: 'renaper',
			}),
			RENAPER_TIMEOUT_MS,
			'RENAPER',
		);
		diag.line('wizard', '[renaper] Resultado', {
			dni,
			encontrado: !!dataRenaper.renaper?.encontrado,
			nombre: dataRenaper.renaper?.nombreCompleto || null,
		});

		const respRenaper = await _respuestaIdentificacionOk({
			data: dataRenaper,
			dni,
			conv,
			flujo,
			idConversacion,
			pasoConfirmarActivo,
		});
		if (respRenaper) return respRenaper;

		if (errLocal) {
			return {
				handled: true,
				texto: botAgenda.mensajeErrorIdentificacion(
					{ code: 'RENAPER_NO_ENCONTRADO', fuente: 'renaper' },
					errLocal,
				),
			};
		}
		return {
			handled: true,
			texto: 'No encontramos ese DNI en el sistema. Verificá el número e intentá de nuevo.',
		};
	} catch (errRenaper) {
		if (errRenaper?.message?.includes('timeout') && !errRenaper.code) {
			errRenaper.code = 'RENAPER_TIMEOUT';
			errRenaper.fuente = 'renaper';
		}
		diag.warn('wizard', '[renaper] Error', {
			dni,
			code: errRenaper.code,
			fuente: errRenaper.fuente,
			error: errRenaper.message,
		});
		if (!errLocal) {
			try {
				diag.line('wizard', '[ficha_local] Reintento tras fallo RENAPER', { dni });
				const fallback = await botAgenda.identificarPaciente({
					numeroDocumento: dni,
					telefonoWhatsApp,
					crearSiNoExiste: false,
					idConversacion,
					omitirAvancePaso: pasoConfirmarActivo,
					fase: 'local',
				});
				const resp = await _respuestaIdentificacionOk({
					data: fallback,
					dni,
					conv,
					flujo,
					idConversacion,
					pasoConfirmarActivo,
				});
				if (resp) return resp;
			} catch (errRetry) {
				errLocal = errRetry;
				diag.warn('wizard', '[ficha_local] Reintento falló', {
					dni,
					code: errRetry.code,
					error: errRetry.message,
				});
			}
		}
		return {
			handled: true,
			texto: botAgenda.mensajeErrorIdentificacion(errRenaper, errLocal),
		};
	}
}

async function reconsultarRenaperParaConfirmacion(conv, telefonoWhatsApp, idConversacion, pasoCfg) {
	let errLocal = null;
	try {
		diag.line('wizard', '[ficha_local] Reconsulta confirmación', {
			dni: conv.dniPaciente,
			idConversacion,
		});
		const dataLocal = await botAgenda.identificarPaciente({
			numeroDocumento: conv.dniPaciente,
			telefonoWhatsApp,
			crearSiNoExiste: false,
			idConversacion,
			omitirAvancePaso: true,
			fase: 'local',
		});
		if (dataLocal.pacienteLocal?.existe) {
			const detalle = formatearPersonaRenaper(dataLocal.renaper, conv.dniPaciente, dataLocal.pacienteLocal);
			return `Datos registrados:\n${detalle}\n\n${pasoCfg?.mensajeUsuario || '¿Sos vos? Respondé Sí o No.'}`;
		}
	} catch (err) {
		errLocal = err;
		diag.warn('wizard', '[ficha_local] Reconsulta confirmación falló', {
			code: err.code,
			error: err.message,
		});
	}

	try {
		diag.line('wizard', '[renaper] Reconsulta confirmación', {
			dni: conv.dniPaciente,
			idConversacion,
		});
		const data = await withTimeout(
			botAgenda.identificarPaciente({
				numeroDocumento: conv.dniPaciente,
				telefonoWhatsApp,
				crearSiNoExiste: false,
				idConversacion,
				omitirAvancePaso: true,
				fase: 'renaper',
			}),
			RENAPER_TIMEOUT_MS,
			'RENAPER',
		);

		if (data.renaper?.encontrado) {
			return mensajeConfirmacionRenaper({
				renaper: data.renaper,
				dni: conv.dniPaciente,
				pacienteLocal: data.pacienteLocal,
				pasoCfg,
			});
		}

		const detalle = formatearPersonaRenaper(null, conv.dniPaciente, data.pacienteLocal);
		return `Datos registrados:\n${detalle}\n\n${pasoCfg?.mensajeUsuario || '¿Sos vos? Respondé Sí o No.'}`;
	} catch (err) {
		diag.warn('wizard', '[renaper] Reconsulta confirmación falló', {
			error: err.message,
			code: err.code,
		});
		return botAgenda.mensajeErrorIdentificacion(err, errLocal);
	}
}

async function procesarPasoConfirmarIdentidad({
	idConversacion,
	telefonoWhatsApp,
	conv,
	flujo,
	texto,
	pasoConfirmarActivo,
}) {
	if (!pasoConfirmarActivo || conv?.pasoBot !== 'CONFIRMAR_IDENTIDAD') return null;

	const { conf, intent } = await resolverConfirmacionBinaria({
		texto,
		conv,
		idConversacion,
		pasoBot: 'CONFIRMAR_IDENTIDAD',
		intencionSi: 'confirmar_identidad',
		intencionNo: 'rechazar_identidad',
	});

	if (conf == null && intent?.intencion === 'elegir_especialidad') {
		const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
		if (resEsp?.tipo === 'especialidad') {
			const ctx = preservarContextoTurnoPendiente(conv);
			ctx.especialidadPendiente = {
				valor: resEsp.especialidad.valor,
				nombre: resEsp.especialidad.nombre,
			};
			await botConversacion.guardarContextoBot(idConversacion, ctx);
		}
	}

	if (conf === true) {
		const config = await botConfigService.getBotConfig();
		const ctxPend = preservarContextoTurnoPendiente(conv);
		const espPend = ctxPend.especialidadPendiente || null;
		const profPend = ctxPend.profesionalPendiente || null;
		let data;
		try {
			data = await confirmarIdentidadConAlta({
				idConversacion,
				telefonoWhatsApp,
				dniPaciente: conv.dniPaciente,
			});
		} catch (altaErr) {
			diag.warn('wizard', 'Alta paciente falló tras confirmar identidad', {
				idConversacion,
				dni: conv.dniPaciente,
				error: altaErr.message,
				code: altaErr.code,
			});
			return { handled: true, texto: mensajeErrorAltaPaciente(altaErr) };
		}
		if (!data.idPaciente) {
			diag.warn('wizard', 'Identidad confirmada sin idPaciente en ficha local', {
				idConversacion,
				dni: conv.dniPaciente,
				accion: data.accionSugerida,
			});
			return {
				handled: true,
				texto: mensajeErrorAltaPaciente({ code: 'PACIENTE_NO_CREADO' }),
			};
		}
		let gestion = ctxPend.gestionTurno || botGestionTurno.obtenerGestionActiva(conv);
		if (gestion) {
			gestion = botGestionTurno.mergeIdentidadRenaper(gestion, {
				dni: String(conv.dniPaciente),
				idPaciente: data.idPaciente,
				nombre:
					nombreCompletoRenaper(data.renaper, data.pacienteLocal) ||
					gestion.identidad?.nombreTicket ||
					null,
				fechaNacimiento:
					data.renaper?.fechaNacimiento ||
					data.pacienteLocal?.fechaNacimiento ||
					gestion.identidad?.fechaNacimiento ||
					null,
				fuente: data.renaper?.fuente === 'local' ? 'local' : 'renaper',
			});
			ctxPend.gestionTurno = gestion;
		}
		await botConversacion.guardarContextoBot(
			idConversacion,
			Object.keys(ctxPend).length ? ctxPend : null,
		);
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			idPaciente: data.idPaciente,
			dniPaciente: String(conv.dniPaciente),
		});

		const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
		return avanzarTrasIdentidadConfirmada({
			idConversacion,
			telefonoWhatsApp,
			flujo,
			config,
			conv: convAct,
			espPend,
			profPend,
			idPaciente: data.idPaciente,
		});
	}

	if (conf === false) {
		await botConversacion.limpiarEstadoWizard(idConversacion);
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: pasoInicial(flujo),
		});
		const pasoId = pasoPorId(flujo, 'IDENTIFICAR');
		return {
			handled: true,
			texto:
				pasoId?.mensajeUsuario ||
				'Entendido. Por favor indicá nuevamente tu DNI.',
		};
	}

	const espEnTexto = await detectarEspecialidadEnTexto(texto, conv, idConversacion, 'CONFIRMAR_IDENTIDAD');
	if (espEnTexto && conv.dniPaciente) {
		const config = await botConfigService.getBotConfig();
		let data;
		try {
			data = await confirmarIdentidadConAlta({
				idConversacion,
				telefonoWhatsApp,
				dniPaciente: conv.dniPaciente,
			});
		} catch (altaErr) {
			return { handled: true, texto: mensajeErrorAltaPaciente(altaErr) };
		}
		if (data.idPaciente) {
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: data.idPaciente,
				dniPaciente: String(conv.dniPaciente),
			});
			const saludo = primerNombre(nombreWhatsApp(conv));
			const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';
			if (
				config.reglas.sugerirPrimerTurnoDisponible &&
				pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
			) {
				const convAct =
					(await botConversacion.obtenerConversacion(idConversacion)) || conv;
				return await armarRespuestaBuscarTurnoInicial({
					idConversacion,
					telefonoWhatsApp,
					flujo,
					esp: espEnTexto,
					avisoPrefijo: prefijoSaludo,
					conv: convAct,
				});
			}
		}
	}

	return {
		handled: true,
		texto:
			'Para continuar, confirmá la identidad de la persona del turno respondiendo *Sí* o *No*.',
	};
}

/**
 * @returns {Promise<{ handled: boolean, texto?: string, motivo?: string }>}
 */
async function intentarRespuestaWizard({
	idConversacion,
	telefonoWhatsApp,
	contenido,
}) {
	let conv = await botConversacion.obtenerConversacion(idConversacion);
	if (!conv) return { handled: false, motivo: 'sin conversación' };

	const flujo = await botConfigService.getFlujoPasos();
	const config = await botConfigService.getBotConfig();
	const activos = pasosActivos(flujo);
	const pasoConfirmarActivo = !!pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD')?.activo;
	let pasoActual = conv.pasoBot || pasoInicial(flujo);

	const texto = String(contenido || '').trim();
	const historialCorto = await botConversacion.listarMensajes(idConversacion, { limit: 10 });
	const postTurno = await esContextoPostTurno(conv, historialCorto);

	let interpretacion = await botInterpretacion.interpretarMensaje({
		texto,
		conv,
		idConversacion,
		pasoBot: pasoActual,
	});
	if (interpretacion) {
		await botInterpretacion.registrarSesion(idConversacion, interpretacion, conv);
		conv = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	}

	const salidaFlujo = await procesarSalidaFlujo({
		idConversacion,
		conv,
		config,
		texto,
		pasoActual,
		interpretacion,
	});
	if (salidaFlujo) return salidaFlujo;

	if (postTurno) {
		conv = await sincronizarPasoTurnoCompletado(idConversacion, conv);
		pasoActual = conv?.pasoBot || 'TURNO_COMPLETADO';
		return procesarPasoTurnoCompletado({
			idConversacion,
			telefonoWhatsApp,
			conv,
			flujo,
			config,
			texto,
		});
	}

	if (pasoActual === 'TURNO_COMPLETADO') {
		return procesarPasoTurnoCompletado({
			idConversacion,
			telefonoWhatsApp,
			conv,
			flujo,
			config,
			texto,
		});
	}
	const dniEnMensaje = extraerDni(texto);
	const pasoIdentificar = pasoPorId(flujo, 'IDENTIFICAR');

	if (necesitaReinicioPorNuevoPaciente(conv, pasoActual, dniEnMensaje)) {
		const espPend = conv.contextoBot?.especialidadPendiente;
		diag.line('wizard', 'Reinicio por nuevo paciente (DNI distinto o turno anterior)', {
			idConversacion,
			pasoActual,
			dniAnterior: conv.dniPaciente || null,
			dniNuevo: dniEnMensaje,
		});
		await botConversacion.reiniciarFlujoNuevoTurno(idConversacion, 'IDENTIFICAR');
		const ctxReinicio = preservarContextoTurnoPendiente(conv);
		if (Object.keys(ctxReinicio).length) {
			await botConversacion.guardarContextoBot(idConversacion, ctxReinicio);
		}
		conv = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
		pasoActual = 'IDENTIFICAR';
	}

	// DNI consultado pero sin confirmar: forzar paso de confirmación (solo al inicio del flujo).
	if (
		conv.dniPaciente &&
		!conv.idPaciente &&
		pasoConfirmarActivo &&
		pasoActual !== 'CONFIRMAR_IDENTIDAD' &&
		(pasoActual === 'IDENTIFICAR' || pasoActual === 'inicio' || !pasoActual) &&
		(!dniEnMensaje || String(dniEnMensaje) === String(conv.dniPaciente))
	) {
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: 'CONFIRMAR_IDENTIDAD',
		});
		pasoActual = 'CONFIRMAR_IDENTIDAD';
	}

	// --- DNI en mensaje: siempre antes que GPT o listados (aunque pasoBot esté desfasado) ---
	if (debeProcesarDni(conv, pasoActual, pasoIdentificar, pasoConfirmarActivo, dniEnMensaje)) {
		return procesarIdentificacionDni({
			idConversacion,
			telefonoWhatsApp,
			dni: dniEnMensaje,
			conv,
			flujo,
			pasoConfirmarActivo,
		});
	}

	// Confirmación Sí/No tiene prioridad sobre elección de profesional o GPT
	if (pasoActual === 'CONFIRMAR_IDENTIDAD' && pasoConfirmarActivo && !dniEnMensaje) {
		const resConfirm = await procesarPasoConfirmarIdentidad({
			idConversacion,
			telefonoWhatsApp,
			conv,
			flujo,
			texto,
			pasoConfirmarActivo,
		});
		if (resConfirm) return resConfirm;
	}

	// Médico y/o especialidad — solo sin GPT (con GPT lo resuelve el orquestador + herramientas)
	if (!gptHabilitado() && !dniEnMensaje && texto) {
		const pedidoProf = await procesarPedidoConProfesional({
			idConversacion,
			telefonoWhatsApp,
			conv,
			flujo,
			config,
			texto,
			interpretacion,
		});
		if (pedidoProf) return pedidoProf;
	}

	// Consulta directa de profesionales (sin GPT; con GPT usa herramienta listar_profesionales_especialidad)
	if (!gptHabilitado() && !extraerDni(texto) && botAgenda.esConsultaListaProfesionales(texto)) {
		const espCtx =
			conv?.contextoBot?.especialidadPendiente ||
			conv?.contextoBot?.especialidadNombre ||
			null;
		let esp = null;
		if (espCtx?.valor) {
			esp = { valor: espCtx.valor, nombre: espCtx.nombre };
		} else {
			esp = await botAgenda.resolverEspecialidadDesdeTexto(texto);
		}
		if (esp?.valor) {
			await botConversacion.guardarContextoBot(idConversacion, {
				especialidadPendiente: { valor: esp.valor, nombre: esp.nombre },
			});
			return {
				handled: true,
				texto: await mostrarProfesionalesEspecialidad(idConversacion, esp.valor),
			};
		}
		return {
			handled: true,
			texto:
				'¿En qué especialidad querés ver los profesionales? Por ejemplo: *Traumatología*, *Cardiología*…',
		};
	}

	// Rechazo o preferencia de horario en lista de profesionales (evita confundir "No" con especialidad)
	if (
		pasoActual === 'ELEGIR_PROFESIONAL' &&
		conv.idPaciente &&
		texto &&
		!dniEnMensaje &&
		!esSeleccionNumerada(texto)
	) {
		const confBin = interpretarConfirmacion(texto);
		const rechazo =
			confBin === false ||
			/\b(no puedo|no me sirve|otro dia|otra fecha|prefiero otro|el lunes|el martes|el miercoles|el jueves|el viernes)\b/i.test(
				texto,
			);
		if (rechazo) {
			const espPend = conv.contextoBot?.especialidadPendiente;
			if (config.reglas.sugerirPrimerTurnoDisponible && espPend?.valor) {
				return withInterpretacion(
					{
						handled: true,
						tipoRespuesta: 'ACLARACION',
						texto: `Entiendo. ¿Querés que busque otro turno en *${espPend.nombre}* con otro horario, o preferís otra especialidad? También podés escribir *cancelar*.`,
					},
					interpretacion,
				);
			}
			return withInterpretacion(
				{
					handled: true,
					tipoRespuesta: 'ACLARACION',
					texto:
						'¿Querés elegir otro profesional de la lista o cambiar de especialidad? Escribí el número, el nombre del médico u otra especialidad.',
				},
				interpretacion,
			);
		}
	}

	// Especialidad mencionada sin pedir turno → listado de profesionales (solo si NO sugerimos turno automático)
	const saltarListaPorSugerirTurno =
		config.reglas.sugerirPrimerTurnoDisponible &&
		conv.idPaciente &&
		(pasoActual === 'ELEGIR_ESPECIALIDAD' || pasoActual === 'ELEGIR_PROFESIONAL');
	if (
		!saltarListaPorSugerirTurno &&
		!dniEnMensaje &&
		texto &&
		!textoPideTurnoExplicito(texto) &&
		!esSeleccionNumerada(texto)
	) {
		const pasoListaProf =
			!conv.idPaciente ||
			pasoActual === 'ELEGIR_PROFESIONAL' ||
			pasoActual === 'ELEGIR_ESPECIALIDAD' ||
			pasoActual === 'IDENTIFICAR' ||
			pasoActual === 'inicio' ||
			!pasoActual;
		if (pasoListaProf && pasoPorId(flujo, 'ELEGIR_PROFESIONAL')?.activo !== false) {
			const espSolo = await botAgenda.resolverEspecialidadDesdeTexto(texto);
			if (espSolo?.valor) {
				await botConversacion.guardarContextoBot(idConversacion, {
					especialidadPendiente: { valor: espSolo.valor, nombre: espSolo.nombre },
				});
				return {
					handled: true,
					texto: await mostrarProfesionalesEspecialidad(idConversacion, espSolo.valor),
				};
			}
		}
	}

	// Elección de profesional (ej. "con palma") cuando ya hay especialidad en contexto
	if (!dniEnMensaje && texto) {
		const respProf = await procesarEleccionProfesional({
			idConversacion,
			telefonoWhatsApp,
			conv,
			flujo,
			texto,
		});
		if (respProf) return respProf;
	}

	// --- Intención GPT (lenguaje natural: nuevo turno, gracias, especialidad, etc.) ---
	if (!dniEnMensaje && texto) {
		const gptEntrada = await procesarIntencionGptEntrada({
			idConversacion,
			telefonoWhatsApp,
			conv,
			flujo,
			texto,
			pasoActual,
			pasoIdentificar,
			interpretacion,
		});
		if (gptEntrada?.handled && gptEntrada.texto) {
			return withInterpretacion(gptEntrada, interpretacion || gptEntrada.interpretacion);
		}
		if (gptEntrada?.handled === false && gptEntrada.motivo === 'gpt-conversacion') {
			return gptEntrada;
		}
	}

	const pasoSinPaciente =
		!conv.idPaciente &&
		(pasoActual === 'IDENTIFICAR' || pasoActual === 'inicio' || !pasoActual);
	if (pasoSinPaciente && texto && !dniEnMensaje) {
		await capturarEspecialidadPendienteDesdeMensaje(
			idConversacion,
			conv,
			texto,
			pasoActual,
		);
		conv = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	}

	// --- Obra social / cobertura (opcional, configurable) ---
	const configBot = await botConfigService.getBotConfig();
	if (pasoActual === 'ELEGIR_COBERTURA' && botAgenda.coberturaPasoHabilitado(flujo, configBot)) {
		const pasoCobCfg = pasoPorId(flujo, 'ELEGIR_COBERTURA');
		if (!conv.idPaciente) {
			return {
				handled: true,
				texto: 'Primero confirmá tu identidad enviando el DNI.',
			};
		}
		if (!texto) {
			return {
				handled: true,
				texto: await botAgenda.mensajePasoCobertura(pasoCobCfg, conv.idPaciente),
			};
		}

		const resuelta = await botAgenda.resolverCoberturaDesdeTexto(texto);
		if (!resuelta) {
			return {
				handled: true,
				texto: `No reconocí esa cobertura. ${await botAgenda.mensajeListaCoberturas(10)}`,
			};
		}

		let nombreCobertura = resuelta.nombre;
		try {
			if (resuelta.omitido) {
				nombreCobertura = 'Particular';
			} else {
				const saved = await botAgenda.actualizarCoberturaPacienteBot(conv.idPaciente, resuelta);
				nombreCobertura = saved.nombre;
			}
		} catch (err) {
			diag.warn('wizard', 'Error guardando cobertura', { error: err.message });
			return {
				handled: true,
				texto: 'No pudimos registrar esa cobertura. Escribí el nombre exacto de la obra social.',
			};
		}

		const espPend = conv.contextoBot?.especialidadPendiente;
		return avanzarTrasCobertura({
			idConversacion,
			telefonoWhatsApp,
			flujo,
			config: configBot,
			conv,
			espPend,
			idPaciente: conv.idPaciente,
			nombreCobertura: resuelta.omitido ? 'Particular' : nombreCobertura,
		});
	}

	// --- Especialidad → sugerir primer turno (si está activo en config) ---
	const pasoEspecialidad = pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD');
	const configEsp = await botConfigService.getBotConfig();
	const sugerirTurno = configEsp.reglas.sugerirPrimerTurnoDisponible;
	const esPasoEspecialidad =
		pasoActual === 'ELEGIR_ESPECIALIDAD' && pasoEspecialidad?.activo !== false;
	const esPasoProfConSugerir =
		sugerirTurno &&
		conv.idPaciente &&
		(pasoActual === 'ELEGIR_PROFESIONAL' || pasoActual === 'ELEGIR_FECHA_HORA');

	if (
		(esPasoEspecialidad || esPasoProfConSugerir) &&
		!conv.idPaciente &&
		conv.dniPaciente
	) {
		const dataPac = await confirmarIdentidadConAlta({
			idConversacion,
			telefonoWhatsApp,
			dniPaciente: conv.dniPaciente,
		}).catch(() => null);
		if (dataPac?.idPaciente) {
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: dataPac.idPaciente,
				dniPaciente: String(conv.dniPaciente),
			});
			conv = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
		}
	}

	if ((esPasoEspecialidad || esPasoProfConSugerir) && conv.idPaciente) {
		if (pasoActual === 'ELEGIR_PROFESIONAL' && conv.contextoBot?.especialidadPendiente) {
			const respProf = await procesarEleccionProfesional({
				idConversacion,
				telefonoWhatsApp,
				conv,
				flujo,
				texto,
			});
			if (respProf) return respProf;
		}

		let resolucion = { tipo: 'no_encontrada' };
		if (gptHabilitado()) {
			const intent = await botIntencion.interpretarIntencion({
				texto,
				conv,
				idConversacion,
				pasoBot: pasoActual,
			});
			if (intent) {
				resolucion = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
				if (resolucion.tipo === 'conversacion') {
					return { handled: false, motivo: 'gpt-conversacion' };
				}
			}
		}
		if (resolucion.tipo === 'no_encontrada') {
			const espLocal = gptHabilitado()
				? null
				: await botAgenda.resolverEspecialidadDesdeTexto(texto);
			if (espLocal) resolucion = { tipo: 'especialidad', especialidad: espLocal };
		}

		if (resolucion.tipo === 'listar') {
			return withInterpretacion(
				{
					handled: true,
					tipoRespuesta: 'LISTA_ESPECIALIDADES',
					texto: botAgenda.mensajeEspecialidadesDisponibles(resolucion.lista),
				},
				interpretacion,
			);
		}

		const esp = resolucion.tipo === 'especialidad' ? resolucion.especialidad : null;
		if (!esp) {
			if (esPasoProfConSugerir && pasoActual === 'ELEGIR_PROFESIONAL') {
				const pasoProf = pasoPorId(flujo, 'ELEGIR_PROFESIONAL');
				return {
					handled: true,
					texto:
						pasoProf?.mensajeUsuario ||
						'Indicá el profesional por número de la lista o por nombre (por ejemplo: *2* o *Aquino*).',
				};
			}
			if (esPasoProfConSugerir) {
				return {
					handled: true,
					texto:
						'Indicá la especialidad que necesitás (por ejemplo: *Traumatología*) y te propongo el turno libre más cercano.',
				};
			}
			if (esPasoEspecialidad && gptHabilitado()) {
				return { handled: false };
			}
			const lista = await botAgenda.listarEspecialidadesBot();
			return {
				handled: true,
				texto: botAgenda.mensajeEspecialidadesDisponibles(lista),
			};
		}

		if (sugerirTurno) {
			return withInterpretacion(
				await armarRespuestaBuscarTurnoInicial({
					idConversacion,
					telefonoWhatsApp,
					flujo,
					esp,
					conv,
				}),
				interpretacion,
			);
		}

		const pasoProf = pasoPorId(flujo, 'ELEGIR_PROFESIONAL');
		const profs = await botAgenda.listarProfesionalesBot(esp.valor);
		const configLista = await botConfigService.getBotConfig();
		const maxProf =
			Number(configLista.reglas.busquedaMaxProfesionales) || 40;
		const listaProf = profs.profesionales
			.slice(0, maxProf)
			.map((p, i) => `${i + 1}. ${p.nombre}`)
			.join('\n');
		const extraProf =
			profs.profesionales.length > maxProf
				? `\n\n(Mostrando ${maxProf} de ${profs.profesionales.length} profesionales.)`
				: '';
		await botConversacion.guardarContextoBot(idConversacion, {
			especialidadValor: esp.valor,
			especialidadNombre: esp.nombre,
		});
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: pasoProf?.activo ? 'ELEGIR_PROFESIONAL' : pasoActual,
		});
		return {
			handled: true,
			texto: `Especialidad *${esp.nombre}*. Profesionales disponibles:\n\n${listaProf}${extraProf}\n\n${pasoProf?.mensajeUsuario || 'Indicá el profesional.'}`,
		};
	}

	// --- Confirmación de turno sugerido ---
	const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	if (pasoActual === 'CONFIRMAR' && convAct.contextoBot?.tipo === 'turno_sugerido') {
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR');
		const ctx = convAct.contextoBot;
		const intentGpt = interpretacion;
		let conf = null;

		if (intentGpt?.intencion === 'confirmar_turno') conf = true;
		else if (intentGpt?.intencion === 'rechazar_turno') conf = false;
		else if (intentGpt?.intencion === 'buscar_turno') conf = false;
		else conf = interpretarConfirmacion(texto);

		if (intentGpt?.intencion === 'cambiar_especialidad') {
			await botConversacion.guardarContextoBot(idConversacion, null);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: 'ELEGIR_ESPECIALIDAD',
			});
			return withInterpretacion(
				{
					handled: true,
					tipoRespuesta: 'ACLARACION',
					texto: pasoEspecialidad?.mensajeUsuario || '¿Qué especialidad necesitás?',
				},
				interpretacion,
			);
		}

		if (botInterpretacion.debeSalirFlujo(interpretacion, texto)) {
			await cancelarFlujoTurnoActivo(idConversacion);
			return withInterpretacion(
				{
					handled: true,
					tipoRespuesta: 'SALIDA_FLUJO',
					texto: mensajeSalidaFlujo(config, convAct),
				},
				interpretacion,
			);
		}

		if (conf === true && ctx.matricula && ctx.fecha && ctx.hora) {
			try {
				const valido = await botAgenda.validarSugerenciaTurno(
					{
						matricula: ctx.matricula,
						medico: ctx.medico,
						fecha: ctx.fecha,
						hora: ctx.hora,
						sector: ctx.sector,
					},
					ctx.especialidadValor,
				);
				if (!valido) {
					await botConversacion.guardarContextoBot(idConversacion, null);
					return {
						handled: true,
						texto:
							'Ese profesional no está habilitado en la agenda. Indicá otra especialidad o contactá al centro.',
					};
				}
				const reserva = await botAgenda.reservarTurno(
					{
						matricula: ctx.matricula,
						idPaciente: convAct.idPaciente,
						fecha: ctx.fecha,
						hora: ctx.hora,
						sector: ctx.sector,
						telefonoWhatsApp,
						idConversacion,
					},
					Number(process.env.BOT_COD_OPERADOR) || 0,
				);
				await botConversacion.finalizarTrasReservaExitosa(idConversacion);
				const saludo = primerNombre(nombreWhatsApp(convAct));
				const ticket = reserva.ticket?.mensajeWhatsApp || reserva.mensajeConfirmacion;
				return withInterpretacion(
					{
						handled: true,
						tipoRespuesta: 'CONFIRMACION_TURNO_OK',
						pauta: botHumanizer.pautaPorTipo('CONFIRMACION_TURNO_OK'),
						ticketEstatico: ticket,
						datosOperativos: {
							medico: ctx.medico,
							especialidad: ctx.especialidadNombre,
							fechaLegible: ctx.fechaLegible,
							diaSemana: ctx.diaSemana,
							hora: ctx.hora,
							nombreSaludo: saludo || null,
						},
					},
					interpretacion,
				);
			} catch (err) {
				diag.warn('wizard', 'Error reservando turno sugerido', { error: err.message, code: err.code });
				if (err.code === 'PROFESIONAL_INEXISTENTE' || err.code === 'ESPECIALIDAD_NO_COINCIDE') {
					await botConversacion.guardarContextoBot(idConversacion, null);
					return {
						handled: true,
						texto:
							'Ese profesional no está habilitado en la agenda. Indicá otra especialidad o contactá al centro.',
					};
				}
				return {
					handled: true,
					texto:
						err.code === 'ANTICIPACION_INSUFICIENTE' || err.code === 'MAX_TURNOS_DIA'
							? err.message
							: 'No pudimos confirmar ese turno. Probá escribir otra especialidad o contactá al centro.',
				};
			}
		}

		const buscarPorGpt =
			intentGpt &&
			(intentGpt.intencion === 'buscar_turno' || intentGpt.intencion === 'rechazar_turno');

		if (conf === false || buscarPorGpt) {
			const ajusteGpt =
				buscarPorGpt && intentGpt
					? botIntencion.intencionAAjusteTurno(intentGpt.intencion, intentGpt.parametros, ctx)
					: null;
			const ajusteInteligente = await botAgenda.interpretarAjusteTurnoInteligente(texto, ctx);
			const ajuste = _fusionarAjustesTurno(ajusteGpt, ajusteInteligente);
			return withInterpretacion(
				_planificarBusquedaTurno(idConversacion, ctx, texto, pasoCfg, ajuste),
				interpretacion,
			);
		}

		if (!gptHabilitado()) {
			const ajusteLocal = await botAgenda.interpretarAjusteTurnoInteligente(texto, ctx);
			if (interpretarRechazoTurno(texto, ctx) || _ajusteTienePreferencia(ajusteLocal)) {
				return withInterpretacion(
					_planificarBusquedaTurno(idConversacion, ctx, texto, pasoCfg, ajusteLocal),
					interpretacion,
				);
			}
		}

		const ajusteFallback = await botAgenda.interpretarAjusteTurnoInteligente(texto, ctx);
		if (interpretarRechazoTurno(texto, ctx) || _ajusteTienePreferencia(ajusteFallback)) {
			return withInterpretacion(
				_planificarBusquedaTurno(idConversacion, ctx, texto, pasoCfg, ajusteFallback),
				interpretacion,
			);
		}

		if (intentGpt?.intencion === 'conversacion' || interpretacion?.flags?.es_saludo) {
			return withInterpretacion(
				{
					handled: true,
					tipoRespuesta: 'ACLARACION',
					texto:
						'Seguimos con el turno que te propuse. ¿Lo confirmás con *Sí*, preferís otro horario con *No*, o escribís *cancelar* si ya no querés sacar turno?',
				},
				interpretacion,
			);
		}

		return withInterpretacion(
			{
				handled: true,
				tipoRespuesta: 'SUGERENCIA_TURNO',
				texto: botAgenda.mensajeSugerenciaTurno(ctx, pasoCfg),
				datosOperativos: {
					medico: ctx.medico,
					especialidad: ctx.especialidadNombre,
					fechaLegible: ctx.fechaLegible,
					diaSemana: ctx.diaSemana,
					hora: ctx.hora,
				},
			},
			interpretacion,
		);
	}

	return { handled: false, motivo: 'wizard no aplica' };
}

function _ajusteTienePreferencia(ajuste) {
	if (!ajuste) return false;
	const p = ajuste.preferir || {};
	return !!(
		p.fechas?.length ||
		p.diasSemana?.length ||
		p.franja ||
		p.fechaDesde ||
		p.fechaHasta ||
		ajuste.excluir?.fechas?.length ||
		ajuste.excluir?.diasSemana?.length ||
		ajuste.resumen
	);
}

function _fusionarAjustesTurno(a, b) {
	if (!a) return b;
	if (!b) return a;
	const uniq = (arr) => [...new Set((arr || []).map((x) => String(x)))];
	return {
		excluir: {
			slots: [...(a.excluir?.slots || []), ...(b.excluir?.slots || [])],
			fechas: uniq([...(a.excluir?.fechas || []), ...(b.excluir?.fechas || [])]),
			diasSemana: uniq([...(a.excluir?.diasSemana || []), ...(b.excluir?.diasSemana || [])]).map(
				Number,
			),
		},
		preferir: {
			fechas: uniq([...(a.preferir?.fechas || []), ...(b.preferir?.fechas || [])]),
			diasSemana: uniq([...(a.preferir?.diasSemana || []), ...(b.preferir?.diasSemana || [])]).map(
				Number,
			),
			franja: b.preferir?.franja || a.preferir?.franja || null,
			horaDesde: b.preferir?.horaDesde || a.preferir?.horaDesde || null,
			horaHasta: b.preferir?.horaHasta || a.preferir?.horaHasta || null,
			fechaDesde: b.preferir?.fechaDesde || a.preferir?.fechaDesde || null,
			fechaHasta: b.preferir?.fechaHasta || a.preferir?.fechaHasta || null,
		},
		resumen: b.resumen || a.resumen || null,
	};
}

function _planificarBusquedaTurno(idConversacion, ctx, textoRechazo, pasoCfg, ajustePrecalculado = null) {
	const ajuste = ajustePrecalculado || botAgenda.interpretarAjusteTurno(textoRechazo, ctx);
	return {
		handled: true,
		accion: 'BUSCAR_TURNO',
		aviso: botAgenda.mensajeAvisoBusquedaDisponibilidad({
			preferencia: ajuste.resumen || ctx.especialidadNombre,
		}),
		buscarTurno: {
			tipo: 'alternativo',
			idConversacion,
			ctx,
			pasoCfg,
			ajuste,
		},
	};
}

async function ejecutarBusquedaTurno(buscarTurno) {
	const { tipo, idConversacion } = buscarTurno || {};
	const flujo = await botConfigService.getFlujoPasos();

	try {
		if (tipo === 'inicial') {
			const pasoConfirmar = pasoPorId(flujo, buscarTurno.pasoConfirmarId || 'CONFIRMAR');
			const opcionesBusqueda = {};
			if (buscarTurno.matricula != null) {
				opcionesBusqueda.matricula = buscarTurno.matricula;
			}
			if (buscarTurno.preferir) opcionesBusqueda.preferir = buscarTurno.preferir;
			if (buscarTurno.excluir) opcionesBusqueda.excluir = buscarTurno.excluir;

			let sugerencia = await botAgenda.sugerirPrimerTurnoDisponible(
				buscarTurno.especialidadValor,
				opcionesBusqueda,
			);
			sugerencia = sugerencia
				? await botAgenda.validarSugerenciaTurno(sugerencia, buscarTurno.especialidadValor)
				: null;

			const convAct = await botConversacion.obtenerConversacion(idConversacion);
			let gestion =
				botGestionTurno.obtenerGestionActiva(convAct) || botGestionTurno.ensureGestion(convAct);
			if (sugerencia) {
				gestion = botGestionTurno.mergeTurnoOfrecido(gestion, {
					...sugerencia,
					especialidad: buscarTurno.especialidadValor,
					especialidadNombre: buscarTurno.especialidadNombre,
				});
			}
			const ctxGuardar = botGestionTurno.sincronizarLegacy(convAct?.contextoBot, gestion);
			if (!sugerencia) {
				ctxGuardar.tipo = undefined;
			}
			await botConversacion.guardarContextoBot(idConversacion, {
				...ctxGuardar,
				tipo: sugerencia ? 'turno_sugerido' : ctxGuardar.tipo,
				especialidadValor: buscarTurno.especialidadValor,
				especialidadNombre: buscarTurno.especialidadNombre,
				...(sugerencia || {}),
			});
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: sugerencia ? 'CONFIRMAR' : 'ELEGIR_ESPECIALIDAD',
			});
			return {
				texto: null,
				pauta: botHumanizer.pautaPorTipo(sugerencia ? 'SUGERENCIA_TURNO' : 'SIN_DISPONIBILIDAD'),
				tipoRespuesta: sugerencia ? 'SUGERENCIA_TURNO' : 'SIN_DISPONIBILIDAD',
				datosOperativos: sugerencia
					? {
							medico: sugerencia.medico,
							especialidad: sugerencia.especialidadNombre,
							fechaLegible: sugerencia.fechaLegible,
							diaSemana: sugerencia.diaSemana,
							hora: sugerencia.hora,
							preferencia: gestion.preferenciaHorario?.resumen || null,
						}
					: {
							especialidad: buscarTurno.especialidadNombre,
							preferencia: gestion.preferenciaHorario?.resumen || null,
						},
			};
		}

		if (tipo === 'alternativo') {
			const { ctx, pasoCfg, ajuste: ajusteGuardado } = buscarTurno;
			const convAlt = await botConversacion.obtenerConversacion(idConversacion);
			const gestionAlt = botGestionTurno.obtenerGestionActiva(convAlt);
			let ajuste =
				ajusteGuardado || botAgenda.interpretarAjusteTurno(buscarTurno.textoRechazo || '', ctx);
			if (gestionAlt) {
				const prefGestion = botGestionTurno.aPreferenciasBusqueda(gestionAlt);
				ajuste = _fusionarAjustesTurno(ajuste, {
					preferir: prefGestion.preferir,
					excluir: prefGestion.excluir,
					resumen: prefGestion.resumen,
				});
			}
			const opcionesBusqueda = {
				excluir: ajuste.excluir,
				preferir: ajuste.preferir,
			};
			if (ctx.matricula != null && Number.isFinite(Number(ctx.matricula))) {
				opcionesBusqueda.matricula = Number(ctx.matricula);
			}
			let siguiente = await botAgenda.sugerirPrimerTurnoDisponible(
				ctx.especialidadValor,
				opcionesBusqueda,
			);

			if (!siguiente && ajuste.preferir?.fechas?.length) {
				siguiente = await botAgenda.sugerirPrimerTurnoDisponible(ctx.especialidadValor, {
					...opcionesBusqueda,
					preferir: { ...ajuste.preferir, fechas: [] },
				});
			}

			if (!siguiente && (ajuste.preferir?.fechaDesde || ajuste.preferir?.fechaHasta)) {
				siguiente = await botAgenda.sugerirPrimerTurnoDisponible(ctx.especialidadValor, {
					excluir: ajuste.excluir,
					preferir: {
						...ajuste.preferir,
						fechaDesde: null,
						fechaHasta: null,
					},
					...(opcionesBusqueda.matricula != null
						? { matricula: opcionesBusqueda.matricula }
						: {}),
				});
			}

			if (!siguiente) {
				await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot: 'CONFIRMAR' });
				return {
					pauta: botHumanizer.pautaPorTipo('SIN_DISPONIBILIDAD'),
					tipoRespuesta: 'SIN_DISPONIBILIDAD',
					datosOperativos: ajuste.resumen ? { preferencia: ajuste.resumen } : null,
				};
			}

			siguiente = await botAgenda.validarSugerenciaTurno(siguiente, ctx.especialidadValor);
			if (!siguiente) {
				return {
					pauta: botHumanizer.pautaPorTipo('SIN_DISPONIBILIDAD'),
					tipoRespuesta: 'SIN_DISPONIBILIDAD',
				};
			}

			let gestionAlt2 =
				botGestionTurno.obtenerGestionActiva(convAlt) || botGestionTurno.ensureGestion(convAlt);
			gestionAlt2 = botGestionTurno.mergeTurnoOfrecido(gestionAlt2, {
				...siguiente,
				especialidad: ctx.especialidadValor,
				especialidadNombre: ctx.especialidadNombre,
			});
			const ctxGuardar = botGestionTurno.sincronizarLegacy(convAlt?.contextoBot, gestionAlt2);
			await botConversacion.guardarContextoBot(idConversacion, {
				...ctxGuardar,
				tipo: 'turno_sugerido',
				especialidadValor: ctx.especialidadValor,
				especialidadNombre: ctx.especialidadNombre,
				...siguiente,
			});
			await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot: 'CONFIRMAR' });
			return {
				pauta: botHumanizer.pautaPorTipo('SUGERENCIA_TURNO'),
				tipoRespuesta: 'SUGERENCIA_TURNO',
				datosOperativos: {
					medico: siguiente.medico,
					especialidad: siguiente.especialidadNombre,
					fechaLegible: siguiente.fechaLegible,
					diaSemana: siguiente.diaSemana,
					hora: siguiente.hora,
					preferencia: ajuste.resumen || null,
				},
			};
		}
	} catch (err) {
		diag.warn('wizard', 'Error ejecutando búsqueda de turno', { error: err.message, tipo });
		return {
			pauta: botHumanizer.pautaPorTipo('ERROR_AGENDA'),
			tipoRespuesta: 'ERROR_AGENDA',
		};
	}

	return {
		pauta: botHumanizer.pautaPorTipo('ERROR_AGENDA'),
		tipoRespuesta: 'ERROR_AGENDA',
	};
}

module.exports = {
	pasosActivos,
	siguientePasoActivo,
	pasoInicial,
	intentarRespuestaWizard,
	ejecutarBusquedaTurno,
	extraerDni,
	interpretarConfirmacion,
	interpretarRechazoTurno,
	interpretarSalidaFlujo,
	esContextoPostTurno,
	esCierreCordial,
	resolverMensajePostTurno,
};
