const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
} = require("../utils/dateUtils");
const { normalizarTextoParaClarionAnsi } = require("../utils/clarionText");

/** SELECT compartido: nombre de profesional desde imPersonal; operador desde imPassword. */
const SELECT_EVOLUCION = `
    SELECT 
      ev.NumeroVisita,
      ev.Profesional,
      COALESCE(
        NULLIF(LTRIM(RTRIM(per.ApellidoNombre)), ''),
        NULLIF(LTRIM(RTRIM(ISNULL(pwOp.Apellido, '') + ' ' + ISNULL(pwOp.Nombres, ''))), '')
      ) AS ProfesionalApellido,
      CAST(NULL AS VARCHAR(80)) AS ProfesionalNombres,
      CONVERT(varchar(10), DATEADD(day, ev.FechaControl, '1800-12-28'), 23) AS FechaControl,
      CONVERT(varchar(5), DATEADD(ms, (ev.HoraControl - 1) * 10, 0), 108) AS HoraControl,
      ev.FechaControl AS FechaControlClarion,
      ev.HoraControl AS HoraControlClarion,
      ev.Observaciones,
      ev.FechaHoraCarga,
      ev.OperadorCarga,
      NULLIF(LTRIM(RTRIM(pwOp.Apellido)), '') AS OperadorApellido,
      NULLIF(LTRIM(RTRIM(pwOp.Nombres)), '') AS OperadorNombres
    FROM dbo.imInterCtrlEvolucion AS ev
    OUTER APPLY (
      SELECT TOP 1 p.ApellidoNombre
      FROM dbo.imPersonal p
      WHERE p.Valor = ev.Profesional OR p.Matricula = ev.Profesional
      ORDER BY CASE WHEN p.Valor = ev.Profesional THEN 0 ELSE 1 END
    ) per
    LEFT JOIN dbo.imPassword AS pwOp
      ON pwOp.CodOperador = ev.OperadorCarga
`;

/**
 * Obtener evoluciones de enfermería por número de visita y fecha
 */
const obtenerEvolucionesPorVisitaYFecha = async (numeroVisita, fecha) => {
    const fechaClarion = convertirFechaAClarion(fecha);

    const consulta = `
    ${SELECT_EVOLUCION}
    WHERE ev.NumeroVisita = @param0 
      AND ev.FechaControl = @param1
    ORDER BY ev.HoraControl DESC
  `;
    const parametros = [{ value: numeroVisita }, { value: fechaClarion }];

    try {
        return await executeQuery(consulta, parametros);
    } catch (error) {
        console.error("Error al obtener evoluciones de enfermería por visita y fecha:", error);
        throw error;
    }
};

/**
 * Obtener una evolución de enfermería por clave compuesta
 */
const obtenerEvolucionPorClave = async (numeroVisita, fechaControl, horaControl) => {
    const consulta = `
    ${SELECT_EVOLUCION}
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
        throw error;
    }
};

/**
 * Eliminar una evolución de enfermería por clave compuesta
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
        throw error;
    }
};

/**
 * Actualizar observaciones de una evolución (misma clave compuesta).
 */
const actualizarEvolucion = async (numeroVisita, fechaControl, horaControl, observaciones) => {
    const consulta = `
    UPDATE dbo.imInterCtrlEvolucion
    SET Observaciones = @param3
    WHERE NumeroVisita = @param0
      AND FechaControl = @param1
      AND HoraControl = @param2
  `;
    const parametros = [
        { value: numeroVisita },
        { value: fechaControl },
        { value: horaControl },
        { value: normalizarTextoParaClarionAnsi(observaciones) },
    ];
    try {
        await executeQuery(consulta, parametros);
        return obtenerEvolucionPorClave(numeroVisita, fechaControl, horaControl);
    } catch (error) {
        console.error("Error al actualizar evolución de enfermería:", error);
        throw error;
    }
};

/**
 * Crear nueva evolución de enfermería
 */
const crearEvolucion = async (data) => {
    const fechaClarion = convertirFechaAClarion(data.FechaControl);
    const horaClarion = convertirHoraAClarion(data.HoraControl);

    const sql = `
        INSERT INTO dbo.imInterCtrlEvolucion (
            NumeroVisita,
            Profesional,
            FechaControl,
            HoraControl,
            Observaciones,
            FechaHoraCarga,
            OperadorCarga
        ) VALUES (
            @param0,
            @param1,
            @param2,
            @param3,
            @param4,
            GETDATE(),
            @param5
        )
    `;

    const params = [
        { value: data.NumeroVisita },
        { value: data.Profesional || null },
        { value: fechaClarion },
        { value: horaClarion },
        { value: normalizarTextoParaClarionAnsi(data.Observaciones) },
        { value: data.OperadorCarga != null ? data.OperadorCarga : (data.Profesional || null) }
    ];

    try {
        await executeQuery(sql, params);
        return { success: true };
    } catch (error) {
        console.error("Error al crear evolución de enfermería:", error);
        throw error;
    }
};

module.exports = {
    obtenerEvolucionesPorVisitaYFecha,
    obtenerEvolucionPorClave,
    eliminarEvolucion,
    actualizarEvolucion,
    crearEvolucion,
};
