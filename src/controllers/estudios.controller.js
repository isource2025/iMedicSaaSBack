const estudiosService = require('../services/estudios.service');
const { resolverMatriculaTenant } = require('../utils/matriculaTenant');

function _codOperadorSesion(req) {
	const cod = req.auth?.usuario?.codOperador;
	return cod != null && Number.isFinite(Number(cod)) ? Number(cod) : 0;
}

async function _matriculaSesion(req) {
	let matricula =
		req.matricula != null && Number(req.matricula) > 0 ? Number(req.matricula) : null;
	if (req.valorPersonal != null) {
		try {
			const tenantMat = await resolverMatriculaTenant(req.valorPersonal);
			if (tenantMat) matricula = tenantMat;
		} catch {
			/* keep JWT */
		}
	}
	return Number.isFinite(matricula) && matricula > 0 ? matricula : null;
}

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
		const data = await estudiosService.listarPorVisita(idVisita);
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[estudios] listar:', err.message);
		return _err(res, err);
	}
}

async function listarPendientes(req, res) {
	try {
		const sector = String(req.query.sector || '').trim();
		if (!sector) {
			return res.status(400).json({ success: false, mensaje: 'Query sector requerido' });
		}
		const limit = req.query.limit != null ? Number(req.query.limit) : 100;
		const data = await estudiosService.listarPendientesPorSector(sector, {
			limit,
			paciente: req.query.paciente || req.query.q,
			fechaDesde: req.query.fechaDesde,
			fechaHasta: req.query.fechaHasta,
			soloEstudios: true,
		});
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[estudios] pendientes:', err.message);
		return _err(res, err);
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
		return _err(res, err);
	}
}

async function crear(req, res) {
	try {
		const body = req.body || {};
		const matricula = await _matriculaSesion(req);
		if (!matricula) {
			return res.status(400).json({
				success: false,
				mensaje: 'No se pudo resolver la matrícula del solicitante',
			});
		}
		const data = await estudiosService.crearPedido({
			idVisita: Number(body.idVisita),
			matriculaSolicitante: Number(body.matriculaSolicitante) || matricula,
			sectorSolicitante: body.sectorSolicitante,
			idTipoPedido: body.idTipoPedido,
			idSectorReceptor: body.idSectorReceptor,
			notas: body.notas,
			estadoUrgencia: body.estadoUrgencia,
		});
		return res.status(201).json({ success: true, data });
	} catch (err) {
		console.error('[estudios] crear:', err.message);
		return _err(res, err);
	}
}

async function cumplir(req, res) {
	try {
		const idPedido = Number(req.params.idPedido);
		const body = req.body || {};
		const matricula = await _matriculaSesion(req);
		if (!matricula) {
			return res.status(400).json({
				success: false,
				mensaje: 'No se pudo resolver la matrícula del realizador',
			});
		}
		const data = await estudiosService.cumplirPedido({
			idPedido,
			textoInforme: body.textoInforme,
			matriculaRealizador: Number(body.matriculaRealizador) || matricula,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
			sectorServicio: body.sectorServicio,
			codPractica: body.codPractica,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[estudios] cumplir:', err.message);
		return _err(res, err);
	}
}

async function tomar(req, res) {
	try {
		const idPedido = Number(req.params.idPedido);
		const matricula = await _matriculaSesion(req);
		if (!matricula) {
			return res.status(400).json({
				success: false,
				mensaje: 'No se pudo resolver la matrícula del operador',
			});
		}
		const data = await estudiosService.tomarPedido({
			idPedido,
			matricula,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[estudios] tomar:', err.message);
		return _err(res, err);
	}
}

async function liberar(req, res) {
	try {
		const idPedido = Number(req.params.idPedido);
		const matricula = await _matriculaSesion(req);
		if (!matricula) {
			return res.status(400).json({
				success: false,
				mensaje: 'No se pudo resolver la matrícula del operador',
			});
		}
		const data = await estudiosService.liberarPedido({ idPedido, matricula });
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[estudios] liberar:', err.message);
		return _err(res, err);
	}
}

async function buscarTipos(req, res) {
	try {
		const data = await estudiosService.buscarTiposPedidosEstudios({
			q: req.query.q,
			limit: req.query.limit,
		});
		return res.json({ success: true, data });
	} catch (err) {
		return _err(res, err);
	}
}

async function listarSectores(req, res) {
	try {
		const soloMios =
			String(req.query.soloMios || req.query.mios || '').trim() === '1' ||
			String(req.query.soloMios || '').toLowerCase() === 'true';
		const data = await estudiosService.listarSectoresReceptor({
			valorPersonal: soloMios ? req.valorPersonal : null,
		});
		return res.json({ success: true, data });
	} catch (err) {
		return _err(res, err);
	}
}

module.exports = {
	listarPorVisita,
	listarPendientes,
	obtenerPorId,
	crear,
	cumplir,
	tomar,
	liberar,
	buscarTipos,
	listarSectores,
};
