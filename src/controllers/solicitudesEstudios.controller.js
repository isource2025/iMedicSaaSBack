const svc = require('../services/solicitudesEstudios.service');
const estudiosService = require('../services/estudios.service');
const { runWithTenant } = require('../context/tenantContext');
const { resolverMatriculaTenant } = require('../utils/matriculaTenant');
const { esAdminClinico } = require('../middlewares/propietario.middleware');
const { sectorEnSesion, codigosParaFiltro, idSectorSesion } = require('../utils/sectoresSesion');

async function _veTodosLosServicios(req) {
	const rn = String(req.rolNombre ?? req.auth?.rol?.nombre ?? '').trim().toUpperCase();
	const id = Number(req.auth?.rol?.id);
	if (rn === 'SUPER_ADMIN' || id === 5) return true;
	return esAdminClinico(req);
}

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

const _sinMatricula = (res, quien) =>
	res.status(400).json({
		success: false,
		mensaje: `No se pudo resolver la matrícula del ${quien}`,
	});

function _boolQuery(v) {
	const s = String(v ?? '').trim().toLowerCase();
	return s === '1' || s === 'true';
}

async function listarPorVisita(req, res) {
	try {
		const idVisita = Number(req.params.idVisita);
		if (!Number.isFinite(idVisita) || idVisita <= 0) {
			return res.status(400).json({ success: false, mensaje: 'idVisita inválido' });
		}
		return res.json({ success: true, data: await svc.listarPorVisita(idVisita) });
	} catch (err) {
		console.error('[solicitudes-estudios] listar:', err.message);
		return _err(res, err);
	}
}

async function listarPendientes(req, res) {
	try {
		const todos = await _veTodosLosServicios(req);
		const sector = String(req.query.sector || '').trim();
		let codigos = [];
		if (!todos) {
			const destinos = await estudiosService.listarSectoresReceptor({
				valorPersonal: req.valorPersonal,
			});
			if (!destinos.length) return res.json({ success: true, data: [] });
			if (sector && !sectorEnSesion(destinos, sector)) {
				return res.status(403).json({ success: false, mensaje: 'Servicio no asignado' });
			}
			const expanded = [];
			for (const c of codigosParaFiltro(destinos, sector)) {
				expanded.push(...(await estudiosService.expandCodigosReceptor(c)));
			}
			codigos = [...new Set(expanded)];
		} else if (sector) {
			codigos = await estudiosService.expandCodigosReceptor(sector);
		} else {
			return res.status(400).json({ success: false, mensaje: 'Query sector requerido' });
		}
		const data = await svc.listarPendientes(sector, {
			limit: req.query.limit != null ? Number(req.query.limit) : 100,
			paciente: req.query.paciente || req.query.q,
			fechaDesde: req.query.fechaDesde,
			fechaHasta: req.query.fechaHasta,
			codigos,
			permitirVacio: true,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] pendientes:', err.message);
		return _err(res, err);
	}
}

async function contarLibres(req, res) {
	try {
		const soloMios = _boolQuery(req.query.soloMios || req.query.mios);
		const todos = await _veTodosLosServicios(req);
		const data = await svc.contarLibres({
			valorPersonal: soloMios && !todos ? req.valorPersonal : null,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] conteo:', err.message);
		return _err(res, err);
	}
}

async function obtener(req, res) {
	try {
		const data = await svc.obtenerSolicitud(req.params.clave);
		if (!data) return res.status(404).json({ success: false, mensaje: 'Solicitud no encontrada' });
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] obtener:', err.message);
		return _err(res, err);
	}
}

async function crear(req, res) {
	try {
		const body = req.body || {};
		const matricula = await _matriculaSesion(req);
		if (!matricula) return _sinMatricula(res, 'solicitante');
		const data = await svc.crearSolicitud({
			idVisita: Number(body.idVisita),
			matriculaSolicitante: Number(body.matriculaSolicitante) || matricula,
			sectorSolicitante: idSectorSesion(req) || String(body.sectorSolicitante || '').trim(),
			idSectorReceptor: body.idSectorReceptor,
			items: body.items,
			notas: body.notas,
			estadoUrgencia: body.estadoUrgencia,
		});
		return res.status(201).json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] crear:', err.message);
		return _err(res, err);
	}
}

