/**
 * Rutas del módulo Almacén / Abastecimiento
 */
const express = require('express');
const router = express.Router();
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/almacen.controller');

router.use(requireTenant);

// Dashboard / stock
router.get('/resumen', requirePermiso('ALMACEN.STOCK.VER'), ctrl.resumen);
router.get('/stock', requirePermiso('ALMACEN.STOCK.VER'), ctrl.listarStock);
router.get('/movimientos', requirePermiso('ALMACEN.MOVIMIENTOS.VER'), ctrl.listarMovimientos);
router.get('/trazabilidad', requirePermiso('ALMACEN.MOVIMIENTOS.VER'), ctrl.listarTrazabilidad);
router.get(
	'/trazabilidad/articulo/:idArticulo',
	requirePermiso('ALMACEN.MOVIMIENTOS.VER'),
	ctrl.detalleTrazabilidad,
);
router.post('/stock/ajuste', requirePermiso('ALMACEN.STOCK.GESTIONAR'), ctrl.registrarAjuste);
router.post('/stock/salida', requirePermiso('ALMACEN.STOCK.GESTIONAR'), ctrl.registrarSalida);
router.get('/depositos', requirePermiso('ALMACEN.STOCK.VER'), ctrl.listarDepositos);
router.get('/depositos/resumen', requirePermiso('ALMACEN.STOCK.VER'), ctrl.resumenDepositos);

// Artículos
router.get('/articulos', requirePermiso('ALMACEN.ARTICULOS.VER'), ctrl.listarArticulos);
router.get('/articulos/codigo/:codigo', requirePermiso('ALMACEN.ARTICULOS.VER'), ctrl.buscarArticuloPorCodigo);
router.get('/articulos/:id', requirePermiso('ALMACEN.ARTICULOS.VER'), ctrl.obtenerArticulo);
router.post('/articulos', requirePermiso('ALMACEN.ARTICULOS.CREAR'), ctrl.crearArticulo);
router.put('/articulos/:id', requirePermiso('ALMACEN.ARTICULOS.EDITAR'), ctrl.actualizarArticulo);
router.delete('/articulos/:id', requirePermiso('ALMACEN.ARTICULOS.EDITAR'), ctrl.eliminarArticulo);
router.get('/vademecum/estado', requirePermiso('ALMACEN.ARTICULOS.VER'), ctrl.estadoVademecum);
router.post(
	'/vademecum/importar',
	requirePermiso('ALMACEN.ARTICULOS.CREAR'),
	ctrl.importarDesdeVademecum,
);

// Proveedores
router.get('/proveedores', requirePermiso('ALMACEN.PROVEEDORES.VER'), ctrl.listarProveedores);
router.post('/proveedores', requirePermiso('ALMACEN.PROVEEDORES.CREAR'), ctrl.crearProveedor);
router.put('/proveedores/:id', requirePermiso('ALMACEN.PROVEEDORES.EDITAR'), ctrl.actualizarProveedor);
router.delete('/proveedores/:id', requirePermiso('ALMACEN.PROVEEDORES.EDITAR'), ctrl.eliminarProveedor);

// Configuración de almacén (catálogos y sectores origen)
router.get('/config', requirePermiso('ALMACEN.CONFIG.VER'), ctrl.getConfig);
router.get('/config/sectores', requirePermiso('ALMACEN.CONFIG.VER'), ctrl.listarConfigSectores);
router.post('/config/sectores', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.upsertConfigSector);
router.put('/config/sectores', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.upsertConfigSector);
router.delete('/config/sectores/:id', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.eliminarConfigSector);
router.get('/config/rubros', requirePermiso('ALMACEN.SOLICITUDES.VER'), ctrl.listarRubros);
router.post('/config/rubros', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.upsertRubro);
router.put('/config/rubros', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.upsertRubro);
router.delete('/config/rubros/:id', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.eliminarRubro);
router.post('/config/depositos', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.upsertDeposito);
router.put('/config/depositos', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.upsertDeposito);
router.delete('/config/depositos/:id', requirePermiso('ALMACEN.CONFIG.EDITAR'), ctrl.eliminarDeposito);

// Solicitudes de provisión
router.get('/solicitudes/destinatarios', requirePermiso('ALMACEN.SOLICITUDES.VER'), ctrl.listarDestinatarios);
router.get('/solicitudes/origenes', requirePermiso('ALMACEN.SOLICITUDES.VER'), ctrl.listarOrigenes);
router.get('/solicitudes/proximo-nro', requirePermiso('ALMACEN.SOLICITUDES.CREAR'), ctrl.proximoNroPedido);
router.get('/solicitudes', requirePermiso('ALMACEN.SOLICITUDES.VER'), ctrl.listarSolicitudes);
router.get('/solicitudes/:id', requirePermiso('ALMACEN.SOLICITUDES.VER'), ctrl.obtenerSolicitud);
router.post('/solicitudes', requirePermiso('ALMACEN.SOLICITUDES.CREAR'), ctrl.crearSolicitud);
router.put('/solicitudes/:id', requirePermiso('ALMACEN.SOLICITUDES.EDITAR'), ctrl.actualizarSolicitud);
router.post(
	'/solicitudes/:id/estado',
	requirePermiso('ALMACEN.SOLICITUDES.GESTIONAR'),
	ctrl.cambiarEstadoSolicitud,
);
router.post(
	'/solicitudes/:id/orden',
	requirePermiso('ALMACEN.ORDENES.CREAR'),
	ctrl.crearOrdenDesdeSolicitud,
);
router.post(
	'/solicitudes/:id/transferir',
	requirePermiso('ALMACEN.STOCK.GESTIONAR'),
	ctrl.ejecutarTransferenciaSolicitud,
);

// Órdenes de provisión
router.get('/ordenes', requirePermiso('ALMACEN.ORDENES.VER'), ctrl.listarOrdenes);
router.get('/ordenes/:id', requirePermiso('ALMACEN.ORDENES.VER'), ctrl.obtenerOrden);
router.post('/ordenes', requirePermiso('ALMACEN.ORDENES.CREAR'), ctrl.crearOrden);
router.put('/ordenes/:id', requirePermiso('ALMACEN.ORDENES.CREAR'), ctrl.actualizarOrden);
router.post('/ordenes/:id/anular', requirePermiso('ALMACEN.ORDENES.CREAR'), ctrl.anularOrden);

// Actas de recepción
router.get('/actas', requirePermiso('ALMACEN.ACTAS.VER'), ctrl.listarActas);
router.get('/actas/:id', requirePermiso('ALMACEN.ACTAS.VER'), ctrl.obtenerActa);
router.post('/actas', requirePermiso('ALMACEN.ACTAS.CREAR'), ctrl.crearActa);

module.exports = router;
