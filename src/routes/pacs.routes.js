const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const pacsController = require('../controllers/pacs.controller');

router.use(requireAuth, requireTenant);

const ver = requireAnyPermiso(
	'INTERNACION.ESTUDIOS.VER',
	'TURNOS.AGENDA.VER',
	'INTERNACION.ADJUNTOS.VER',
);

router.get('/health', ver, pacsController.health);
router.get('/pacientes/:patientId/estudios', ver, pacsController.listarPorPaciente);
router.get('/estudios/:studyUid', ver, pacsController.obtenerEstudio);
router.get('/estudios/:studyUid/series', ver, pacsController.listarSeries);
router.get('/estudios/:studyUid/files', ver, pacsController.listarArchivos);
router.get('/estudios/:studyUid/file', ver, pacsController.descargarArchivo);

module.exports = router;
