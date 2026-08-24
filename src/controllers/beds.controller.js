const bedsService = require('../services/beds.service');

const obtenerCamas = async (req, res) => {
	try {
		const camas = await bedsService.obtenerCamas();
		res.json({ success: true, data: camas });
	} catch (error) {
		console.error('Error al obtener camas:', error);
		res.status(500).json({ success: false, mensaje: 'Error al obtener las camas' });
	}
};

const obtenerCamasPorId = async (req, res) => {
	const { id } = req.params;

	try {
		const cama = await bedsService.obtenerCamaPorId(id);
		res.json({ success: true, data: cama });
	} catch (err) {
		console.error('Error al obtener camas:', err);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener la cama',
		});
	}
};

const obtenerEstadosCama = async (req, res) => {
	try {
		const estados = await bedsService.obtenerEstadosCama();
		res.json({ success: true, data: estados });
	} catch (error) {
		console.error('Error al obtener estados de cama:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener los estados de cama',
		});
	}
};

const obtenerCamaPorId = async (req, res) => {
	try {
		const id = req.params.id; // Usar el ID tal como viene, sin convertir a entero
		if (!id) {
			return res
				.status(400)
				.json({ success: false, mensaje: 'ID inválido o no proporcionado' });
		}

		const cama = await bedsService.obtenerCamaPorId(id);
		if (!cama) {
			return res.status(404).json({ success: false, mensaje: 'Cama no encontrada' });
		}

		res.json({ success: true, data: cama });
	} catch (error) {
		console.error('Error al obtener cama:', error);
		res.status(500).json({ success: false, mensaje: 'Error al obtener la cama' });
	}
};

const actualizarEstadoCama = async (req, res) => {
	try {
		const id = req.params.id; // Usar el ID tal como viene, sin convertir a entero
		const { estado } = req.body;

		if (!id) {
			return res
				.status(400)
				.json({ success: false, mensaje: 'ID inválido o no proporcionado' });
		}

		const estadosValidos = ['disponible', 'ocupada', 'mantenimiento'];
		if (!estadosValidos.includes(estado)) {
			return res.status(400).json({ success: false, mensaje: 'Estado no válido' });
		}

		const camaActualizada = await bedsService.actualizarEstadoCama(id, estado);
		if (!camaActualizada) {
			return res.status(404).json({ success: false, mensaje: 'Cama no encontrada' });
		}

		res.json({ success: true, data: camaActualizada });
	} catch (error) {
		console.error('Error al actualizar estado de cama:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al actualizar el estado de la cama',
		});
	}
};

/**
 * Filtra camas por estado usando la relación con imestadocama
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const filtrarCamasPorEstado = async (req, res) => {
	try {
		const { estado } = req.params;

		if (!estado) {
			return res.status(400).json({
				success: false,
				mensaje: 'Se requiere especificar un valor de estado para filtrar',
			});
		}

		const camas = await bedsService.filtrarCamasPorEstado(estado);

		res.json({
			success: true,
			count: camas.length,
			data: camas,
		});
	} catch (error) {
		console.error('Error al filtrar camas por estado:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al filtrar camas por estado',
			error: error.message,
		});
	}
};

/**
 * Obtiene todos los sectores desde imSectores
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const obtenerSectores = async (req, res) => {
	try {
		const sectores = await bedsService.obtenerSectores();
		res.json({ success: true, data: sectores });
	} catch (error) {
		console.error('Error al obtener sectores:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener los sectores',
			error: error.message,
		});
	}
};

/**
 * Obtener el total de camas y estadísticas
 * @param {Object} req Request
 * @param {Object} res Response
 */
const obtenerTotalCamas = async (req, res) => {
	try {
		const estadisticas = await bedsService.obtenerTotalCamas();
		res.json({
			success: true,
			data: estadisticas,
		});
	} catch (error) {
		console.error('Error al obtener total de camas:', error);
		res.status(500).json({
			success: false,
			mensaje: 'Error al obtener el total de camas',
			error: error.message,
		});
	}
};

/**
 * Obtener los registros de control frecuente por número de visita
 * @param {Object} req Request
 * @param {Object} res Response
 */
const obtenerControlesFrecuentesPorVisita = async (req, res) => {
	try {
		const { numeroVisita } = req.params;
		const { days } = req.query; // Parámetro opcional: 0 (hoy), 7, 30, 'all'
		const registros = await bedsService.obtenerControlesFrecuentesPorVisita(numeroVisita, days);
		res.json({
			success: true,
			data: registros,
		});
	} catch (error) {
		console.error('Error al obtener los controles frecuentes:', error);
		res.status(500).json({
			success: false,
			message: 'Error al obtener los controles frecuentes',
			error: error.message,
		});
	}
};

module.exports = {
	obtenerCamas,
	obtenerCamaPorId,
	obtenerEstadosCama,
	filtrarCamasPorEstado,
	obtenerSectores,
	obtenerTotalCamas,
	obtenerControlesFrecuentesPorVisita,
	actualizarEstadoCama,
};
