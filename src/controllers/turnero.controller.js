const turneroService = require('../services/turnero.service');
const turneroEvents = require('../services/turneroEvents.service');
const tokenIndex = require('../services/turneroTokenIndex.service');
const { runWithTenant } = require('../context/tenantContext');

function _err(res, e) {
	const status = e.statusCode || 500;
	res.status(status).json({
		success: false,
		mensaje: e.message || 'Error interno',
		code: e.code,
	});
}

async function obtenerAdmin(req, res) {
	try {
		const idPantalla = req.query.idPantalla;
		const data = await turneroService.getAdminState(idPantalla);
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function listarPantallas(req, res) {
	try {
		const data = await turneroService.listarPantallas();
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function crearPantalla(req, res) {
	try {
		const { nombre, sectoresFiltrados, copiarDesdeIdPantalla } = req.body || {};
		const data = await turneroService.crearPantalla({
			nombre,
			sectoresFiltrados,
			copiarDesdeIdPantalla,
		});
		res.status(201).json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function desactivarPantalla(req, res) {
	try {
		const id = Number(req.params.idPantalla);
		const data = await turneroService.desactivarPantalla(id);
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function guardarAdmin(req, res) {
	try {
		const { idPantalla, nombre, config } = req.body || {};
		const data = await turneroService.saveAdminConfig({ idPantalla, nombre, config });
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function regenerarToken(req, res) {
	try {
		const { idPantalla } = req.body || {};
		const data = await turneroService.regenerarToken(idPantalla);
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function llamarTurno(req, res) {
	try {
		const { matriculaAlcanceAgenda } = require('../utils/matriculaTenant');
		const m = await matriculaAlcanceAgenda(req, res, req.params.matricula);
		if (m == null) return;
		const idTurno = Number(req.params.idTurno);
		const data = await turneroService.registrarLlamado({
			matricula: m,
			idTurno,
			porIdTurno: req.rolNombre !== 'MEDICO',
		});
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

async function obtenerUrl(req, res) {
	try {
		const data = await turneroService.getDisplayUrl();
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

module.exports = {
	obtenerAdmin,
	listarPantallas,
	crearPantalla,
	desactivarPantalla,
	guardarAdmin,
	regenerarToken,
	llamarTurno,
	obtenerUrl,
};
