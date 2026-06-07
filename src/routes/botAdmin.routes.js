const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/botAdmin.controller');
const convCtrl = require('../controllers/botConversacionAdmin.controller');

router.use(requireAuth);

router.get('/config', requirePermiso('TURNOS.ADMIN.VER'), ctrl.obtenerConfigAdmin);
router.patch('/config', requirePermiso('TURNOS.ADMIN.VER'), ctrl.guardarConfigAdmin);
router.get('/whatsapp', requirePermiso('TURNOS.ADMIN.VER'), ctrl.obtenerWhatsappConfig);
router.patch('/whatsapp', requirePermiso('TURNOS.ADMIN.VER'), ctrl.guardarWhatsappConfig);
router.get('/logs', requirePermiso('TURNOS.ADMIN.VER'), ctrl.listarLogs);

router.get('/conversaciones/estado-almacen', requirePermiso('TURNOS.AGENDA.VER'), convCtrl.estadoAlmacenamiento);
router.get('/conversaciones', requirePermiso('TURNOS.AGENDA.VER'), convCtrl.listarConversaciones);
router.post('/conversaciones/simular', requirePermiso('TURNOS.AGENDA.EDITAR'), convCtrl.simularEntrante);
router.get('/conversaciones/:id', requirePermiso('TURNOS.AGENDA.VER'), convCtrl.obtenerDetalle);
router.get('/conversaciones/:id/mensajes', requirePermiso('TURNOS.AGENDA.VER'), convCtrl.listarMensajes);
router.post('/conversaciones/:id/leer', requirePermiso('TURNOS.AGENDA.VER'), convCtrl.marcarLeida);
router.patch('/conversaciones/:id/control', requirePermiso('TURNOS.AGENDA.EDITAR'), convCtrl.cambiarControl);
router.post('/conversaciones/:id/mensajes', requirePermiso('TURNOS.AGENDA.EDITAR'), convCtrl.enviarMensaje);

module.exports = router;
