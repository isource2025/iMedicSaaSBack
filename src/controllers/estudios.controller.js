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

async function obtenerPorId(req, res) {
	try {
		const idPedido = Number(req.params.idPedido);
		if (!Number.isFinite(idPedido) || idPedido <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idPedido inválido' });
		}
		const data = await estudiosService.obtenerPorId(idPedido);
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Pedido no encontrado' });
		}
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[estudios] obtener:', err.message);
		return res.status(500).json({ success: false, mensaje: err.message });
	}
}

module.exports = { listarPorVisita, obtenerPorId };
