const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const interconsultasController = require('../controllers/interconsultas.controller');

router.use(requireAuth, requireTenant);
router.get('/detalle/:id', interconsultasController.obtenerPorId);
router.get('/:idVisita', interconsultasController.listarPorVisita);
router.post('/', interconsultasController.crear);

module.exports = router;
