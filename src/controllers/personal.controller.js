/**
 * Controlador CRUD de Personal (tabla imPersonal) - sección Datos Personales.
 */
const personalService = require('../services/personal.service');
const personalSyncService = require('../services/personalSync.service');
const { getTenantId } = require('../context/tenantContext');

const listarCamposExport = async (_req, res) => {
	try {
		res.json({ success: true, data: personalSyncService.listExportFields() });
	} catch (error) {
		console.error('[personal.listarCamposExport] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar campos de exportación' });
	}
};

const estadoSyncFisico = async (_req, res) => {
	try {
		const disponible = await personalSyncService.puedeSyncDesdeFisico(getTenantId());
		res.json({ success: true, data: { disponible } });
	} catch (error) {
		console.error('[personal.estadoSyncFisico] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al consultar estado de sync' });
	}
};

const syncDesdeFisico = async (_req, res) => {
	try {
		const resumen = await personalSyncService.syncPersonalDesdeFisico(getTenantId());
		res.json({
			success: true,
			mensaje:
				resumen.informe?.mensaje ||
				(resumen.sinCambios
					? 'La nube ya estaba al día. No hubo cambios respecto a la base física.'
					: 'Se aplicaron cambios desde la base física.'),
			data: {
				...resumen,
				usuarios: resumen.informe?.usuarios || resumen.usuarios || [],
			},
		});
	} catch (error) {
		console.error('[personal.syncDesdeFisico] ERROR:', error.message);
		const code = error.statusCode || 500;
		res.status(code).json({
			success: false,
			mensaje: error.message || 'Error al sincronizar desde la base física',
		});
	}
};

const exportarPersonal = async (req, res) => {
	try {
		const campos = Array.isArray(req.body?.campos) ? req.body.campos : [];
		const data = await personalSyncService.listarParaExport(campos);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.exportarPersonal] ERROR:', error.message);
		const code = error.statusCode || 500;
		res.status(code).json({
			success: false,
			mensaje: error.message || 'Error al exportar personal',
		});
	}
};

const listarCuentasSoloNube = async (_req, res) => {
	try {
		const data = await personalService.listarCuentasSoloNube();
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarCuentasSoloNube] ERROR:', error.message);
		const code = error.statusCode || 500;
		res.status(code).json({
			success: false,
			mensaje: error.message || 'Error al detectar cuentas sin ficha física',
		});
	}
};

const repararCuentasSoloNube = async (_req, res) => {
	try {
		const data = await personalService.repararCuentasSoloNube();
		const n = (data.reparados || []).length;
		const err = (data.errores || []).length;
		res.json({
			success: true,
			mensaje:
				n === 0 && err === 0
					? 'No había cuentas huérfanas para reparar.'
					: err
					  ? `Se restauraron ${n} ficha(s) en el hospital. ${err} no se pudieron reparar.`
					  : `Se restauraron ${n} ficha(s) en la base del hospital.`,
			data,
		});
	} catch (error) {
		console.error('[personal.repararCuentasSoloNube] ERROR:', error.message);
		const code = error.statusCode || 500;
		res.status(code).json({
			success: false,
			mensaje: error.message || 'Error al reparar cuentas sin ficha física',
		});
	}
};

const listar = async (req, res) => {
	try {
		const { page = 1, limit = 30, search = '' } = req.query;
		const pageNum = Math.max(1, parseInt(page, 10) || 1);
		const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
		const result = await personalService.listar(pageNum, limitNum, String(search || ''));
		res.json({
			success: true,
			data: result.data,
			pagination: {
				currentPage: pageNum,
				totalPages: result.totalPages,
				totalCount: result.totalCount,
				limit: limitNum,
			},
		});
	} catch (error) {
		console.error('[personal.listar] ERROR:', error.message);
		const msg = String(error.message || '');
		if (
			error.code === 'ETIMEOUT' ||
			error.originalError?.code === 'ETIMEOUT' ||
			/ETIMEOUT|Failed to connect/i.test(msg)
		) {
			return res.status(503).json({
				success: false,
				mensaje:
					'No se puede conectar al servidor SQL de la clínica. Verificá que el puerto 1433 esté accesible desde Railway (firewall / red).',
			});
		}
		res.status(500).json({ success: false, mensaje: 'Error al obtener el personal' });
	}
};

