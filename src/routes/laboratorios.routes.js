const express = require('express');
const router = express.Router();
const laboratoriosController = require('../controllers/laboratorios.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.post(
	'/upload-ocr',
	requirePermiso('INTERNACION.ESTUDIOS.CREAR'),
	laboratoriosController.upload.single('archivo'),
	laboratoriosController.uploadYProcesarOCR,
);
router.post('/save', requirePermiso('INTERNACION.ESTUDIOS.CREAR'), laboratoriosController.guardarExamen);
router.get(
	'/visita/:numeroVisita',
	requirePermiso('INTERNACION.ESTUDIOS.VER'),
	laboratoriosController.obtenerExamenesPorVisita,
);
router.get('/:idExamen', requirePermiso('INTERNACION.ESTUDIOS.VER'), laboratoriosController.obtenerExamenPorId);
router.put('/:idExamen', requirePermiso('INTERNACION.ESTUDIOS.EDITAR'), laboratoriosController.actualizarExamen);
router.delete('/:idExamen', requirePermiso('INTERNACION.ESTUDIOS.ELIMINAR'), laboratoriosController.eliminarExamen);
router.get(
	'/parametros/config',
	requirePermiso('INTERNACION.ESTUDIOS.VER'),
	laboratoriosController.obtenerParametrosConfig,
);
router.put(
	'/parametros/config/:idParametro',
	requirePermiso('INTERNACION.ESTUDIOS.EDITAR'),
	laboratoriosController.actualizarParametroConfig,
);

module.exports = router;
