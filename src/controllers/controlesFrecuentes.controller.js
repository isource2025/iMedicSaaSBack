const controlesFrecuentesService = require("../services/controlesFrecuentes.service");
const { requireOperadorCarga } = require("../utils/sessionIdentity");

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

/**
 * Crear un nuevo control frecuente
 */
const crearControl = async (req, res) => {
    try {
        const {
            numeroVisita,
            fechaControl,
            horaControl,
            idHci,
            pulso,
            presionMax,
            presionMin,
            presionMedia,
            frecuenciaRespiratoria,
            temperaturaAxilar,
            temperaturaRectal,
            glucemia,
            saturacion,
            peso,
            talla,
            observaciones,
            idSector
        } = req.body;

        if (!numeroVisita) {
            return res.status(400).json({
                success: false,
                mensaje: "Número de visita es requerido",
            });
        }

        if (!fechaControl || !horaControl) {
            return res.status(400).json({
                success: false,
                mensaje: "Fecha y hora del control son requeridos",
            });
        }

        const operadorCarga = requireOperadorCarga(req, res);
        if (operadorCarga == null) return;

        const resultado = await controlesFrecuentesService.crearControl({
            numeroVisita: parseInt(numeroVisita),
            fechaControl,
            horaControl,
            operadorCarga,
            idHci: idHci ? parseInt(idHci) : 0,
            pulso: pulso ? parseInt(pulso) : 0,
            presionMax: presionMax ? parseInt(presionMax) : 0,
            presionMin: presionMin ? parseInt(presionMin) : 0,
            presionMedia: presionMedia ? parseInt(presionMedia) : 0,
            frecuenciaRespiratoria: frecuenciaRespiratoria ? parseInt(frecuenciaRespiratoria) : 0,
            temperaturaAxilar: temperaturaAxilar ? parseFloat(temperaturaAxilar) : 0,
            temperaturaRectal: temperaturaRectal ? parseFloat(temperaturaRectal) : 0,
            glucemia: glucemia ? parseInt(glucemia) : 0,
            saturacion: saturacion ? parseInt(saturacion) : 0,
            peso: peso ? parseFloat(peso) : 0,
            talla: talla ? parseFloat(talla) : 0,
            observaciones: observaciones || '',
            idSector: idSector || '',
        });

        res.status(201).json({
            success: true,
            mensaje: "Control frecuente creado correctamente",
            data: resultado,
        });
    } catch (error) {
        console.error("Error al crear control frecuente:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al crear el control frecuente",
            error: error.message,
        });
    }
};

module.exports = {
    obtenerControlesPorVisitaYFecha,
    obtenerControlPorId,
    eliminarControl,
    crearControl,
};
