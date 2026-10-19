/**
 * Facturación > Convenios: cabecera (imClientesConvenios) y sus pestañas de detalle.
 */
const conveniosService = require('../services/facturacion/convenios.service');
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
	catalogos: manejar('Error al obtener los catálogos de convenios', () => conveniosService.catalogos()),
	buscarEnCatalogo: manejar('Error al buscar en el catálogo', (req) =>
		conveniosService.buscarEnCatalogo(req.params.tipo, req.query.q),
	),
	listar: manejar('Error al listar los convenios', (req) => conveniosService.listar(req.query)),
	obtener: manejar('Error al obtener el convenio', (req) => conveniosService.obtener(req.params.codigo)),
	uso: manejar('Error al contar los usos del convenio', (req) => conveniosService.uso(req.params.codigo)),
	crear: manejar('Error al crear el convenio', (req) => conveniosService.crear(req.body, ctx(req))),
	actualizar: manejar('Error al guardar el convenio', (req) =>
		conveniosService.actualizar(req.params.codigo, req.body, ctx(req)),
	),
	listarPestana: manejar('Error al obtener el detalle del convenio', (req) =>
		conveniosService.listarPestana(req.params.codigo, req.params.pestana, req.query),
	),
	guardarLote: manejar('Error al guardar los cambios del convenio', (req) =>
		conveniosService.guardarLote(req.params.codigo, req.params.pestana, req.body, ctx(req)),
	),
	previsualizarAjuste: manejar('Error al calcular el ajuste', (req) =>
		conveniosService.previsualizarAjuste(req.params.codigo, req.body),
	),
	aplicarAjuste: manejar('Error al aplicar el ajuste', (req) =>
		conveniosService.aplicarAjuste(req.params.codigo, req.body, ctx(req)),
	),
	duplicar: manejar('Error al duplicar el convenio', (req) =>
		conveniosService.duplicar(req.params.codigo, req.body, ctx(req)),
	),
	exportar: manejar('Error al exportar el convenio', (req) => conveniosService.exportar(req.params.codigo)),
	reporteMantenimiento: manejar('Error al revisar la consistencia de convenios', () =>
		conveniosService.reporteMantenimiento(),
	),
	limpiarHuerfanas: manejar('Error al limpiar las filas huérfanas', (req) =>
		conveniosService.limpiarHuerfanas(req.body, ctx(req)),
	),
};
