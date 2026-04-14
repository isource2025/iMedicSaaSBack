const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
} = require("../utils/dateUtils");

/**
 * Glucemia desde controles frecuentes (Hgt puede ser int o texto legacy en BD).
 * Sin TRY_CONVERT (requiere SQL 2012+): solo dígitos vía PATINDEX, luego CAST — compatible SQL 2005.
 */
const SQL_GLUCEMIA_OUTER_APPLY = `
        OUTER APPLY (
            SELECT TOP 1 g.Glucemia AS Glucemia
            FROM (
                SELECT
                    CASE
                        WHEN cf.Hgt IS NULL THEN NULL
                        WHEN LTRIM(RTRIM(CAST(cf.Hgt AS VARCHAR(200)))) = '' THEN NULL
                        WHEN PATINDEX('%[^0-9]%', LTRIM(RTRIM(CAST(cf.Hgt AS VARCHAR(200))))) > 0 THEN NULL
                        ELSE CAST(LTRIM(RTRIM(CAST(cf.Hgt AS VARCHAR(200)))) AS INT)
                    END AS Glucemia,
                    cf.FechaControl,
                    cf.HoraControl
                FROM dbo.imInterCtrlFrecuente AS cf
                WHERE cf.NumeroVisita = ev.IdVisita
                  AND (
                    cf.FechaControl < ev.FechaEv
                    OR (
                      cf.FechaControl = ev.FechaEv
                      AND ISNULL(cf.HoraControl, 0) <= ISNULL(NULLIF(ev.HoraEv, 0), 99999999)
                    )
                  )
            ) AS g
            WHERE g.Glucemia IS NOT NULL AND g.Glucemia <> 0
            ORDER BY g.FechaControl DESC, g.HoraControl DESC
        ) AS glu`;

/**
 * Obtener evoluciones por visita y fecha/período
 * @param {number} idVisita - Número de visita
 * @param {string} fecha - Fecha en formato YYYY-MM-DD (fecha de referencia)
 * @param {number|null} dias - Número de días hacia atrás desde la fecha (null = todas)
 */
const obtenerEvolucionesPorVisitaYFecha = async (idVisita, fecha, dias = null) => {
    const fechaClarion = convertirFechaAClarion(fecha);
    
    let whereClause = 'ev.IdVisita = @param0';
    const params = [{ value: idVisita }];
    
    if (dias === null) {
        // Todas las evoluciones de la visita
        // No agregamos filtro de fecha
    } else if (dias === 0) {
        // Solo la fecha específica
        whereClause += ' AND ev.FechaEv = @param1';
        params.push({ value: fechaClarion });
    } else {
        // Rango de días hacia atrás
        const fechaDesde = convertirFechaAClarion(
            new Date(new Date(fecha).getTime() - dias * 24 * 60 * 60 * 1000)
                .toISOString().split('T')[0]
        );
        whereClause += ' AND ev.FechaEv >= @param1 AND ev.FechaEv <= @param2';
        params.push({ value: fechaDesde });
        params.push({ value: fechaClarion });
    }
    
    const sql = `
        SELECT 
            ev.IdHCEvolucion,
            ev.IdVisita,
            ev.NroHC,
            CONVERT(varchar(10), DATEADD(day, ev.FechaEv, '1800-12-28'), 23) AS FechaEv,
            CONVERT(varchar(5), DATEADD(ms, (ev.HoraEv - 1) * 10, 0), 108) AS HoraEv,
            ev.IdSector,
            sec.Descripcion AS SectorDescripcion,
            ev.Evolucion,
            ev.NumeroDocumento,
            ev.Profecional,
            per.ApellidoNombre AS ProfesionalNombreCompleto,
            per.ValorEspecialidad,
            esp.Descripcion AS EspecialidadDescripcion,
            glu.Glucemia AS Glucemia
        FROM dbo.imHCEvolucion AS ev
        LEFT JOIN dbo.imSectores AS sec ON ev.IdSector = sec.Valor
        LEFT JOIN dbo.imPersonal AS per ON ev.Profecional = per.Matricula
        LEFT JOIN dbo.imEspecialidad AS esp ON per.ValorEspecialidad = esp.Valor
        ${SQL_GLUCEMIA_OUTER_APPLY}
        WHERE ${whereClause}
        ORDER BY ev.FechaEv DESC, ev.HoraEv DESC
    `;

    try {
        const resultado = await executeQuery(sql, params);
        return resultado;
    } catch (error) {
        console.error("Error al obtener evoluciones por visita y fecha:", error);
        throw error;
    }
};

