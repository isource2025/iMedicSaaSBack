const express = require('express');
const router = express.Router();
const {
	obtenerProduccion,
	obtenerOpciones,
	obtenerResumenMes,
} = require('../controllers/produccionHospital.controller');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');

// Montado en /api/indicadores/produccion: hereda requireTenant del router padre.
// Muestra montos por profesional y por cobertura: sólo ADMIN (REPORTES.FACTURACION.VER).
const PERMISO = 'REPORTES.FACTURACION.VER';

router.get('/', requirePermiso(PERMISO), obtenerProduccion);
router.get('/opciones', requirePermiso(PERMISO), obtenerOpciones);
router.get('/resumen-mes', requirePermiso(PERMISO), obtenerResumenMes);

module.exports = router;
