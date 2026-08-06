const express = require('express');
const router = express.Router();
const hciController = require('../controllers/hci.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _ownHci = requirePropietario({
	tabla: 'imHCI',
	pkCol: 'IdHCIngreso',
	autorCol: 'IdProfecional',
	pkParam: 'id',
	failSafe: true,
});

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
router.put(
	'/:id',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.EDITAR'),
	_ownHci,
	hciController.actualizar,
);
router.delete(
	'/:id',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.ELIMINAR'),
	_ownHci,
	hciController.eliminar,
);

module.exports = router;