/**
 * Crear nueva evolución
 */
const crearEvolucion = async (data) => {
    // Convertir fecha y hora a formato Clarion INT
    const fechaClarion = convertirFechaAClarion(data.FechaEv);
    const horaClarion = convertirHoraAClarion(data.HoraEv);

    const sql = `
        INSERT INTO dbo.imHCEvolucion (
            IdVisita,
            NroHC,
            FechaEv,
            HoraEv,
            IdSector,
            Evolucion,
            NumeroDocumento,
            Profecional
        ) VALUES (
            @param0,
            COALESCE((SELECT p.NumeroHC FROM dbo.imVisita v 
             INNER JOIN dbo.imPacientes p ON v.IdPaciente = p.IdPaciente 
             WHERE v.NumeroVisita = @param0), ''),
            @param1,
            @param2,
            @param3,
            @param4,
            @param5,
            @param6
        );
        SELECT SCOPE_IDENTITY() AS IdHCEvolucion;
    `;

    const params = [
        { value: data.IdVisita },
        { value: fechaClarion },
        { value: horaClarion },
        { value: data.IdSector },
        { value: data.Evolucion },
        { value: data.NumeroDocumento },
        { value: data.Profecional || null }
    ];

    try {
        const resultado = await executeQuery(sql, params);
        return resultado[0];
    } catch (error) {
        console.error("Error al crear evolución:", error);
        throw error;
    }
};

/**
 * Obtener evolución por ID
 */
const obtenerEvolucionPorId = async (idHCEvolucion) => {
    const sql = `
        SELECT 
            ev.IdHCEvolucion,
            ev.IdVisita,
            ev.NroHC,
            CONVERT(varchar(10), DATEADD(day, ev.FechaEv, '1800-12-28'), 23) AS FechaEv,
            CONVERT(varchar(5), DATEADD(ms, (ev.HoraEv - 1) * 10, 0), 108) AS HoraEv,
            ev.IdSector,
            sec.Descripcion AS SectorDescripcion,
            ev.Evolucion,
            ev.NumeroDocumento,
            ev.Profecional,
            per.ApellidoNombre AS ProfesionalNombreCompleto,
            per.ValorEspecialidad,
            esp.Descripcion AS EspecialidadDescripcion,
            glu.Glucemia AS Glucemia
        FROM dbo.imHCEvolucion AS ev
        LEFT JOIN dbo.imSectores AS sec ON ev.IdSector = sec.Valor
        LEFT JOIN dbo.imPersonal AS per ON ev.Profecional = per.Matricula
        LEFT JOIN dbo.imEspecialidad AS esp ON per.ValorEspecialidad = esp.Valor
        ${SQL_GLUCEMIA_OUTER_APPLY}
        WHERE ev.IdHCEvolucion = @param0
    `;

    const params = [{ value: idHCEvolucion }];

    try {
        const resultado = await executeQuery(sql, params);
        return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
    } catch (error) {
        console.error("Error al obtener evolución por ID:", error);
        throw error;
    }
};

/**
 * Eliminar evolución
 */
const eliminarEvolucion = async (id) => {
    const sql = `
        DELETE FROM dbo.imHCEvolucion
        WHERE IdHCEvolucion = @param0
    `;

    const params = [{ value: id }];

    try {
        await executeQuery(sql, params);
        return true;
    } catch (error) {
        console.error("Error al eliminar evolución:", error);
        throw error;
    }
};

/**
 * Actualizar evolución
 */
const actualizarEvolucion = async (id, data) => {
    // Convertir fecha y hora a formato Clarion INT
    const fechaClarion = convertirFechaAClarion(data.FechaEv);
    const horaClarion = convertirHoraAClarion(data.HoraEv);

    const sql = `
        UPDATE dbo.imHCEvolucion
        SET
            FechaEv = @param1,
            HoraEv = @param2,
            IdSector = @param3,
            Evolucion = @param4,
            NumeroDocumento = @param5
        WHERE IdHCEvolucion = @param0
    `;

    const params = [
        { value: id },
        { value: fechaClarion },
        { value: horaClarion },
        { value: data.IdSector },
        { value: data.Evolucion },
        { value: data.NumeroDocumento }
    ];

    try {
        await executeQuery(sql, params);
        return true;
    } catch (error) {
        console.error("Error al actualizar evolución:", error);
        throw error;
    }
};

module.exports = {
    obtenerEvolucionesPorVisitaYFecha,
    crearEvolucion,
    obtenerEvolucionPorId,
    eliminarEvolucion,
    actualizarEvolucion,
};
