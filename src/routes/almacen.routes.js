/**
 * Rutas del módulo Almacén / Abastecimiento
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/almacen.controller');

const fotoTmpDir = path.join(__dirname, '..', '..', 'uploads', '.tmp-producto-foto');
fs.mkdirSync(fotoTmpDir, { recursive: true });
const uploadFoto = multer({
	dest: fotoTmpDir,
	limits: { fileSize: 4 * 1024 * 1024 },
	fileFilter: (_req, file, cb) => {
		if (/^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype || '')) return cb(null, true);
		const err = new Error('Solo se permiten imágenes (JPEG, PNG, GIF, WebP)');
		err.statusCode = 400;
		cb(err);
	},
});

/** Errores de multer (tamaño / tipo) como 400 con mensaje legible. */
function conFoto(req, res, next) {
	uploadFoto.single('foto')(req, res, (err) => {
		if (!err) return next();
		const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera los 4 MB' : err.message;
		return res.status(400).json({ success: false, mensaje });
	});
}

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

// ── Productos & Remitos (tablas legacy Clarion) ──────────────────────────
router.get('/productos', requirePermiso('ALMACEN.PRODUCTOS.VER'), ctrl.listarProductosLegacy);
router.get('/productos/resumen', requirePermiso('ALMACEN.PRODUCTOS.VER'), ctrl.resumenProductosLegacy);
router.get(
	'/productos/catalogos',
	requirePermiso('ALMACEN.PRODUCTOS.VER'),
	ctrl.catalogosProductosLegacy,
);
router.post(
	'/productos/catalogos/:catalogo',
	requirePermiso('ALMACEN.PRODUCTOS.EDITAR'),
	ctrl.guardarCatalogoProductoLegacy,
);
router.put(
	'/productos/catalogos/:catalogo/:id',
	requirePermiso('ALMACEN.PRODUCTOS.EDITAR'),
	ctrl.guardarCatalogoProductoLegacy,
);
router.delete(
	'/productos/catalogos/:catalogo/:id',
	requirePermiso('ALMACEN.PRODUCTOS.ELIMINAR'),
	ctrl.eliminarCatalogoProductoLegacy,
);
router.get(
	'/productos/cuentas',
	requirePermiso('ALMACEN.PRODUCTOS.VER'),
	ctrl.listarCuentasProductoLegacy,
);
router.get('/productos/:id', requirePermiso('ALMACEN.PRODUCTOS.VER'), ctrl.obtenerProductoLegacy);
router.get('/productos/:id/ficha', requirePermiso('ALMACEN.PRODUCTOS.VER'), ctrl.fichaProductoLegacy);
router.get('/productos/:id/foto', requirePermiso('ALMACEN.PRODUCTOS.VER'), ctrl.fotoProductoLegacy);
router.post('/productos/:id/foto', requirePermiso('ALMACEN.PRODUCTOS.EDITAR'), conFoto, ctrl.subirFotoProductoLegacy);
router.delete('/productos/:id/foto', requirePermiso('ALMACEN.PRODUCTOS.EDITAR'), ctrl.quitarFotoProductoLegacy);
router.post('/productos/:id/estado', requirePermiso('ALMACEN.PRODUCTOS.EDITAR'), ctrl.estadoProductoLegacy);
router.post('/productos', requirePermiso('ALMACEN.PRODUCTOS.CREAR'), ctrl.crearProductoLegacy);
router.put('/productos/:id', requirePermiso('ALMACEN.PRODUCTOS.EDITAR'), ctrl.actualizarProductoLegacy);
router.delete(
	'/productos/:id',
	requirePermiso('ALMACEN.PRODUCTOS.ELIMINAR'),
	ctrl.eliminarProductoLegacy,
);

