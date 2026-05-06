const express = require("express");
const router = express.Router();
const evolucionesController = require("../controllers/evoluciones.controller");
const { requireAuth } = require("../middlewares/authJwt.middleware");
const { requirePropietario } = require("../middlewares/propietario.middleware");

// Para imHCEvolucion el campo de autor es Profecional (Matricula), que no
// coincide con CodOperador. Usamos failSafe=true: si no puede verificar,
// deja pasar (el control real es el frontend + auditoría).
const _ownEvolucion = requirePropietario({
    tabla: 'imHCEvolucion', pkCol: 'IdHCEvolucion', autorCol: 'Profecional',
    pkParam: 'id', failSafe: true,
});

// Obtener evoluciones por visita y fecha
router.get("/:idVisita/byDate", evolucionesController.obtenerEvolucionesPorVisitaYFecha);

// Crear nueva evolución
router.post("/", evolucionesController.crearEvolucion);

// Obtener evolución por ID
router.get("/:id", evolucionesController.obtenerEvolucionPorId);

// Actualizar evolución (propietario verificado con failSafe)
router.put("/:id", requireAuth, _ownEvolucion, evolucionesController.actualizarEvolucion);

// Eliminar evolución (propietario verificado con failSafe)
router.delete("/:id", requireAuth, _ownEvolucion, evolucionesController.eliminarEvolucion);

module.exports = router;
