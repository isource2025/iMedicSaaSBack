const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const ctrl = require('../controllers/turnero.controller');

router.use(requireAuth, requireTenant);

router.get('/pantallas', requirePermiso('TURNOS.ADMIN.VER'), ctrl.listarPantallas);
router.post('/pantallas', requirePermiso('TURNOS.ADMIN.EDITAR'), ctrl.crearPantalla);
router.delete('/pantallas/:idPantalla', requirePermiso('TURNOS.ADMIN.EDITAR'), ctrl.desactivarPantalla);
router.get('/config', requirePermiso('TURNOS.ADMIN.VER'), ctrl.obtenerAdmin);
router.get('/url', requirePermiso('TURNOS.AGENDA.VER'), ctrl.obtenerUrl);
router.put('/config', requirePermiso('TURNOS.ADMIN.EDITAR'), ctrl.guardarAdmin);
router.post('/config/regenerar-token', requirePermiso('TURNOS.ADMIN.EDITAR'), ctrl.regenerarToken);

module.exports = router;
