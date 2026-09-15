const express = require('express');
const controller = require('../controllers/catalogoSql.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requireAnyPermiso } = require('../middlewares/requirePermiso.middleware');

const router = express.Router();

router.use(requireTenant);
router.use(
	requireAnyPermiso('ADMISION.TABLA.VER', 'INTERNACION.TABLA.VER', 'FACTURACION.TABLA.VER'),
);

router.get('/:id', controller.listar);
router.post('/:id', controller.crear);
router.put('/:id/:clave', controller.actualizar);
router.delete('/:id/:clave', controller.borrar);

module.exports = router;
