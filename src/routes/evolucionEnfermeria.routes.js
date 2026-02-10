const express = require("express");
const router = express.Router();
const evolucionEnfermeriaController = require("../controllers/evolucionEnfermeria.controller");

// Obtener evoluciones de enfermería por número de visita y fecha (?fecha=YYYY-MM-DD)
router.get(
    "/:numeroVisita/byDate",
    evolucionEnfermeriaController.obtenerEvolucionesPorVisitaYFecha
);

// Crear nueva evolución de enfermería
router.post(
    "/",
    evolucionEnfermeriaController.crearEvolucion
);

// Eliminar una evolución de enfermería (?numeroVisita=X&fechaControl=Y&horaControl=Z)
router.delete(
    "/",
    evolucionEnfermeriaController.eliminarEvolucion
);

module.exports = router;
