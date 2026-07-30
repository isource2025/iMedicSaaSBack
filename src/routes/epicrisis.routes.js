const express = require('express');
const router = express.Router();
const epicrisisController = require('../controllers/epicrisis.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _ownEpicrisis = requirePropietario({
	tabla: 'imHCEpicrisis',
	pkCol: 'IdHCEpicrisis',
	autorCol: 'Profecional',
	pkParam: 'id',
	failSafe: true,
	autorEsMatricula: true,
});

router.get(
	'/:idVisita/generar-ia',
	requirePermiso('INTERNACION.EPICRISIS.CREAR'),
	epicrisisController.generarConIA,
);
router.post(
	'/:idVisita/generar-ia',
	requirePermiso('INTERNACION.EPICRISIS.CREAR'),
	epicrisisController.generarConIA,
);

router.get(
	'/:idVisita',
	requirePermiso('INTERNACION.EPICRISIS.VER'),
	epicrisisController.listarPorVisita,
);
router.get('/item/:id', requirePermiso('INTERNACION.EPICRISIS.VER'), epicrisisController.obtenerPorId);
router.post('/', requirePermiso('INTERNACION.EPICRISIS.CREAR'), epicrisisController.crear);
router.put(
	'/:id',
	requirePermiso('INTERNACION.EPICRISIS.EDITAR'),
	_ownEpicrisis,
	epicrisisController.actualizar,
);
router.delete(
	'/:id',
	requirePermiso('INTERNACION.EPICRISIS.ELIMINAR'),
	_ownEpicrisis,
	epicrisisController.eliminar,
);

module.exports = router;
