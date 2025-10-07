const indicacionesService = require('../services/indicaciones.service');

/**
 * Obtener la última indicación por número de visita
 */
const obtenerUltimaIndicacionPorVisita = async (req, res) => {
	try {
		const { numeroVisita } = req.params;
		const numeroVisitaInt = parseInt(numeroVisita);

		if (isNaN(numeroVisitaInt)) {
			return res.status(400).json({
				success: false,
				mensaje: 'Número de visita inválido',
			});
		}

		const resultado = await indicacionesService.obtenerUltimaIndicacionPorVisita(
			numeroVisitaInt,
		);
		const ultima = Array.isArray(resultado) ? resultado[0] || null : resultado;

		res.json({
			success: true,
			data: ultima,
		});
	} catch (error) {
		console.error('Error al obtener última indicación por visita:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener la última indicación de la visita',
			error: error.message,
		});
	}
};

/**
 * Obtener las últimas N indicaciones por número de visita
 */
const obtenerUltimasIndicacionesPorVisita = async (req, res) => {
	try {
		const { numeroVisita } = req.params;
		const { limit } = req.query;
		const numeroVisitaInt = parseInt(numeroVisita);
		const limitInt = isNaN(parseInt(limit)) ? 3 : parseInt(limit);

		if (isNaN(numeroVisitaInt)) {
			return res
				.status(400)
				.json({ success: false, mensaje: 'Número de visita inválido' });
		}

		const lista = await indicacionesService.obtenerUltimasIndicacionesPorVisita(
			numeroVisitaInt,
			limitInt,
		);
		res.json({ success: true, data: Array.isArray(lista) ? lista : [] });
	} catch (error) {
		console.error('Error al obtener últimas indicaciones por visita:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener las últimas indicaciones de la visita',
			error: error.message,
		});
	}
};

const byDate = async (req, res) => {
	try {
		const { numeroVisita } = req.params;
		const { date } = req.query;

		const visitaNum = Number(numeroVisita);
		if (!Number.isFinite(visitaNum) || visitaNum <= 0) {
			return res.status(400).json({ success: false, mensaje: 'numeroVisita inválido' });
		}

		if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
			return res
				.status(400)
				.json({ success: false, mensaje: 'date debe ser YYYY-MM-DD' });
		}

		const rows = await indicacionesService.getByVisitaAndDate(visitaNum, String(date));

		return res.json({
			success: true,
			data: rows || [],
		});
	} catch (err) {
		console.error('[IndicacionesController][byDate] error:', err);
		return res.status(500).json({
			success: false,
			mensaje: 'Error interno al obtener indicaciones por fecha',
		});
	}
};

/**
 * Obtener datos para el formulario de creación de indicaciones
 */
const obtenerDatosFormulario = async (req, res) => {
	try {
		const datos = await indicacionesService.obtenerDatosFormulario();

		res.json({
			success: true,
			data: datos,
		});
	} catch (error) {
		console.error('Error al obtener datos del formulario:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener los datos del formulario',
			error: error.message,
		});
	}
};

module.exports = {
	obtenerUltimaIndicacionPorVisita,
	obtenerUltimasIndicacionesPorVisita,
	byDate,
	obtenerDatosFormulario,
};
