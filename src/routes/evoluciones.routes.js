const express = require('express');
const router = express.Router();
const evolucionesController = require('../controllers/evoluciones.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');

router.use(requireTenant);

const _ownEvolucion = requirePropietario({
	tabla: 'imHCEvolucion',
	pkCol: 'IdHCEvolucion',
	autorCol: 'Profecional',
	pkParam: 'id',
	failSafe: true,
	autorEsMatricula: true,
});

router.get(
	'/:idVisita/byDate',
	requirePermiso('INTERNACION.EVOLUCIONES.VER'),
	evolucionesController.obtenerEvolucionesPorVisitaYFecha,
);
router.post('/', requirePermiso('INTERNACION.EVOLUCIONES.CREAR'), evolucionesController.crearEvolucion);
router.get('/:id', requirePermiso('INTERNACION.EVOLUCIONES.VER'), evolucionesController.obtenerEvolucionPorId);
router.put(
	'/:id',
	requirePermiso('INTERNACION.EVOLUCIONES.EDITAR'),
	_ownEvolucion,
	evolucionesController.actualizarEvolucion,
);
router.delete(
	'/:id',
	requirePermiso('INTERNACION.EVOLUCIONES.ELIMINAR'),
	_ownEvolucion,
	evolucionesController.eliminarEvolucion,
);

module.exports = router;