const obtenerPorId = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const personal = await personalService.obtenerPorId(id);
		if (!personal) {
			return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		}
		res.json({ success: true, data: personal });
	} catch (error) {
		console.error('[personal.obtenerPorId] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener el personal' });
	}
};

const obtenerProximoId = async (_req, res) => {
	try {
		const valor = await personalService.obtenerProximoValor();
		res.json({ success: true, data: { Valor: valor } });
	} catch (error) {
		console.error('[personal.obtenerProximoId] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener el próximo ID' });
	}
};

const crear = async (req, res) => {
	try {
		if (!String(req.body?.ApellidoNombre || '').trim()) {
			return res.status(400).json({
				success: false,
				mensaje: 'El campo ApellidoNombre es obligatorio',
			});
		}
		const nuevo = await personalService.crear(req.body);
		if (!nuevo) {
			return res.status(500).json({
				success: false,
				mensaje:
					'El alta no confirmó la ficha en la base del hospital. Buscá en el listado antes de volver a crearlo.',
			});
		}
		res.status(201).json({
			success: true,
			mensaje: 'Personal creado con éxito',
			data: nuevo,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.crear] ERROR:', error.message);
		res
			.status(status)
			.json({ success: false, mensaje: error.message || 'Error al crear el personal' });
	}
};

const actualizar = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		if (!String(req.body?.ApellidoNombre || '').trim()) {
			return res.status(400).json({
				success: false,
				mensaje: 'El campo ApellidoNombre es obligatorio',
			});
		}
		const actualizado = await personalService.actualizar(id, req.body);
		if (!actualizado) {
			return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		}
		res.json({
			success: true,
			mensaje: 'Personal actualizado con éxito',
			data: actualizado,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizar] ERROR:', error.message);
		res
			.status(status)
			.json({ success: false, mensaje: error.message || 'Error al actualizar el personal' });
	}
};

const eliminar = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const ok = await personalService.eliminar(id);
		if (!ok) {
			return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		}
		res.json({ success: true, mensaje: 'Personal eliminado con éxito' });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.eliminar] ERROR:', error.message);
		res
			.status(status)
			.json({ success: false, mensaje: error.message || 'Error al eliminar el personal' });
	}
};

// ---------- Catálogos ----------

const _catalogoHandler = (fn, label) => async (_req, res) => {
	try {
		const data = await fn();
		res.json({ success: true, data });
	} catch (error) {
		console.error(`[personal.${label}] ERROR:`, error.message);
		res
			.status(500)
			.json({ success: false, mensaje: `Error al obtener ${label}` });
	}
};

const listarEspecialidades = _catalogoHandler(
	personalService.listarEspecialidades,
	'especialidades',
);
const listarFunciones = _catalogoHandler(
	personalService.listarFunciones,
	'funciones',
);
const listarServicios = _catalogoHandler(
	personalService.listarServicios,
	'servicios',
);
const listarCategorias = _catalogoHandler(
	personalService.listarCategorias,
	'categorias',
);
const listarClases = _catalogoHandler(
	personalService.listarClases,
	'clases',
);
const listarEmpresasCatalogo = _catalogoHandler(
	personalService.listarEmpresasCatalogo,
	'empresas (catálogo)',
);

const _idInt = (req) => {
	const id = parseInt(req.params.id, 10);
	return Number.isFinite(id) ? id : null;
};

const obtenerServicioPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.obtenerServicioPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerServicioPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener servicio del personal' });
	}
};

const actualizarServicioPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.actualizarServicioPersonal(id, req.body || {});
		res.json({ success: true, mensaje: 'Servicio actualizado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarServicioPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar servicio',
		});
	}
};

const listarEmpresasPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarEmpresasPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarEmpresasPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar empresas' });
	}
};

const agregarEmpresaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.agregarEmpresaPersonal(id, req.body?.IdEmpresa);
		res.status(201).json({ success: true, mensaje: 'Empresa asociada', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.agregarEmpresaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al asociar empresa',
		});
	}
};

