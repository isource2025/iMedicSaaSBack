const dashboardService = require('../services/dashboard.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v) {
	return typeof v === 'string' && RE_FECHA.test(v) && !Number.isNaN(new Date(v).getTime());
}

/**
 * GET /api/dashboard/resumen?fechaInicio&fechaFin&limiteActividad&graciaMin&incluir=a,b
 */
const obtenerResumen = async (req, res) => {
	try {
		const { fechaInicio, fechaFin, limiteActividad, graciaMin, incluir } = req.query;

		if ((fechaInicio && !fechaValida(fechaInicio)) || (fechaFin && !fechaValida(fechaFin))) {
			return res
				.status(400)
				.json({ success: false, message: 'Formato de fecha inválido. Use YYYY-MM-DD' });
		}
		if (fechaInicio && fechaFin && new Date(fechaInicio) > new Date(fechaFin)) {
			return res.status(400).json({
				success: false,
				message: 'La fecha de inicio no puede ser mayor que la fecha de fin',
			});
		}

		const data = await dashboardService.obtenerResumenDashboard({
			permisos: req.permisos,
			fechaInicio,
			fechaFin,
			limiteActividad,
			graciaMin,
			incluir: typeof incluir === 'string' && incluir.trim() ? incluir.split(',').map((s) => s.trim()) : undefined,
		});

		// Datos de tablero: el browser puede reutilizarlos unos segundos sin volver a pedir.
		res.setHeader('Cache-Control', 'private, max-age=10');
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error en dashboard.obtenerResumen:', error);
		res.status(statusDeError(error)).json({
			success: false,
			message: mensajeDeError(error, 'Error al obtener el resumen del panel'),
			error: error.message,
		});
	}
};

module.exports = { obtenerResumen };
