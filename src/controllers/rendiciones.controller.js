/**
 * Controlador para gestión de rendiciones
 */
const rendicionesService = require('../services/rendiciones.service');

/**
 * Obtiene rendiciones con paginación y búsqueda
 */
const obtenerRendiciones = async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = Math.min(parseInt(req.query.limit) || 30, 100);
		const search = req.query.search || '';
		const estado = req.query.estado || 'all';
		const mes = req.query.mes ? parseInt(req.query.mes) : null;
		const anio = req.query.anio ? parseInt(req.query.anio) : null;
		
		const result = await rendicionesService.buscarRendicionesPaginadas(page, limit, search, estado, mes, anio);
		
		res.json(result);
	} catch (error) {
		console.error('Error en obtenerRendiciones:', error);
		res.status(500).json({ 
			error: 'Error al obtener rendiciones',
			message: error.message 
		});
	}
};

/**
 * Obtiene una rendición por ID
 */
const obtenerRendicionPorId = async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		
		if (isNaN(id)) {
			return res.status(400).json({ error: 'ID inválido' });
		}
		
		const rendicion = await rendicionesService.obtenerRendicionPorId(id);
		
		if (!rendicion) {
			return res.status(404).json({ error: 'Rendición no encontrada' });
		}
		
		res.json(rendicion);
	} catch (error) {
		console.error('Error en obtenerRendicionPorId:', error);
		res.status(500).json({ 
			error: 'Error al obtener rendición',
			message: error.message 
		});
	}
};

/**
 * Crea una nueva rendición
 */
const crearRendicion = async (req, res) => {
	try {
		const nuevaRendicion = await rendicionesService.crearRendicion(req.body);
		res.status(201).json(nuevaRendicion);
	} catch (error) {
		console.error('Error en crearRendicion:', error);
		res.status(500).json({ 
			error: 'Error al crear rendición',
			message: error.message 
		});
	}
};

/**
 * Actualiza una rendición existente
 */
const actualizarRendicion = async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		
		if (isNaN(id)) {
			return res.status(400).json({ error: 'ID inválido' });
		}
		
		const rendicionActualizada = await rendicionesService.actualizarRendicion(id, req.body);
		res.json(rendicionActualizada);
	} catch (error) {
		console.error('Error en actualizarRendicion:', error);
		res.status(500).json({ 
			error: 'Error al actualizar rendición',
			message: error.message 
		});
	}
};

/**
 * Elimina una rendición
 */
const eliminarRendicion = async (req, res) => {
	try {
		const id = parseInt(req.params.id);
		
		if (isNaN(id)) {
			return res.status(400).json({ error: 'ID inválido' });
		}
		
		await rendicionesService.eliminarRendicion(id);
		res.json({ message: 'Rendición eliminada exitosamente' });
	} catch (error) {
		console.error('Error en eliminarRendicion:', error);
		res.status(500).json({ 
			error: 'Error al eliminar rendición',
			message: error.message 
		});
	}
};

module.exports = {
	obtenerRendiciones,
	obtenerRendicionPorId,
	crearRendicion,
	actualizarRendicion,
	eliminarRendicion
};
