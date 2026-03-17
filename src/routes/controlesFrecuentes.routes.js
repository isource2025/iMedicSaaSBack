const express = require("express");
const router = express.Router();
const controlesFrecuentesController = require("../controllers/controlesFrecuentes.controller");

// Obtener controles frecuentes por número de visita y fecha (?fecha=YYYY-MM-DD)
router.get(
    "/:numeroVisita/byDate",
    controlesFrecuentesController.obtenerControlesPorVisitaYFecha
);

// Obtener un control frecuente por ID
router.get(
    "/detalle/:valor",
    controlesFrecuentesController.obtenerControlPorId
);

// Crear un nuevo control frecuente
router.post(
    "/",
    controlesFrecuentesController.crearControl
);

// Eliminar un control frecuente por ID
router.delete(
    "/:valor",
    controlesFrecuentesController.eliminarControl
);

module.exports = router;
