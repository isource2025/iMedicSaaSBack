const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const sectoresController = require('../controllers/sectores.controller');

router.use(requireAuth, requireTenant);
router.get('/', sectoresController.obtenerSectores);

module.exports = router;
