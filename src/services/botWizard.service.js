/**
 * Wizard determinístico del bot (RENAPER, confirmación, pasos activos).
 * GPT complementa solo cuando el wizard no resuelve el turno.
 */
const botAgenda = require('./botAgenda.service');
const botConfigService = require('./botConfig.service');
const botConversacion = require('./botConversacion.service');

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

function formatearPersonaRenaper(renaper, dni) {
	const lineas = [];
	if (renaper?.nombreCompleto) lineas.push(`Nombre: *${renaper.nombreCompleto}*`);
	lineas.push(`DNI: *${dni}*`);
	if (renaper?.fechaNacimiento) lineas.push(`Fecha de nacimiento: ${renaper.fechaNacimiento}`);
	if (renaper?.sexo) lineas.push(`Sexo: ${renaper.sexo === 'F' ? 'Femenino' : renaper.sexo === 'M' ? 'Masculino' : renaper.sexo}`);
	if (renaper?.domicilio) lineas.push(`Domicilio: ${renaper.domicilio}`);
	return lineas.join('\n');
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
	const pasoActual = conv.pasoBot || pasoInicial(flujo);
	const texto = String(contenido || '').trim();

	// --- Confirmación de identidad RENAPER ---
	if (pasoActual === 'CONFIRMAR_IDENTIDAD' && pasoConfirmarActivo) {
		const conf = interpretarConfirmacion(texto);
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
			texto: 'Respondé *Sí* o *No* para confirmar si los datos de RENAPER son correctos.',
		};
	}

	// --- Identificación por DNI + consulta RENAPER ---
	const pasoIdentificar = pasoPorId(flujo, 'IDENTIFICAR');
	if (
		pasoIdentificar?.activo &&
		(pasoActual === 'IDENTIFICAR' || pasoActual === 'inicio' || !pasoActual)
	) {
		const dni = extraerDni(texto);
		if (!dni) return { handled: false, motivo: 'sin dni en mensaje' };

		const data = await botAgenda.identificarPaciente({
			numeroDocumento: dni,
			telefonoWhatsApp,
			crearSiNoExiste: !pasoConfirmarActivo,
			idConversacion,
			omitirAvancePaso: pasoConfirmarActivo,
		});

		if (!data.renaper?.encontrado) {
			return {
				handled: true,
				texto: 'No encontramos ese DNI en RENAPER. Verificá el número e intentá de nuevo.',
			};
		}

		if (pasoConfirmarActivo) {
			const detalle = formatearPersonaRenaper(data.renaper, dni);
			const pasoCfg = pasoPorId(flujo, 'CONFIRMAR_IDENTIDAD');
			await botConversacion.actualizarContextoPaciente(idConversacion, {
				dniPaciente: String(dni),
				nombreContacto: data.renaper.nombreCompleto || conv.nombreContacto,
				pasoBot: 'CONFIRMAR_IDENTIDAD',
				idPaciente: null,
			});
			return {
				handled: true,
				texto: `Encontramos en *RENAPER*:\n${detalle}\n\n${pasoCfg?.mensajeUsuario || '¿Sos vos? Respondé Sí o No.'}`,
			};
		}

		const siguiente = siguientePasoActivo(flujo, 'IDENTIFICAR');
		const pasoCfg = pasoPorId(flujo, siguiente);
		return {
			handled: true,
			texto:
				pasoCfg?.mensajeUsuario ||
				'Gracias. ¿Qué especialidad necesitás?',
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
