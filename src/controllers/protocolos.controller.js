const protocolosService = require('../services/protocolos.service');

function _codOperadorSesion(req) {
	const cod = req.auth?.usuario?.codOperador;
	return cod != null && Number.isFinite(Number(cod)) ? Number(cod) : 0;
}

function _err(res, err) {
	const code = err?.statusCode || 500;
	return res.status(code).json({ success: false, mensaje: err?.message || 'Error interno' });
}

async function listarTipos(req, res) {
	try {
		const data = await protocolosService.listarTiposProtocolo();
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[protocolos] tipos:', err.message);
		return _err(res, err);
	}
}

async function proForma(req, res) {
	try {
		const tipo = String(req.query.tipo || req.params.tipo || '').trim();
		const data = await protocolosService.obtenerProForma(tipo);
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[protocolos] proforma:', err.message);
		return _err(res, err);
	}
}

async function buscarPracticas(req, res) {
	try {
		const q = String(req.query.q || '').trim();
		const limit = req.query.limit != null ? Number(req.query.limit) : 30;
		const data = await protocolosService.buscarPracticas({ q, limit });
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[protocolos] practicas:', err.message);
		return _err(res, err);
	}
}

async function detallePractica(req, res) {
	try {
		const idPractica = Number(req.params.idPractica);
		const tipoPractica = String(req.query.tipo || 'NO').trim();
		const data = await protocolosService.detallePractica(idPractica, tipoPractica);
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[protocolos] practica detalle:', err.message);
		return _err(res, err);
	}
}

async function buscarProfesionales(req, res) {
	try {
		const q = String(req.query.q || '').trim();
		const limit = req.query.limit != null ? Number(req.query.limit) : 25;
		const data = await protocolosService.buscarProfesionales({ q, limit });
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[protocolos] profesionales:', err.message);
		return _err(res, err);
	}
}

async function listarPorVisita(req, res) {
	try {
		const idVisita = Number(req.params.idVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		const data = await protocolosService.listarPorVisita(idVisita);
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[protocolos] listar:', err.message);
		return _err(res, err);
	}
}

async function crear(req, res) {
	try {
		const body = req.body || {};
		const idOperador =
			body.idOperador != null && Number(body.idOperador) > 0
				? Number(body.idOperador)
				: Number(req.valorPersonal) || 0;

		const data = await protocolosService.crearProtocolo({
			numeroVisita: Number(body.numeroVisita),
			tipoProtocolo: body.tipoProtocolo,
			texto: body.texto,
			tecnica: body.tecnica,
			diagnosticoPre: body.diagnosticoPre,
			diagnosticoPos: body.diagnosticoPos,
			fechaHoraInicio: body.fechaHoraInicio,
			fechaHoraFin: body.fechaHoraFin,
			estado: body.estado,
			idOperador,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
			sector: body.sector,
			idPractica: body.idPractica,
			tipoPractica: body.tipoPractica,
			profesionales: body.profesionales,
		});
		return res.status(201).json({ success: true, data });
	} catch (err) {
		console.error('[protocolos] crear:', err.message);
		return _err(res, err);
	}
}

module.exports = {
	listarTipos,
	proForma,
	buscarPracticas,
	detallePractica,
	buscarProfesionales,
	listarPorVisita,
	crear,
};
