/**
 * Facturación > Rendiciones: cabecera (imRendiciones) y su detalle valorizado (imFacDetalle).
 */
const rendicionesService = require('../services/facturacion/rendiciones.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const ctx = (req) => ({ actor: req.valorPersonal ?? null, ip: req.ip });

/** Envuelve un handler: responde { success, data } o el error con `detalles`. */
const manejar = (mensajeGenerico, fn) => async (req, res) => {
	try {
		const data = await fn(req);
		return res.json({ success: true, data });
	} catch (error) {
		const status = statusDeError(error);
		if (status >= 500) console.error(`${mensajeGenerico}:`, error);
		return res.status(status).json({
			success: false,
			mensaje: mensajeDeError(error, mensajeGenerico),
			detalles: Array.isArray(error?.detalles) ? error.detalles : undefined,
		});
	}
};

module.exports = {
	catalogos: manejar('Error al obtener los catálogos de rendiciones', () => rendicionesService.catalogos()),
	listar: manejar('Error al listar las rendiciones', (req) => rendicionesService.listar(req.query)),
	exportar: manejar('Error al exportar las rendiciones', (req) => rendicionesService.exportar(req.query)),
	obtener: manejar('Error al obtener la rendición', (req) => rendicionesService.obtener(req.params.id)),
	visitas: manejar('Error al obtener las visitas de la rendición', (req) =>
		rendicionesService.visitas(req.params.id, req.query),
	),
	lineas: manejar('Error al obtener las prestaciones de la rendición', (req) =>
		rendicionesService.lineas(req.params.id, req.query),
	),
	facturas: manejar('Error al obtener las facturas de la rendición', (req) => rendicionesService.facturas(req.params.id)),
	crear: manejar('Error al crear la rendición', (req) => rendicionesService.crear(req.body, ctx(req))),
	actualizar: manejar('Error al guardar la rendición', (req) =>
		rendicionesService.actualizar(req.params.id, req.body, ctx(req)),
	),
	eliminar: manejar('Error al borrar la rendición', (req) => rendicionesService.eliminar(req.params.id, ctx(req))),
};
