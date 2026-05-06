const evolucionEnfermeriaService = require("../services/evolucionEnfermeria.service");
const { convertirFechaAClarion } = require("../utils/dateUtils");

/**
 * Obtener evoluciones de enfermería por número de visita y fecha
 */
const obtenerEvolucionesPorVisitaYFecha = async (req, res) => {
    try {
        console.log('🔵 [evolucionEnfermeria.controller] Request params:', req.params);
        console.log('🔵 [evolucionEnfermeria.controller] Query params:', req.query);

        const { numeroVisita } = req.params;
        const fecha = req.query.fecha || req.query.date;

        console.log('🔵 [evolucionEnfermeria.controller] Parsed values:', {
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

        console.log('🔵 [evolucionEnfermeria.controller] Calling service with:', {
            numeroVisitaInt,
            fecha
        });

        const resultado = await evolucionEnfermeriaService.obtenerEvolucionesPorVisitaYFecha(
            numeroVisitaInt,
            fecha
        );

        console.log('🔵 [evolucionEnfermeria.controller] Service returned:', {
            resultadoType: typeof resultado,
            isArray: Array.isArray(resultado),
            length: resultado?.length
        });

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error al obtener evoluciones de enfermería por visita y fecha:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al obtener las evoluciones de enfermería",
            error: error.message,
        });
    }
};

/**
 * Eliminar una evolución de enfermería
 * Espera query params: numeroVisita, fechaControl, horaControl (en formato Clarion)
 */
const eliminarEvolucion = async (req, res) => {
    try {
        const { numeroVisita, fechaControl, horaControl } = req.query;

        const numeroVisitaInt = parseInt(numeroVisita);
        const fechaControlInt = parseInt(fechaControl);
        const horaControlInt = parseInt(horaControl);

        if (isNaN(numeroVisitaInt) || isNaN(fechaControlInt) || isNaN(horaControlInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "Parámetros inválidos (numeroVisita, fechaControl, horaControl requeridos)",
            });
        }

        // Verificación de propiedad: solo el creador puede eliminar.
        const { executeQuery } = require('../models/db');
        const registros = await executeQuery(
            `SELECT TOP 1 OperadorCarga FROM dbo.imInterCtrlEvolucion
             WHERE NumeroVisita = @p0 AND FechaControl = @p1 AND HoraControl = @p2`,
            [{ value: numeroVisitaInt }, { value: fechaControlInt }, { value: horaControlInt }],
        );
        if (registros.length) {
            const autorCarga = Number(registros[0].OperadorCarga);
            const codOperadorSesion = Number(req.auth?.usuario?.codOperador);
            if (autorCarga && codOperadorSesion && autorCarga !== codOperadorSesion) {
                return res.status(403).json({
                    success: false,
                    mensaje: 'Por restricciones legales, no puede eliminar registros creados por otro profesional.',
                    codigoError: 'REGISTRO_AJENO',
                });
            }
        }

        await evolucionEnfermeriaService.eliminarEvolucion(
            numeroVisitaInt,
            fechaControlInt,
            horaControlInt
        );

        res.json({
            success: true,
            mensaje: "Evolución de enfermería eliminada correctamente",
        });
    } catch (error) {
        console.error("Error al eliminar evolución de enfermería:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al eliminar la evolución de enfermería",
            error: error.message,
        });
    }
};

/**
 * Crear nueva evolución de enfermería
 */
const crearEvolucion = async (req, res) => {
    try {
        const { NumeroVisita, FechaControl, HoraControl, Observaciones, Profesional } = req.body;

        // Validaciones
        if (!NumeroVisita) {
            return res.status(400).json({
                success: false,
                mensaje: "NumeroVisita es requerido",
            });
        }

        if (!FechaControl) {
            return res.status(400).json({
                success: false,
                mensaje: "FechaControl es requerida",
            });
        }

        if (!HoraControl) {
            return res.status(400).json({
                success: false,
                mensaje: "HoraControl es requerida",
            });
        }

        if (!Observaciones || Observaciones.trim() === "") {
            return res.status(400).json({
                success: false,
                mensaje: "Observaciones es requerida",
            });
        }

        const resultado = await evolucionEnfermeriaService.crearEvolucion({
            NumeroVisita,
            FechaControl,
            HoraControl,
            Observaciones,
            Profesional,
            OperadorCarga: Profesional
        });

        res.json({
            success: true,
            mensaje: "Evolución de enfermería creada correctamente",
            data: resultado,
        });
    } catch (error) {
        console.error("Error al crear evolución de enfermería:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al crear la evolución de enfermería",
            error: error.message,
        });
    }
};

module.exports = {
    obtenerEvolucionesPorVisitaYFecha,
    eliminarEvolucion,
    crearEvolucion,
};