router.get('/remitos', requirePermiso('ALMACEN.REMITOS.VER'), ctrl.listarRemitosLegacy);
router.get('/remitos/catalogos', requirePermiso('ALMACEN.REMITOS.VER'), ctrl.catalogosRemitosLegacy);
router.get(
	'/remitos/proveedores',
	requirePermiso('ALMACEN.REMITOS.VER'),
	ctrl.listarProveedoresRemitoLegacy,
);
router.get(
	'/remitos/clientes',
	requirePermiso('ALMACEN.REMITOS.VER'),
	ctrl.listarClientesRemitoLegacy,
);
router.get(
	'/remitos/pacientes',
	requirePermiso('ALMACEN.REMITOS.VER'),
	ctrl.listarPacientesRemitoLegacy,
);
router.get(
	'/remitos/proximo-nro',
	requirePermiso('ALMACEN.REMITOS.CREAR'),
	ctrl.proximoNroRemitoLegacy,
);
router.get(
	'/remitos/candidatos-salida-servicio',
	requirePermiso('ALMACEN.REMITOS.CREAR'),
	ctrl.candidatosSalidaServicio,
);
router.get(
	'/remitos/medicacion-pendiente-servicios',
	requirePermiso('ALMACEN.REMITOS.VER'),
	ctrl.medicacionPendienteServicios,
);
router.post(
	'/remitos/indicaciones/:nroIndicacion/excluir-entrega',
	requirePermiso('ALMACEN.REMITOS.EDITAR'),
	ctrl.excluirIndicacionEntrega,
);
router.get('/remitos/:id', requirePermiso('ALMACEN.REMITOS.VER'), ctrl.obtenerRemitoLegacy);
router.post('/remitos', requirePermiso('ALMACEN.REMITOS.CREAR'), ctrl.crearRemitoLegacy);
router.put('/remitos/:id', requirePermiso('ALMACEN.REMITOS.EDITAR'), ctrl.actualizarRemitoLegacy);
router.post('/remitos/:id/anular', requirePermiso('ALMACEN.REMITOS.ELIMINAR'), ctrl.anularRemitoLegacy);
router.delete('/remitos/:id', requirePermiso('ALMACEN.REMITOS.ELIMINAR'), ctrl.anularRemitoLegacy);

// ── Existencias Clarion (dbo.Stock) + Proveedores (dbo.PROVEEDORES) ─────
// Rutas /existencias evitan colisión con el stack imAlmacén en /stock.
router.get('/existencias', requirePermiso('ALMACEN.STOCK.VER'), ctrl.listarExistenciasClarion);
router.get('/existencias/resumen', requirePermiso('ALMACEN.STOCK.VER'), ctrl.resumenExistenciasClarion);
router.get('/existencias/movimientos', requirePermiso('ALMACEN.STOCK.VER'), ctrl.movimientosExistenciasClarion);
router.get(
	'/existencias/catalogos',
	requirePermiso('ALMACEN.STOCK.VER'),
	ctrl.catalogosExistenciasClarion,
);
router.post('/existencias', requirePermiso('ALMACEN.STOCK.CREAR'), ctrl.crearExistenciaClarion);
router.post('/existencias/ajustes', requirePermiso('ALMACEN.STOCK.GESTIONAR'), ctrl.ajustarExistenciaClarion);
const CLAVE_STOCK = '/existencias/:idEmpresa/:idSucursal/:idDeposito/:idProducto';
router.put(CLAVE_STOCK, requirePermiso('ALMACEN.STOCK.EDITAR'), ctrl.actualizarExistenciaClarion);
router.delete(CLAVE_STOCK, requirePermiso('ALMACEN.STOCK.ELIMINAR'), ctrl.eliminarExistenciaClarion);

router.get('/proveedores-clarion', requirePermiso('ALMACEN.PROVEEDORES.VER'), ctrl.listarProveedoresClarion);
router.get('/proveedores-clarion/resumen', requirePermiso('ALMACEN.PROVEEDORES.VER'), ctrl.resumenProveedoresClarion);
router.get(
	'/proveedores-clarion/catalogos',
	requirePermiso('ALMACEN.PROVEEDORES.VER'),
	ctrl.catalogosProveedoresClarion,
);
router.get('/proveedores-clarion/:id', requirePermiso('ALMACEN.PROVEEDORES.VER'), ctrl.obtenerProveedorClarion);
router.post('/proveedores-clarion', requirePermiso('ALMACEN.PROVEEDORES.CREAR'), ctrl.crearProveedorClarion);
router.put('/proveedores-clarion/:id', requirePermiso('ALMACEN.PROVEEDORES.EDITAR'), ctrl.actualizarProveedorClarion);
router.post(
	'/proveedores-clarion/:id/estado',
	requirePermiso('ALMACEN.PROVEEDORES.EDITAR'),
	ctrl.estadoProveedorClarion,
);
router.delete(
	'/proveedores-clarion/:id',
	requirePermiso('ALMACEN.PROVEEDORES.ELIMINAR'),
	ctrl.eliminarProveedorClarion,
);

module.exports = router;
