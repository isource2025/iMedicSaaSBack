const express = require("express");
const router = express.Router();
const evolucionesController = require("../controllers/evoluciones.controller");

// Obtener evoluciones por visita y fecha
router.get("/:idVisita/byDate", evolucionesController.obtenerEvolucionesPorVisitaYFecha);

// Crear nueva evolución
router.post("/", evolucionesController.crearEvolucion);

// Obtener evolución por ID
router.get("/:id", evolucionesController.obtenerEvolucionPorId);

// Actualizar evolución
router.put("/:id", evolucionesController.actualizarEvolucion);

// Eliminar evolución
router.delete("/:id", evolucionesController.eliminarEvolucion);

module.exports = router;
