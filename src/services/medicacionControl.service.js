const { executeQuery } = require("../models/db");
const { convertirFechaAClarion } = require("../utils/dateUtils");

/**
 * Obtener medicación suministrada por número de visita
 * @param {number} numeroVisita - Número de visita
 * @returns {Promise<Array>} Lista de medicación suministrada
 */
const obtenerMedicacionPorVisita = async (numeroVisita) => {
    const consulta = `
    SELECT 
      mc.IDCtrlMedica,
      mc.IDFactura,
      mc.IDDetalle,
      mc.NroIndicacion,
      mc.ModuloOrigen,
      mc.TipoMedicamento,
      mc.NumeroVisita,
      mc.Sector,
      CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCarga,
      CASE 
        WHEN mc.HoraCarga IS NULL OR mc.HoraCarga = 0 THEN NULL
        ELSE STUFF(STUFF(RIGHT('000000' + CAST(mc.HoraCarga AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
      END AS HoraCarga,
      mc.OperadorCarga,
      pw1.Apellido AS OperadorApellido,
      pw1.Nombres AS OperadorNombres,
      pw1.Nombres + ' ' + pw1.Apellido AS OperadorFullName,
      mc.Profesional,
      pw2.Apellido AS ProfesionalApellido,
      pw2.Nombres AS ProfesionalNombres,
      pw2.Nombres + ' ' + pw2.Apellido AS ProfesionalFullName,
      CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(mc.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      mc.Troquel,
      mc.Cantidad,
      mc.TipoUnidad,
      mc.Observaciones,
      mc.IDCliente,
      mc.Status,
      mc.CantidadIndicada,
      mc.IdTurno,
      v.Alias AS NombreMedicamento,
      v.Descripcion AS DescripcionMedicamento,
      ind.NroAdicional,
      ind.FormaAdicional
    FROM dbo.imInterCtrlMedicamento AS mc
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = mc.OperadorCarga
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = mc.Profesional
    LEFT JOIN dbo.imVademecum AS v ON mc.Troquel = v.Troquel
    LEFT JOIN dbo.imInterIndMedicas AS ind ON mc.NroIndicacion = ind.NroIndicacion
    WHERE mc.NumeroVisita = @param0
    ORDER BY mc.FechaCarga DESC, mc.HoraCarga DESC, mc.IDCtrlMedica DESC
  `;
    const parametros = [{ value: numeroVisita }];
    try {
        const resultado = await executeQuery(consulta, parametros);
        const medicaciones = Array.isArray(resultado) ? resultado : [];
        
        // Agrupar medicaciones padre con sus hijas (adicionales)
        const medicacionesPadre = [];
        const medicacionesHijas = new Map(); // Map<NroIndicacion del padre, Array<Hija>>
        
        medicaciones.forEach((m) => {
            const nroAdicional = m.NroAdicional || 0;
            
            if (nroAdicional === 0 || nroAdicional === null) {
                // Es una medicación padre (principal)
                medicacionesPadre.push({
                    ...m,
                    adicionales: [] // Se llenará después
                });
            } else {
                // Es una medicación hija (NroAdicional contiene el NroIndicacion del padre)
                const hija = {
                    NroIndicacion: m.NroIndicacion,
                    NroAdicional: m.NroAdicional,
                    FormaAdicional: m.FormaAdicional,
                    NombreMedicamento: m.NombreMedicamento,
                    DescripcionMedicamento: m.DescripcionMedicamento,
                    Cantidad: m.Cantidad,
                    CantidadIndicada: m.CantidadIndicada,
                    TipoUnidad: m.TipoUnidad
                };
                
                // Agrupar por el NroIndicacion del padre (que está en NroAdicional de la hija)
                if (!medicacionesHijas.has(m.NroAdicional)) {
                    medicacionesHijas.set(m.NroAdicional, []);
                }
                medicacionesHijas.get(m.NroAdicional).push(hija);
            }
        });
        
        // Asignar hijas a sus padres
        medicacionesPadre.forEach((padre) => {
            if (medicacionesHijas.has(padre.NroIndicacion)) {
                padre.adicionales = medicacionesHijas.get(padre.NroIndicacion);
            }
        });
        
        console.log("🔍 [medicacionControl] Medicaciones padre:", medicacionesPadre.length);
        console.log("🔍 [medicacionControl] Medicaciones con adicionales:", 
            medicacionesPadre.filter(p => p.adicionales && p.adicionales.length > 0).length);
        
        return medicacionesPadre;
    } catch (error) {
        console.error("Error al obtener medicación por visita:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Obtener medicación suministrada por número de visita y fecha
 * @param {number} numeroVisita - Número de visita
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @returns {Promise<Array>} Lista de medicación suministrada
 */
const obtenerMedicacionPorVisitaYFecha = async (numeroVisita, fecha) => {
    console.log('🔵 [medicacionControl.service] obtenerMedicacionPorVisitaYFecha called:', {
        numeroVisita,
        fecha,
        numeroVisitaType: typeof numeroVisita,
        fechaType: typeof fecha
    });

    // PRIMERO: Ver qué fechas existen para esta visita
    const consultaDebug = `
        SELECT TOP 10
            mc.IDCtrlMedica,
            mc.FechaCarga,
            mc.HoraCarga,
            mc.FechaControl,
            mc.HoraControl,
            CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCargaConvertida,
            CASE 
                WHEN mc.HoraCarga IS NULL OR mc.HoraCarga = 0 THEN NULL
                ELSE STUFF(STUFF(RIGHT('000000' + CAST(mc.HoraCarga AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
            END AS HoraCargaConvertida,
            CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControlConvertida,
            CONVERT(varchar(8), DATEADD(ms, (NULLIF(mc.HoraControl,0) - 1) * 10, 0), 108) AS HoraControlConvertida
        FROM dbo.imInterCtrlMedicamento AS mc
        WHERE mc.NumeroVisita = @param0
        ORDER BY mc.IDCtrlMedica DESC
    `;
    
    try {
        const registrosDebug = await executeQuery(consultaDebug, [{ value: numeroVisita }]);
        console.log('🔍 [DEBUG] Primeros 10 registros de esta visita:', registrosDebug);
    } catch (error) {
        console.error('❌ [DEBUG] Error al obtener registros de debug:', error);
    }

    // Convertir fecha YYYY-MM-DD a formato Clarion usando la función correcta
    const fechaClarion = convertirFechaAClarion(fecha);

    console.log('🔵 [medicacionControl.service] Fecha Clarion calculada:', {
        fechaISO: fecha,
        fechaClarion
    });

    const consulta = `
    SELECT 
      mc.IDCtrlMedica,
      mc.IDFactura,
      mc.IDDetalle,
      mc.NroIndicacion,
      mc.ModuloOrigen,
      mc.TipoMedicamento,
      mc.NumeroVisita,
      mc.Sector,
      CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCarga,
      CASE 
        WHEN mc.HoraCarga IS NULL OR mc.HoraCarga = 0 THEN NULL
        ELSE STUFF(STUFF(RIGHT('000000' + CAST(mc.HoraCarga AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
      END AS HoraCarga,
      mc.OperadorCarga,
      pw1.Apellido AS OperadorApellido,
      pw1.Nombres AS OperadorNombres,
      pw1.Nombres + ' ' + pw1.Apellido AS OperadorFullName,
      mc.Profesional,
      pw2.Apellido AS ProfesionalApellido,
      pw2.Nombres AS ProfesionalNombres,
      pw2.Nombres + ' ' + pw2.Apellido AS ProfesionalFullName,
      CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(mc.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      mc.Troquel,
      mc.Cantidad,
      mc.TipoUnidad,
      mc.Observaciones,
      mc.IDCliente,
      mc.Status,
      mc.CantidadIndicada,
      mc.IdTurno,
      v.Alias AS NombreMedicamento,
      v.Descripcion AS DescripcionMedicamento,
      ind.NroAdicional,
      ind.FormaAdicional
    FROM dbo.imInterCtrlMedicamento AS mc
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = mc.OperadorCarga
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = mc.Profesional
    LEFT JOIN dbo.imVademecum AS v ON mc.Troquel = v.Troquel
    LEFT JOIN dbo.imInterIndMedicas AS ind ON mc.NroIndicacion = ind.NroIndicacion
    WHERE mc.NumeroVisita = @param0 
      AND mc.FechaCarga = @param1
    ORDER BY mc.HoraControl ASC, mc.IDCtrlMedica ASC
  `;
    const parametros = [{ value: numeroVisita }, { value: fechaClarion }];
    
    console.log('🔵 [medicacionControl.service] Ejecutando query con parámetros:', {
        parametros,
        consultaPreview: consulta.substring(0, 200) + '...'
    });

    try {
        const resultado = await executeQuery(consulta, parametros);
        const medicaciones = Array.isArray(resultado) ? resultado : [];
        
        console.log('🔵 [medicacionControl.service] Query result:', {
            resultadoType: typeof resultado,
            isArray: Array.isArray(resultado),
            length: medicaciones.length,
            firstRecord: medicaciones.length > 0 ? medicaciones[0] : null
        });

        // Agrupar medicaciones padre con sus hijas (adicionales)
        const medicacionesPadre = [];
        const medicacionesHijas = new Map();
        
        medicaciones.forEach((m) => {
            const nroAdicional = m.NroAdicional || 0;
            
            if (nroAdicional === 0 || nroAdicional === null) {
                medicacionesPadre.push({
                    ...m,
                    adicionales: []
                });
            } else {
                const hija = {
                    NroIndicacion: m.NroIndicacion,
                    NroAdicional: m.NroAdicional,
                    FormaAdicional: m.FormaAdicional,
                    NombreMedicamento: m.NombreMedicamento,
                    DescripcionMedicamento: m.DescripcionMedicamento,
                    Cantidad: m.Cantidad,
                    CantidadIndicada: m.CantidadIndicada,
                    TipoUnidad: m.TipoUnidad
                };
                
                if (!medicacionesHijas.has(m.NroAdicional)) {
                    medicacionesHijas.set(m.NroAdicional, []);
                }
                medicacionesHijas.get(m.NroAdicional).push(hija);
            }
        });
        
        medicacionesPadre.forEach((padre) => {
            if (medicacionesHijas.has(padre.NroIndicacion)) {
                padre.adicionales = medicacionesHijas.get(padre.NroIndicacion);
            }
        });
        
        console.log("🔍 [medicacionControl] Medicaciones padre (por fecha):", medicacionesPadre.length);
        console.log("🔍 [medicacionControl] Medicaciones con adicionales:", 
            medicacionesPadre.filter(p => p.adicionales && p.adicionales.length > 0).length);

        return medicacionesPadre;
    } catch (error) {
        console.error("❌ [medicacionControl.service] Error al obtener medicación por visita y fecha:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Obtener un registro de medicación por ID
 * @param {number} idCtrlMedica - ID del control de medicación
 * @returns {Promise<Object|null>} Registro de medicación
 */
const obtenerMedicacionPorId = async (idCtrlMedica) => {
    const consulta = `
    SELECT 
      mc.IDCtrlMedica,
      mc.IDFactura,
      mc.IDDetalle,
      mc.NroIndicacion,
      mc.ModuloOrigen,
      mc.TipoMedicamento,
      mc.NumeroVisita,
      mc.Sector,
      CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaCarga,0) - 4, '1801-01-01'), 23) AS FechaCarga,
      CASE 
        WHEN mc.HoraCarga IS NULL OR mc.HoraCarga = 0 THEN NULL
        ELSE STUFF(STUFF(RIGHT('000000' + CAST(mc.HoraCarga AS VARCHAR(6)), 6), 5, 0, ':'), 3, 0, ':')
      END AS HoraCarga,
      mc.OperadorCarga,
      pw1.Apellido AS OperadorApellido,
      pw1.Nombres AS OperadorNombres,
      pw1.Nombres + ' ' + pw1.Apellido AS OperadorFullName,
      mc.Profesional,
      pw2.Apellido AS ProfesionalApellido,
      pw2.Nombres AS ProfesionalNombres,
      pw2.Nombres + ' ' + pw2.Apellido AS ProfesionalFullName,
      CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
      CONVERT(varchar(8), DATEADD(ms, (NULLIF(mc.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
      mc.Troquel,
      mc.Cantidad,
      mc.TipoUnidad,
      mc.Observaciones,
      mc.IDCliente,
      mc.Status,
      mc.CantidadIndicada,
      mc.IdTurno,
      v.Alias AS NombreMedicamento,
      v.Descripcion AS DescripcionMedicamento,
      ind.NroAdicional,
      ind.FormaAdicional
    FROM dbo.imInterCtrlMedicamento AS mc
    LEFT JOIN dbo.imPassword AS pw1 ON pw1.CodOperador = mc.OperadorCarga
    LEFT JOIN dbo.imPassword AS pw2 ON pw2.CodOperador = mc.Profesional
    LEFT JOIN dbo.imVademecum AS v ON mc.Troquel = v.Troquel
    LEFT JOIN dbo.imInterIndMedicas AS ind ON mc.NroIndicacion = ind.NroIndicacion
    WHERE mc.IDCtrlMedica = @param0
  `;
    const parametros = [{ value: idCtrlMedica }];
    try {
        const resultado = await executeQuery(consulta, parametros);
        return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
    } catch (error) {
        console.error("Error al obtener medicación por ID:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Eliminar un registro de medicación por ID
 * @param {number} idCtrlMedica - ID del control de medicación
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
const eliminarMedicacion = async (idCtrlMedica) => {
    const consulta = `
    DELETE FROM dbo.imInterCtrlMedicamento
    WHERE IDCtrlMedica = @param0
  `;
    const parametros = [{ value: idCtrlMedica }];
    try {
        await executeQuery(consulta, parametros);
        return true;
    } catch (error) {
        console.error("Error al eliminar medicación:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

module.exports = {
    obtenerMedicacionPorVisita,
    obtenerMedicacionPorVisitaYFecha,
    obtenerMedicacionPorId,
    eliminarMedicacion,
};
