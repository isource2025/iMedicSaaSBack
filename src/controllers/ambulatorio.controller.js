const ambulatorioService = require('../services/ambulatorio.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const RANGO_MAX_DIAS = 400;

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida el rango pedido. Devuelve null y responde 400 si algo no cierra.
 */
function validarRango(req, res) {
	const { fechaInicio, fechaFin } = req.query;

	if (!fechaInicio || !fechaFin) {
		res.status(400).json({
			success: false,
			message: 'Los parámetros fechaInicio y fechaFin son requeridos',
		});
		return null;
	}

	if (!FECHA_ISO.test(String(fechaInicio)) || !FECHA_ISO.test(String(fechaFin))) {
		res.status(400).json({
			success: false,
			message: 'Formato de fecha inválido. Use YYYY-MM-DD',
		});
		return null;
	}

	const fi = new Date(`${fechaInicio}T00:00:00`);
	const ff = new Date(`${fechaFin}T00:00:00`);

	if (isNaN(fi.getTime()) || isNaN(ff.getTime())) {
		res.status(400).json({
			success: false,
			message: 'Formato de fecha inválido. Use YYYY-MM-DD',
		});
		return null;
	}

	if (fi > ff) {
		res.status(400).json({
			success: false,
			message: 'La fecha de inicio no puede ser mayor que la fecha de fin',
		});
		return null;
	}

	// imTurnos es una tabla histórica sin índice garantizado sobre FechaAsignada:
	// se acota el rango para que una consulta no se lleve puesto el pool.
	const dias = Math.round((ff - fi) / 86400000) + 1;
	if (dias > RANGO_MAX_DIAS) {
		res.status(400).json({
			success: false,
			message: `El rango no puede superar los ${RANGO_MAX_DIAS} días (pedido: ${dias})`,
		});
		return null;
	}

	return { fechaInicio: String(fechaInicio), fechaFin: String(fechaFin) };
}

/** Analítica ambulatoria completa para /dashboard/turnos/analytics. */
const obtenerAnaliticaAmbulatoria = async (req, res) => {
	try {
		const rango = validarRango(req, res);
		if (!rango) return;

		const { graciaMin, sector, profesional, especialidad } = req.query;

		const data = await ambulatorioService.obtenerAnaliticaAmbulatoria({
			...rango,
			graciaMin,
			sector,
			profesional,
			especialidad,
		});

		res.json({ success: true, data });
	} catch (error) {
		console.error('Error en obtenerAnaliticaAmbulatoria:', error);
		res.status(statusDeError(error)).json({
			success: false,
			message: mensajeDeError(error, 'Error al obtener la analítica ambulatoria'),
			error: error.message,
		});
	}
};

/** Resumen del día para la card del dashboard. */
const obtenerResumenAmbulatorioHoy = async (req, res) => {
	try {
		const data = await ambulatorioService.obtenerResumenAmbulatorioHoy(req.query.graciaMin);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error en obtenerResumenAmbulatorioHoy:', error);
		res.status(statusDeError(error)).json({
			success: false,
			message: mensajeDeError(error, 'Error al obtener el resumen ambulatorio de hoy'),
			error: error.message,
		});
	}
};

module.exports = {
	obtenerAnaliticaAmbulatoria,
	obtenerResumenAmbulatorioHoy,
};
