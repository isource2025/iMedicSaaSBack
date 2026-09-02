/**
 * Importación del Excel de liquidación de honorarios (Facturación >
 * Liquidaciones). Dos pasos: previsualizar, que no escribe nada, y aplicar.
 */
const liquidacionImportService = require('../services/liquidacionImport.service');

const respuestaDeError = (res, error, mensajeGenerico) => {
	const status = Number(error?.statusCode) || 500;
	if (status >= 500) console.error(`${mensajeGenerico}:`, error);
	return res.status(status).json({
		success: false,
		mensaje: status >= 500 ? mensajeGenerico : error.message,
		code: error?.code || null,
		resumen: error?.resumen || null,
	});
};

const archivoDeRequest = (req) => {
	const archivo = req.file;
	if (!archivo || !archivo.buffer || archivo.buffer.length === 0) {
		const e = new Error('Subí el archivo Excel de la liquidación');
		e.statusCode = 400;
		throw e;
	}
	return archivo;
};

/** POST /api/liquidaciones/importe-liquidado/preview */
const previsualizar = async (req, res) => {
	try {
		const archivo = archivoDeRequest(req);
		const data = await liquidacionImportService.previsualizar(
			archivo.buffer,
			archivo.originalname,
		);
		return res.json({ success: true, data });
	} catch (error) {
		return respuestaDeError(res, error, 'Error al previsualizar la liquidación');
	}
};

/** POST /api/liquidaciones/importe-liquidado/aplicar */
const aplicar = async (req, res) => {
	try {
		const archivo = archivoDeRequest(req);
		const confirmarParcial =
			String(req.body?.confirmarParcial ?? '').toLowerCase() === 'true';
		const data = await liquidacionImportService.aplicar(
			archivo.buffer,
			archivo.originalname,
			req.auth,
			{ confirmarParcial },
		);
		return res.json({ success: true, data });
	} catch (error) {
		return respuestaDeError(res, error, 'Error al aplicar la liquidación');
	}
};

/** GET /api/liquidaciones/importaciones */
const listarImportaciones = async (req, res) => {
	try {
		const data = await liquidacionImportService.listarImportaciones(req.query?.limite);
		return res.json({ success: true, data });
	} catch (error) {
		return respuestaDeError(res, error, 'Error al listar las importaciones');
	}
};

/** GET /api/liquidaciones/importaciones/:id */
const obtenerImportacion = async (req, res) => {
	try {
		const data = await liquidacionImportService.obtenerImportacion(req.params.id);
		return res.json({ success: true, data });
	} catch (error) {
		return respuestaDeError(res, error, 'Error al obtener la importación');
	}
};

/** POST /api/liquidaciones/importaciones/:id/revertir */
const revertir = async (req, res) => {
	try {
		const data = await liquidacionImportService.revertir(req.params.id);
		return res.json({ success: true, data });
	} catch (error) {
		return respuestaDeError(res, error, 'Error al revertir la importación');
	}
};

module.exports = {
	previsualizar,
	aplicar,
	listarImportaciones,
	obtenerImportacion,
	revertir,
};
