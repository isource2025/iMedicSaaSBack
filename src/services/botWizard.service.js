/**
 * Wizard determinístico del bot (RENAPER, confirmación, pasos activos).
 * GPT complementa solo cuando el wizard no resuelve el turno.
 */
const botAgenda = require('./botAgenda.service');
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const botIntencion = require('./botIntencion.service');
const diag = require('../utils/diagLog');

function gptHabilitado() {
	return botIntencion.gptHabilitado();
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
	const m = String(texto || '').match(/\b(\d{7,8})\b/);
	return m ? m[1] : null;
}

function interpretarConfirmacion(texto) {
	const t = String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (/^(si|s|yes|ok|dale|confirmo|correcto|exacto|1|soy yo|afirmativo|su)$/.test(t)) return true;
	if (/^dale\b/.test(t)) return true;
	if (/^(no|n|nop|incorrecto|otra persona|2|negativo)$/.test(t)) return false;
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
		/\b(no puedo|no me sirve|no me conviene|otro dia|otra fecha|otro horario|prefiero otro|buscar otro|siguiente turno|otra opcion|imposible ese|ese horario no|a esa hora no)\b/.test(
			t,
		)
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

function mensajePasoFlujo(flujo, pasoId, conv, fallback = '') {
	const pasoCfg = pasoPorId(flujo, pasoId);
	return aplicarPlantillaMensaje(pasoCfg?.mensajeUsuario || fallback, conv);
}

function resolverMensajePostTurno(flujo, config, conv) {
	const pasoCfg = pasoPorId(flujo, 'TURNO_COMPLETADO');
	const raw =
		pasoCfg?.mensajeUsuario ||
		config?.mensajes?.agradecimiento ||
		'¡De nada! Si necesitás otro turno, escribinos cuando quieras.';
	return aplicarPlantillaMensaje(raw, conv);
}

function mensajeConfirmacionRenaper({ renaper, dni, pacienteLocal, pasoCfg }) {
	const fuente = renaper?.fuente === 'local' ? 'ficha local' : 'RENAPER';
	const detalle = formatearPersonaRenaper(renaper, dni, pacienteLocal);
	return `Encontramos en *${fuente}*:\n${detalle}\n\n${pasoCfg?.mensajeUsuario || '¿Sos vos? Respondé Sí o No.'}`;
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
	if (!pasoIdentificar?.activo && !pasoConfirmarActivo) return false;

	if (conv.dniPaciente && String(conv.dniPaciente) !== String(dni)) {
		return true;
	}

	if (
		pasoActual === 'IDENTIFICAR' ||
		pasoActual === 'inicio' ||
		pasoActual === 'CONFIRMAR_IDENTIDAD' ||
		!pasoActual
	) {
		return true;
	}

	if (
		conv.idPaciente &&
		(pasoActual === 'CONFIRMAR' ||
			pasoActual === 'ELEGIR_ESPECIALIDAD' ||
			pasoActual === 'ELEGIR_PROFESIONAL' ||
			pasoActual === 'ELEGIR_FECHA_HORA')
	) {
		return true;
	}

	return !conv.dniPaciente;
}

function necesitaReinicioPorNuevoPaciente(conv, pasoActual, dniEnMensaje) {
	if (!dniEnMensaje) return false;
	const dniDistinto = conv.dniPaciente && String(conv.dniPaciente) !== String(dniEnMensaje);
	const pasoTurnoAnterior = [
		'CONFIRMAR',
		'ELEGIR_ESPECIALIDAD',
		'ELEGIR_PROFESIONAL',
		'ELEGIR_FECHA_HORA',
	].includes(pasoActual);
	return dniDistinto || (!!conv.idPaciente && pasoTurnoAnterior);
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
	const msg =
		pasoIdentificar?.mensajeUsuario ||
		'Para comenzar, indicá el DNI de la persona que va a atenderse (sin puntos).';
	if (!conSaludo) return msg;
	const saludo = primerNombre(nombreWhatsApp(conv));
	return saludo ? `Hola, ${saludo}. ${msg}` : msg;
}

async function responderListaEspecialidades() {
	return {
		handled: true,
		texto: botAgenda.mensajeEspecialidadesDisponibles(await botAgenda.listarEspecialidadesBot()),
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
}) {
	if (pasoIdentificar?.activo === false) return null;

	if (!gptHabilitado()) return null;

	const pasoGpt =
		pasoActual === 'CONFIRMAR' && conv?.contextoBot?.tipo !== 'turno_sugerido'
			? 'IDENTIFICAR'
			: pasoActual;
	if (!botIntencion.esPasoIdentificacionLibre(pasoActual, conv)) return null;

	const intent = await botIntencion.interpretarIntencion({
		texto,
		conv,
		idConversacion,
		pasoBot: pasoGpt,
	});
	if (!intent?.intencion) return null;

	diag.line('wizard', 'Intención GPT', {
		idConversacion,
		paso: pasoActual,
		intencion: intent.intencion,
		resumen: intent.parametros?.resumen || null,
	});

	if (intent.intencion === 'solicitar_turno') {
		let espPend = null;
		const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
		if (resEsp?.tipo === 'especialidad') {
			espPend = { valor: resEsp.especialidad.valor, nombre: resEsp.especialidad.nombre };
		}
		return {
			handled: true,
			texto: await iniciarFlujoNuevoTurno({ idConversacion, conv, flujo, espPend }),
		};
	}

	if (intent.intencion === 'agradecimiento') {
		const config = await botConfigService.getBotConfig();
		if (pasoActual !== 'TURNO_COMPLETADO') {
			await botConversacion.finalizarTrasReservaExitosa(idConversacion);
		}
		return {
			handled: true,
			texto: resolverMensajePostTurno(flujo, config, conv),
		};
	}

	if (intent.intencion === 'listar_especialidades') {
		return responderListaEspecialidades();
	}

	if (intent.intencion === 'elegir_especialidad') {
		const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
		if (resEsp?.tipo === 'especialidad') {
			const espPend = { valor: resEsp.especialidad.valor, nombre: resEsp.especialidad.nombre };
			if (botIntencion.esPasoIdentificacionLibre(pasoActual, conv)) {
				return {
					handled: true,
					texto: await iniciarFlujoNuevoTurno({
						idConversacion,
						conv,
						flujo,
						espPend,
						conSaludo: false,
					}),
				};
			}
			await botConversacion.guardarContextoBot(idConversacion, { especialidadPendiente: espPend });
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
	const ctx = { ...(conv?.contextoBot || {}), especialidadPendiente: esp };
	await botConversacion.guardarContextoBot(idConversacion, ctx);
	return esp;
}

function armarRespuestaBuscarTurnoInicial({
	idConversacion,
	telefonoWhatsApp,
	flujo,
	esp,
	avisoPrefijo = '',
}) {
	const pasoConfirmar = pasoPorId(flujo, 'CONFIRMAR');
	return {
		handled: true,
		accion: 'BUSCAR_TURNO',
		aviso: `${avisoPrefijo}${botAgenda.mensajeAvisoBusquedaDisponibilidad()}`,
		buscarTurno: {
			tipo: 'inicial',
			idConversacion,
			telefonoWhatsApp,
			especialidadValor: esp.valor,
			especialidadNombre: esp.nombre,
			pasoConfirmarId: pasoConfirmar?.id || 'CONFIRMAR',
		},
	};
}

function mensajeErrorRenaper(err) {
	if (err?.code === 'RENAPER_TIMEOUT') {
		return 'La consulta a RENAPER tardó demasiado. Intentá enviar tu DNI de nuevo en unos segundos.';
	}
	if (err?.code === 'RENAPER_NO_ENCONTRADO') {
		return 'No encontramos ese DNI en RENAPER. Verificá el número e intentá de nuevo.';
	}
	if (err?.code === 'RENAPER_UNAVAILABLE' || err?.code === 'RENAPER_HTTP') {
		return 'No pudimos consultar RENAPER en este momento. Intentá de nuevo en unos segundos.';
	}
	return 'No pudimos consultar RENAPER en este momento. Intentá de nuevo en unos segundos.';
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
		const espPendPreservar = conv.contextoBot?.especialidadPendiente || null;
		if (conv.idPaciente || conv.contextoBot) {
			await botConversacion.limpiarEstadoWizard(idConversacion);
			if (espPendPreservar) {
				await botConversacion.guardarContextoBot(idConversacion, {
					especialidadPendiente: espPendPreservar,
				});
			}
		} else {
			await botConversacion.guardarContextoBot(
				idConversacion,
				espPendPreservar ? { especialidadPendiente: espPendPreservar } : null,
			);
		}
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			dniPaciente: String(dni),
			pasoBot: 'CONFIRMAR_IDENTIDAD',
			idPaciente: null,
		});
		return {
			handled: true,
			texto: mensajeConfirmacionRenaper({
				renaper: data.renaper,
				dni,
				pacienteLocal: data.pacienteLocal,
				pasoCfg,
			}),
		};
	}

	const siguiente = siguientePasoActivo(flujo, 'IDENTIFICAR');
	const pasoCfg = pasoPorId(flujo, siguiente);
	return {
		handled: true,
		texto: pasoCfg?.mensajeUsuario || 'Gracias. ¿Qué especialidad necesitás?',
	};
}