const quitarEmpresaPersonal = async (req, res) => {
	const id = _idInt(req);
	const idEmpresa = parseInt(req.params.idEmpresa, 10);
	if (id == null || !Number.isFinite(idEmpresa)) {
		return res.status(400).json({ success: false, mensaje: 'Parámetros inválidos' });
	}
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.quitarEmpresaPersonal(id, idEmpresa);
		res.json({ success: true, mensaje: 'Empresa quitada', data });
	} catch (error) {
		console.error('[personal.quitarEmpresaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al quitar empresa' });
	}
};

const obtenerFirmaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.obtenerFirmaPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerFirmaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener firma' });
	}
};

/** Firma por matrícula para exportes PDF (cualquier usuario autenticado del tenant). */
const obtenerFirmaPorMatricula = async (req, res) => {
	const matricula = Number(req.params.matricula);
	if (!Number.isFinite(matricula) || matricula <= 0) {
		return res.status(400).json({ success: false, mensaje: 'Matrícula inválida' });
	}
	try {
		const data = await personalService.obtenerFirmaPorMatricula(matricula);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerFirmaPorMatricula] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener firma' });
	}
};

/** Firma por ID (Valor) para exportes PDF — sin permiso de configuración. */
const obtenerFirmaPorIdPublic = async (req, res) => {
	const id = Number(req.params.id);
	if (!Number.isFinite(id) || id <= 0) {
		return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	}
	try {
		const data = await personalService.obtenerFirmaPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerFirmaPorIdPublic] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener firma' });
	}
};

const actualizarFirmaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		if (!req.file?.buffer) {
			return res.status(400).json({
				success: false,
				mensaje: 'Adjunte una imagen (campo archivo)',
			});
		}
		await personalService.actualizarFirmaPersonal(id, req.file.buffer);
		res.json({ success: true, mensaje: 'Firma guardada' });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarFirmaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al guardar firma',
		});
	}
};

const eliminarFirmaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		await personalService.eliminarFirmaPersonal(id);
		res.json({ success: true, mensaje: 'Firma eliminada' });
	} catch (error) {
		console.error('[personal.eliminarFirmaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al eliminar firma' });
	}
};

const listarSectoresPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarSectoresPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarSectoresPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar sectores' });
	}
};

const agregarSectorPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.agregarSectorPersonal(id, req.body?.idSector);
		res.status(201).json({ success: true, mensaje: 'Sector asignado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.agregarSectorPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al asignar sector',
		});
	}
};

const quitarSectorPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		let idSector = req.query?.idSector || req.body?.idSector;
		if (Array.isArray(idSector)) idSector = idSector[0];
		if (!idSector) {
			return res.status(400).json({ success: false, mensaje: 'idSector es obligatorio' });
		}
		const data = await personalService.quitarSectorPersonal(id, idSector);
		res.json({ success: true, mensaje: 'Sector quitado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.quitarSectorPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al quitar sector',
		});
	}
};

const listarServiciosPedidosPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarServiciosPedidosPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarServiciosPedidosPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar servicios' });
	}
};

const agregarServicioPedidosPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.agregarServicioPedidosPersonal(
			id,
			req.body?.idServicio,
		);
		res.status(201).json({ success: true, mensaje: 'Servicio asignado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.agregarServicioPedidosPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al asignar servicio',
		});
	}
};

const quitarServicioPedidosPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		let idServicio = req.query?.idServicio || req.body?.idServicio;
		if (Array.isArray(idServicio)) idServicio = idServicio[0];
		if (!idServicio) {
			return res.status(400).json({ success: false, mensaje: 'idServicio es obligatorio' });
		}
		const data = await personalService.quitarServicioPedidosPersonal(id, idServicio);
		res.json({ success: true, mensaje: 'Servicio quitado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.quitarServicioPedidosPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al quitar servicio',
		});
	}
};

const reemplazarAsignacionesPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.reemplazarAsignacionesPersonal(id, {
			sectores: req.body?.sectores,
			servicios: req.body?.servicios,
		});
		res.json({ success: true, mensaje: 'Asignaciones actualizadas', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.reemplazarAsignacionesPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al guardar asignaciones',
		});
	}
};

const listarCodigosFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarCodigosFacturacionPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarCodigosFacturacionPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar códigos de facturación' });
	}
};

const crearCodigoFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.crearCodigoFacturacionPersonal(id, req.body || {});
		res.status(201).json({ success: true, mensaje: 'Código agregado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.crearCodigoFacturacionPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al crear código',
		});
	}
};

const actualizarCodigoFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.actualizarCodigoFacturacionPersonal(id, req.body || {});
		res.json({ success: true, mensaje: 'Código actualizado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarCodigoFacturacionPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar código',
		});
	}
};

const eliminarCodigoFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		let ca = req.query?.CodigoAsociacion || req.body?.CodigoAsociacion;
		if (Array.isArray(ca)) ca = ca[0];
		if (!ca) {
			return res.status(400).json({ success: false, mensaje: 'CodigoAsociacion es obligatorio' });
		}
		const data = await personalService.eliminarCodigoFacturacionPersonal(id, ca);
		res.json({ success: true, mensaje: 'Código eliminado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.eliminarCodigoFacturacionPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al eliminar código',
		});
	}
};

const actualizarAdicionalesPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.actualizarAdicionalesPersonal(id, req.body || {});
		res.json({ success: true, mensaje: 'Datos adicionales actualizados', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarAdicionalesPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar datos adicionales',
		});
	}
};

const obtenerCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const data = await personalService.obtenerCuentaPersonal(id);
		if (!data) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerCuentaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener la cuenta de acceso' });
	}
};

const crearCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	const { nombreRed, password, codOperador } = req.body || {};
	if (!String(nombreRed || '').trim()) {
		return res.status(400).json({ success: false, mensaje: 'El nombre de usuario es obligatorio' });
	}
	if (!String(password || '').trim() || String(password).trim().length < 4) {
		return res.status(400).json({
			success: false,
			mensaje: 'La contraseña debe tener al menos 4 caracteres',
		});
	}
	try {
		const data = await personalService.crearCuentaPersonal(id, {
			nombreRed,
			password,
			codOperador,
		});
		res.status(201).json({
			success: true,
			mensaje: 'Cuenta de acceso creada correctamente',
			data,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.crearCuentaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al crear la cuenta de acceso',
		});
	}
};

const actualizarCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const data = await personalService.actualizarCuentaPersonal(id, req.body || {});
		res.json({
			success: true,
			mensaje: 'Cuenta de acceso actualizada',
			data,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarCuentaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar la cuenta de acceso',
		});
	}
};

const cambiarPasswordCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	const { password } = req.body || {};
	if (!password) {
		return res.status(400).json({ success: false, mensaje: 'La contraseña es requerida' });
	}
	try {
		await personalService.cambiarPasswordCuentaPersonal(id, password);
		res.json({ success: true, mensaje: 'Contraseña actualizada correctamente' });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.cambiarPasswordCuentaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al cambiar la contraseña',
		});
	}
};

module.exports = {
	listar,
	obtenerPorId,
	obtenerProximoId,
	crear,
	actualizar,
	eliminar,
	listarCamposExport,
	estadoSyncFisico,
	syncDesdeFisico,
	exportarPersonal,
	listarCuentasSoloNube,
	repararCuentasSoloNube,
	listarEspecialidades,
	listarFunciones,
	listarServicios,
	listarCategorias,
	listarClases,
	listarEmpresasCatalogo,
	obtenerServicioPersonal,
	actualizarServicioPersonal,
	listarEmpresasPersonal,
	agregarEmpresaPersonal,
	quitarEmpresaPersonal,
	obtenerFirmaPersonal,
	obtenerFirmaPorMatricula,
	obtenerFirmaPorIdPublic,
	actualizarFirmaPersonal,
	eliminarFirmaPersonal,
	listarSectoresPersonal,
	agregarSectorPersonal,
	quitarSectorPersonal,
	listarServiciosPedidosPersonal,
	agregarServicioPedidosPersonal,
	quitarServicioPedidosPersonal,
	reemplazarAsignacionesPersonal,
	listarCodigosFacturacionPersonal,
	crearCodigoFacturacionPersonal,
	actualizarCodigoFacturacionPersonal,
	eliminarCodigoFacturacionPersonal,
	actualizarAdicionalesPersonal,
	obtenerCuentaPersonal,
	crearCuentaPersonal,
	actualizarCuentaPersonal,
	cambiarPasswordCuentaPersonal,
};
