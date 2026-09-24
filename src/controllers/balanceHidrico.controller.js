const balanceHidricoService = require('../services/balanceHidrico.service');
const { requireProfesional } = require('../utils/sessionIdentity');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const obtenerPorVisitaYFecha = async (req, res) => {
	try {
		const numeroVisitaInt = parseInt(req.params.numeroVisita, 10);
		const fecha = req.query.fecha || req.query.date;

		if (Number.isNaN(numeroVisitaInt)) {
			return res.status(400).json({
				success: false,
				mensaje: 'Número de visita inválido',
			});
		}
		if (!fecha) {
			return res.status(400).json({
				success: false,
				mensaje: 'Fecha es requerida (query param: fecha o date)',
			});
		}

		const data = await balanceHidricoService.obtenerPorVisitaYFecha(numeroVisitaInt, fecha);
		const resumen = balanceHidricoService.resumirDia(data);

		res.json({ success: true, data, resumen });
	} catch (error) {
		console.error('Error al obtener balance hídrico:', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error al obtener el balance hídrico'),
			error: error.message,
		});
	}
};

const obtenerPorId = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const data = await balanceHidricoService.obtenerPorId(id);
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
		}
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al obtener balance hídrico por id:', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error al obtener el registro'),
			error: error.message,
		});
	}
};

const crear = async (req, res) => {
	try {
		const profesional = requireProfesional(req, res);
		if (profesional == null) return;

		const body = req.body || {};
		const data = await balanceHidricoService.crear({
			...body,
			Profesional: profesional,
			Sector: body.Sector || body.sector || body.idSector || req.idSector || '',
		});

		res.status(201).json({ success: true, data });
	} catch (error) {
		console.error('Error al crear balance hídrico:', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error al crear el registro de balance hídrico'),
			error: error.message,
		});
	}
};

const actualizar = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const data = await balanceHidricoService.actualizar(id, req.body || {});
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
		}
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al actualizar balance hídrico:', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error al actualizar el registro'),
			error: error.message,
		});
	}
};

const eliminar = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (Number.isNaN(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const existing = await balanceHidricoService.obtenerPorId(id);
		if (!existing) {
			return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
		}
		await balanceHidricoService.eliminar(id);
		res.json({ success: true });
	} catch (error) {
		console.error('Error al eliminar balance hídrico:', error);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error al eliminar el registro'),
			error: error.message,
		});
	}
};

module.exports = {
	obtenerPorVisitaYFecha,
	obtenerPorId,
	crear,
	actualizar,
	eliminar,
};
