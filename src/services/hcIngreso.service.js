const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
} = require("../utils/dateUtils");

/**
 * Obtener HC de Ingreso por visita
 */
const obtenerHCIngresoPorVisita = async (numeroVisita) => {
    const sql = `
        SELECT 
            hc.IdHCIngreso,
            hc.NumeroVisita,
            hc.IdSector,
            hc.MotivoConsulta,
            hc.EnfermedadActual,
            hc.IdProfecional,
            hc.Fecha,
            CONVERT(VARCHAR(10), hc.Fecha, 23) AS FechaFormateada,
            SUBSTRING(CONVERT(VARCHAR(8), hc.Fecha, 108), 1, 5) AS HoraFormateada,
            LTRIM(RTRIM(ISNULL(pw.Apellido, '') + ' ' + ISNULL(pw.Nombres, ''))) AS ProfesionalNombre,
            sec.Descripcion AS SectorDescripcion
        FROM dbo.imHCI AS hc
        LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = hc.IdProfecional
        LEFT JOIN dbo.imSectores AS sec ON hc.IdSector = sec.Valor
        WHERE hc.NumeroVisita = @param0
        ORDER BY hc.Fecha DESC, hc.IdHCIngreso DESC
    `;

    const params = [{ value: numeroVisita }];

    try {
        const resultado = await executeQuery(sql, params);
        return resultado;
    } catch (error) {
        console.error("Error al obtener HC de Ingreso por visita:", error);
        throw error;
    }
};

/**
 * Obtener HC de Ingreso por ID
 */
const obtenerHCIngresoPorId = async (idHCIngreso) => {
    const sql = `
        SELECT 
            hc.IdHCIngreso,
            hc.NumeroVisita,
            hc.IdSector,
            hc.MotivoConsulta,
            hc.EnfermedadActual,
            hc.IdProfecional,
            hc.Fecha,
            CONVERT(VARCHAR(10), hc.Fecha, 23) AS FechaFormateada,
            SUBSTRING(CONVERT(VARCHAR(8), hc.Fecha, 108), 1, 5) AS HoraFormateada,
            LTRIM(RTRIM(ISNULL(pw.Apellido, '') + ' ' + ISNULL(pw.Nombres, ''))) AS ProfesionalNombre,
            sec.Descripcion AS SectorDescripcion
        FROM dbo.imHCI AS hc
        LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = hc.IdProfecional
        LEFT JOIN dbo.imSectores AS sec ON hc.IdSector = sec.Valor
        WHERE hc.IdHCIngreso = @param0
    `;

    const params = [{ value: idHCIngreso }];

    try {
        const resultado = await executeQuery(sql, params);
        return resultado.length > 0 ? resultado[0] : null;
    } catch (error) {
        console.error("Error al obtener HC de Ingreso por ID:", error);
        throw error;
    }
};

/**
 * Crear nueva HC de Ingreso
 */
const crearHCIngreso = async (data) => {
    const sql = `
        INSERT INTO dbo.imHCI (
            NumeroVisita,
            IdSector,
            MotivoConsulta,
            EnfermedadActual,
            IdProfecional
        ) VALUES (
            @param0,
            @param1,
            @param2,
            @param3,
            @param4
        );
        SELECT SCOPE_IDENTITY() AS IdHCIngreso;
    `;

    const params = [
        { value: data.NumeroVisita },
        { value: data.IdSector },
        { value: data.MotivoConsulta || null },
        { value: data.EnfermedadActual || null },
        { value: data.IdProfecional || null }
    ];

    try {
        const resultado = await executeQuery(sql, params);
        return resultado[0];
    } catch (error) {
        console.error("Error al crear HC de Ingreso:", error);
        throw error;
    }
};

/**
 * Actualizar HC de Ingreso
 */
const actualizarHCIngreso = async (idHCIngreso, data) => {
    const sql = `
        UPDATE dbo.imHCI
        SET
            IdSector = @param1,
            MotivoConsulta = @param2,
            EnfermedadActual = @param3,
            IdProfecional = @param4
        WHERE IdHCIngreso = @param0
    `;

    const params = [
        { value: idHCIngreso },
        { value: data.IdSector },
        { value: data.MotivoConsulta || null },
        { value: data.EnfermedadActual || null },
        { value: data.IdProfecional || null }
    ];

    try {
        await executeQuery(sql, params);
        return { success: true };
    } catch (error) {
        console.error("Error al actualizar HC de Ingreso:", error);
        throw error;
    }
};

/**
 * Eliminar HC de Ingreso
 */
const eliminarHCIngreso = async (idHCIngreso) => {
    const sql = `
        DELETE FROM dbo.imHCI
        WHERE IdHCIngreso = @param0
    `;

    const params = [{ value: idHCIngreso }];

    try {
        await executeQuery(sql, params);
        return { success: true };
    } catch (error) {
        console.error("Error al eliminar HC de Ingreso:", error);
        throw error;
    }
};

module.exports = {
    obtenerHCIngresoPorVisita,
    obtenerHCIngresoPorId,
    crearHCIngreso,
    actualizarHCIngreso,
    eliminarHCIngreso,
};
