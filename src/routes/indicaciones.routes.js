const express = require("express");
const router = express.Router();
const indicacionesController = require("../controllers/indicaciones.controller");

// Obtener datos para el formulario de creación de indicaciones
router.get("/formulario/datos", indicacionesController.obtenerDatosFormulario);

// Última indicación por número de visita
router.get(
    "/ultima/:numeroVisita",
    indicacionesController.obtenerUltimaIndicacionPorVisita
);

// Últimas N indicaciones por número de visita (?limit=3 por defecto)
router.get(
    "/ultimas/:numeroVisita",
    indicacionesController.obtenerUltimasIndicacionesPorVisita
);

router.get("/:numeroVisita/byDate", indicacionesController.byDate);

// ✅ NUEVO: Obtener insumos/descartables por visita y fecha
router.get("/:numeroVisita/insumos/byDate", indicacionesController.insumosByDate);

//Nueva indicación
router.post("/", indicacionesController.nuevaIndicacion);

router.delete("/:nroIndicacion", indicacionesController.deleteIndicacion);

router.get("/:nroIndicacion", indicacionesController.getIndicacionById);

router.put("/:nroIndicacion", indicacionesController.updateIndicacion);

router.post("/:nroIndicacion/aplicar", indicacionesController.aplicarIndicacion);

module.exports = router;
