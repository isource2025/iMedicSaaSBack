const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const protocolosController = require('../controllers/protocolos.controller');

router.use(requireAuth, requireTenant);

const ver = requirePermiso('INTERNACION.PROTOCOLOS.VER');
const crear = requirePermiso('INTERNACION.PROTOCOLOS.CREAR');

router.get('/tipos', ver, protocolosController.listarTipos);
router.get('/proforma', ver, protocolosController.proForma);
router.get('/practicas/buscar', ver, protocolosController.buscarPracticas);
router.get('/practicas/:idPractica', ver, protocolosController.detallePractica);
router.get('/profesionales/buscar', ver, protocolosController.buscarProfesionales);
router.get('/visita/:idVisita', ver, protocolosController.listarPorVisita);
router.post('/', crear, protocolosController.crear);

module.exports = router;
