const express = require('express');
const router = express.Router();
const c = require('../controllers/rendiciones.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

const ver = requirePermiso('FACTURACION.RENDICIONES.VER');
const crear = requirePermiso('FACTURACION.RENDICIONES.CREAR');
const editar = requirePermiso('FACTURACION.RENDICIONES.EDITAR');
const eliminar = requirePermiso('FACTURACION.RENDICIONES.ELIMINAR');
const exportar = requirePermiso('FACTURACION.RENDICIONES.EXPORTAR');

// Solo se borran rendiciones vacías (ver docs/FACTURACION_RENDICIONES.md).
router.get('/catalogos', ver, c.catalogos);
router.get('/exportar', exportar, c.exportar);
router.get('/', ver, c.listar);
router.post('/', crear, c.crear);
router.get('/:id', ver, c.obtener);
router.put('/:id', editar, c.actualizar);
router.delete('/:id', eliminar, c.eliminar);
router.get('/:id/visitas', ver, c.visitas);
router.get('/:id/lineas', ver, c.lineas);
router.get('/:id/facturas', ver, c.facturas);

module.exports = router;
