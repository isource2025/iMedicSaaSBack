const interconsultasService = require('../services/interconsultas.service');

async function listarPorVisita(req, res) {
	try {
		const idVisita = Number(req.params.idVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		const data = await interconsultasService.listarPorVisita(idVisita);
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[interconsultas] listar:', err.message);
		return res.status(500).json({ success: false, mensaje: err.message });
	}
}

async function crear(req, res) {
	try {
		const body = req.body || {};
		if (!body.IdVisita || !body.FechaSolicitud || !body.Motivo?.trim()) {
			return res.status(400).json({
				success: false,
				mensaje: 'IdVisita, FechaSolicitud y Motivo son requeridos',
			});
		}
		const data = await interconsultasService.crear(body);
		return res.status(201).json({ success: true, data, mensaje: 'Interconsulta registrada' });
	} catch (err) {
		console.error('[interconsultas] crear:', err.message);
		return res.status(500).json({ success: false, mensaje: err.message });
	}
}

module.exports = { listarPorVisita, crear };
