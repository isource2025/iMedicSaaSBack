const express = require('express');
const router = express.Router();
const hcIngresoController = require('../controllers/hcIngreso.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _ownHc = requirePropietario({
	tabla: 'imHCI',
	pkCol: 'IdHCIngreso',
	autorCol: 'IdProfecional',
	pkParam: 'id',
	failSafe: true,
});

router.get(
	'/visita/:numeroVisita',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.VER'),
	hcIngresoController.obtenerHCIngresoPorVisita,
);
router.get('/:id', requirePermiso('INTERNACION.HISTORIA_CLINICA.VER'), hcIngresoController.obtenerHCIngresoPorId);
router.post('/', requirePermiso('INTERNACION.HISTORIA_CLINICA.CREAR'), hcIngresoController.crearHCIngreso);
router.put(
	'/:id',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.EDITAR'),
	_ownHc,
	hcIngresoController.actualizarHCIngreso,
);
router.delete(
	'/:id',
	requirePermiso('INTERNACION.HISTORIA_CLINICA.ELIMINAR'),
	_ownHc,
	hcIngresoController.eliminarHCIngreso,
);

module.exports = router;
