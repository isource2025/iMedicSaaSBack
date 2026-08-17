const { obtenerPracticasPorVisita } = require('../services/admissionSearch.service');

function _err(res, err) {
	const code = err?.statusCode || 500;
	return res.status(code).json({ success: false, mensaje: err?.message || 'Error interno' });
}

async function listarPorVisita(req, res) {
	try {
		const idVisita = Number(req.params.idVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		const data = await obtenerPracticasPorVisita(idVisita);
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[procedimientos] listar:', err.message);
		return _err(res, err);
	}
}

module.exports = { listarPorVisita };
