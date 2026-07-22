const interconsultasService = require('../services/interconsultas.service');
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
		const data = await interconsultasService.listarPorVisita(idVisita);
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[interconsultas] listar:', err.message);
		return _err(res, err);
	}
}

async function listarSectores(req, res) {
	try {
		const data = await interconsultasService.listarSectoresDestino();
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[interconsultas] sectores:', err.message);
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
		const data = await interconsultasService.listarPendientesPorSector(sector, {
			limit,
			paciente: req.query.paciente || req.query.q,
			fechaDesde: req.query.fechaDesde,
			fechaHasta: req.query.fechaHasta,
		});
		return res.json({ success: true, data: data || [] });
	} catch (err) {
		console.error('[interconsultas] pendientes:', err.message);
		return _err(res, err);
	}
}

async function obtenerPorId(req, res) {
	try {
		const id = Number(req.params.id);
		const origen = req.query.origen === 'WEB' ? 'WEB' : 'LEGACY';
		if (!Number.isFinite(id) || id <= 0) {
			return res.status(400).json({ success: false, mensaje: 'id inválido' });
		}
		const data = await interconsultasService.obtenerPorId(id, origen);
		if (!data) {
			return res.status(404).json({ success: false, mensaje: 'Interconsulta no encontrada' });
		}
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[interconsultas] obtener:', err.message);
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
		const idVisita = Number(body.idVisita ?? body.IdVisita);
		const idSectorReceptor = String(
			body.idSectorReceptor ?? body.IdSectorReceptor ?? '',
		).trim();
		const motivo = String(body.motivo ?? body.Motivo ?? '').trim();
		const sectorSolicitante = String(
			body.sectorSolicitante ?? body.SectorSolicitante ?? '',
		).trim();

		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita es requerido' });
		}
		if (!idSectorReceptor) {
			return res.status(400).json({ success: false, mensaje: 'Servicio destino es requerido' });
		}
		if (!motivo) {
			return res.status(400).json({ success: false, mensaje: 'Motivo es requerido' });
		}

		const data = await interconsultasService.crear({
			idVisita,
			matriculaSolicitante: Number(body.matriculaSolicitante) || matricula,
			sectorSolicitante,
			idSectorReceptor,
			motivo,
			estadoUrgencia: body.estadoUrgencia ?? body.EstadoUrgencia,
		});
		return res.status(201).json({ success: true, data, mensaje: 'Interconsulta registrada' });
	} catch (err) {
		console.error('[interconsultas] crear:', err.message);
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
		const data = await interconsultasService.tomar({
			idPedido,
			matricula,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[interconsultas] tomar:', err.message);
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
		const data = await interconsultasService.liberar({ idPedido, matricula });
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[interconsultas] liberar:', err.message);
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
		const data = await interconsultasService.cumplir({
			idPedido,
			textoRespuesta: body.textoRespuesta || body.textoInforme || body.Respuesta,
			matriculaRealizador: Number(body.matriculaRealizador) || matricula,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
			sectorServicio: body.sectorServicio,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[interconsultas] cumplir:', err.message);
		return _err(res, err);
	}
}

module.exports = {
	listarPorVisita,
	listarSectores,
	listarPendientes,
	obtenerPorId,
	crear,
	tomar,
	liberar,
	cumplir,
};
