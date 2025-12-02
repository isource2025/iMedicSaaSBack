const express = require("express");
const router = express.Router();
const medicacionControlController = require("../controllers/medicacionControl.controller");

// Obtener medicación suministrada por número de visita
router.get(
    "/:numeroVisita",
    medicacionControlController.obtenerMedicacionPorVisita
);

// Obtener medicación suministrada por número de visita y fecha (?fecha=YYYY-MM-DD)
router.get(
    "/:numeroVisita/byDate",
    medicacionControlController.obtenerMedicacionPorVisitaYFecha
);

// Obtener un registro de medicación por ID
router.get(
    "/detalle/:idCtrlMedica",
    medicacionControlController.obtenerMedicacionPorId
);

// Eliminar un registro de medicación por ID
router.delete(
    "/:idCtrlMedica",
    medicacionControlController.eliminarMedicacion
);

module.exports = router;
