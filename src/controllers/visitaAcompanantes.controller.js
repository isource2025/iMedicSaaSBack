const service = require('../services/visitaAcompanantes.service');
const { resolveCodOperador } = require('../utils/sessionIdentity');
const { statusDeError } = require('../utils/httpError');

function fallar(res, error, mensajePorDefecto) {
	const status = error?.statusCode || statusDeError(error);
	res.status(status).json({
		success: false,
		message: error?.message || mensajePorDefecto,
	});
}

async function panel(req, res) {
	try {
		const data = await service.obtenerPanel(req.params.numeroVisita);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al cargar acompañantes y novedades:', error);
		fallar(res, error, 'Error al cargar acompañantes y novedades');
	}
}

async function agregarAcompanante(req, res) {
	try {
		const data = await service.agregarAcompanante(req.params.numeroVisita, req.body || {}, {
			codOperador: resolveCodOperador(req),
		});
		res.status(201).json({ success: true, data });
	} catch (error) {
		console.error('Error al agregar el acompañante:', error);
		fallar(res, error, 'Error al agregar el acompañante');
	}
}

async function quitarAcompanante(req, res) {
	try {
		const data = await service.quitarAcompanante(req.params.numeroVisita, req.body || {});
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al quitar el acompañante:', error);
		fallar(res, error, 'Error al quitar el acompañante');
	}
}

async function guardarObservacion(req, res) {
	try {
		const data = await service.guardarObservacion(
			req.params.numeroVisita,
			req.body?.observaciones,
		);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al guardar la observación:', error);
		fallar(res, error, 'Error al guardar la observación');
	}
}

async function agregarNovedad(req, res) {
	try {
		const data = await service.agregarNovedad(req.params.numeroVisita, req.body?.novedad, {
			codOperador: resolveCodOperador(req),
		});
		res.status(201).json({ success: true, data });
	} catch (error) {
		console.error('Error al agregar la novedad:', error);
		fallar(res, error, 'Error al agregar la novedad');
	}
}

async function quitarNovedad(req, res) {
	try {
		const data = await service.quitarNovedad(
			req.params.numeroVisita,
			req.query.fechaCarga,
			req.query.horaCarga,
		);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al quitar la novedad:', error);
		fallar(res, error, 'Error al quitar la novedad');
	}
}

module.exports = {
	panel,
	agregarAcompanante,
	quitarAcompanante,
	guardarObservacion,
	agregarNovedad,
	quitarNovedad,
};
