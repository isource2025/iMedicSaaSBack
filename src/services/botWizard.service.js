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
	if (/^(si|s|yes|ok|dale|confirmo|correcto|exacto|1|soy yo|afirmativo)$/.test(t)) return true;
	if (/^(no|n|nop|incorrecto|otra persona|2|negativo)$/.test(t)) return false;
	if (/\b(si|confirmo|correcto)\b/.test(t)) return true;
	if (/\b(no|incorrecto|otra)\b/.test(t)) return false;
	return null;
}

function formatearPersonaRenaper(renaper, dni, pacienteLocal = null) {
	const lineas = [];
	const apellido = String(renaper?.apellido || '').trim();
	const nombres = String(renaper?.nombres || '').trim();
	let nombre =
		renaper?.nombreCompleto ||
		(apellido && nombres ? `${apellido} ${nombres}` : null) ||
		apellido ||
		nombres ||
		pacienteLocal?.nombre ||
		null;

	if (nombre) {
		lineas.push(`Nombre: *${nombre}*`);
	} else if (apellido || nombres) {
		if (apellido) lineas.push(`Apellido: *${apellido}*`);
		if (nombres) lineas.push(`Nombres: *${nombres}*`);
	}

	lineas.push(`DNI: *${dni}*`);

	if (renaper?.fechaNacimiento) {
		lineas.push(`Fecha de nacimiento: ${renaper.fechaNacimiento}`);
	}
	if (renaper?.sexo) {
		lineas.push(
			`Sexo: ${renaper.sexo === 'F' ? 'Femenino' : renaper.sexo === 'M' ? 'Masculino' : renaper.sexo}`,
		);
	}
	if (renaper?.domicilio) lineas.push(`Domicilio: ${renaper.domicilio}`);

	return lineas.join('\n');
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
	if (!dni || conv.idPaciente) return false;
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

function mensajeErrorRenaper(err) {
	if (err?.code === 'RENAPER_TIMEOUT') {
		return 'La consulta a RENAPER tardó demasiado. Intentá enviar tu DNI de nuevo en unos segundos.';
	}
	if (err?.code === 'RENAPER_NO_ENCONTRADO') {
		return 'No encontramos ese DNI en RENAPER. Verificá el número e intentá de nuevo.';
	}
	if (err?.code === 'RENAPER_UNAVAILABLE') {
		return 'RENAPER no responde desde el servidor en la nube. Intentá de nuevo en unos segundos o contactá al centro.';
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
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				dniPaciente: String(dni),
				nombreContacto:
					data.renaper.nombreCompleto ||
					data.pacienteLocal?.nombre ||
					conv.nombreContacto,
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
			const data = await botAgenda.identificarPaciente({
				numeroDocumento: conv.dniPaciente,
				telefonoWhatsApp,
				crearSiNoExiste: true,
				idConversacion,
				omitirAvancePaso: true,
			});
			const siguiente = siguientePasoActivo(flujo, 'CONFIRMAR_IDENTIDAD');
			const pasoCfg = pasoPorId(flujo, siguiente);
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: data.idPaciente,
				dniPaciente: String(conv.dniPaciente),
				nombreContacto:
					data.pacienteLocal?.nombre || data.renaper?.nombreCompleto || conv.nombreContacto,
				pasoBot: siguiente,
			});
			const nombre =
				data.pacienteLocal?.nombre || data.renaper?.nombreCompleto || conv.nombreContacto;
			return {
				handled: true,
				texto: pasoCfg?.mensajeUsuario
					? `Perfecto${nombre ? `, ${nombre.split(' ')[0]}` : ''}. ${pasoCfg.mensajeUsuario}`
					: `Gracias${nombre ? `, ${nombre.split(' ')[0]}` : ''}. Continuemos con tu turno.`,
			};
		}
		if (conf === false) {
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				idPaciente: null,
				dniPaciente: null,
				nombreContacto: null,
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

	return { handled: false, motivo: 'wizard no aplica' };
}

module.exports = {
	pasosActivos,
	siguientePasoActivo,
	pasoInicial,
	intentarRespuestaWizard,
	extraerDni,
	interpretarConfirmacion,
};
