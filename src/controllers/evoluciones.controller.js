const evolucionesService = require("../services/evoluciones.service");

/**
 * Obtener evoluciones por visita y fecha
 */
const obtenerEvolucionesPorVisitaYFecha = async (req, res) => {
    try {
        const { idVisita } = req.params;
        const { date } = req.query;

        const visitaNum = Number(idVisita);
        if (!Number.isFinite(visitaNum) || visitaNum <= 0) {
            return res.status(400).json({
                success: false,
                mensaje: "idVisita inválido"
            });
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            return res.status(400).json({
                success: false,
                mensaje: "date debe ser YYYY-MM-DD"
            });
        }

        const rows = await evolucionesService.obtenerEvolucionesPorVisitaYFecha(
            visitaNum,
            String(date)
        );

        console.log('🔍 [Evoluciones] Datos a enviar al frontend:', {
            cantidadRegistros: rows?.length || 0,
            primerRegistro: rows?.[0] || null
        });

        return res.json({
            success: true,
            data: rows || [],
        });
    } catch (err) {
        console.error("[EvolucionesController][byDate] error:", err);
        return res.status(500).json({
            success: false,
            mensaje: "Error interno al obtener evoluciones por fecha",
        });
    }
};

/**
 * Crear nueva evolución
 */
const crearEvolucion = async (req, res) => {
    try {
        const data = req.body;

        // Validaciones básicas
        if (!data.IdVisita) {
            return res.status(400).json({
                success: false,
                mensaje: "IdVisita es requerido"
            });
        }

        if (!data.FechaEv) {
            return res.status(400).json({
                success: false,
                mensaje: "FechaEv es requerida"
            });
        }

        if (!data.HoraEv) {
            return res.status(400).json({
                success: false,
                mensaje: "HoraEv es requerida"
            });
        }

        if (!data.IdSector) {
            return res.status(400).json({
                success: false,
                mensaje: "IdSector es requerido"
            });
        }

        if (!data.Evolucion || data.Evolucion.trim() === "") {
            return res.status(400).json({
                success: false,
                mensaje: "Evolución es requerida"
            });
        }

        if (!data.NumeroDocumento) {
            return res.status(400).json({
                success: false,
                mensaje: "NumeroDocumento es requerido"
            });
        }

        const resultado = await evolucionesService.crearEvolucion(data);

        res.status(201).json({
            success: true,
            data: resultado,
            mensaje: "Evolución creada correctamente"
        });
    } catch (err) {
        console.error("Error al crear evolución:", err);
        res.status(500).json({
            success: false,
            mensaje: "Error interno al crear evolución",
            error: err.message || err,
        });
    }
};

/**
 * Obtener evolución por ID
 */
const obtenerEvolucionPorId = async (req, res) => {
    try {
        const { id } = req.params;
        const idNum = parseInt(id);

        if (isNaN(idNum)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de evolución inválido"
            });
        }

        const evolucion = await evolucionesService.obtenerEvolucionPorId(idNum);

        if (!evolucion) {
            return res.status(404).json({
                success: false,
                mensaje: "Evolución no encontrada"
            });
        }

        res.json({
            success: true,
            data: evolucion,
        });
    } catch (error) {
        console.error("Error al obtener evolución por ID:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener la evolución",
            error: error.message,
        });
    }
};

/**
 * Eliminar evolución
 */
const eliminarEvolucion = async (req, res) => {
    try {
        const { id } = req.params;
        const idNum = parseInt(id);

        if (isNaN(idNum)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de evolución inválido"
            });
        }

        await evolucionesService.eliminarEvolucion(idNum);

        res.json({
            success: true,
            mensaje: "Evolución eliminada correctamente",
        });
    } catch (error) {
        console.error("Error al eliminar evolución:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al eliminar la evolución",
            error: error.message,
        });
    }
};

/**
 * Actualizar evolución
 */
const actualizarEvolucion = async (req, res) => {
    try {
        const { id } = req.params;
        const idNum = parseInt(id);

        if (isNaN(idNum)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de evolución inválido"
            });
        }

        const data = req.body;

        await evolucionesService.actualizarEvolucion(idNum, data);

        res.json({
            success: true,
            mensaje: "Evolución actualizada correctamente",
        });
    } catch (error) {
        console.error("Error al actualizar evolución:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al actualizar la evolución",
            error: error.message,
        });
    }
};

module.exports = {
    obtenerEvolucionesPorVisitaYFecha,
    crearEvolucion,
    obtenerEvolucionPorId,
    eliminarEvolucion,
    actualizarEvolucion,
};
