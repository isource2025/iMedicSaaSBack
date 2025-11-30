const controlesFrecuentesService = require("../services/controlesFrecuentes.service");

/**
 * Obtener controles frecuentes por número de visita y fecha
 */
const obtenerControlesPorVisitaYFecha = async (req, res) => {
    try {
        console.log('🔵 [controlesFrecuentes.controller] Request params:', req.params);
        console.log('🔵 [controlesFrecuentes.controller] Query params:', req.query);

        const { numeroVisita } = req.params;
        const fecha = req.query.fecha || req.query.date;

        console.log('🔵 [controlesFrecuentes.controller] Parsed values:', {
            numeroVisita,
            fecha,
            numeroVisitaType: typeof numeroVisita,
            fechaType: typeof fecha
        });

        const numeroVisitaInt = parseInt(numeroVisita);

        if (isNaN(numeroVisitaInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "Número de visita inválido",
            });
        }

        if (!fecha) {
            return res.status(400).json({
                success: false,
                mensaje: "Fecha es requerida (query param: fecha o date)",
            });
        }

        console.log('🔵 [controlesFrecuentes.controller] Calling service with:', {
            numeroVisitaInt,
            fecha
        });

        const resultado = await controlesFrecuentesService.obtenerControlesPorVisitaYFecha(
            numeroVisitaInt,
            fecha
        );

        console.log('🔵 [controlesFrecuentes.controller] Service returned:', {
            resultadoType: typeof resultado,
            isArray: Array.isArray(resultado),
            length: resultado?.length
        });

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error al obtener controles frecuentes por visita y fecha:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener los controles frecuentes",
            error: error.message,
        });
    }
};

/**
 * Obtener un control frecuente por ID
 */
const obtenerControlPorId = async (req, res) => {
    try {
        const { valor } = req.params;
        const valorInt = parseInt(valor);

        if (isNaN(valorInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de control frecuente inválido",
            });
        }

        const resultado = await controlesFrecuentesService.obtenerControlPorId(valorInt);

        if (!resultado) {
            return res.status(404).json({
                success: false,
                mensaje: "Control frecuente no encontrado",
            });
        }

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error al obtener control frecuente por ID:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener el control frecuente",
            error: error.message,
        });
    }
};

/**
 * Eliminar un control frecuente
 */
const eliminarControl = async (req, res) => {
    try {
        const { valor } = req.params;
        const valorInt = parseInt(valor);

        if (isNaN(valorInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de control frecuente inválido",
            });
        }

        await controlesFrecuentesService.eliminarControl(valorInt);

        res.json({
            success: true,
            mensaje: "Control frecuente eliminado correctamente",
        });
    } catch (error) {
        console.error("Error al eliminar control frecuente:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al eliminar el control frecuente",
            error: error.message,
        });
    }
};

module.exports = {
    obtenerControlesPorVisitaYFecha,
    obtenerControlPorId,
    eliminarControl,
};
