const express = require('express');
const router = express.Router();
const c = require('../controllers/convenios.controller');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

router.use(requireTenant);

const ver = requirePermiso('FACTURACION.CONVENIOS.VER');
const crear = requirePermiso('FACTURACION.CONVENIOS.CREAR');
const editar = requirePermiso('FACTURACION.CONVENIOS.EDITAR');
const eliminar = requirePermiso('FACTURACION.CONVENIOS.ELIMINAR');

// Los convenios no se borran desde la web (ver docs/FACTURACION_CONVENIOS.md, "Pendientes").
router.get('/catalogos', ver, c.catalogos);
router.get('/catalogos/:tipo/buscar', ver, c.buscarEnCatalogo);
router.get('/mantenimiento', ver, c.reporteMantenimiento);
router.post('/mantenimiento/limpiar-huerfanas', eliminar, c.limpiarHuerfanas);

router.get('/', ver, c.listar);
router.post('/', crear, c.crear);
router.get('/:codigo', ver, c.obtener);
router.put('/:codigo', editar, c.actualizar);
router.get('/:codigo/uso', ver, c.uso);
router.get('/:codigo/exportar', ver, c.exportar);
router.post('/:codigo/duplicar', crear, c.duplicar);
router.post('/:codigo/ajuste/preview', editar, c.previsualizarAjuste);
router.post('/:codigo/ajuste', editar, c.aplicarAjuste);
router.get('/:codigo/pestanas/:pestana', ver, c.listarPestana);
router.post('/:codigo/pestanas/:pestana/lote', editar, c.guardarLote);

module.exports = router;
