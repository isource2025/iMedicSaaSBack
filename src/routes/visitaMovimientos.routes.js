const express = require('express');
const router = express.Router();
const visitaMovimientosController = require('../controllers/visitaMovimientos.controller');

// Obtiene el último movimiento de una visita
router.get('/ultimo/:numeroVisita', visitaMovimientosController.obtenerUltimoMovimientoVisita);

// Obtiene todos los movimientos de una visita
router.get('/visita/:numeroVisita', visitaMovimientosController.obtenerMovimientosVisita);

// Actualiza el último movimiento de una visita con datos de egreso
router.put('/ultimo/:numeroVisita', visitaMovimientosController.actualizarUltimoMovimientoVisita);

// Mueve un paciente a una cama vacía
router.post('/mover/:numeroVisita', visitaMovimientosController.moverPacienteACamaVacia);

// Intercambia las camas entre dos pacientes
router.post('/intercambiar/:numeroVisita1/:numeroVisita2', visitaMovimientosController.intercambiarCamasPacientes);

// Obtiene los últimos movimientos de internación para el dashboard
router.get('/recientes', visitaMovimientosController.obtenerMovimientosRecientes);

module.exports = router;
