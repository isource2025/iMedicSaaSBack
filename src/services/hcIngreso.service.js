const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
} = require("../utils/dateUtils");

/**
 * Guardar signos vitales en tabla de controles frecuentes
 * Esta función se ejecuta automáticamente al crear/editar HC
 * @param {Object} data - Datos de signos vitales y contexto
 * @returns {Promise<Object>} Resultado de la operación
 */
const guardarSignosVitalesEnControles = async (data) => {
    try {
        // Convertir fecha y hora a formato Clarion
        const fechaClarion = convertirFechaAClarion(data.Fecha || new Date().toISOString().split('T')[0]);
        const horaClarion = convertirHoraAClarion(data.Hora || new Date().toTimeString().slice(0, 5));
        
        // Parsear presión arterial "120/80" → Maximo: 120, Minimo: 80
        let maximo = null;
        let minimo = null;
        if (data.SV_PA) {
            const partes = data.SV_PA.split('/');
            if (partes.length === 2) {
                maximo = parseInt(partes[0]) || null;
                minimo = parseInt(partes[1]) || null;
            }
        }
        
        // Convertir valores
        const pulso = data.SV_FC ? parseInt(data.SV_FC) || null : null;
        const frecResp = data.SV_FR ? parseInt(data.SV_FR) || null : null;
        const axilar = data.SV_TAX ? parseFloat(data.SV_TAX) || null : null;
        const peso = data.SV_PESOACTUAL ? parseFloat(data.SV_PESOACTUAL) || null : null;
        const talla = data.SV_TALLA ? parseFloat(data.SV_TALLA) || null : null;
        
        // Verificar si hay al menos un signo vital para guardar
        const haySignosVitales = maximo || minimo || pulso || frecResp || axilar || 
                                 data.SV_GLUCEMIA || peso || talla;
        
        if (!haySignosVitales) {
            console.log('No hay signos vitales para guardar en controles frecuentes');
            return {
                success: true,
                message: 'No hay signos vitales para guardar',
                data: null
            };
        }
        
        const sql = `
            INSERT INTO dbo.imInterCtrlFrecuente (
                NumeroVisita,
                FechaCarga,
                HoraCarga,
                OperadorCarga,
                Profesional,
                FechaControl,
                HoraControl,
                Pulso,
                Maximo,
                Minimo,
                FrecuenciaRespiratoria,
                Axilar,
                Rectal,
                Hgt,
                Peso,
                Talla,
                Saturometria,
                PAMedia,
                IdSector,
                IdTurno,
                Nroindicacion,
                Observaciones
            )
            OUTPUT INSERTED.Valor
            VALUES (
                @param0,  @param1,  @param2,  @param3,  @param4,  @param5,  @param6,
                @param7,  @param8,  @param9,  @param10, @param11, @param12, @param13,
                @param14, @param15, @param16, @param17, @param18, @param19, @param20, @param21
            );
        `;
        
        const params = [
            { value: data.NumeroVisita },
            { value: fechaClarion },
            { value: horaClarion },
            { value: data.IdProfecional },
            { value: data.IdProfecional },
            { value: fechaClarion },
            { value: horaClarion },
            { value: pulso },
            { value: maximo },
            { value: minimo },
            { value: frecResp },
            { value: axilar },
            { value: 0 }, // Rectal
            { value: data.SV_GLUCEMIA || null },
            { value: peso },
            { value: talla },
            { value: null }, // Saturometria
            { value: null }, // PAMedia
            { value: data.IdSector || null },
            { value: 0 }, // IdTurno
            { value: 0 }, // Nroindicacion
            { value: 'Cargado desde Historia Clínica' }
        ];
        
        const resultado = await executeQuery(sql, params);
        
        console.log('✅ Signos vitales guardados en controles frecuentes:', resultado[0].Valor);
        
        return {
            success: true,
            message: 'Signos vitales guardados en controles frecuentes',
            data: { Valor: resultado[0].Valor }
        };
    } catch (error) {
        console.error('⚠️ Error al guardar signos vitales en controles:', error);
        // No lanzar error para no bloquear el guardado de HC
        return {
            success: false,
            error: error.message,
            message: 'Error al guardar signos vitales en controles (HC se guardó correctamente)'
        };
    }
};

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
        const idHCIngreso = resultado[0].IdHCIngreso;
        
        // ✅ DOBLE GUARDADO: Guardar signos vitales en controles frecuentes
        const resultadoControles = await guardarSignosVitalesEnControles({
            ...data,
            Fecha: data.Fecha || new Date().toISOString().split('T')[0],
            Hora: data.Hora || new Date().toTimeString().slice(0, 5)
        });
        
        console.log('Resultado guardado en controles:', resultadoControles.message);
        
        return {
            IdHCIngreso: idHCIngreso,
            signosVitalesEnControles: resultadoControles.success
        };
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
        
        // ✅ DOBLE GUARDADO: Si se modificaron signos vitales, crear nuevo registro en controles
        // (No actualizar el anterior, crear uno nuevo para mantener historial)
        const resultadoControles = await guardarSignosVitalesEnControles({
            ...data,
            Fecha: data.Fecha || new Date().toISOString().split('T')[0],
            Hora: new Date().toTimeString().slice(0, 5) // Hora actual de la modificación
        });
        
        console.log('Resultado guardado en controles (actualización):', resultadoControles.message);
        
        return { 
            success: true,
            signosVitalesEnControles: resultadoControles.success
        };
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
    guardarSignosVitalesEnControles,
};
