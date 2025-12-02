const medicacionControlService = require("../services/medicacionControl.service");

/**
 * Obtener medicación suministrada por número de visita
 */
const obtenerMedicacionPorVisita = async (req, res) => {
    try {
        const { numeroVisita } = req.params;
        const numeroVisitaInt = parseInt(numeroVisita);

        if (isNaN(numeroVisitaInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "Número de visita inválido",
            });
        }

        const resultado = await medicacionControlService.obtenerMedicacionPorVisita(
            numeroVisitaInt
        );

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error al obtener medicación por visita:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener la medicación suministrada",
            error: error.message,
        });
    }
};

/**
 * Obtener medicación suministrada por número de visita y fecha
 */
const obtenerMedicacionPorVisitaYFecha = async (req, res) => {
    console.log('🔵 [medicacionControl.controller] obtenerMedicacionPorVisitaYFecha called');
    console.log('🔵 Request params:', req.params);
    console.log('🔵 Request query:', req.query);
    
    try {
        const { numeroVisita } = req.params;
        const { fecha, date } = req.query; // Soportar ambos: fecha y date
        const fechaParam = fecha || date; // Priorizar 'fecha', pero aceptar 'date'
        const numeroVisitaInt = parseInt(numeroVisita);

        console.log('🔵 [medicacionControl.controller] Parsed values:', {
            numeroVisita,
            numeroVisitaInt,
            fechaParam,
            fechaFromQuery: fecha,
            dateFromQuery: date
        });

        if (isNaN(numeroVisitaInt)) {
            console.log('❌ [medicacionControl.controller] Número de visita inválido');
            return res.status(400).json({
                success: false,
                mensaje: "Número de visita inválido",
            });
        }

        if (!fechaParam || !/^\d{4}-\d{2}-\d{2}$/.test(String(fechaParam))) {
            console.log('❌ [medicacionControl.controller] Fecha inválida:', fechaParam);
            return res.status(400).json({
                success: false,
                mensaje: "Fecha debe estar en formato YYYY-MM-DD",
            });
        }

        console.log('🔵 [medicacionControl.controller] Calling service with:', {
            numeroVisitaInt,
            fechaParam: String(fechaParam)
        });

        const resultado = await medicacionControlService.obtenerMedicacionPorVisitaYFecha(
            numeroVisitaInt,
            String(fechaParam)
        );

        console.log('🔵 [medicacionControl.controller] Service returned:', {
            resultadoType: typeof resultado,
            isArray: Array.isArray(resultado),
            length: Array.isArray(resultado) ? resultado.length : 'N/A'
        });

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("❌ [medicacionControl.controller] Error al obtener medicación por visita y fecha:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener la medicación suministrada por fecha",
            error: error.message,
        });
    }
};

/**
 * Obtener un registro de medicación por ID
 */
const obtenerMedicacionPorId = async (req, res) => {
    try {
        const { idCtrlMedica } = req.params;
        const idCtrlMedicaInt = parseInt(idCtrlMedica);

        if (isNaN(idCtrlMedicaInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de control de medicación inválido",
            });
        }

        const resultado = await medicacionControlService.obtenerMedicacionPorId(
            idCtrlMedicaInt
        );

        if (!resultado) {
            return res.status(404).json({
                success: false,
                mensaje: "Registro de medicación no encontrado",
            });
        }

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error al obtener medicación por ID:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener el registro de medicación",
            error: error.message,
        });
    }
};

/**
 * Eliminar un registro de medicación
 */
const eliminarMedicacion = async (req, res) => {
    try {
        const { idCtrlMedica } = req.params;
        const idCtrlMedicaInt = parseInt(idCtrlMedica);

        if (isNaN(idCtrlMedicaInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "ID de control de medicación inválido",
            });
        }

        await medicacionControlService.eliminarMedicacion(idCtrlMedicaInt);

        res.json({
            success: true,
            mensaje: "Registro de medicación eliminado correctamente",
        });
    } catch (error) {
        console.error("Error al eliminar medicación:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al eliminar el registro de medicación",
            error: error.message,
        });
    }
};

module.exports = {
    obtenerMedicacionPorVisita,
    obtenerMedicacionPorVisitaYFecha,
    obtenerMedicacionPorId,
    eliminarMedicacion,
};
