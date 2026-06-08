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
	if (/^(no|n|nop|incorrecto|otra persona|2|negativo)$/.test(t)) return false;
	// "no tenés para el miércoles" es pregunta de disponibilidad, no rechazo binario
	if (/\bno\s+tenes?\b/.test(t) || /\bno\s+hay\b/.test(t)) return null;
	if (/\b(si|confirmo|correcto)\b/.test(t)) return true;
	if (/\b(incorrecto|otra persona)\b/.test(t)) return false;
	if (/\b(no confirmo|no quiero|no gracias|no me sirve)\b/.test(t)) return false;
	if (/^no\b/.test(t) && t.length <= 12) return false;
	return null;
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
function formatearPersonaRenaper(renaper, _dni, pacienteLocal = null) {
	const lineas = [];
	const nombre = nombreCompletoRenaper(renaper, pacienteLocal);
	if (nombre) lineas.push(`Nombre: *${nombre}*`);
	if (renaper?.fechaNacimiento) {
		lineas.push(`Fecha de nacimiento: ${renaper.fechaNacimiento}`);
	} else if (pacienteLocal?.fechaNacimiento) {
		lineas.push(`Fecha de nacimiento: ${pacienteLocal.fechaNacimiento}`);
	}
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

function mensajeConfirmacionRenaper({ renaper, dni, pacienteLocal, pasoCfg }) {
	const fuente = renaper?.fuente === 'local' ? 'ficha local' : 'RENAPER';
	const detalle = formatearPersonaRenaper(renaper, dni, pacienteLocal);
	return `Encontramos en *${fuente}*:\n${detalle}\n\n${pasoCfg?.mensajeUsuario || '¿Sos vos? Respondé Sí o No.'}`;
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

function esInicioNuevoTurno(texto) {
	const t = String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)$/.test(t)) return true;
	if (/\b(quiero un turno|necesito un turno|sacar un turno|pedir turno|nuevo turno)\b/.test(t)) {
		return true;
	}
	if (/\b(quiero|necesito|busco|estoy queriendo)\b.*\b(turno|consulta)\b/.test(t)) return true;
	if (/\b(turno|consulta)\b.*\b(para|de)\b/.test(t)) return true;
	if (
		/\b(para mi|para el|para la|otra persona|otro paciente|mi familiar)\b/.test(t) &&
		/\b(turno|consulta|herman|hij|familiar|mama|mami|papa|nene|bebe)\b/.test(t)
	) {
		return true;
	}
	if (
		/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)\b/.test(t) &&
		/\b(turno|consulta|especialidad)\b/.test(t)
	) {
		return true;
	}
	return false;
}

async function detectarEspecialidadEnTexto(texto) {
	if (!texto || extraerDni(texto)) return null;
	if (botAgenda.esConsultaListaEspecialidades(texto)) return null;

	let esp = await botAgenda.resolverEspecialidadDesdeTexto(texto);
	if (!esp && gptHabilitado()) {
		try {
			const intent = await botIntencion.interpretarIntencion({
				texto,
				conv: null,
				pasoBot: 'IDENTIFICAR',
			});
			const res = await botIntencion.resolverEspecialidadDesdeIntencion(intent);
			if (res?.tipo === 'especialidad') esp = res.especialidad;
		} catch (_) {
			/* GPT opcional */
		}
	}
	return esp ? { valor: esp.valor, nombre: esp.nombre } : null;
}

