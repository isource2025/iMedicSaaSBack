const express = require('express');
const multer = require('multer');
const router = express.Router();
const personalController = require('../controllers/personal.controller');

const uploadFirma = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 3 * 1024 * 1024 },
});

// Orden: rutas más específicas primero
router.get('/next-id', personalController.obtenerProximoId);
// Catálogos (dropdowns de "Datos Profesionales")
router.get('/catalogos/especialidades', personalController.listarEspecialidades);
router.get('/catalogos/funciones', personalController.listarFunciones);
router.get('/catalogos/servicios', personalController.listarServicios);
router.get('/catalogos/categorias', personalController.listarCategorias);
router.get('/catalogos/clases', personalController.listarClases);
router.get('/catalogos/empresas', personalController.listarEmpresasCatalogo);

// Acciones sobre un registro (no van en el form CRUD principal)
router.get('/:id/servicio', personalController.obtenerServicioPersonal);
router.put('/:id/servicio', personalController.actualizarServicioPersonal);
router.get('/:id/empresas', personalController.listarEmpresasPersonal);
router.post('/:id/empresas', personalController.agregarEmpresaPersonal);
router.delete('/:id/empresas/:idEmpresa', personalController.quitarEmpresaPersonal);
router.get('/:id/firma', personalController.obtenerFirmaPersonal);
router.put(
	'/:id/firma',
	uploadFirma.single('archivo'),
	personalController.actualizarFirmaPersonal,
);
router.delete('/:id/firma', personalController.eliminarFirmaPersonal);
router.get('/:id/sectores', personalController.listarSectoresPersonal);
router.post('/:id/sectores', personalController.agregarSectorPersonal);
router.delete('/:id/sectores', personalController.quitarSectorPersonal);

router.get('/:id/codigos-facturacion', personalController.listarCodigosFacturacionPersonal);
router.post('/:id/codigos-facturacion', personalController.crearCodigoFacturacionPersonal);
router.put('/:id/codigos-facturacion', personalController.actualizarCodigoFacturacionPersonal);
router.delete('/:id/codigos-facturacion', personalController.eliminarCodigoFacturacionPersonal);

router.patch('/:id/adicionales', personalController.actualizarAdicionalesPersonal);

router.get('/', personalController.listar);
router.get('/:id', personalController.obtenerPorId);
router.post('/', personalController.crear);
router.put('/:id', personalController.actualizar);
router.delete('/:id', personalController.eliminar);

module.exports = router;
