const express = require('express');
const multer = require('multer');
const router = express.Router();
const personalController = require('../controllers/personal.controller');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');

const uploadFirma = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 3 * 1024 * 1024 },
});

// Todas las rutas de personal requieren autenticación y tenant activo (SaaS).
router.use(requireAuth, requireTenant);

// Orden: rutas más específicas primero
router.get('/next-id', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerProximoId);
// Catálogos (dropdowns de "Datos Profesionales")
router.get('/catalogos/especialidades', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarEspecialidades);
router.get('/catalogos/funciones', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarFunciones);
router.get('/catalogos/servicios', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarServicios);
router.get('/catalogos/categorias', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCategorias);
router.get('/catalogos/clases', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarClases);
router.get('/catalogos/empresas', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarEmpresasCatalogo);

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
	personalController.actualizarFirmaPersonal,
);
router.delete('/:id/firma', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.eliminarFirmaPersonal);
router.get('/:id/sectores', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarSectoresPersonal);
router.post('/:id/sectores', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.agregarSectorPersonal);
router.delete('/:id/sectores', requirePermiso('CONFIGURACION.PERSONAL.GESTIONAR'), personalController.quitarSectorPersonal);

router.get('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listarCodigosFacturacionPersonal);
router.post('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.CREAR'), personalController.crearCodigoFacturacionPersonal);
router.put('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizarCodigoFacturacionPersonal);
router.delete('/:id/codigos-facturacion', requirePermiso('CONFIGURACION.PERSONAL.ELIMINAR'), personalController.eliminarCodigoFacturacionPersonal);

router.patch('/:id/adicionales', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizarAdicionalesPersonal);

router.get('/', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.listar);
router.get('/:id', requirePermiso('CONFIGURACION.PERSONAL.VER'), personalController.obtenerPorId);
router.post('/', requirePermiso('CONFIGURACION.PERSONAL.CREAR'), personalController.crear);
router.put('/:id', requirePermiso('CONFIGURACION.PERSONAL.EDITAR'), personalController.actualizar);
router.delete('/:id', requirePermiso('CONFIGURACION.PERSONAL.ELIMINAR'), personalController.eliminar);

module.exports = router;
