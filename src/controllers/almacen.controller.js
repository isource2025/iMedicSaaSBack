/**
 * Controlador del módulo Almacén
 */
const svc = require('../services/almacen.service');

function handleError(res, error, fallback) {
	const status = error.statusCode || 500;
	console.error(fallback, error);
	return res.status(status).json({
		success: false,
		mensaje: error.message || fallback,
		error: process.env.NODE_ENV === 'development' ? error.message : undefined,
	});
}

const ctrl = {
	async resumen(req, res) {
		try {
			const data = await svc.getResumen();
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener resumen de almacén');
		}
	},

	async listarStock(req, res) {
		try {
			const data = await svc.listarStock({
				search: req.query.search || '',
				idDeposito: req.query.idDeposito || null,
				codigoDeposito: req.query.codigoDeposito || req.query.deposito || null,
				soloBajoMinimo: req.query.bajoMinimo === '1' || req.query.bajoMinimo === 'true',
				incluirCero: req.query.incluirCero === '1' || req.query.incluirCero === 'true',
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar stock');
		}
	},

	async listarMovimientos(req, res) {
		try {
			const data = await svc.listarMovimientos({
				limit: req.query.limit,
				idArticulo: req.query.idArticulo || null,
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar movimientos');
		}
	},

	async registrarAjuste(req, res) {
		try {
			await svc.registrarAjuste(req.body || {}, req.auth || req.user);
			return res.status(201).json({ success: true, mensaje: 'Ajuste de stock registrado' });
		} catch (e) {
			return handleError(res, e, 'Error al registrar ajuste');
		}
	},

	async registrarSalida(req, res) {
		try {
			await svc.registrarSalida(req.body || {}, req.auth || req.user);
			return res.status(201).json({ success: true, mensaje: 'Salida de stock registrada' });
		} catch (e) {
			return handleError(res, e, 'Error al registrar salida');
		}
	},

	async listarDepositos(req, res) {
		try {
			const data = await svc.listarDepositos();
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar depósitos');
		}
	},

	async resumenDepositos(req, res) {
		try {
			const data = await svc.resumenDepositos();
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener resumen de depósitos');
		}
	},

	// ── Artículos ──────────────────────────────────────────────────────────
	async listarArticulos(req, res) {
		try {
			const data = await svc.listarArticulos({
				search: req.query.search || '',
				activos: req.query.todos !== '1',
				page: req.query.page,
				pageSize: req.query.pageSize || req.query.limit,
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar artículos');
		}
	},

	async listarTrazabilidad(req, res) {
		try {
			const data = await svc.listarTrazabilidad({
				search: req.query.search || '',
				limit: req.query.limit,
				idArticulo: req.query.idArticulo || null,
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar trazabilidad');
		}
	},

	async detalleTrazabilidad(req, res) {
		try {
			const data = await svc.detalleTrazabilidadArticulo(req.params.idArticulo);
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener detalle de trazabilidad');
		}
	},

	async obtenerArticulo(req, res) {
		try {
			const data = await svc.obtenerArticulo(req.params.id);
			if (!data) return res.status(404).json({ success: false, mensaje: 'Artículo no encontrado' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener artículo');
		}
	},

	async crearArticulo(req, res) {
		try {
			const data = await svc.crearArticulo(req.body || {}, req.auth || req.user);
			return res.status(201).json({ success: true, data, mensaje: 'Artículo creado' });
		} catch (e) {
			return handleError(res, e, 'Error al crear artículo');
		}
	},

	async actualizarArticulo(req, res) {
		try {
			const data = await svc.actualizarArticulo(req.params.id, req.body || {});
			return res.json({ success: true, data, mensaje: 'Artículo actualizado' });
		} catch (e) {
			return handleError(res, e, 'Error al actualizar artículo');
		}
	},

	async eliminarArticulo(req, res) {
		try {
			const data = await svc.eliminarArticulo(req.params.id);
			return res.json({ success: true, data, mensaje: 'Artículo desactivado' });
		} catch (e) {
			return handleError(res, e, 'Error al eliminar artículo');
		}
	},

	async estadoVademecum(req, res) {
		try {
			const data = await svc.estadoVademecum();
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al consultar vademécum');
		}
	},

	async importarDesdeVademecum(req, res) {
		try {
			const data = await svc.importarDesdeVademecum(req.body || {});
			return res.json({ success: true, data, mensaje: 'Importación desde vademécum completada' });
		} catch (e) {
			return handleError(res, e, 'Error al importar vademécum');
		}
	},

	// ── Proveedores ────────────────────────────────────────────────────────
	async listarProveedores(req, res) {
		try {
			const data = await svc.listarProveedores({
				search: req.query.search || '',
				activos: req.query.todos !== '1',
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar proveedores');
		}
	},

	async crearProveedor(req, res) {
		try {
			const data = await svc.crearProveedor(req.body || {});
			return res.status(201).json({ success: true, data, mensaje: 'Proveedor creado' });
		} catch (e) {
			return handleError(res, e, 'Error al crear proveedor');
		}
	},

	async actualizarProveedor(req, res) {
		try {
			const data = await svc.actualizarProveedor(req.params.id, req.body || {});
			if (!data) return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado' });
			return res.json({ success: true, data, mensaje: 'Proveedor actualizado' });
		} catch (e) {
			return handleError(res, e, 'Error al actualizar proveedor');
		}
	},

	async eliminarProveedor(req, res) {
		try {
			const data = await svc.eliminarProveedor(req.params.id);
			return res.json({ success: true, data, mensaje: 'Proveedor desactivado' });
		} catch (e) {
			return handleError(res, e, 'Error al eliminar proveedor');
		}
	},

	// ── Solicitudes ────────────────────────────────────────────────────────
	async listarSolicitudes(req, res) {
		try {
			const data = await svc.listarSolicitudes({
				estado: req.query.estado || null,
				search: req.query.search || '',
				destino: req.query.destino || null,
				origen: req.query.origen || null,
				idSector: req.query.idSector || null,
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar solicitudes');
		}
	},

	_origenesCtx(req) {
		const gestiona =
			Array.isArray(req.permisos) &&
			req.permisos.some(
				(p) =>
					p === 'ALMACEN.SOLICITUDES.GESTIONAR' ||
					p === 'ALMACEN.CONFIG.EDITAR' ||
					p === 'ALMACEN.CONFIG.VER' ||
					String(p).startsWith('ALMACEN.'),
			);
		// gestionaTodo en listar orígenes de filtro: operadores de almacén ven todos los configurados
		const soloMios = req.query.mios === '1' || req.query.soloMios === '1' || req.query.todos !== '1';
		return {
			valorPersonal: req.valorPersonal,
			gestionaTodo: gestiona && req.query.todos === '1',
			soloMios: soloMios && req.query.todos !== '1',
		};
	},

	async listarDestinatarios(req, res) {
		try {
			const data = await svc.listarOrigenesSolicitud(ctrl._origenesCtx(req), {
				soloMios: req.query.todos !== '1',
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar orígenes');
		}
	},

	async listarOrigenes(req, res) {
		try {
			const vp =
				req.valorPersonal ??
				req.auth?.valorPersonal ??
				req.user?.valorPersonal ??
				req.auth?.idPersonal ??
				req.user?.idPersonal;
			const data = await svc.listarOrigenesSolicitud(
				{
					valorPersonal: vp,
					gestionaTodo:
						req.query.todos === '1' &&
						Array.isArray(req.permisos) &&
						req.permisos.includes('ALMACEN.SOLICITUDES.GESTIONAR'),
				},
				// mios=1 (o sin todos=1) → sectores del usuario en sesión
				{ soloMios: req.query.todos !== '1' },
			);
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar orígenes');
		}
	},

	async buscarArticuloPorCodigo(req, res) {
		try {
			const data = await svc.buscarArticuloPorCodigo(req.params.codigo || req.query.codigo, {
				idDeposito: req.query.idDeposito || null,
				origen: req.query.origen || null,
				idSector: req.query.idSector || null,
			});
			if (!data) return res.status(404).json({ success: false, mensaje: 'Artículo no encontrado' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al buscar artículo');
		}
	},

	async obtenerSolicitud(req, res) {
		try {
			const data = await svc.obtenerSolicitud(req.params.id);
			if (!data) return res.status(404).json({ success: false, mensaje: 'Solicitud no encontrada' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener solicitud');
		}
	},

	async crearSolicitud(req, res) {
		try {
			const data = await svc.crearSolicitud(req.body || {}, req.auth || req.user);
			return res.status(201).json({ success: true, data, mensaje: 'Solicitud creada' });
		} catch (e) {
			return handleError(res, e, 'Error al crear solicitud');
		}
	},

	async proximoNroPedido(req, res) {
		try {
			const data = await svc.proximoNroPedido();
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al generar número de pedido');
		}
	},

	async actualizarSolicitud(req, res) {
		try {
			const data = await svc.actualizarSolicitud(req.params.id, req.body || {}, req.auth || req.user);
			return res.json({ success: true, data, mensaje: 'Solicitud actualizada' });
		} catch (e) {
			return handleError(res, e, 'Error al actualizar solicitud');
		}
	},

	async cambiarEstadoSolicitud(req, res) {
		try {
			const data = await svc.cambiarEstadoSolicitud(
				req.params.id,
				req.body?.estado,
				req.auth || req.user,
				req.body || {},
			);
			return res.json({ success: true, data, mensaje: 'Estado actualizado' });
		} catch (e) {
			return handleError(res, e, 'Error al cambiar estado de solicitud');
		}
	},

	// ── Órdenes ────────────────────────────────────────────────────────────
	async listarOrdenes(req, res) {
		try {
			const data = await svc.listarOrdenes({
				estado: req.query.estado || null,
				search: req.query.search || '',
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar órdenes');
		}
	},

	async obtenerOrden(req, res) {
		try {
			const data = await svc.obtenerOrden(req.params.id);
			if (!data) return res.status(404).json({ success: false, mensaje: 'Orden no encontrada' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener orden');
		}
	},

	async crearOrden(req, res) {
		try {
			const data = await svc.crearOrden(req.body || {}, req.auth || req.user);
			return res.status(201).json({ success: true, data, mensaje: 'Orden de provisión creada' });
		} catch (e) {
			return handleError(res, e, 'Error al crear orden');
		}
	},

	async ejecutarTransferenciaSolicitud(req, res) {
		try {
			const data = await svc.ejecutarTransferenciaSolicitud(req.params.id, req.auth || req.user);
			return res.json({ success: true, data, mensaje: 'Transferencia ejecutada' });
		} catch (e) {
			return handleError(res, e, 'Error al ejecutar transferencia');
		}
	},

	async crearOrdenDesdeSolicitud(req, res) {
		try {
			const data = await svc.crearOrdenDesdeSolicitud(
				req.params.id,
				req.body || {},
				req.auth || req.user,
			);
			return res.status(201).json({ success: true, data, mensaje: 'Orden creada desde solicitud' });
		} catch (e) {
			return handleError(res, e, 'Error al crear orden desde solicitud');
		}
	},

	// ── Actas ──────────────────────────────────────────────────────────────
	async listarActas(req, res) {
		try {
			const data = await svc.listarActas({ search: req.query.search || '' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar actas');
		}
	},

	async obtenerActa(req, res) {
		try {
			const data = await svc.obtenerActa(req.params.id);
			if (!data) return res.status(404).json({ success: false, mensaje: 'Acta no encontrada' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al obtener acta');
		}
	},

	async crearActa(req, res) {
		try {
			const data = await svc.crearActa(req.body || {}, req.auth || req.user);
			return res
				.status(201)
				.json({ success: true, data, mensaje: 'Acta de recepción confirmada e ingresada a stock' });
		} catch (e) {
			return handleError(res, e, 'Error al crear acta de recepción');
		}
	},

	// ── Configuración (catálogos en BD) ─────────────────────────────────────
	async getConfig(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.getConfigCompleta();
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al cargar configuración de almacén');
		}
	},

	async listarRubros(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.listarRubros({
				soloActivos: req.query.todos !== '1',
			});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar rubros');
		}
	},

	async upsertRubro(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.upsertRubro(req.body || {});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al guardar rubro');
		}
	},

	async eliminarRubro(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			await cfgSvc.eliminarRubro(req.params.id);
			return res.json({ success: true, mensaje: 'Rubro eliminado' });
		} catch (e) {
			return handleError(res, e, 'Error al eliminar rubro');
		}
	},

	async listarConfigSectores(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.listarConfigSectores({ soloActivos: req.query.activos === '1' });
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al listar sectores de config');
		}
	},

	async upsertConfigSector(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.upsertConfigSector(req.body || {});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al guardar sector de config');
		}
	},

	async eliminarConfigSector(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			await cfgSvc.eliminarConfigSector(req.params.id);
			return res.json({ success: true, mensaje: 'Sector quitado de la configuración' });
		} catch (e) {
			return handleError(res, e, 'Error al eliminar sector de config');
		}
	},

	async upsertDeposito(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.upsertDeposito(req.body || {});
			return res.json({ success: true, data });
		} catch (e) {
			return handleError(res, e, 'Error al guardar depósito');
		}
	},

	async eliminarDeposito(req, res) {
		try {
			const cfgSvc = require('../services/almacen.config.service');
			const data = await cfgSvc.eliminarDeposito(req.params.id);
			return res.json({ success: true, data, mensaje: 'Depósito eliminado o desactivado' });
		} catch (e) {
			return handleError(res, e, 'Error al eliminar depósito');
		}
	},

	async actualizarOrden(req, res) {
		try {
			const data = await svc.actualizarOrden(req.params.id, req.body || {}, req.auth || req.user);
			return res.json({ success: true, data, mensaje: 'Orden actualizada' });
		} catch (e) {
			return handleError(res, e, 'Error al actualizar orden');
		}
	},

	async anularOrden(req, res) {
		try {
			const data = await svc.anularOrden(req.params.id, req.auth || req.user);
			return res.json({ success: true, data, mensaje: 'Orden anulada' });
		} catch (e) {
			return handleError(res, e, 'Error al anular orden');
		}
	},
};

module.exports = ctrl;
