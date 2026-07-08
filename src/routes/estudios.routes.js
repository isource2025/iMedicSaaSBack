const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const estudiosController = require('../controllers/estudios.controller');

router.use(requireAuth, requireTenant);
router.get('/visita/:idVisita', estudiosController.listarPorVisita);
router.get('/:idPedido', estudiosController.obtenerPorId);

module.exports = router;
