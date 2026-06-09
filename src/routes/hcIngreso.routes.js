const express = require("express");
const router = express.Router();
const hcIngresoController = require("../controllers/hcIngreso.controller");

// Obtener HC de Ingreso por visita
router.get("/visita/:numeroVisita", hcIngresoController.obtenerHCIngresoPorVisita);

// Obtener HC de Ingreso por ID
router.get("/:id", hcIngresoController.obtenerHCIngresoPorId);

const { requireAuth } = require('../middlewares/authJwt.middleware');

// Crear nueva HC de Ingreso
router.post("/", requireAuth, hcIngresoController.crearHCIngreso);

// Actualizar HC de Ingreso
router.put("/:id", requireAuth, hcIngresoController.actualizarHCIngreso);

// Eliminar HC de Ingreso
router.delete("/:id", hcIngresoController.eliminarHCIngreso);

module.exports = router;
