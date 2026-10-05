const dietaControlService = require('../services/dietaControl.service');
const { requireOperadorCarga, resolveProfesional } = require('../utils/sessionIdentity');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const responderError = (res, error, mensaje) => {
	console.error(`${mensaje}:`, error);
	res.status(statusDeError(error)).json({
		success: false,
		mensaje: mensajeDeError(error, mensaje),
		error: error.message,
	});
};

const parseId = (raw) => {
	const n = parseInt(raw, 10);
	return Number.isNaN(n) ? null : n;
};

const obtenerPorVisitaYFecha = async (req, res) => {
	try {
		const numeroVisita = parseId(req.params.numeroVisita);
		const fecha = String(req.query.fecha || req.query.date || '');
		if (numeroVisita == null) {
			return res.status(400).json({ success: false, mensaje: 'Número de visita inválido' });
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
			return res
				.status(400)
				.json({ success: false, mensaje: 'Fecha debe estar en formato YYYY-MM-DD' });
		}
		const data = await dietaControlService.obtenerPorVisitaYFecha(
			numeroVisita,
			fecha,
			req.query.days,
		);
		res.json({ success: true, data });
	} catch (error) {
		responderError(res, error, 'Error al obtener las dietas');
	}
};

const obtenerPorId = async (req, res) => {
	try {
		const id = parseId(req.params.id);
		if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		const data = await dietaControlService.obtenerPorId(id);
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
		}
		res.json({ success: true, data });
	} catch (error) {
		responderError(res, error, 'Error al obtener el registro de dieta');
	}
};

const obtenerTipos = async (_req, res) => {
	try {
		const data = await dietaControlService.obtenerTiposDieta();
		res.json({ success: true, data });
	} catch (error) {
		responderError(res, error, 'Error al obtener los tipos de dieta');
	}
};

const crear = async (req, res) => {
	try {
		const operadorCarga = requireOperadorCarga(req, res);
		if (operadorCarga == null) return;
		const body = req.body || {};
		const data = await dietaControlService.crear({
			numeroVisita: body.numeroVisita,
			tipoDieta: body.tipoDieta,
			fechaDieta: body.fechaDieta,
			horaDieta: body.horaDieta,
			observaciones: body.observaciones,
			operadorCarga,
			profesional: resolveProfesional(req) ?? operadorCarga,
		});
		res.status(201).json({ success: true, data });
	} catch (error) {
		responderError(res, error, 'Error al registrar la dieta');
	}
};

const actualizar = async (req, res) => {
	try {
		const id = parseId(req.params.id);
		if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		const body = req.body || {};
		const data = await dietaControlService.actualizar(id, {
			tipoDieta: body.tipoDieta,
			fechaDieta: body.fechaDieta,
			horaDieta: body.horaDieta,
			observaciones: body.observaciones,
		});
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
		}
		res.json({ success: true, data });
	} catch (error) {
		responderError(res, error, 'Error al actualizar el registro de dieta');
	}
};

const eliminar = async (req, res) => {
	try {
		const id = parseId(req.params.id);
		if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		const existing = await dietaControlService.obtenerPorId(id);
		if (!existing) {
			return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
		}
		await dietaControlService.eliminar(id);
		res.json({ success: true });
	} catch (error) {
		responderError(res, error, 'Error al eliminar el registro de dieta');
	}
};

module.exports = {
	obtenerPorVisitaYFecha,
	obtenerPorId,
	obtenerTipos,
	crear,
	actualizar,
	eliminar,
};
