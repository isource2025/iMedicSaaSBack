const sectoresService = require('../services/sectores.service');

const obtenerSectores = async (req, res) => {
	try {
		const sectores = await sectoresService.obtenerSectores();
		res.json({
			success: true,
			data: sectores,
			total: sectores.length,
		});
	} catch (error) {
		console.error('Error en obtenerSectores:', error);
		res.status(500).json({
			success: false,
			data: [],
			total: 0,
			mensaje: error.message || 'Error al obtener sectores',
		});
	}
};

const crearSector = async (req, res) => {
	try {
		const data = await sectoresService.crearSector(req.body || {});
		res.status(201).json({ success: true, data });
	} catch (error) {
		res.status(error.statusCode || 500).json({
			success: false,
			mensaje: error.message || 'Error al crear sector',
		});
	}
};

const actualizarSector = async (req, res) => {
	try {
		const data = await sectoresService.actualizarSector(req.params.valor, req.body || {});
		res.json({ success: true, data });
	} catch (error) {
		res.status(error.statusCode || 500).json({
			success: false,
			mensaje: error.message || 'Error al actualizar sector',
		});
	}
};

const obtenerServicios = async (req, res) => {
	try {
		const data = await sectoresService.obtenerServiciosMedicos();
		res.json({ success: true, data, total: data.length });
	} catch (error) {
		res.status(500).json({
			success: false,
			mensaje: error.message || 'Error al obtener servicios',
		});
	}
};

const crearServicio = async (req, res) => {
	try {
		const data = await sectoresService.crearServicioMedico(req.body || {});
		res.status(201).json({ success: true, data });
	} catch (error) {
		res.status(error.statusCode || 500).json({
			success: false,
			mensaje: error.message || 'Error al crear servicio',
		});
	}
};

const actualizarServicio = async (req, res) => {
	try {
		const data = await sectoresService.actualizarServicioMedico(req.params.valor, req.body || {});
		res.json({ success: true, data });
	} catch (error) {
		res.status(error.statusCode || 500).json({
			success: false,
			mensaje: error.message || 'Error al actualizar servicio',
		});
	}
};

module.exports = {
	obtenerSectores,
	crearSector,
	actualizarSector,
	obtenerServicios,
	crearServicio,
	actualizarServicio,
};
