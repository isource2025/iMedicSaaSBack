const botAgenda = require('../services/botAgenda.service');
const { mapBotError } = require('../utils/botErrorCodes');

function _err(res, err, fallbackCode) {
	const mapped = mapBotError(err, fallbackCode);
	return res.status(mapped.statusCode).json({
		success: false,
		code: err?.code || mapped.code,
		mensaje: mapped.mensaje,
		mensajeBot: mapped.mensajeBot,
	});
}

async function obtenerConfig(req, res) {
	try {
		const data = await botAgenda.obtenerConfigCompleta();
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

/**
 * Puerta de entrada del chatbot: solo DNI → RENAPER + paciente local.
 */
async function identificar(req, res) {
	try {
		const body = req.body || {};
		const data = await botAgenda.identificarPaciente({
			numeroDocumento: body.numeroDocumento ?? body.dni,
			sexo: body.sexo,
			telefonoWhatsApp: body.telefonoWhatsApp ?? body.telefono,
			crearSiNoExiste: body.crearSiNoExiste === true || body.crearSiNoExiste === 'true',
			idConversacion: body.idConversacion,
		});
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function buscarPacientes(req, res) {
	try {
		const data = await botAgenda.buscarPaciente({
			dni: req.query.dni,
			telefono: req.query.telefono,
		});
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function crearPaciente(req, res) {
	try {
		const data = await botAgenda.crearPacienteBot(req.body || {});
		res.status(201).json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function especialidades(req, res) {
	try {
		const data = await botAgenda.listarEspecialidadesBot();
		res.json({ success: true, data: { especialidades: data, siguientePaso: 'ELEGIR_PROFESIONAL' } });
	} catch (err) {
		_err(res, err);
	}
}

async function profesionales(req, res) {
	try {
		const data = await botAgenda.listarProfesionalesBot(
			req.query.especialidad,
			req.query.servicio,
		);
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function disponibilidad(req, res) {
	try {
		const { fecha, servicio, especialidad, matricula } = req.query;
		const esp =
			especialidad != null && especialidad !== '' ? Number(especialidad) : undefined;
		const mat =
			matricula != null && matricula !== '' ? Number(matricula) : undefined;
		const data = await botAgenda.disponibilidadBot(String(fecha || ''), {
			servicio: servicio ? String(servicio).trim() : undefined,
			especialidad: Number.isFinite(esp) ? esp : undefined,
			matricula: Number.isFinite(mat) ? mat : undefined,
		});
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function ticketTurno(req, res) {
	try {
		const data = await botAgenda.obtenerTicketTurno(req.params.idTurno);
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function reservar(req, res) {
	try {
		const codOperador = req.botContext?.codOperador ?? 0;
		const data = await botAgenda.reservarTurno(req.body || {}, codOperador);
		res.status(201).json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function turnosPaciente(req, res) {
	try {
		const proximos = req.query.proximos !== 'false' && req.query.proximos !== '0';
		const data = await botAgenda.consultarTurnosPaciente({
			idPaciente: req.query.idPaciente,
			dni: req.query.dni,
			proximos,
		});
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

async function cancelar(req, res) {
	try {
		const data = await botAgenda.cancelarTurnoBot(req.body || {});
		res.json({ success: true, data });
	} catch (err) {
		_err(res, err);
	}
}

module.exports = {
	obtenerConfig,
	identificar,
	buscarPacientes,
	crearPaciente,
	especialidades,
	profesionales,
	disponibilidad,
	reservar,
	turnosPaciente,
	cancelar,
	ticketTurno,
};
