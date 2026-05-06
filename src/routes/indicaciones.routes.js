const express = require("express");
const router = express.Router();
const indicacionesController = require("../controllers/indicaciones.controller");
const { requireAuth } = require("../middlewares/authJwt.middleware");
const { requirePropietario } = require("../middlewares/propietario.middleware");

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

// Crear indicación hija
router.post("/hija", indicacionesController.crearIndicacionHija);

const _ownIndicacion = requirePropietario({
    tabla: 'imInterIndMedicas', pkCol: 'Valor', autorCol: 'OperadorCarga', pkParam: 'nroIndicacion'
});

router.delete("/:nroIndicacion", requireAuth, _ownIndicacion, indicacionesController.deleteIndicacion);

// Eliminar indicación hija (adicional)
router.delete("/hija/:nroIndicacion", indicacionesController.deleteIndicacionHija);

router.get("/:nroIndicacion", indicacionesController.getIndicacionById);

router.put("/:nroIndicacion", requireAuth, _ownIndicacion, indicacionesController.updateIndicacion);

router.post("/:nroIndicacion/aplicar", indicacionesController.aplicarIndicacion);

module.exports = router;
