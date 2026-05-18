const racService = require('../services/agendaRac.service');

function _err(res, e) {
	const code = e?.statusCode || 500;
	return res.status(code).json({ success: false, mensaje: e?.message || 'Error interno' });
}

async function obtenerRac(req, res) {
	try {
		const data = await racService.obtenerRac(req.params.idTurno);
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function crearControl(req, res) {
	try {
		const data = await racService.crearControlTurno(req.params.idTurno, req.body || {});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function crearMedicacion(req, res) {
	try {
		const data = await racService.crearMedicacionTurno(req.params.idTurno, req.body || {});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function actualizarTriage(req, res) {
	try {
		const body = req.body || {};
		const data = await racService.actualizarTriage(req.params.idTurno, {
			idClasificacionTriage: body.idClasificacionTriage,
			observaciones: body.observaciones,
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function eliminarControl(req, res) {
	try {
		await racService.eliminarControl(Number(req.params.valor));
		res.json({ success: true });
	} catch (e) {
		_err(res, e);
	}
}

async function eliminarMedicacion(req, res) {
	try {
		await racService.eliminarMedicacion(Number(req.params.idCtrlMedica));
		res.json({ success: true });
	} catch (e) {
		_err(res, e);
	}
}

module.exports = {
	obtenerRac,
	crearControl,
	crearMedicacion,
	actualizarTriage,
	eliminarControl,
	eliminarMedicacion,
};
