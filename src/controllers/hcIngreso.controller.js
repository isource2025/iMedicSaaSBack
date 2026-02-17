const hcIngresoService = require("../services/hcIngreso.service");

/**
 * Obtener HC de Ingreso por visita
 */
const obtenerHCIngresoPorVisita = async (req, res) => {
    try {
        const { numeroVisita } = req.params;

        if (!numeroVisita) {
            return res.status(400).json({
                success: false,
                message: "El número de visita es requerido",
            });
        }

        const resultado = await hcIngresoService.obtenerHCIngresoPorVisita(numeroVisita);

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error en obtenerHCIngresoPorVisita:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener HC de Ingreso",
            error: error.message,
        });
    }
};

/**
 * Obtener HC de Ingreso por ID
 */
const obtenerHCIngresoPorId = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "El ID de HC de Ingreso es requerido",
            });
        }

        const resultado = await hcIngresoService.obtenerHCIngresoPorId(id);

        if (!resultado) {
            return res.status(404).json({
                success: false,
                message: "HC de Ingreso no encontrada",
            });
        }

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error en obtenerHCIngresoPorId:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener HC de Ingreso",
            error: error.message,
        });
    }
};

/**
 * Crear nueva HC de Ingreso
 */
const crearHCIngreso = async (req, res) => {
    try {
        const data = req.body;

        if (!data.NumeroVisita) {
            return res.status(400).json({
                success: false,
                message: "El número de visita es requerido",
            });
        }

        const resultado = await hcIngresoService.crearHCIngreso(data);

        res.status(201).json({
            success: true,
            data: resultado,
            message: "HC de Ingreso creada exitosamente",
        });
    } catch (error) {
        console.error("Error en crearHCIngreso:", error);
        res.status(500).json({
            success: false,
            message: "Error al crear HC de Ingreso",
            error: error.message,
        });
    }
};

/**
 * Actualizar HC de Ingreso
 */
const actualizarHCIngreso = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "El ID de HC de Ingreso es requerido",
            });
        }

        const resultado = await hcIngresoService.actualizarHCIngreso(id, data);

        res.json({
            success: true,
            data: resultado,
            message: "HC de Ingreso actualizada exitosamente",
        });
    } catch (error) {
        console.error("Error en actualizarHCIngreso:", error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar HC de Ingreso",
            error: error.message,
        });
    }
};

/**
 * Eliminar HC de Ingreso
 */
const eliminarHCIngreso = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "El ID de HC de Ingreso es requerido",
            });
        }

        const resultado = await hcIngresoService.eliminarHCIngreso(id);

        res.json({
            success: true,
            data: resultado,
            message: "HC de Ingreso eliminada exitosamente",
        });
    } catch (error) {
        console.error("Error en eliminarHCIngreso:", error);
        res.status(500).json({
            success: false,
            message: "Error al eliminar HC de Ingreso",
            error: error.message,
        });
    }
};

module.exports = {
    obtenerHCIngresoPorVisita,
    obtenerHCIngresoPorId,
    crearHCIngreso,
    actualizarHCIngreso,
    eliminarHCIngreso,
};
