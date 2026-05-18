const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/turnosAdmin.controller');

router.use(requireAuth);
router.get('/', requirePermiso('TURNOS.ADMIN.VER'), ctrl.listar);

module.exports = router;
