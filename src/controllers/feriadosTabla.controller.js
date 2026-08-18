const feriadosService = require('../services/feriados.service');

function sendError(res, error, fallback) {
	const status = Number(error?.status) || 500;
	res.status(status).json({
		success: false,
		message: error?.message || fallback,
	});
}

const feriadosTablaController = {
	async listar(req, res) {
		try {
			const data = await feriadosService.listarTodos();
			res.json({ success: true, data });
		} catch (error) {
			console.error('Error al listar feriados:', error);
			sendError(res, error, 'Error al listar feriados');
		}
	},

	async crear(req, res) {
		try {
			const fecha = req.body?.Fecha || req.body?.fecha;
			const nombre = req.body?.Descripcion || req.body?.descripcion || req.body?.nombre;
			const data = await feriadosService.crearFeriado(fecha, nombre);
			res.status(201).json({ success: true, data });
		} catch (error) {
			console.error('Error al crear feriado:', error);
			sendError(res, error, 'Error al crear feriado');
		}
	},

	async actualizar(req, res) {
		try {
			const actual = req.params.fecha;
			const fecha = req.body?.Fecha || req.body?.fecha;
			const nombre = req.body?.Descripcion || req.body?.descripcion || req.body?.nombre;
			const data = await feriadosService.actualizarFeriado(actual, { fecha, nombre });
			res.json({ success: true, data });
		} catch (error) {
			console.error('Error al actualizar feriado:', error);
			sendError(res, error, 'Error al actualizar feriado');
		}
	},

	async eliminar(req, res) {
		try {
			const data = await feriadosService.eliminarFeriado(req.params.fecha);
			res.json({ success: true, data });
		} catch (error) {
			console.error('Error al eliminar feriado:', error);
			sendError(res, error, 'Error al eliminar feriado');
		}
	},
};

module.exports = feriadosTablaController;
