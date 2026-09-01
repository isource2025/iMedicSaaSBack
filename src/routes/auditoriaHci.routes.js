const express = require('express');
const router = express.Router();
const auditoriaHciController = require('../controllers/auditoriaHci.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

// INTERNACION.AUDITORIA_HC.VER solo lo tienen ADMIN y SUPER_ADMIN: el historial
// dice quién tocó cada HC, no es información para el resto del personal.
const soloAuditores = requirePermiso('INTERNACION.AUDITORIA_HC.VER');

router.get('/hc/:id', soloAuditores, auditoriaHciController.obtenerPorHC);
router.get('/visita/:numeroVisita', soloAuditores, auditoriaHciController.obtenerPorVisita);

module.exports = router;
