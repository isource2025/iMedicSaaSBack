const express = require('express');
const multer = require('multer');
const router = express.Router();
const personalController = require('../controllers/personal.controller');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { restoreTenantFromRequest } = require('../context/tenantContext');

const uploadFirma = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 3 * 1024 * 1024 },
});

// Todas las rutas de personal requieren autenticación y tenant activo (SaaS).
router.use(requireAuth, requireTenant);

// Orden: rutas más específicas primero
router.get('/next-id', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerProximoId);
// Catálogos (dropdowns de "Datos Profesionales")
router.get('/catalogos/sectores', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCatalogoSectores);
router.get('/catalogos/especialidades', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarEspecialidades);
router.get('/catalogos/funciones', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarFunciones);
router.get('/catalogos/servicios', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarServicios);
router.get('/catalogos/categorias', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCategorias);
router.get('/catalogos/clases', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarClases);
router.get('/catalogos/empresas', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarEmpresasCatalogo);

// Sync FÍSICO → NUBE + export Excel (antes de /:id)
router.get('/export-fields', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCamposExport);
router.get('/sync-fisico/estado', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.estadoSyncFisico);
router.post('/sync-desde-fisico', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.syncDesdeFisico);
router.get('/cuentas-solo-nube', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCuentasSoloNube);
router.post('/reparar-cuentas-solo-nube', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.repararCuentasSoloNube);
router.post('/exportar', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.exportarPersonal);

// Firma para PDFs clínicos (auth+tenant; sin permiso de configuración)
router.get('/firma/por-matricula/:matricula', personalController.obtenerFirmaPorMatricula);
router.get('/firma/por-id/:id', personalController.obtenerFirmaPorIdPublic);

// Acciones sobre un registro (no van en el form CRUD principal)
router.get('/:id/servicio', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerServicioPersonal);
router.put('/:id/servicio', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizarServicioPersonal);
router.get('/:id/empresas', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarEmpresasPersonal);
router.post('/:id/empresas', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.agregarEmpresaPersonal);
router.delete('/:id/empresas/:idEmpresa', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.quitarEmpresaPersonal);
router.get('/:id/firma', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerFirmaPersonal);
router.put(
	'/:id/firma',
	requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'),
	uploadFirma.single('archivo'),
	restoreTenantFromRequest,
	personalController.actualizarFirmaPersonal,
);
router.delete('/:id/firma', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.eliminarFirmaPersonal);
router.get('/:id/sectores', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarSectoresPersonal);
router.post('/:id/sectores', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.agregarSectorPersonal);
router.delete('/:id/sectores', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.quitarSectorPersonal);
router.get('/:id/servicios-pedidos', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarServiciosPedidosPersonal);
router.post('/:id/servicios-pedidos', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.agregarServicioPedidosPersonal);
router.delete('/:id/servicios-pedidos', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.quitarServicioPedidosPersonal);
router.put('/:id/asignaciones', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.reemplazarAsignacionesPersonal);

router.get('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCodigosFacturacionPersonal);
router.post('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.CREAR'), personalController.crearCodigoFacturacionPersonal);
router.put('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizarCodigoFacturacionPersonal);
router.delete('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.ELIMINAR'), personalController.eliminarCodigoFacturacionPersonal);

router.patch('/:id/adicionales', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizarAdicionalesPersonal);

router.get('/:id/cuenta', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerCuentaPersonal);
router.post('/:id/cuenta', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.crearCuentaPersonal);
router.put('/:id/cuenta', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.actualizarCuentaPersonal);
router.put('/:id/cuenta/password', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.cambiarPasswordCuentaPersonal);

router.get('/', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listar);
router.get('/:id', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerPorId);
router.post('/', requirePermiso('CONFIGURACION.PERSONAL.CREAR'), personalController.crear);
router.put('/:id', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizar);
router.delete('/:id', requirePermiso('CONFIGURACION.PERSONAL.ELIMINAR'), personalController.eliminar);

module.exports = router;
