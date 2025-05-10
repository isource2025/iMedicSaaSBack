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

// Ruta para mover un paciente a una nueva cama
router.put('/visitas/:numeroVisita/mover-cama', visitaMovimientosController.moverPacienteACamaVacia);

// Ruta para intercambiar camas entre dos pacientes
router.put('/visitas/:numeroVisita1/intercambiar-cama/:numeroVisita2', visitaMovimientosController.intercambiarCamasPacientes);

// Ruta para registrar egreso (específica)
router.post('/visitas/egreso', patientsController.registrarEgresoPaciente);

// Ruta para obtener visita por número (más general)
router.get('/visitas/:numeroVisita', patientsController.obtenerVisitaPorNumero);

// Rutas generales de pacientes
router.get('/', patientsController.obtenerPacientes);
router.get('/search', patientsController.buscarPacientes);

// Obtiene las tablas de referencia (sexo, raza, provincia, etc.)
router.get('/reference-tables', patientsController.obtenerTablasReferencia);
router.get('/:id', patientsController.obtenerPacientePorId);
router.post('/', patientsController.crearPaciente);
router.put('/:id', patientsController.actualizarPaciente);
router.delete('/:id', patientsController.eliminarPaciente);

module.exports = router;