async function actualizar(req, res) {
	try {
		const body = req.body || {};
		const matricula = await _matriculaSesion(req);
		if (!matricula) return _sinMatricula(res, 'operador');
		const data = await svc.actualizarSolicitud({
			clave: req.params.clave,
			matricula,
			valorPersonal: req.valorPersonal != null ? Number(req.valorPersonal) : null,
			codOperador: _codOperadorSesion(req),
			notas: body.notas,
			estadoUrgencia: body.estadoUrgencia,
			idSectorReceptor: body.idSectorReceptor,
			items: body.items,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] actualizar:', err.message);
		return _err(res, err);
	}
}

async function eliminar(req, res) {
	try {
		const matricula = await _matriculaSesion(req);
		if (!matricula) return _sinMatricula(res, 'operador');
		const data = await svc.eliminarSolicitud({
			clave: req.params.clave,
			matricula,
			valorPersonal: req.valorPersonal != null ? Number(req.valorPersonal) : null,
			codOperador: _codOperadorSesion(req),
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] eliminar:', err.message);
		return _err(res, err);
	}
}

async function tomar(req, res) {
	try {
		const matricula = await _matriculaSesion(req);
		if (!matricula) return _sinMatricula(res, 'operador');
		const data = await svc.tomarSolicitud({
			clave: req.params.clave,
			matricula,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] tomar:', err.message);
		return _err(res, err);
	}
}

async function liberar(req, res) {
	try {
		const matricula = await _matriculaSesion(req);
		if (!matricula) return _sinMatricula(res, 'operador');
		const data = await svc.liberarSolicitud({ clave: req.params.clave, matricula });
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] liberar:', err.message);
		return _err(res, err);
	}
}

async function cumplir(req, res) {
	try {
		const body = req.body || {};
		const matricula = await _matriculaSesion(req);
		if (!matricula) return _sinMatricula(res, 'realizador');
		const data = await svc.cumplirSolicitud({
			clave: req.params.clave,
			textoInforme: body.textoInforme,
			matriculaRealizador: Number(body.matriculaRealizador) || matricula,
			codOperador: _codOperadorSesion(req) || Number(req.valorPersonal) || 0,
			sectorServicio: idSectorSesion(req) || String(body.sectorServicio || '').trim(),
			idsPedidos: Array.isArray(body.idsPedidos) ? body.idsPedidos : undefined,
		});
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] cumplir:', err.message);
		return _err(res, err);
	}
}

/** Catálogo = imTiposPedidosEstudios (agrupador de prácticas nomencladas y moduladas). */
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

async function listarServicios(req, res) {
	try {
		const soloMios = _boolQuery(req.query.soloMios || req.query.mios);
		const todos = await _veTodosLosServicios(req);
		const data = await estudiosService.listarSectoresReceptor({
			valorPersonal: soloMios && !todos ? req.valorPersonal : null,
		});
		return res.json({ success: true, data });
	} catch (err) {
		return _err(res, err);
	}
}

/* ---- Super admin: migración de esquema por empresa (usa la conexión guardada de la empresa) ---- */

function _idEmpresaParam(req) {
	const id = Number(req.params.id);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idEmpresa inválido');
		e.statusCode = 400;
		throw e;
	}
	return id;
}

async function estadoEsquemaEmpresa(req, res) {
	try {
		const id = _idEmpresaParam(req);
		const data = await runWithTenant(id, () => svc.estadoEsquema());
		return res.json({ success: true, data });
	} catch (err) {
		return _err(res, err);
	}
}

async function aplicarEsquemaEmpresa(req, res) {
	try {
		const id = _idEmpresaParam(req);
		const data = await runWithTenant(id, async () => {
			const out = await svc.aplicarEsquema();
			svc.ensureSchema.reset();
			return out;
		});
		console.log(
			`[solicitudes-estudios] migración empresa ${id} por ${req.auth?.usuario?.nombreRed || '?'}:`,
			JSON.stringify(data.despues),
		);
		return res.json({ success: true, data });
	} catch (err) {
		console.error('[solicitudes-estudios] migración:', err.message);
		return _err(res, err);
	}
}

module.exports = {
	listarPorVisita,
	listarPendientes,
	contarLibres,
	obtener,
	crear,
	actualizar,
	eliminar,
	tomar,
	liberar,
	cumplir,
	buscarTipos,
	listarServicios,
	estadoEsquemaEmpresa,
	aplicarEsquemaEmpresa,
};
