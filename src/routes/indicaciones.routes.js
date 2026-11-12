const express = require('express');
const router = express.Router();
const indicacionesController = require('../controllers/indicaciones.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso, requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const TIPO_INDICACION_DESCARTABLES = 9;

const _crearIndicacion = requirePermiso('INTERNACION.INDICACIONES.CREAR');
// Descartables (insumos): INTERNACION.INSUMOS.CREAR alcanza; INDICACIONES.CREAR los sigue incluyendo.
const _crearInsumo = requireAnyPermiso('INTERNACION.INSUMOS.CREAR', 'INTERNACION.INDICACIONES.CREAR');
const requirePermisoAltaIndicacion = (req, res, next) =>
	Number(req.body?.TipoIndicacion) === TIPO_INDICACION_DESCARTABLES
		? _crearInsumo(req, res, next)
		: _crearIndicacion(req, res, next);

router.get(
	'/formulario/datos',
	requireAnyPermiso('INTERNACION.INDICACIONES.VER', 'INTERNACION.INSUMOS.CREAR'),
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
	requireAnyPermiso('INTERNACION.INSUMOS.VER', 'INTERNACION.INDICACIONES.VER'),
	indicacionesController.insumosByDate,
);
router.post(
	'/:numeroVisita/visto-enfermeria',
	requirePermiso('INTERNACION.INDICACIONES.VER'),
	indicacionesController.marcarVistoEnfermeria,
);
router.get(
	'/:numeroVisita/nuevas-enfermeria',
	requirePermiso('INTERNACION.INDICACIONES.VER'),
	indicacionesController.nuevasEnfermeria,
);

router.post('/', requirePermisoAltaIndicacion, indicacionesController.nuevaIndicacion);
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
	'/:nroIndicacion/sin-efecto',
	requirePermiso('INTERNACION.INDICACIONES.EDITAR'),
	indicacionesController.dejarSinEfecto,
);
router.post(
	'/:nroIndicacion/aplicar',
	requirePermiso('INTERNACION.INDICACIONES.APLICAR'),
	indicacionesController.aplicarIndicacion,
);

module.exports = router;
