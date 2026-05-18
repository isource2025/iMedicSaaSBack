const service = require('../services/turnosAdmin.service');

function _err(res, e) {
	const code = e?.statusCode || 500;
	return res.status(code).json({ success: false, mensaje: e?.message || 'Error interno' });
}

async function listar(req, res) {
	try {
		const page = Number(req.query.page) || 1;
		const limit = Number(req.query.limit) || 25;
		const filtros = {
			q: req.query.q ? String(req.query.q).trim() : '',
			fechaDesde: req.query.fechaDesde ? String(req.query.fechaDesde).slice(0, 10) : '',
			fechaHasta: req.query.fechaHasta ? String(req.query.fechaHasta).slice(0, 10) : '',
			status: req.query.status !== undefined && req.query.status !== '' ? req.query.status : '',
			tipoTurno:
				req.query.tipoTurno !== undefined && req.query.tipoTurno !== ''
					? req.query.tipoTurno
					: '',
			sector: req.query.sector ? String(req.query.sector).trim() : '',
			profesional:
				req.query.profesional !== undefined && req.query.profesional !== ''
					? req.query.profesional
					: '',
			triage:
				req.query.triage !== undefined && req.query.triage !== '' ? req.query.triage : '',
			idTurno: req.query.idTurno ? String(req.query.idTurno).trim() : '',
			idPaciente: req.query.idPaciente ? String(req.query.idPaciente).trim() : '',
			numeroDocumento: req.query.numeroDocumento
				? String(req.query.numeroDocumento).trim()
				: '',
		};
		const data = await service.listar(filtros, page, limit);
		res.json({ success: true, data });
	} catch (e) {
		_err(res, e);
	}
}

module.exports = { listar };
