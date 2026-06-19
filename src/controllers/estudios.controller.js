const estudiosService = require('../services/estudios.service');

async function listarPorVisita(req, res) {
	try {
		const idVisita = Number(req.params.idVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		const data = await estudiosService.listarPorVisita(idVisita);
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[estudios] listar:', err.message);
		return res.status(500).json({ success: false, mensaje: err.message });
	}
}

module.exports = { listarPorVisita };
