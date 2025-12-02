const { executeQuery } = require("../models/db");
const { convertirFechaAClarion } = require("../utils/dateUtils");

/**
 * Obtener controles frecuentes por número de visita y fecha
 * @param {number} numeroVisita - Número de visita del paciente
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @returns {Promise<Array>} Lista de controles frecuentes
 */
const obtenerControlesPorVisitaYFecha = async (numeroVisita, fecha) => {
    console.log('🔵 [controlesFrecuentes.service] obtenerControlesPorVisitaYFecha called:', {
        numeroVisita,
        fecha,
        numeroVisitaType: typeof numeroVisita,
        fechaType: typeof fecha
    });

    // Convertir fecha YYYY-MM-DD a formato Clarion usando la función correcta
    const fechaClarion = convertirFechaAClarion(fecha);

    console.log('🔵 [controlesFrecuentes.service] Fecha Clarion calculada:', {
        fechaISO: fecha,
        fechaClarion
    });

    const consulta = `
    SELECT 
      cf.Valor,
      cf.NumeroVisita,
      CONVERT(varchar(10), DATEADD(day, NULLIF(cf.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCarga,
      CASE 
        WHEN cf.HoraCarga IS NULL OR cf.HoraCarga = 0 THEN NULL
        ELSE STUFF(STUFF(RIGHT('000000' + CAST(cf.HoraCarga AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
      END AS HoraCarga,
      cf.OperadorCarga,
      pw1.Apellido AS OperadorApellido,
      pw1.Nombres AS OperadorNombres,
      cf.Profesional,
      pw2.Apellido AS ProfesionalApellido,
      pw2.Nombres AS ProfesionalNombres,
      CONVERT(varchar(10), DATEADD(day, NULLIF(cf.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(cf.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      cf.Pulso,
      cf.Maximo,
      cf.Minimo,
      cf.FrecuenciaRespiratoria,
      cf.Axilar,
      cf.Rectal,
      cf.Observaciones,
      cf.Nroindicacion,
      cf.Hgt,
      cf.IdSector,
      cf.PAMedia,
      cf.Saturometria,
      cf.Peso,
      cf.Talla,
      cf.IdTurno
    FROM dbo.imInterCtrlFrecuente AS cf
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = cf.OperadorCarga
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = cf.Profesional
    WHERE cf.NumeroVisita = @param0 
      AND cf.FechaControl = @param1
    ORDER BY cf.HoraControl ASC, cf.Valor ASC
  `;
    const parametros = [{ value: numeroVisita }, { value: fechaClarion }];
    
    console.log('🔵 [controlesFrecuentes.service] Ejecutando query con parámetros:', {
        parametros,
        consultaPreview: consulta.substring(0, 200) + '...'
    });

    try {
        const resultado = await executeQuery(consulta, parametros);
        console.log('🔵 [controlesFrecuentes.service] Resultado:', {
            resultadoType: typeof resultado,
            isArray: Array.isArray(resultado),
            length: resultado?.length,
            firstRecord: resultado?.[0]
        });
        return resultado;
    } catch (error) {
        console.error("Error al obtener controles frecuentes por visita y fecha:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Obtener un control frecuente por ID
 * @param {number} valor - ID del control frecuente
 * @returns {Promise<Object|null>} Registro de control frecuente o null
 */
const obtenerControlPorId = async (valor) => {
    const consulta = `
    SELECT 
      cf.Valor,
      cf.NumeroVisita,
      CONVERT(varchar(10), DATEADD(day, NULLIF(cf.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCarga,
      CASE 
        WHEN cf.HoraCarga IS NULL OR cf.HoraCarga = 0 THEN NULL
        ELSE STUFF(STUFF(RIGHT('000000' + CAST(cf.HoraCarga AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
      END AS HoraCarga,
      cf.OperadorCarga,
      pw1.Apellido AS OperadorApellido,
      pw1.Nombres AS OperadorNombres,
      cf.Profesional,
      pw2.Apellido AS ProfesionalApellido,
      pw2.Nombres AS ProfesionalNombres,
      CONVERT(varchar(10), DATEADD(day, NULLIF(cf.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(cf.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      cf.Pulso,
      cf.Maximo,
      cf.Minimo,
      cf.FrecuenciaRespiratoria,
      cf.Axilar,
      cf.Rectal,
      cf.Observaciones,
      cf.Nroindicacion,
      cf.Hgt,
      cf.IdSector,
      cf.PAMedia,
      cf.Saturometria,
      cf.Peso,
      cf.Talla,
      cf.IdTurno
    FROM dbo.imInterCtrlFrecuente AS cf
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = cf.OperadorCarga
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = cf.Profesional
    WHERE cf.Valor = @param0
  `;
    const parametros = [{ value: valor }];
    try {
        const resultado = await executeQuery(consulta, parametros);
        return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
    } catch (error) {
        console.error("Error al obtener control frecuente por ID:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Eliminar un control frecuente por ID
 * @param {number} valor - ID del control frecuente
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
const eliminarControl = async (valor) => {
    const consulta = `
    DELETE FROM dbo.imInterCtrlFrecuente
    WHERE Valor = @param0
  `;
    const parametros = [{ value: valor }];
    try {
        await executeQuery(consulta, parametros);
        return true;
    } catch (error) {
        console.error("Error al eliminar control frecuente:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

module.exports = {
    obtenerControlesPorVisitaYFecha,
    obtenerControlPorId,
    eliminarControl,
};
