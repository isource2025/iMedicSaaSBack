const express = require('express');
const router = express.Router();
const opcGrdController = require('../controllers/opcGrd.controller');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireAuth, requireTenant);

router.get('/', requirePermiso('CONFIGURACION.OPCGRD.VER'), opcGrdController.getAllOpcGrd);
router.get('/:id', requirePermiso('CONFIGURACION.OPCGRD.VER'), opcGrdController.getOpcGrdById);
router.post('/', requirePermiso('CONFIGURACION.OPCGRD.CREAR'), opcGrdController.createOpcGrd);
router.put('/:id', requirePermiso('CONFIGURACION.OPCGRD.EDITAR'), opcGrdController.updateOpcGrd);
router.delete('/:id', requirePermiso('CONFIGURACION.OPCGRD.ELIMINAR'), opcGrdController.deleteOpcGrd);

module.exports = router;
