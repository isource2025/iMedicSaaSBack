const express = require('express');
const router = express.Router();
const indicacionesController = require('../controllers/indicaciones.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

router.get(
	'/formulario/datos',
	requirePermiso('INTERNACION.INDICACIONES.VER'),
	indicacionesController.obtenerDatosFormulario,
);
router.get(
	'/ultima/:numeroVisita',
	requirePermiso('INTERNACION.INDICACIONES.VER'),
	indicacionesController.obtenerUltimaIndicacionPorVisita,
);
router.get(
	'/ultimas/:numeroVisita',
	requirePermiso('INTERNACION.INDICACIONES.VER'),
	indicacionesController.obtenerUltimasIndicacionesPorVisita,
);
router.get('/:numeroVisita/byDate', requirePermiso('INTERNACION.INDICACIONES.VER'), indicacionesController.byDate);
router.get(
	'/:numeroVisita/insumos/byDate',
	requirePermiso('INTERNACION.INDICACIONES.VER'),
	indicacionesController.insumosByDate,
);

router.post('/', requirePermiso('INTERNACION.INDICACIONES.CREAR'), indicacionesController.nuevaIndicacion);
router.post('/hija', requirePermiso('INTERNACION.INDICACIONES.CREAR'), indicacionesController.crearIndicacionHija);

const _ownIndicacion = requirePropietario({
	tabla: 'imInterIndMedicas',
	pkCol: 'Valor',
	autorCol: 'OperadorCarga',
	pkParam: 'nroIndicacion',
});

router.delete(
	'/:nroIndicacion',
	requirePermiso('INTERNACION.INDICACIONES.ELIMINAR'),
	_ownIndicacion,
	indicacionesController.deleteIndicacion,
);
router.delete(
	'/hija/:nroIndicacion',
	requirePermiso('INTERNACION.INDICACIONES.ELIMINAR'),
	indicacionesController.deleteIndicacionHija,
);
router.get('/:nroIndicacion', requirePermiso('INTERNACION.INDICACIONES.VER'), indicacionesController.getIndicacionById);
router.put(
	'/:nroIndicacion',
	requirePermiso('INTERNACION.INDICACIONES.EDITAR'),
	_ownIndicacion,
	indicacionesController.updateIndicacion,
);
router.post(
	'/:nroIndicacion/aplicar',
	requirePermiso('INTERNACION.INDICACIONES.APLICAR'),
	indicacionesController.aplicarIndicacion,
);

module.exports = router;
