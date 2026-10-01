const produccionService = require('../services/produccionHospital.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

function _responderError(res, error, contexto, mensajeGenerico) {
	console.error(`Error en ${contexto}:`, error);
	res.status(statusDeError(error)).json({
		success: false,
		message: mensajeDeError(error, mensajeGenerico),
		error: error.message,
	});
}

/** Analítica completa de producción del hospital (página Reportes → Facturación). */
const obtenerProduccion = async (req, res) => {
	try {
		const data = await produccionService.obtenerProduccion(req.query);
		res.json({ success: true, data });
	} catch (error) {
		_responderError(res, error, 'obtenerProduccion', 'Error al obtener la producción del hospital');
	}
};

/** Catálogos para los selectores de filtro. */
const obtenerOpciones = async (req, res) => {
	try {
		const data = await produccionService.obtenerOpciones(req.query);
		res.json({ success: true, data });
	} catch (error) {
		_responderError(res, error, 'obtenerOpciones', 'Error al obtener las opciones de filtro');
	}
};

/** Resumen del mes en curso para la card del panel de control. */
const obtenerResumenMes = async (req, res) => {
	try {
		const data = await produccionService.obtenerResumenMes();
		res.json({ success: true, data });
	} catch (error) {
		_responderError(res, error, 'obtenerResumenMes', 'Error al obtener el resumen de producción del mes');
	}
};

module.exports = {
	obtenerProduccion,
	obtenerOpciones,
	obtenerResumenMes,
};