async function avanzarTrasIdentidadConfirmada({
	idConversacion,
	telefonoWhatsApp,
	flujo,
	config,
	conv,
	espPend,
	idPaciente,
}) {
	const saludo = primerNombre(nombreWhatsApp(conv));
	const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';

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
		espPend?.valor &&
		config.reglas.sugerirPrimerTurnoDisponible &&
		pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
	) {
		return armarRespuestaBuscarTurnoInicial({
			idConversacion,
			telefonoWhatsApp,
			flujo,
			esp: espPend,
			avisoPrefijo: prefijoSaludo,
		});
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
		const buscar = armarRespuestaBuscarTurnoInicial({
			idConversacion,
			telefonoWhatsApp,
			flujo,
			esp: espPend,
			avisoPrefijo: `${prefijoSaludo}${coberturaMsg}`,
		});
		return buscar;
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
	if (!gptHabilitado()) {
		return { handled: true, texto: resolverMensajePostTurno(flujo, config, conv) };
	}

	const intent = await botIntencion.interpretarIntencion({
		texto,
		conv,
		idConversacion,
		pasoBot: 'TURNO_COMPLETADO',
	});

	if (intent?.intencion === 'agradecimiento' || intent?.intencion === 'conversacion') {
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
				return armarRespuestaBuscarTurnoInicial({
					idConversacion,
					telefonoWhatsApp,
					flujo,
					esp: espPend,
				});
			}
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: 'ELEGIR_ESPECIALIDAD',
			});
			return {
				handled: true,
				texto: mensajePasoFlujo(
					flujo,
					'ELEGIR_ESPECIALIDAD',
					conv,
					'¿Qué especialidad necesitás?',
				),
			};
		}

		return {
			handled: true,
			texto: await iniciarFlujoNuevoTurno({
				idConversacion,
				conv,
				flujo,
				espPend,
			}),
		};
	}

	return { handled: true, texto: resolverMensajePostTurno(flujo, config, conv) };
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
		const espPendPreservar = conv.contextoBot?.especialidadPendiente || null;
		await botConversacion.reiniciarFlujoNuevoTurno(idConversacion, 'IDENTIFICAR');
		if (espPendPreservar) {
			await botConversacion.guardarContextoBot(idConversacion, {
				especialidadPendiente: espPendPreservar,
			});
		}
		conv = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	}

	try {
		diag.line('wizard', 'Buscando ficha local por DNI', { dni, idConversacion });
		const dataLocal = await botAgenda.identificarPaciente({
			numeroDocumento: dni,
			telefonoWhatsApp,
			crearSiNoExiste: false,
			idConversacion,
			omitirAvancePaso: pasoConfirmarActivo,
			fase: 'local',
		});
		diag.line('wizard', 'Ficha local', {
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

		diag.line('wizard', 'Sin ficha local, consultando RENAPER', { dni, idConversacion });
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
		diag.line('wizard', 'RENAPER respondió', {
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

		return {
			handled: true,
			texto: 'No encontramos ese DNI en el sistema. Verificá el número e intentá de nuevo.',
		};
	} catch (err) {
		diag.warn('wizard', 'Error identificando DNI', {
			dni,
			error: err.message,
			code: err.code,
		});
		try {
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
		} catch {
			/* ignore */
		}
		return { handled: true, texto: mensajeErrorRenaper(err) };
	}
}

async function reconsultarRenaperParaConfirmacion(conv, telefonoWhatsApp, idConversacion, pasoCfg) {
	try {
		const data = await withTimeout(
			botAgenda.identificarPaciente({
				numeroDocumento: conv.dniPaciente,
				telefonoWhatsApp,
				crearSiNoExiste: false,
				idConversacion,
				omitirAvancePaso: true,
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
		diag.warn('wizard', 'Error reconsultando RENAPER', { error: err.message, code: err.code });
		return mensajeErrorRenaper(err);
	}
}

/**
 * @returns {Promise<{ handled: boolean, texto?: string, motivo?: string }>}
 */
async function intentarRespuestaWizard({
	idConversacion,
	telefonoWhatsApp,
	contenido,
}) {
	const conv = await botConversacion.obtenerConversacion(idConversacion);
	if (!conv) return { handled: false, motivo: 'sin conversación' };

	const flujo = await botConfigService.getFlujoPasos();
	const config = await botConfigService.getBotConfig();
	const activos = pasosActivos(flujo);
	const pasoConfirmarActivo = !!pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD')?.activo;
	let pasoActual = conv.pasoBot || pasoInicial(flujo);

	const texto = String(contenido || '').trim();

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
		if (espPend) {
			await botConversacion.guardarContextoBot(idConversacion, { especialidadPendiente: espPend });
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
		});
		if (gptEntrada?.handled && gptEntrada.texto) return gptEntrada;
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

	// --- DNI en mensaje: RENAPER siempre antes que GPT (aunque pasoBot esté desfasado) ---
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

	// --- Confirmación de identidad RENAPER ---
	if (pasoActual === 'CONFIRMAR_IDENTIDAD' && pasoConfirmarActivo) {
		const { conf, intent } = await resolverConfirmacionBinaria({
			texto,
			conv,
			idConversacion,
			pasoBot: pasoActual,
			intencionSi: 'confirmar_identidad',
			intencionNo: 'rechazar_identidad',
		});
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD');

		if (conf == null && intent?.intencion === 'elegir_especialidad') {
			const resEsp = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
			if (resEsp?.tipo === 'especialidad') {
				await botConversacion.guardarContextoBot(idConversacion, {
					especialidadPendiente: {
						valor: resEsp.especialidad.valor,
						nombre: resEsp.especialidad.nombre,
					},
				});
			}
		}

		if (conf === true) {
			const config = await botConfigService.getBotConfig();
			const espPend = conv.contextoBot?.especialidadPendiente;
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
			await botConversacion.guardarContextoBot(idConversacion, null);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: data.idPaciente,
				dniPaciente: String(conv.dniPaciente),
			});

			return avanzarTrasIdentidadConfirmada({
				idConversacion,
				telefonoWhatsApp,
				flujo,
				config,
				conv,
				espPend,
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
					'Entendido. Por favor indicá nuevamente tu DNI (sin puntos).',
			};
		}

		const espEnTexto = await detectarEspecialidadEnTexto(
			texto,
			conv,
			idConversacion,
			pasoActual,
		);
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
					return armarRespuestaBuscarTurnoInicial({
						idConversacion,
						telefonoWhatsApp,
						flujo,
						esp: espEnTexto,
						avisoPrefijo: prefijoSaludo,
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
			return {
				handled: true,
				texto: botAgenda.mensajeEspecialidadesDisponibles(resolucion.lista),
			};
		}

		const esp = resolucion.tipo === 'especialidad' ? resolucion.especialidad : null;
		if (!esp) {
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
			return armarRespuestaBuscarTurnoInicial({
				idConversacion,
				telefonoWhatsApp,
				flujo,
				esp,
			});
		}

		const pasoProf = pasoPorId(flujo, 'ELEGIR_PROFESIONAL');
		const profs = await botAgenda.listarProfesionalesBot(esp.valor);
		const listaProf = profs.profesionales
			.slice(0, 10)
			.map((p) => `• ${p.nombre}`)
			.join('\n');
		await botConversacion.guardarContextoBot(idConversacion, {
			especialidadValor: esp.valor,
			especialidadNombre: esp.nombre,
		});
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: pasoProf?.activo ? 'ELEGIR_PROFESIONAL' : pasoActual,
		});
		return {
			handled: true,
			texto: `Especialidad *${esp.nombre}*. Profesionales disponibles:\n\n${listaProf}\n\n${pasoProf?.mensajeUsuario || 'Indicá el profesional.'}`,
		};
	}

	// --- Confirmación de turno sugerido ---
	const convAct = (await botConversacion.obtenerConversacion(idConversacion)) || conv;
	if (pasoActual === 'CONFIRMAR' && convAct.contextoBot?.tipo === 'turno_sugerido') {
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR');
		const ctx = convAct.contextoBot;
		let intentGpt = null;
		let conf = null;

		if (gptHabilitado()) {
			intentGpt = await botIntencion.interpretarIntencion({
				texto,
				conv: convAct,
				idConversacion,
				pasoBot: pasoActual,
			});
			if (intentGpt?.intencion === 'confirmar_turno') conf = true;
			else if (intentGpt?.intencion === 'rechazar_turno') conf = false;
			else conf = interpretarConfirmacion(texto);
		} else {
			conf = interpretarConfirmacion(texto);
		}

		if (intentGpt?.intencion === 'cambiar_especialidad') {
			await botConversacion.guardarContextoBot(idConversacion, null);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: 'ELEGIR_ESPECIALIDAD',
			});
			return {
				handled: true,
				texto: pasoEspecialidad?.mensajeUsuario || '¿Qué especialidad necesitás?',
			};
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
				return {
					handled: true,
					texto: saludo ? `Perfecto, ${saludo}.\n\n${ticket}` : ticket,
				};
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
			const ajuste =
				buscarPorGpt && intentGpt
					? botIntencion.intencionAAjusteTurno(intentGpt.intencion, intentGpt.parametros, ctx)
					: botAgenda.interpretarAjusteTurno(texto, ctx);
			return _planificarBusquedaTurno(idConversacion, ctx, texto, pasoCfg, ajuste);
		}

		if (!gptHabilitado()) {
			const ajusteLocal = botAgenda.interpretarAjusteTurno(texto, ctx);
			const tienePref =
				ajusteLocal.preferir.diasSemana.length ||
				ajusteLocal.preferir.fechas.length ||
				ajusteLocal.preferir.franja;
			if (interpretarRechazoTurno(texto, ctx) || tienePref) {
				return _planificarBusquedaTurno(idConversacion, ctx, texto, pasoCfg, ajusteLocal);
			}
		}

		if (intentGpt?.intencion === 'conversacion') {
			return {
				handled: true,
				texto: `${botAgenda.mensajeSugerenciaTurno(ctx, pasoCfg)}\n\nRespondé *Sí* para confirmar el turno o indicá otro día u horario.`,
			};
		}

		return {
			handled: true,
			texto: botAgenda.mensajeSugerenciaTurno(ctx, pasoCfg),
		};
	}

	return { handled: false, motivo: 'wizard no aplica' };
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
			let sugerencia = await botAgenda.sugerirPrimerTurnoDisponible(buscarTurno.especialidadValor);
			sugerencia = sugerencia
				? await botAgenda.validarSugerenciaTurno(sugerencia, buscarTurno.especialidadValor)
				: null;
			await botConversacion.guardarContextoBot(idConversacion, {
				tipo: 'turno_sugerido',
				especialidadValor: buscarTurno.especialidadValor,
				especialidadNombre: buscarTurno.especialidadNombre,
				...(sugerencia || {}),
			});
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: sugerencia ? 'CONFIRMAR' : 'ELEGIR_ESPECIALIDAD',
			});
			return {
				texto: botAgenda.mensajeSugerenciaTurno(sugerencia, pasoConfirmar),
			};
		}

		if (tipo === 'alternativo') {
			const { ctx, pasoCfg, ajuste: ajusteGuardado } = buscarTurno;
			const ajuste =
				ajusteGuardado || botAgenda.interpretarAjusteTurno(buscarTurno.textoRechazo || '', ctx);
			let siguiente = await botAgenda.sugerirPrimerTurnoDisponible(ctx.especialidadValor, {
				excluir: ajuste.excluir,
				preferir: ajuste.preferir,
			});

			if (!siguiente && ajuste.preferir?.fechas?.length) {
				siguiente = await botAgenda.sugerirPrimerTurnoDisponible(ctx.especialidadValor, {
					excluir: ajuste.excluir,
					preferir: { ...ajuste.preferir, fechas: [] },
				});
			}

			if (!siguiente) {
				await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot: 'CONFIRMAR' });
				const pref = ajuste.resumen ? ` *${ajuste.resumen}*` : '';
				return {
					texto: `No encontré turno disponible${pref} en los próximos días. Decime otro día u horario que te sirva.`,
				};
			}

			siguiente = await botAgenda.validarSugerenciaTurno(siguiente, ctx.especialidadValor);
			if (!siguiente) {
				return {
					texto: 'No hay turnos con profesionales habilitados en la agenda. Contactá al centro o probá otra especialidad.',
				};
			}

			await botConversacion.guardarContextoBot(idConversacion, {
				tipo: 'turno_sugerido',
				especialidadValor: ctx.especialidadValor,
				especialidadNombre: ctx.especialidadNombre,
				...siguiente,
			});
			await botConversacion.actualizarContextoPaciente(idConversacion, { pasoBot: 'CONFIRMAR' });
			return {
				texto: botAgenda.mensajeSugerenciaTurno(siguiente, pasoCfg, {
					alternativa: true,
					preferencia: ajuste.resumen,
				}),
			};
		}
	} catch (err) {
		diag.warn('wizard', 'Error ejecutando búsqueda de turno', { error: err.message, tipo });
		return {
			texto:
				'Hubo un problema al consultar la agenda. ¿Podés repetir qué día y horario te conviene?',
		};
	}

	return { texto: 'No pude completar la búsqueda de turnos. Intentá de nuevo.' };
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
};
