const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requirePropietario } = require('../middlewares/propietario.middleware');
const protocolosController = require('../controllers/protocolos.controller');

router.use(requireAuth, requireTenant);

const ver = requirePermiso('INTERNACION.PROTOCOLOS.VER');
const crear = requirePermiso('INTERNACION.PROTOCOLOS.CREAR');
const editar = requirePermiso('INTERNACION.PROTOCOLOS.EDITAR');
const eliminar = requirePermiso('INTERNACION.PROTOCOLOS.ELIMINAR');

// IdOperador guarda el ValorPersonal de quien cargó; ADMIN puede gestionar ajenos.
const _own = requirePropietario({
	tabla: 'HCProtocolosPtes',
	pkCol: 'IdProtocolo',
	autorCol: 'IdOperador',
	pkParam: 'id',
	failSafe: true,
});

router.get('/tipos', ver, protocolosController.listarTipos);
router.get('/tipos/medicamentos', ver, protocolosController.medicamentosPorDefecto);
router.get('/proforma', ver, protocolosController.proForma);
router.get('/medicamentos/buscar', ver, protocolosController.buscarMedicamentos);
router.get('/practicas/buscar', ver, protocolosController.buscarPracticas);
router.get('/practicas/:idPractica', ver, protocolosController.detallePractica);
router.get('/profesionales/buscar', ver, protocolosController.buscarProfesionales);
router.get('/visita/:idVisita', ver, protocolosController.listarPorVisita);
router.post('/', crear, protocolosController.crear);
router.put('/:id', editar, _own, protocolosController.actualizar);
router.delete('/:id', eliminar, _own, protocolosController.eliminar);

module.exports = router;
