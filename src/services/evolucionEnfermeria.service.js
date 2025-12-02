const { executeQuery } = require("../models/db");
const { convertirFechaAClarion } = require("../utils/dateUtils");

/**
 * Obtener evoluciones de enfermería por número de visita y fecha
 * @param {number} numeroVisita - Número de visita del paciente
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @returns {Promise<Array>} Lista de evoluciones de enfermería
 */
const obtenerEvolucionesPorVisitaYFecha = async (numeroVisita, fecha) => {
    console.log('🔵 [evolucionEnfermeria.service] obtenerEvolucionesPorVisitaYFecha called:', {
        numeroVisita,
        fecha,
        numeroVisitaType: typeof numeroVisita,
        fechaType: typeof fecha
    });

    const fechaClarion = convertirFechaAClarion(fecha);

    console.log('🔵 [evolucionEnfermeria.service] Fecha Clarion calculada:', {
        fechaISO: fecha,
        fechaClarion
    });

    const consulta = `
    SELECT 
      ev.NumeroVisita,
      ev.Profesional,
      pw1.Apellido AS ProfesionalApellido,
      pw1.Nombres AS ProfesionalNombres,
      CONVERT(varchar(10), DATEADD(day, NULLIF(ev.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(ev.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      ev.Observaciones,
      ev.FechaHoraCarga,
      ev.OperadorCarga,
      pw2.Apellido AS OperadorApellido,
      pw2.Nombres AS OperadorNombres
    FROM dbo.imInterCtrlEvolucion AS ev
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = ev.Profesional
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = ev.OperadorCarga
    WHERE ev.NumeroVisita = @param0 
      AND ev.FechaControl = @param1
    ORDER BY ev.HoraControl ASC
  `;
    const parametros = [{ value: numeroVisita }, { value: fechaClarion }];
    
    console.log('🔵 [evolucionEnfermeria.service] Ejecutando query con parámetros:', {
        parametros,
        consultaPreview: consulta.substring(0, 200) + '...'
    });

    try {
        const resultado = await executeQuery(consulta, parametros);
        console.log('🔵 [evolucionEnfermeria.service] Resultado:', {
            resultadoType: typeof resultado,
            isArray: Array.isArray(resultado),
            length: resultado?.length,
            firstRecord: resultado?.[0]
        });
        return resultado;
    } catch (error) {
        console.error("Error al obtener evoluciones de enfermería por visita y fecha:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Obtener una evolución de enfermería por clave compuesta
 * @param {number} numeroVisita - Número de visita
 * @param {number} fechaControl - Fecha control en formato Clarion
 * @param {number} horaControl - Hora control en formato Clarion
 * @returns {Promise<Object|null>} Registro de evolución o null
 */
const obtenerEvolucionPorClave = async (numeroVisita, fechaControl, horaControl) => {
    const consulta = `
    SELECT 
      ev.NumeroVisita,
      ev.Profesional,
      pw1.Apellido AS ProfesionalApellido,
      pw1.Nombres AS ProfesionalNombres,
      CONVERT(varchar(10), DATEADD(day, NULLIF(ev.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(ev.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      ev.Observaciones,
      ev.FechaHoraCarga,
      ev.OperadorCarga,
      pw2.Apellido AS OperadorApellido,
      pw2.Nombres AS OperadorNombres
    FROM dbo.imInterCtrlEvolucion AS ev
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = ev.Profesional
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = ev.OperadorCarga
    WHERE ev.NumeroVisita = @param0
      AND ev.FechaControl = @param1
      AND ev.HoraControl = @param2
  `;
    const parametros = [
        { value: numeroVisita },
        { value: fechaControl },
        { value: horaControl }
    ];
    try {
        const resultado = await executeQuery(consulta, parametros);
        return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
    } catch (error) {
        console.error("Error al obtener evolución de enfermería por clave:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Eliminar una evolución de enfermería por clave compuesta
 * @param {number} numeroVisita - Número de visita
 * @param {number} fechaControl - Fecha control en formato Clarion
 * @param {number} horaControl - Hora control en formato Clarion
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
const eliminarEvolucion = async (numeroVisita, fechaControl, horaControl) => {
    const consulta = `
    DELETE FROM dbo.imInterCtrlEvolucion
    WHERE NumeroVisita = @param0
      AND FechaControl = @param1
      AND HoraControl = @param2
  `;
    const parametros = [
        { value: numeroVisita },
        { value: fechaControl },
        { value: horaControl }
    ];
    try {
        await executeQuery(consulta, parametros);
        return true;
    } catch (error) {
        console.error("Error al eliminar evolución de enfermería:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

module.exports = {
    obtenerEvolucionesPorVisitaYFecha,
    obtenerEvolucionPorClave,
    eliminarEvolucion,
};