async function capturarEspecialidadPendienteDesdeMensaje(idConversacion, conv, texto) {
	const esp = await detectarEspecialidadEnTexto(texto);
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
		diag.line('wizard', 'Consultando RENAPER por DNI', { dni, idConversacion });
		const data = await withTimeout(
			consultarRenaperPorDni(dni, telefonoWhatsApp, idConversacion, pasoConfirmarActivo),
			RENAPER_TIMEOUT_MS,
			'RENAPER',
		);
		diag.line('wizard', 'RENAPER respondió', {
			dni,
			encontrado: !!data.renaper?.encontrado,
			nombre: data.renaper?.nombreCompleto || null,
		});

		if (!data.renaper?.encontrado) {
			return {
				handled: true,
				texto: 'No encontramos ese DNI en RENAPER. Verificá el número e intentá de nuevo.',
			};
		}

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
	} catch (err) {
		diag.warn('wizard', 'Error consultando RENAPER', {
			dni,
			error: err.message,
			code: err.code,
		});
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
	const activos = pasosActivos(flujo);
	const pasoConfirmarActivo = !!pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD')?.activo;
	let pasoActual = conv.pasoBot || pasoInicial(flujo);

	const texto = String(contenido || '').trim();
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

	// --- Hola / nuevo turno: reiniciar flujo (tras turno confirmado u otra sesión) ---
	if (esInicioNuevoTurno(texto) && pasoIdentificar?.activo !== false) {
		const espPend = await detectarEspecialidadEnTexto(texto);
		await botConversacion.reiniciarFlujoNuevoTurno(idConversacion, 'IDENTIFICAR');
		if (espPend) {
			await botConversacion.guardarContextoBot(idConversacion, { especialidadPendiente: espPend });
		}
		const saludo = primerNombre(nombreWhatsApp(conv));
		const msg =
			pasoIdentificar?.mensajeUsuario ||
			'Para comenzar, indicá el DNI de la persona que va a atenderse (sin puntos).';
		return {
			handled: true,
			texto: saludo ? `Hola, ${saludo}. ${msg}` : msg,
		};
	}

	const pasoSinPaciente =
		!conv.idPaciente &&
		(pasoActual === 'IDENTIFICAR' || pasoActual === 'inicio' || !pasoActual);
	if (pasoSinPaciente && texto && !dniEnMensaje) {
		await capturarEspecialidadPendienteDesdeMensaje(idConversacion, conv, texto);
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
		let conf = interpretarConfirmacion(texto);
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD');

		if (conf == null && gptHabilitado()) {
			const intent = await botIntencion.interpretarIntencion({
				texto,
				conv,
				idConversacion,
				pasoBot: pasoActual,
			});
			if (intent?.intencion === 'confirmar_identidad') conf = true;
			if (intent?.intencion === 'rechazar_identidad') conf = false;
		}

		if (conf === true) {
			const config = await botConfigService.getBotConfig();
			const espPend = conv.contextoBot?.especialidadPendiente;
			const data = await botAgenda.identificarPaciente({
				numeroDocumento: conv.dniPaciente,
				telefonoWhatsApp,
				crearSiNoExiste: true,
				idConversacion,
				omitirAvancePaso: true,
			});
			await botConversacion.guardarContextoBot(idConversacion, null);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: data.idPaciente,
				dniPaciente: String(conv.dniPaciente),
			});
			if (!data.idPaciente) {
				diag.warn('wizard', 'Identidad confirmada sin idPaciente en ficha local', {
					idConversacion,
					dni: conv.dniPaciente,
					accion: data.accionSugerida,
				});
			}

			const saludo = primerNombre(nombreWhatsApp(conv));
			const prefijoSaludo = saludo ? `Perfecto, ${saludo}. ` : 'Perfecto. ';
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
			const pasoCfg = pasoPorId(flujo, siguiente);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: siguiente,
			});
			return {
				handled: true,
				texto: pasoCfg?.mensajeUsuario
					? `${prefijoSaludo.trim()} ${pasoCfg.mensajeUsuario}`
					: `Gracias${saludo ? `, ${saludo}` : ''}. Continuemos con tu turno.`,
			};
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

		const espEnTexto = await detectarEspecialidadEnTexto(texto);
		if (espEnTexto && conv.dniPaciente) {
			const config = await botConfigService.getBotConfig();
			const data = await botAgenda.identificarPaciente({
				numeroDocumento: conv.dniPaciente,
				telefonoWhatsApp,
				crearSiNoExiste: true,
				idConversacion,
				omitirAvancePaso: true,
			});
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
		const dataPac = await botAgenda.identificarPaciente({
			numeroDocumento: conv.dniPaciente,
			telefonoWhatsApp,
			crearSiNoExiste: true,
			idConversacion,
			omitirAvancePaso: true,
		});
		if (dataPac.idPaciente) {
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
			const espLocal = await botAgenda.resolverEspecialidadDesdeTexto(texto);
			if (espLocal) resolucion = { tipo: 'especialidad', especialidad: espLocal };
			else if (botAgenda.esConsultaListaEspecialidades(texto)) {
				resolucion = { tipo: 'listar', lista: await botAgenda.listarEspecialidadesBot() };
			}
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
		let conf = interpretarConfirmacion(texto);
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR');
		const ctx = convAct.contextoBot;
		let intentGpt = null;

		if (gptHabilitado()) {
			intentGpt = await botIntencion.interpretarIntencion({
				texto,
				conv: convAct,
				idConversacion,
				pasoBot: pasoActual,
			});
			if (conf == null && intentGpt?.intencion === 'confirmar_turno') conf = true;
			if (conf == null && intentGpt?.intencion === 'rechazar_turno') conf = false;
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
				await botConversacion.reiniciarFlujoNuevoTurno(idConversacion, pasoInicial(flujo));
				const saludo = primerNombre(nombreWhatsApp(convAct));
				const ticket = reserva.ticket?.mensajeWhatsApp || reserva.mensajeConfirmacion;
				return {
					handled: true,
					texto: saludo ? `Perfecto, ${saludo}.\n\n${ticket}` : ticket,
				};
			} catch (err) {
				diag.warn('wizard', 'Error reservando turno sugerido', { error: err.message });
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
			return { handled: false, motivo: 'gpt-conversacion' };
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
			const sugerencia = await botAgenda.sugerirPrimerTurnoDisponible(buscarTurno.especialidadValor);
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
