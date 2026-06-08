/**
 * Wizard determinístico del bot (RENAPER, confirmación, pasos activos).
 * GPT complementa solo cuando el wizard no resuelve el turno.
 */
const botAgenda = require('./botAgenda.service');
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');
const diag = require('../utils/diagLog');

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
	if (/\b(si|confirmo|correcto)\b/.test(t)) return true;
	if (/\b(no|incorrecto|otra)\b/.test(t)) return false;
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

	const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
	for (const dia of dias) {
		if (t.includes(dia) && /\b(no|ni|imposible|puedo)\b/.test(t)) return true;
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

	if (
		pasoActual === 'IDENTIFICAR' ||
		pasoActual === 'inicio' ||
		pasoActual === 'CONFIRMAR_IDENTIDAD' ||
		!pasoActual
	) {
		return true;
	}

	return !conv.dniPaciente;
}

function esInicioNuevoTurno(texto) {
	const t = String(texto || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	return /^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches)$/.test(t) ||
		/\b(quiero un turno|necesito un turno|sacar un turno|pedir turno|nuevo turno)\b/.test(t);
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
			if (conv.idPaciente || conv.contextoBot) {
				await botConversacion.limpiarEstadoWizard(idConversacion);
			} else {
				await botConversacion.guardarContextoBot(idConversacion, null);
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

	// DNI consultado pero sin confirmar: forzar paso de confirmación.
	if (conv.dniPaciente && !conv.idPaciente && pasoConfirmarActivo && pasoActual !== 'CONFIRMAR_IDENTIDAD') {
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: 'CONFIRMAR_IDENTIDAD',
		});
		pasoActual = 'CONFIRMAR_IDENTIDAD';
	}

	const texto = String(contenido || '').trim();
	const dniEnMensaje = extraerDni(texto);
	const pasoIdentificar = pasoPorId(flujo, 'IDENTIFICAR');

	// --- Hola / nuevo turno: reiniciar flujo (tras turno confirmado u otra sesión) ---
	if (esInicioNuevoTurno(texto) && pasoIdentificar?.activo !== false) {
		await botConversacion.limpiarEstadoWizard(idConversacion);
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: 'IDENTIFICAR',
		});
		const saludo = primerNombre(nombreWhatsApp(conv));
		const msg = pasoIdentificar?.mensajeUsuario || 'Para comenzar, indicá tu DNI (sin puntos).';
		return {
			handled: true,
			texto: saludo ? `Hola, ${saludo}. ${msg}` : msg,
		};
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
		const conf = interpretarConfirmacion(texto);
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD');

		if (conf === true) {
			const config = await botConfigService.getBotConfig();
			const data = await botAgenda.identificarPaciente({
				numeroDocumento: conv.dniPaciente,
				telefonoWhatsApp,
				crearSiNoExiste: true,
				idConversacion,
				omitirAvancePaso: true,
			});
			let siguiente = siguientePasoActivo(flujo, 'CONFIRMAR_IDENTIDAD');
			if (
				config.reglas.sugerirPrimerTurnoDisponible &&
				pasoPorId(flujo, 'ELEGIR_ESPECIALIDAD')?.activo !== false
			) {
				siguiente = 'ELEGIR_ESPECIALIDAD';
			}
			const pasoCfg = pasoPorId(flujo, siguiente);
			await botConversacion.guardarContextoBot(idConversacion, null);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: data.idPaciente,
				dniPaciente: String(conv.dniPaciente),
				pasoBot: siguiente,
			});
			const saludo = primerNombre(nombreWhatsApp(conv));
			return {
				handled: true,
				texto: pasoCfg?.mensajeUsuario
					? `Perfecto${saludo ? `, ${saludo}` : ''}. ${pasoCfg.mensajeUsuario}`
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

		return {
			handled: true,
			texto: await reconsultarRenaperParaConfirmacion(
				conv,
				telefonoWhatsApp,
				idConversacion,
				pasoCfg,
			),
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

	if ((esPasoEspecialidad || esPasoProfConSugerir) && conv.idPaciente) {
		const esp = await botAgenda.resolverEspecialidadDesdeTexto(texto);
		if (!esp) {
			if (esPasoProfConSugerir) {
				return {
					handled: true,
					texto:
						'Indicá la especialidad que necesitás (por ejemplo: *Traumatología*) y te propongo el turno libre más cercano.',
				};
			}
			const lista = await botAgenda.listarEspecialidadesBot();
			const opciones = lista
				.slice(0, 12)
				.map((e) => `• ${e.nombre}`)
				.join('\n');
			return {
				handled: true,
				texto: `No encontré esa especialidad. Estas son las disponibles:\n\n${opciones}\n\nIndicá cuál necesitás.`,
			};
		}

		if (sugerirTurno) {
			const sugerencia = await botAgenda.sugerirPrimerTurnoDisponible(esp.valor);
			const pasoConfirmar = pasoPorId(flujo, 'CONFIRMAR');
			await botConversacion.guardarContextoBot(idConversacion, {
				tipo: 'turno_sugerido',
				especialidadValor: esp.valor,
				especialidadNombre: esp.nombre,
				...(sugerencia || {}),
			});
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				pasoBot: sugerencia ? 'CONFIRMAR' : 'ELEGIR_ESPECIALIDAD',
			});
			return {
				handled: true,
				texto: botAgenda.mensajeSugerenciaTurno(sugerencia, pasoConfirmar),
			};
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
		const conf = interpretarConfirmacion(texto);
		const pasoCfg = pasoPorId(flujo, 'CONFIRMAR');
		const ctx = convAct.contextoBot;
		const tNorm = String(texto || '')
			.trim()
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');

		if (/\b(otra especialidad|cambiar especialidad)\b/.test(tNorm)) {
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
				await botConversacion.limpiarEstadoWizard(idConversacion);
				await botConversacion.actualizarContextoPaciente(idConversacion, {
					pasoBot: pasoInicial(flujo),
				});
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

		if (conf === false || interpretarRechazoTurno(texto, ctx)) {
			return _buscarSiguienteTurnoSugerido(idConversacion, ctx, texto, pasoCfg);
		}

		return {
			handled: true,
			texto: botAgenda.mensajeSugerenciaTurno(ctx, pasoCfg),
		};
	}

	return { handled: false, motivo: 'wizard no aplica' };
}

async function _buscarSiguienteTurnoSugerido(idConversacion, ctx, textoRechazo, pasoCfg) {
	const excluir = botAgenda.construirExclusionesRechazo(textoRechazo, ctx);
	const siguiente = await botAgenda.sugerirPrimerTurnoDisponible(ctx.especialidadValor, { excluir });

	if (!siguiente) {
		await botConversacion.guardarContextoBot(idConversacion, {
			tipo: 'turno_sugerido',
			especialidadValor: ctx.especialidadValor,
			especialidadNombre: ctx.especialidadNombre,
		});
		await botConversacion.actualizarContextoPaciente(idConversacion, {
			pasoBot: 'ELEGIR_ESPECIALIDAD',
		});
		return {
			handled: true,
			texto:
				'No encontré otro turno disponible con esas restricciones en los próximos días. ¿Querés probar otra especialidad o decime qué días sí podés?',
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
		handled: true,
		texto: botAgenda.mensajeSugerenciaTurno(siguiente, pasoCfg, { alternativa: true }),
	};
}

module.exports = {
	pasosActivos,
	siguientePasoActivo,
	pasoInicial,
	intentarRespuestaWizard,
	extraerDni,
	interpretarConfirmacion,
	interpretarRechazoTurno,
};
