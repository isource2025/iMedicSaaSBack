const express = require('express');
const router = express.Router();
const hciController = require('../controllers/hci.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

router.get(
	'/visita/:numeroVisita',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.VER'),
	hciController.getByNumeroVisita,
);
router.get('/:id', requirePermiso('INTERNACION.HISTORIA_CLINICA.VER'), hciController.getById);
router.get(
	'/paciente/:idPaciente',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.VER'),
	hciController.getByIdPaciente,
);
router.post('/', requirePermiso('INTERNACION.HISTORIA_CLINICA.CREAR'), hciController.crear);
router.put('/:id', requirePermiso('INTERNACION.HISTORIA_CLINICA.EDITAR'), hciController.actualizar);
router.delete('/:id', requirePermiso('INTERNACION.HISTORIA_CLINICA.ELIMINAR'), hciController.eliminar);

module.exports = router;
