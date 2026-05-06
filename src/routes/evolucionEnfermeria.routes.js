const express = require("express");
const router = express.Router();
const evolucionEnfermeriaController = require("../controllers/evolucionEnfermeria.controller");
const { requireAuth } = require("../middlewares/authJwt.middleware");
const { requirePropietario } = require("../middlewares/propietario.middleware");

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
// La PK de imInterCtrlEvolucion es por query params, no por /:id, así que
// la verificación de propietario se hace internamente en el servicio.
// El middleware se aplica en el controlador con una lógica adaptada.
router.delete(
    "/",
    requireAuth,
    evolucionEnfermeriaController.eliminarEvolucion
);

module.exports = router;
