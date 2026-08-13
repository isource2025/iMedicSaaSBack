const evolucionEnfermeriaService = require("../services/evolucionEnfermeria.service");
const { requireProfesional, requireOperadorCarga } = require("../utils/sessionIdentity");
const { parseDaysFiltro } = require("../utils/dateUtils");

function parseClaveFromQuery(req) {
    const numeroVisitaInt = parseInt(req.query.numeroVisita, 10);
    const fechaControlInt = parseInt(req.query.fechaControl, 10);
    const horaControlInt = parseInt(req.query.horaControl, 10);
    if (
        Number.isNaN(numeroVisitaInt) ||
        Number.isNaN(fechaControlInt) ||
        Number.isNaN(horaControlInt)
    ) {
        return null;
    }
    return { numeroVisitaInt, fechaControlInt, horaControlInt };
}

async function assertPropiedad(req, res, numeroVisitaInt, fechaControlInt, horaControlInt) {
    const { executeQuery } = require("../models/db");
    const registros = await executeQuery(
        `SELECT TOP 1 OperadorCarga, Profesional FROM dbo.imInterCtrlEvolucion
         WHERE NumeroVisita = @p0 AND FechaControl = @p1 AND HoraControl = @p2`,
        [{ value: numeroVisitaInt }, { value: fechaControlInt }, { value: horaControlInt }],
    );
    if (!registros.length) {
        res.status(404).json({
            success: false,
            mensaje: "Evolución no encontrada",
        });
        return false;
    }

    const autorCarga = Number(registros[0].OperadorCarga);
    const profesional = Number(registros[0].Profesional);
    const u = req.auth?.usuario || {};
    const codOperadorSesion = Number(u.codOperador ?? u.idCodOperador);
    const valorPersonalSesion = Number(u.valorPersonal ?? u.idValorpersonal);
    const matriculaSesion = Number(u.matricula ?? u.Matricula);

    const esPropio =
        (Number.isFinite(codOperadorSesion) && autorCarga === codOperadorSesion) ||
        (Number.isFinite(valorPersonalSesion) &&
            (autorCarga === valorPersonalSesion || profesional === valorPersonalSesion)) ||
        (Number.isFinite(matriculaSesion) &&
            (autorCarga === matriculaSesion || profesional === matriculaSesion));

    if (!esPropio) {
        res.status(403).json({
            success: false,
            mensaje:
                "Por restricciones legales, no puede modificar registros creados por otro profesional.",
            codigoError: "REGISTRO_AJENO",
        });
        return false;
    }
    return true;
}

/**
 * Obtener evoluciones de enfermería por número de visita y fecha
 */
const obtenerEvolucionesPorVisitaYFecha = async (req, res) => {
    try {
        const { numeroVisita } = req.params;
        const fecha = req.query.fecha || req.query.date;
        const diasFiltro = parseDaysFiltro(req.query.days);
        const numeroVisitaInt = parseInt(numeroVisita, 10);

        if (Number.isNaN(numeroVisitaInt)) {
            return res.status(400).json({
                success: false,
                mensaje: "Número de visita inválido",
            });
        }

        if (!fecha && diasFiltro !== null) {
            return res.status(400).json({
                success: false,
                mensaje: "Fecha es requerida (query param: fecha o date)",
            });
        }

        const resultado = await evolucionEnfermeriaService.obtenerEvolucionesPorVisitaYFecha(
            numeroVisitaInt,
            fecha,
            diasFiltro,
        );

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
 */
const eliminarEvolucion = async (req, res) => {
    try {
        const clave = parseClaveFromQuery(req);
        if (!clave) {
            return res.status(400).json({
                success: false,
                mensaje:
                    "Parámetros inválidos (numeroVisita, fechaControl, horaControl requeridos)",
            });
        }

        const ok = await assertPropiedad(
            req,
            res,
            clave.numeroVisitaInt,
            clave.fechaControlInt,
            clave.horaControlInt,
        );
        if (!ok) return;

        await evolucionEnfermeriaService.eliminarEvolucion(
            clave.numeroVisitaInt,
            clave.fechaControlInt,
            clave.horaControlInt,
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
 * Actualizar observaciones de una evolución de enfermería
 */
const actualizarEvolucion = async (req, res) => {
    try {
        const clave = parseClaveFromQuery(req);
        if (!clave) {
            return res.status(400).json({
                success: false,
                mensaje:
                    "Parámetros inválidos (numeroVisita, fechaControl, horaControl requeridos)",
            });
        }

        const observaciones = String(req.body?.Observaciones ?? "").trim();
        if (!observaciones) {
            return res.status(400).json({
                success: false,
                mensaje: "Observaciones es requerida",
            });
        }

        const ok = await assertPropiedad(
            req,
            res,
            clave.numeroVisitaInt,
            clave.fechaControlInt,
            clave.horaControlInt,
        );
        if (!ok) return;

        const data = await evolucionEnfermeriaService.actualizarEvolucion(
            clave.numeroVisitaInt,
            clave.fechaControlInt,
            clave.horaControlInt,
            observaciones,
        );

        res.json({
            success: true,
            mensaje: "Evolución de enfermería actualizada correctamente",
            data,
        });
    } catch (error) {
        console.error("Error al actualizar evolución de enfermería:", error);
        res.status(500).json({
            success: false,
            mensaje: "Error al actualizar la evolución de enfermería",
            error: error.message,
        });
    }
};

/**
 * Crear nueva evolución de enfermería
 */
const crearEvolucion = async (req, res) => {
    try {
        const { NumeroVisita, FechaControl, HoraControl, Observaciones } = req.body;

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

        if (!Observaciones || String(Observaciones).trim() === "") {
            return res.status(400).json({
                success: false,
                mensaje: "Observaciones es requerida",
            });
        }

        const Profesional = requireProfesional(req, res);
        if (Profesional == null) return;

        const OperadorCarga = requireOperadorCarga(req, res);
        if (OperadorCarga == null) return;

        const resultado = await evolucionEnfermeriaService.crearEvolucion({
            NumeroVisita,
            FechaControl,
            HoraControl,
            Observaciones,
            Profesional,
            OperadorCarga,
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
    actualizarEvolucion,
    crearEvolucion,
};
