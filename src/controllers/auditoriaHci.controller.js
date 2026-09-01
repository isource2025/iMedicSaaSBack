const auditoriaHciService = require("../services/auditoriaHci.service");

const enteroValido = (valor) => Number.isInteger(Number(valor)) && Number(valor) > 0;

/**
 * Historial de cambios de una HC de ingreso puntual.
 */
const obtenerPorHC = async (req, res) => {
    try {
        const { id } = req.params;

        if (!enteroValido(id)) {
            return res.status(400).json({
                success: false,
                message: "El ID de HC de Ingreso es inválido",
            });
        }

        const resultado = await auditoriaHciService.obtenerPorHC(id);

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error en obtenerAuditoriaPorHC:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener el historial de la HC de Ingreso",
            error: error.message,
        });
    }
};

/**
 * Historial de todas las HC de una visita, incluidas las que se borraron.
 */
const obtenerPorVisita = async (req, res) => {
    try {
        const { numeroVisita } = req.params;

        if (!enteroValido(numeroVisita)) {
            return res.status(400).json({
                success: false,
                message: "El número de visita es inválido",
            });
        }

        const resultado = await auditoriaHciService.obtenerPorVisita(numeroVisita);

        res.json({
            success: true,
            data: resultado,
        });
    } catch (error) {
        console.error("Error en obtenerAuditoriaPorVisita:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener el historial de la visita",
            error: error.message,
        });
    }
};

module.exports = { obtenerPorHC, obtenerPorVisita };
