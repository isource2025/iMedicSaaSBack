const express = require('express');
const router = express.Router();
const patientsController = require('../controllers/patients.controller');
const visitaMovimientosController = require('../controllers/visitaMovimientos.controller');

// IMPORTANTE: El orden de las rutas es crucial
// Las rutas más específicas deben ir antes que las más generales

// Rutas para movimientos de visita (más específicas)
router.get('/visitas/:numeroVisita/movimientos/ultimo', visitaMovimientosController.obtenerUltimoMovimientoVisita);
router.put('/visitas/:numeroVisita/movimientos/ultimo', visitaMovimientosController.actualizarUltimoMovimientoVisita);
router.get('/visitas/:numeroVisita/movimientos', visitaMovimientosController.obtenerMovimientosVisita);

// Ruta para registrar egreso (específica)
router.post('/visitas/egreso', patientsController.registrarEgresoPaciente);

// Ruta para obtener visita por número (más general)
router.get('/visitas/:numeroVisita', patientsController.obtenerVisitaPorNumero);

// Rutas generales de pacientes
router.get('/', patientsController.obtenerPacientes);
router.get('/search', patientsController.buscarPacientes);
router.get('/:id', patientsController.obtenerPacientePorId);
router.post('/', patientsController.crearPaciente);
router.put('/:id', patientsController.actualizarPaciente);
router.delete('/:id', patientsController.eliminarPaciente);

module.exports = router;
