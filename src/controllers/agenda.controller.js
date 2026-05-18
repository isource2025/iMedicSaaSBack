const service = require('../services/agenda.service');

function _enforceAlcance(req, res, matriculaParam) {
	const m = Number(matriculaParam);
	if (!Number.isFinite(m) || m <= 0) {
		res.status(400).json({ success: false, mensaje: 'Matrícula inválida' });
		return null;
	}
	if (req.rolNombre === 'MEDICO' && req.matricula !== m) {
		res.status(403).json({ success: false, mensaje: 'Sólo podés ver tu propia agenda' });
		return null;
	}
	return m;
}

function _err(res, e) {
	const code = e?.statusCode || 500;
	return res.status(code).json({ success: false, mensaje: e?.message || 'Error interno' });
}

async function obtenerSlots(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const { desde, hasta } = req.query;
		if (!desde || !hasta) {
			return res.status(400).json({
				success: false,
				mensaje: 'Query params desde y hasta (YYYY-MM-DD) son requeridos',
			});
		}
		const data = await service.generarSlots(m, String(desde), String(hasta));
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function obtenerResumen(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const { fecha } = req.query;
		if (!fecha) {
			return res.status(400).json({
				success: false,
				mensaje: 'Query param fecha (YYYY-MM-DD) es requerido',
			});
		}
		const data = await service.resumenDia(m, String(fecha));
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function listarTurnos(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const { desde, hasta } = req.query;
		if (!desde || !hasta) {
			return res.status(400).json({
				success: false,
				mensaje: 'Query params desde y hasta son requeridos',
			});
		}
		const data = await service.listarTurnos(m, String(desde), String(hasta));
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function obtenerDisponibilidad(req, res) {
	try {
		const { fecha } = req.query;
		if (!fecha) {
			return res.status(400).json({
				success: false,
				mensaje: 'Query param fecha (YYYY-MM-DD) es requerido',
			});
		}
		const servicio = req.query.servicio ? String(req.query.servicio).trim() : undefined;
		const especialidad =
			req.query.especialidad != null && req.query.especialidad !== ''
				? Number(req.query.especialidad)
				: undefined;
		const data = await service.disponibilidadDia(String(fecha), {
			servicio: servicio || undefined,
			especialidad: Number.isFinite(especialidad) ? especialidad : undefined,
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function asignarTurno(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const body = req.body || {};
		const data = await service.asignarTurno({
			matricula: m,
			fecha: String(body.fecha || ''),
			hora: String(body.hora || ''),
			horaClarion:
				body.horaClarion != null && Number.isFinite(Number(body.horaClarion))
					? Number(body.horaClarion)
					: null,
			sector: String(body.sector || '').trim(),
			idPaciente: Number(body.idPaciente),
			observaciones: body.observaciones || '',
			tipoTurno: body.tipoTurno != null ? Number(body.tipoTurno) : 0,
			especialidad: body.especialidad != null ? Number(body.especialidad) : 0,
			codOperador: req.valorPersonal != null ? Number(req.valorPersonal) : 0,
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function actualizarTurno(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const idTurno = Number(req.params.idTurno);
		const body = req.body || {};
		const data = await service.actualizarTurno({
			matricula: m,
			idTurno,
			idPaciente: Number(body.idPaciente),
			observaciones: body.observaciones,
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function cancelarTurno(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const idTurno = Number(req.params.idTurno);
		const data = await service.cancelarTurno({ matricula: m, idTurno });
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function borrarTurno(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const idTurno = Number(req.params.idTurno);
		const data = await service.borrarTurno({ matricula: m, idTurno });
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function cerrarTurno(req, res) {
	try {
		const m = _enforceAlcance(req, res, req.params.matricula);
		if (m == null) return;
		const idTurno = Number(req.params.idTurno);
		const data = await service.cerrarTurno({ matricula: m, idTurno });
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function buscarTurnosPorPaciente(req, res) {
	try {
		const idPaciente = Number(req.query.idPaciente);
		if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
			return res.status(400).json({
				success: false,
				mensaje: 'Query param idPaciente es requerido',
			});
		}
		const matriculaMedico =
			req.rolNombre === 'MEDICO' && req.matricula ? Number(req.matricula) : null;
		const data = await service.buscarTurnosPorPaciente(idPaciente, {
			matriculaMedico: Number.isFinite(matriculaMedico) ? matriculaMedico : null,
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function listarProfesionales(req, res) {
	try {
		const servicio = req.query.servicio ? String(req.query.servicio).trim() : undefined;
		const especialidad =
			req.query.especialidad != null && req.query.especialidad !== ''
				? Number(req.query.especialidad)
				: undefined;
		const data = await service.listarProfesionalesAgenda({
			servicio: servicio || undefined,
			especialidad: Number.isFinite(especialidad) ? especialidad : undefined,
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

module.exports = {
	obtenerSlots,
	obtenerResumen,
	listarTurnos,
	buscarTurnosPorPaciente,
	obtenerDisponibilidad,
	listarProfesionales,
	asignarTurno,
	actualizarTurno,
	cancelarTurno,
	borrarTurno,
	cerrarTurno,
};
