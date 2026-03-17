const { executeQuery } = require("../models/db");
const { convertirFechaAClarion, convertirHoraAClarion } = require("../utils/dateUtils");

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
      cf.IdTurno,
      cf.IdHci
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
      cf.IdTurno,
      cf.IdHci
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

/**
 * Crear un nuevo control frecuente (desde HC o Gestión de Enfermería)
 * @param {Object} data - Datos del control
 * @param {number} data.numeroVisita - Número de visita del paciente
 * @param {string} data.fechaControl - Fecha del control YYYY-MM-DD
 * @param {string} data.horaControl - Hora del control HH:mm
 * @param {number} data.operadorCarga - Código del operador
 * @param {number|null} data.idHci - ID de HC de Ingreso (si fue cargado desde HC)
 * @param {number|null} data.pulso
 * @param {number|null} data.presionMax
 * @param {number|null} data.presionMin
 * @param {number|null} data.presionMedia
 * @param {number|null} data.frecuenciaRespiratoria
 * @param {number|null} data.temperaturaAxilar
 * @param {number|null} data.temperaturaRectal
 * @param {number|null} data.glucemia
 * @param {number|null} data.saturacion
 * @param {string|null} data.observaciones
 * @param {string|null} data.idSector
 * @returns {Promise<Object>} Registro creado con su Valor (ID)
 */
const crearControl = async (data) => {
    const ahora = new Date();
    const yyyy = ahora.getFullYear();
    const mm = String(ahora.getMonth() + 1).padStart(2, '0');
    const dd = String(ahora.getDate()).padStart(2, '0');
    const hh = String(ahora.getHours()).padStart(2, '0');
    const mi = String(ahora.getMinutes()).padStart(2, '0');
    const ss = String(ahora.getSeconds()).padStart(2, '0');

    const fechaCargaClarion = convertirFechaAClarion(`${yyyy}-${mm}-${dd}`);
    const horaCargaClarion = convertirHoraAClarion(`${hh}:${mi}:${ss}`);
    const fechaControlClarion = convertirFechaAClarion(data.fechaControl);
    const horaControlClarion = convertirHoraAClarion(data.horaControl + ':00');

    // ✅ COMPATIBILIDAD CLARION: Usar 0 en lugar de NULL para numéricos, "" para strings
    const sql = `
        INSERT INTO dbo.imInterCtrlFrecuente (
            NumeroVisita, FechaCarga, HoraCarga, OperadorCarga, Profesional,
            FechaControl, HoraControl,
            Pulso, Maximo, Minimo, FrecuenciaRespiratoria,
            Axilar, Rectal, Hgt, PAMedia, Saturometria,
            Peso, Talla, IdSector, IdTurno, Nroindicacion,
            Observaciones, IdHci
        )
        OUTPUT INSERTED.Valor
        VALUES (
            @param0, @param1, @param2, @param3, @param4,
            @param5, @param6,
            @param7, @param8, @param9, @param10,
            @param11, @param12, @param13, @param14, @param15,
            @param16, @param17, @param18, @param19, @param20,
            @param21, @param22
        )
    `;

    const params = [
        { value: data.numeroVisita },                                       // @param0
        { value: fechaCargaClarion },                                       // @param1
        { value: horaCargaClarion },                                        // @param2
        { value: data.operadorCarga || 0 },                                 // @param3
        { value: data.operadorCarga || 0 },                                 // @param4 (Profesional = OperadorCarga)
        { value: fechaControlClarion },                                     // @param5
        { value: horaControlClarion },                                      // @param6
        { value: data.pulso || 0 },                                         // @param7
        { value: data.presionMax || 0 },                                    // @param8
        { value: data.presionMin || 0 },                                    // @param9
        { value: data.frecuenciaRespiratoria || 0 },                        // @param10
        { value: data.temperaturaAxilar || 0 },                             // @param11
        { value: data.temperaturaRectal || 0 },                             // @param12
        { value: data.glucemia ? String(data.glucemia) : '0' },             // @param13 (Hgt es varchar)
        { value: data.presionMedia || 0 },                                  // @param14
        { value: data.saturacion || 0 },                                    // @param15
        { value: 0 },                                                       // @param16 Peso
        { value: 0 },                                                       // @param17 Talla
        { value: data.idSector || '' },                                     // @param18
        { value: 0 },                                                       // @param19 IdTurno
        { value: 0 },                                                       // @param20 Nroindicacion
        { value: data.observaciones || '' },                                // @param21
        { value: data.idHci || 0 },                                         // @param22 IdHci (0 = no viene de HC)
    ];

    try {
        const resultado = await executeQuery(sql, params);
        console.log('✅ Control frecuente creado:', resultado[0]?.Valor, data.idHci ? `(desde HC ${data.idHci})` : '');
        return resultado[0];
    } catch (error) {
        console.error("Error al crear control frecuente:", error);
        throw error;
    }
};

module.exports = {
    obtenerControlesPorVisitaYFecha,
    obtenerControlPorId,
    eliminarControl,
    crearControl,
};
