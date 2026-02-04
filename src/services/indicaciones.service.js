const { executeQuery } = require("../models/db");
const {
    convertirFechaAClarion,
    convertirHoraAClarion,
    convertirFechaClarionADate,
    convertirHoraClarionAString,
} = require("../utils/dateUtils");

const limitLength = (str, max) =>
    str == null ? null : str.toString().substring(0, max);

const toNumberOrNull = (v) =>
    v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

const toBitOrNull = (v) => (v == null ? null : v ? 1 : 0);
// ✅ Helper para obtener fecha local sin problemas de zona horaria
const getLocalDateString = (date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

// ✅ Helper para obtener hora local en formato HH:mm
const getLocalTimeString = (date) => {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
};

/**
 * Convierte fecha y hora Clarion a objeto Date JavaScript usando utilidades existentes
 * @param {number} fechaClarion - Fecha en formato Clarion (días desde 28/12/1800)
 * @param {number} horaClarion - Hora en formato Clarion TIME (milisegundos/10 + 1)
 * @returns {Date} Objeto Date
 */
const convertirClarionADateCompleto = (fechaClarion, horaClarion) => {
    // Usar utilidad existente para convertir fecha
    const fecha = convertirFechaClarionADate(fechaClarion);
    if (!fecha) return null;
    
    // Agregar hora si existe usando utilidad existente
    if (horaClarion && horaClarion > 0) {
        const horaStr = convertirHoraClarionAString(horaClarion);
        if (horaStr) {
            const [horas, minutos, segundos] = horaStr.split(':').map(Number);
            fecha.setHours(horas, minutos, segundos, 0);
        }
    }
    
    return fecha;
};

/**
 * Calcula la próxima fecha/hora de aplicación basándose en la última aplicación y frecuencia
 * @param {number} fechaCumplido - Fecha Clarion de última aplicación
 * @param {number} horaCumplido - Hora Clarion de última aplicación
 * @param {number} intervaloMinutos - Intervalo en minutos desde imFrecuenciasAdmin
 * @returns {Object} { fechaProximo, horaProximo } en formato Clarion
 */
const calcularProximaAplicacion = (fechaCumplido, horaCumplido, intervaloMinutos) => {
    if (!fechaCumplido || fechaCumplido <= 0 || !intervaloMinutos || intervaloMinutos <= 0) {
        return { fechaProximo: null, horaProximo: null };
    }
    
    // ✅ CORREGIDO: Usar función actualizada con utilidades correctas
    const fechaBase = convertirClarionADateCompleto(fechaCumplido, horaCumplido);
    if (!fechaBase) {
        return { fechaProximo: null, horaProximo: null };
    }
    
    // Sumar intervalo en minutos
    const proximaFecha = new Date(fechaBase.getTime() + (intervaloMinutos * 60 * 1000));
    
    // Convertir de vuelta a formato Clarion usando utilidades existentes
    const fechaProximo = convertirFechaAClarion(getLocalDateString(proximaFecha));
    const horaProximo = convertirHoraAClarion(getLocalTimeString(proximaFecha) + ':00');
    
    return { fechaProximo, horaProximo };
};

/**
 * Obtiene el intervalo en minutos para una frecuencia dada
 * @param {string} frecuencia - Código de frecuencia
 * @returns {Promise<number|null>} Intervalo en minutos o null
 */
const obtenerIntervaloFrecuencia = async (frecuencia) => {
    if (!frecuencia) return null;
    
    try {
        // ✅ NUEVO: Primero intentar interpretar frecuencias textuales comunes
        const frecuenciaUpper = frecuencia.toUpperCase().trim();
        
        // Patrón especial: "POR UNICA VEZ" o "UNICA VEZ" (sin intervalo)
        if (frecuenciaUpper.includes('UNICA VEZ') || frecuenciaUpper.includes('ÚNICA VEZ') || frecuenciaUpper.includes('POR UNICA')) {
            console.log(`[FRECUENCIA] "${frecuencia}" es de única vez - NO tiene intervalo`);
            return null;
        }
        
        // Patrón especial: "CADA HORA" (sin número)
        if (frecuenciaUpper === 'CADA HORA' || frecuenciaUpper === 'C/HORA' || frecuenciaUpper === 'C/ HORA') {
            console.log(`[FRECUENCIA] "${frecuencia}" interpretado como cada hora = 60 minutos`);
            return 60;
        }
        
        // Patrón: "X VECES P/DIA" o "X VECES POR DIA"
        const vecesMatch = frecuenciaUpper.match(/(\d+)\s*VECES?\s*(P\/DIA|POR\s*DIA|P\/D)/);
        if (vecesMatch) {
            const veces = parseInt(vecesMatch[1]);
            // X veces por día = 24 horas / X veces = intervalo en horas
            const intervaloHoras = 24 / veces;
            const intervaloMinutos = Math.round(intervaloHoras * 60);
            console.log(`[FRECUENCIA] "${frecuencia}" interpretado como ${veces} veces/día = ${intervaloMinutos} minutos`);
            return intervaloMinutos;
        }
        
        // Patrón: "CADA X HS" o "CADA X HORAS"
        const horasMatch = frecuenciaUpper.match(/CADA\s*(\d+)\s*(HS|HORAS?)/);
        if (horasMatch) {
            const horas = parseInt(horasMatch[1]);
            const intervaloMinutos = horas * 60;
            console.log(`[FRECUENCIA] "${frecuencia}" interpretado como cada ${horas} horas = ${intervaloMinutos} minutos`);
            return intervaloMinutos;
        }
        
        // Patrón: "CADA X MIN" o "CADA X MINUTOS"
        const minutosMatch = frecuenciaUpper.match(/CADA\s*(\d+)\s*(MIN|MINUTOS?)/);
        if (minutosMatch) {
            const minutos = parseInt(minutosMatch[1]);
            console.log(`[FRECUENCIA] "${frecuencia}" interpretado como cada ${minutos} minutos`);
            return minutos;
        }
        
        // Si no coincide con patrones textuales, buscar en la tabla
        const result = await executeQuery(
            'SELECT Intervalo FROM imFrecuenciasAdmin WHERE Valor = @p0',
            [{ value: frecuencia }]
        );
        
        if (result && result[0] && result[0].Intervalo) {
            // El Intervalo ya está en minutos según la tabla
            return result[0].Intervalo;
        }
        
        console.warn(`[FRECUENCIA] No se pudo interpretar la frecuencia: "${frecuencia}"`);
        return null;
    } catch (error) {
        console.error('Error al obtener intervalo de frecuencia:', error);
        return null;
    }
};

/**
 * Obtener la última indicación por número de visita
 * @param {number} numeroVisita - Número de visita
 * @returns {Promise<Object>} Última indicación para la visita
 */
const obtenerUltimaIndicacionPorVisita = async (numeroVisita) => {
    const consulta = `
    SELECT TOP 1
      iim.NumeroVisita,
      iim.NroIndicacion,
      iim.NroAdicional,
      CASE
        WHEN FechaCarga IS NULL OR FechaCarga <= 0 OR FechaCarga > 2958465 THEN NULL
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaCarga - 2, '19000101'))
      END AS FechaCarga,
      CASE
        WHEN HoraCarga IS NULL OR HoraCarga < 0 OR HoraCarga > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraCarga / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraCarga,
      iim.OperadorCarga,
      pw.Apellido AS OperadorApellido,
      pw.Nombres AS OperadorNombres,
      iim.ProfesionalAsiste,
      iim.TipoIndicacion,
      tit.Tipo as TipoIndicacionCodigo,
      iim.Codigo,
      iim.Cantidad,
      iim.TipoUnidad,
      iim.Frecuencia,
      iim.Observaciones,
      CASE
        WHEN FechaExpiro IS NULL OR FechaExpiro <= 0 OR FechaExpiro > 2958465 THEN NULL
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaExpiro - 2, '19000101'))
      END AS FechaExpiro,
      CASE
        WHEN HoraExpiro IS NULL OR HoraExpiro < 0 OR HoraExpiro > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraExpiro / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraExpiro,
      iim.CantidadIndicada,
      iim.Orden,
      iim.Estado,
      iim.CantidadPorTurno,
      iim.CantidadEntregada,
      iim.ParaFechaEntrega,
      iim.FormaAdicional,
      iim.NroIndicacionAnterior,
      iim.IdSector,
      iim.AliasMedicamento,
      iim.ExcluidoDeEntrega,
      CASE 
        WHEN tit.Tipo = 'M' THEN iim.AliasMedicamento
        WHEN tit.Tipo = 'C' THEN tc.Descripcion
        WHEN tit.Tipo = 'D' THEN td.Descripcion
        WHEN tit.Tipo = 'A' THEN ca.Descripcion
        ELSE iim.AliasMedicamento
      END AS DescripcionIndicacion
    FROM dbo.imInterIndMedicas AS iim
    LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = iim.OperadorCarga
    LEFT JOIN dbo.imInterTipoIndicacion AS tit ON iim.TipoIndicacion = tit.Valor
    LEFT JOIN dbo.imInterTipoControles AS tc ON tit.Tipo = 'C' AND iim.Codigo = tc.Valor
    LEFT JOIN dbo.imTipoDieta AS td ON tit.Tipo = 'D' AND iim.Codigo = td.Valor
    LEFT JOIN dbo.imInterCtrlAsistenciales AS ca ON tit.Tipo = 'A' AND iim.Codigo = ca.Valor
    WHERE iim.NumeroVisita = @param0
    ORDER BY iim.FechaCarga DESC, iim.HoraCarga DESC, iim.NroIndicacion DESC
  `;
    const parametros = [{ value: numeroVisita }];
    try {
        return await executeQuery(consulta, parametros);
    } catch (error) {
        console.error("Error al obtener última indicación por visita:", error);
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

/**
 * Obtener las últimas N indicaciones por número de visita
 * @param {number} numeroVisita
 * @param {number} limit
 * @returns {Promise<Array>} Lista de indicaciones ordenadas por más recientes
 */
const obtenerUltimasIndicacionesPorVisita = async (numeroVisita, limit = 3) => {
    const consulta = `
    SELECT TOP (@param1)
      iim.NumeroVisita,
      iim.NroIndicacion,
      iim.NroAdicional,
      CASE
        WHEN FechaCarga IS NULL OR FechaCarga <= 0 OR FechaCarga > 2958465 THEN NULL
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaCarga - 2, '19000101'))
      END AS FechaCarga,
      CASE
        WHEN HoraCarga IS NULL OR HoraCarga < 0 OR HoraCarga > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraCarga / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraCarga,
      iim.OperadorCarga,
      pw.Apellido AS OperadorApellido,
      pw.Nombres AS OperadorNombres,
      iim.ProfesionalAsiste,
      iim.TipoIndicacion,
      tit.Tipo as TipoIndicacionCodigo,
      tit.PromptCodigo,
      iim.Codigo,
      iim.Cantidad,
      iim.TipoUnidad,
      iim.Frecuencia,
      iim.Observaciones,
      CASE
        WHEN FechaExpiro IS NULL OR FechaExpiro <= 0 OR FechaExpiro > 2958465 THEN NULL
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaExpiro - 2, '19000101'))
      END AS FechaExpiro,
      CASE
        WHEN HoraExpiro IS NULL OR HoraExpiro < 0 OR HoraExpiro > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraExpiro / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraExpiro,
      iim.CantidadIndicada,
      iim.Orden,
      iim.Estado,
      iim.CantidadPorTurno,
      iim.CantidadEntregada,
      iim.ParaFechaEntrega,
      iim.FormaAdicional,
      iim.NroIndicacionAnterior,
      iim.IdSector,
      iim.AliasMedicamento,
      iim.ExcluidoDeEntrega,
      CASE 
        WHEN tit.Tipo = 'M' THEN iim.AliasMedicamento
        WHEN tit.Tipo = 'C' THEN tc.Descripcion
        WHEN tit.Tipo = 'D' THEN td.Descripcion
        WHEN tit.Tipo = 'A' THEN ca.Descripcion
        ELSE iim.AliasMedicamento
      END AS DescripcionIndicacion
    FROM dbo.imInterIndMedicas AS iim
    LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = iim.OperadorCarga
    LEFT JOIN dbo.imInterTipoIndicacion AS tit ON iim.TipoIndicacion = tit.Valor
    LEFT JOIN dbo.imInterTipoControles AS tc ON tit.Tipo = 'C' AND iim.Codigo = tc.Valor
    LEFT JOIN dbo.imTipoDieta AS td ON tit.Tipo = 'D' AND iim.Codigo = td.Valor
    LEFT JOIN dbo.imInterCtrlAsistenciales AS ca ON tit.Tipo = 'A' AND iim.Codigo = ca.Valor
    WHERE iim.NumeroVisita = @param0
    ORDER BY iim.FechaCarga DESC, iim.HoraCarga DESC, iim.NroIndicacion DESC
  `;
    const parametros = [{ value: numeroVisita }, { value: limit }];
    try {
        return await executeQuery(consulta, parametros);
    } catch (error) {
        console.error(
            "Error al obtener últimas indicaciones por visita:",
            error
        );
        console.error("Parámetros:", JSON.stringify(parametros));
        throw error;
    }
};

async function getByVisitaAndDate(numeroVisita, ymdDate) {
    const sql = `
SELECT
  iim.NroIndicacion,
  iim.CantidadIndicada AS Cantidad,
  iim.ProfesionalAsiste,
  p.Nombres + ' ' + p.Apellido AS FullName,
  iim.Frecuencia,
  fa.Intervalo,
  iim.Observaciones,
  iim.Estado,
  
  -- ✅ CORREGIDO: Fechas usando epoch Clarion correcto (28/12/1800)
  -- Formato: DATEADD(day, ClarionDate, '1800-12-28')
  CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaProximo,0), '1800-12-28'), 23) AS FechaProximoISO,
  CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaRevision,0), '1800-12-28'), 23) AS FechaRevisionISO,
  CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaCarga,0), '1800-12-28'), 23) AS FechaCargaISO,
  
  -- ✅ CORREGIDO: Horas usando formato Clarion TIME (milisegundos/10 + 1)
  -- Formato: DATEADD(ms, (ClarionTIME - 1) * 10, 0)
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraProximo,0) - 1) * 10, 0), 108) AS HoraProximo,
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraRevision,0) - 1) * 10, 0), 108) AS HoraRevision,
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraCarga,0) - 1) * 10, 0), 108) AS HoraCarga,
  
  -- ✅ CORREGIDO: Última aplicación (PUNTO DE ANCLAJE) en formato ISO completo
  CASE 
    WHEN iim.FechaCumplido IS NOT NULL AND iim.FechaCumplido > 0 THEN
      CONVERT(varchar(19), 
        DATEADD(ms, (NULLIF(iim.HoraCumplido,0) - 1) * 10,
          DATEADD(day, iim.FechaCumplido, '1800-12-28')
        ), 120)
    ELSE NULL
  END AS UltimaAplicacion,
  
  -- ✅ CORREGIDO: Próxima aplicación en formato ISO completo
  CASE 
    WHEN iim.FechaProximo IS NOT NULL AND iim.FechaProximo > 0 THEN
      CONVERT(varchar(19), 
        DATEADD(ms, (NULLIF(iim.HoraProximo,0) - 1) * 10,
          DATEADD(day, iim.FechaProximo, '1800-12-28')
        ), 120)
    ELSE NULL
  END AS ProximaAplicacion,
  
  iim.IdSector,
  iim.AliasMedicamento,
  iim.Codigo,
  tit.Tipo as TipoIndicacion,
  tit.PromptCodigo,
  v.TipoMedicamento,
  
  -- Obtener descripción según el tipo de indicación
  CASE 
    WHEN tit.Tipo = 'M' THEN iim.AliasMedicamento
    WHEN tit.Tipo = 'C' THEN tc.Descripcion
    WHEN tit.Tipo = 'D' THEN td.Descripcion
    WHEN tit.Tipo = 'A' THEN ca.Descripcion
    ELSE iim.AliasMedicamento
  END AS DescripcionIndicacion
FROM dbo.imInterIndMedicas AS iim
INNER JOIN dbo.imPassword AS p ON iim.ProfesionalAsiste = p.ValorPersonal
INNER JOIN dbo.imInterTipoIndicacion AS tit ON iim.TipoIndicacion = tit.Valor
LEFT JOIN dbo.imFrecuenciasAdmin AS fa ON iim.Frecuencia = fa.Valor
LEFT JOIN dbo.imInterTipoControles AS tc ON tit.Tipo = 'C' AND iim.Codigo = tc.Valor
LEFT JOIN dbo.imTipoDieta AS td ON tit.Tipo = 'D' AND iim.Codigo = td.Valor
LEFT JOIN dbo.imInterCtrlAsistenciales AS ca ON tit.Tipo = 'A' AND iim.Codigo = ca.Valor
LEFT JOIN dbo.imVademecum AS v ON tit.Tipo = 'M' AND iim.Codigo = v.Troquel
WHERE iim.NumeroVisita = @param0
  AND iim.FechaCarga   = @param1
  AND iim.TipoIndicacion <> 9
  AND (iim.NroAdicional IS NULL OR iim.NroAdicional = 0)
  AND (tit.Tipo <> 'M' OR v.TipoMedicamento IS NULL OR v.TipoMedicamento <> 'DESC' OR ISNULL(v.NROREG1, 0) > 0)
ORDER BY iim.Orden ASC;
  `;

    const params = [
        { value: numeroVisita },
        { value: convertirFechaAClarion(ymdDate) }, // 'YYYY-MM-DD'
    ];

    const rows = await executeQuery(sql, params);

    console.log("🔍 BACKEND SQL - Total registros:", rows.length);
    if (rows.length > 0) {
        console.log("🔍 BACKEND SQL - Primer registro completo:", rows[0]);
        console.log("🔍 BACKEND SQL - PromptCodigo del primer registro:", rows[0].PromptCodigo);
        console.log("🔍 BACKEND SQL - Keys del primer registro:", Object.keys(rows[0]));
    }
    
    return rows.map((r) => ({
        id: String(r.NroIndicacion),
        cantidad: r.Cantidad,
        descripcion: r.DescripcionIndicacion,
        profesional: r.ProfesionalAsiste,
        fullName: r.FullName,
        frecuencia: r.Frecuencia,
        intervalo: r.Intervalo,
        observaciones: r.Observaciones,
        proximo: r.FechaProximoISO,
        HoraProximo: r.HoraProximo,
        anterior: r.FechaRevisionISO,
        horaAnterior: r.HoraRevision,
        vigenteDesde: r.FechaCargaISO,
        horaCarga: r.HoraCarga,
        tipo: r.TipoIndicacion,
        promptCodigo: r.PromptCodigo,
        nro: r.NroIndicacion,
        idSector: r.IdSector,
        medicamento: r.AliasMedicamento,
        // ✅ NUEVOS: Campos para cálculo de estado
        ultimaAplicacion: r.UltimaAplicacion,
        proximaAplicacion: r.ProximaAplicacion,
        estado: r.Estado,
        suspendida: r.Estado === 'S',
        // ✅ CORREGIDO: Detectar única vez por frecuencia, no por Estado
        unicaVez: r.Frecuencia && (
            r.Frecuencia.toUpperCase().includes('UNICA VEZ') || 
            r.Frecuencia.toUpperCase().includes('ÚNICA VEZ') ||
            r.Frecuencia.toUpperCase().includes('POR UNICA') ||
            r.Estado === 'U'
        ),
    }));
}

// ✅ NUEVA FUNCIÓN: Obtener solo insumos/descartables por visita y fecha
async function getInsumosByVisitaAndDate(numeroVisita, ymdDate) {
    const sql = `
SELECT
  iim.NroIndicacion,
  iim.CantidadIndicada AS Cantidad,
  iim.ProfesionalAsiste,
  p.Nombres + ' ' + p.Apellido AS FullName,
  iim.Observaciones,
  
  CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaCarga,0), '1800-12-28'), 23) AS FechaCargaISO,
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraCarga,0) - 1) * 10, 0), 108) AS HoraCarga,
  
  iim.IdSector,
  iim.AliasMedicamento,
  iim.Codigo,
  tit.Tipo as TipoIndicacion,
  v.TipoMedicamento,
  COALESCE(v.Alias, v.Descripcion, iim.AliasMedicamento) AS DescripcionIndicacion
FROM dbo.imInterIndMedicas AS iim
INNER JOIN dbo.imPassword AS p ON iim.ProfesionalAsiste = p.ValorPersonal
INNER JOIN dbo.imInterTipoIndicacion AS tit ON iim.TipoIndicacion = tit.Valor
INNER JOIN dbo.imVademecum AS v ON iim.Codigo = v.Troquel
WHERE iim.NumeroVisita = @param0
  AND iim.FechaCarga   = @param1
  AND iim.TipoIndicacion = 9
  AND (iim.NroAdicional IS NULL OR iim.NroAdicional = 0)
ORDER BY iim.Orden ASC;
  `;

    const params = [
        { value: numeroVisita },
        { value: convertirFechaAClarion(ymdDate) },
    ];

    const rows = await executeQuery(sql, params);
    
    return rows.map((r) => ({
        id: String(r.NroIndicacion),
        cantidad: r.Cantidad,
        descripcion: r.DescripcionIndicacion,
        profesional: r.ProfesionalAsiste,
        fullName: r.FullName,
        observaciones: r.Observaciones,
        vigenteDesde: r.FechaCargaISO,
        horaCarga: r.HoraCarga,
        tipo: r.TipoIndicacion,
        nro: r.NroIndicacion,
        idSector: r.IdSector,
        medicamento: r.AliasMedicamento,
        tipoMedicamento: r.TipoMedicamento,
    }));
}

/**
 * Obtener datos para el formulario de creación de indicaciones
 * @returns {Promise<Object>} Objeto con todos los catálogos necesarios
 */
const obtenerDatosFormulario = async () => {
    try {
        // Consultar todas las tablas en paralelo para mejor rendimiento
        const [
            tiposIndicacion,
            vademecum,
            tiposDieta,
            tiposControles,
            controlesAsistenciales,
            unidadesMedida,
            frecuenciasAdmin,
        ] = await Promise.all([
            // imInterTipoIndicacion - Tipos de indicaciones
            executeQuery(`
				SELECT
					Valor,
					Descripcion,
					Tipo,
					Orden as OrdenMedicacion
				FROM imInterTipoIndicacion
				ORDER BY Descripcion
			`),

            // // imVademecum - Medicamentos
            executeQuery(`
				SELECT
					Troquel as Valor,
					Alias as Nombre,
					Descripcion,
					TipoMedicamento
				FROM imVademecum
				WHERE Alias <> ''
				ORDER BY Nombre
			`),

            // // imTipoDieta - Tipos de dieta
            executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imTipoDieta
				ORDER BY Descripcion
			`),

            // // imInterTipoControles - Tipos de controles
            executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imInterTipoControles
				ORDER BY Descripcion
			`),

            // // imInterCtrlAsistenciales - Controles asistenciales
            executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imInterCtrlAsistenciales
				ORDER BY Descripcion
			`),

            // // imTipoUnidadMedida - Unidades de medida
            executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imTipoUnidadMedida
				ORDER BY Descripcion
			`),

            // // imFrecuenciasAdmin - Frecuencias de administración
            executeQuery(`
				SELECT
					Valor,
					Intervalo
				FROM imFrecuenciasAdmin
			`),
        ]);

        return {
            tiposIndicacion: tiposIndicacion || [],
            vademecum: vademecum || [],
            tiposDieta: tiposDieta || [],
            tiposControles: tiposControles || [],
            controlesAsistenciales: controlesAsistenciales || [],
            unidadesMedida: unidadesMedida || [],
            frecuenciasAdmin: frecuenciasAdmin || [],
        };
    } catch (error) {
        console.error("Error al obtener datos del formulario:", error);
        throw error;
    }
};

//Crear - Insertar nueva indicación

const nuevaIndicacion = async (data) => {
    const sd = {
        NumeroVisita: toNumberOrNull(data.NumeroVisita),
        NroAdicional: toNumberOrNull(data.NroAdicional),

        FechaCarga: data.FechaCarga
            ? convertirFechaAClarion(data.FechaCarga)
            : null,
        HoraCarga: data.HoraCarga
            ? convertirHoraAClarion(data.HoraCarga)
            : null,
        OperadorCarga: toNumberOrNull(data.OperadorCarga),
        ProfesionalAsiste: toNumberOrNull(data.ProfesionalAsiste),

        // ✅ NUEVO: Al crear una indicación, estos campos deben estar vacíos
        // Se calcularán automáticamente cuando se aplique la indicación por primera vez
        FechaCumplido: null,
        HoraCumplido: null,
        FechaProximo: null,
        HoraProximo: null,
        FechaRevision: null,
        HoraRevision: null,

        TipoIndicacion: toNumberOrNull(data.TipoIndicacion),
        Codigo: toNumberOrNull(data.Codigo),

        Cantidad: data.Cantidad == null ? null : Number(data.Cantidad),
        TipoUnidad: limitLength(data.TipoUnidad, 5), // char(5)
        Frecuencia: limitLength(data.Frecuencia, 20), // varchar(20)
        Observaciones: limitLength(data.Observaciones, 255), // varchar(255)
        FechaExpiro: data?.FechaExpiro === 0 ? 0 : convertirFechaAClarion(data.FechaExpiro),
        HoraExpiro: data.HoraExpiro
            ? convertirHoraAClarion(data.HoraExpiro)
            : null,

        CantidadIndicada:
            data.CantidadIndicada == null
                ? null
                : Number(data.CantidadIndicada),
        Orden: toNumberOrNull(data.Orden),
        Estado: limitLength(data.Estado, 1), // char(1)
        CantidadPorTurno:
            data.CantidadPorTurno == null
                ? null
                : Number(data.CantidadPorTurno),
        CantidadEntregada:
            data.CantidadEntregada == null
                ? null
                : Number(data.CantidadEntregada),

        // ÚNICA date real en SQL:
        ParaFechaEntrega: data.ParaFechaEntrega || null, // 'YYYY-MM-DD' recomendado

        FormaAdicional: limitLength(data.FormaAdicional, 15),
        NroIndicacionAnterior: toNumberOrNull(data.NroIndicacionAnterior),
        IdSector: limitLength(data.IdSector, 4),
        AliasMedicamento: limitLength(data.AliasMedicamento, 50),
        ExcluidoDeEntrega: toBitOrNull(data.ExcluidoDeEntrega), // bit
    };

    // 2) SQL paramétrico (mismo patrón que crearPaciente)
    const insert = `
    INSERT INTO dbo.imInterIndMedicas (
      NumeroVisita, NroAdicional, FechaCarga, HoraCarga, OperadorCarga, ProfesionalAsiste,
      FechaCumplido, HoraCumplido, FechaProximo, HoraProximo, FechaRevision, HoraRevision,
      TipoIndicacion, Codigo, Cantidad, TipoUnidad, Frecuencia, Observaciones,
      FechaExpiro, HoraExpiro, CantidadIndicada, Orden, Estado, CantidadPorTurno,
      CantidadEntregada, ParaFechaEntrega, FormaAdicional, NroIndicacionAnterior,
      IdSector, AliasMedicamento, ExcluidoDeEntrega
    ) VALUES (
      @p0,@p1,@p2,@p3,@p4,@p5,
      @p6,@p7,@p8,@p9,@p10,@p11,
      @p12,@p13,@p14,@p15,@p16,@p17,
      @p18,@p19,@p20,@p21,@p22,@p23,
      @p24,@p25,@p26,@p27,@p28,@p29,@p30
    );
    SELECT
      NroIndicacion, NumeroVisita, NroAdicional, TipoIndicacion, Codigo,
      Cantidad, TipoUnidad, Frecuencia, Observaciones, CantidadIndicada, Orden,
      Estado, CantidadPorTurno, CantidadEntregada, ParaFechaEntrega,
      FormaAdicional, NroIndicacionAnterior, IdSector, AliasMedicamento, ExcluidoDeEntrega,

      -- Helpers para ver legible las Clarion dates/times (opcionales en la respuesta)
      CONVERT(varchar(10), DATEADD(day, NULLIF(FechaCarga,0), '1800-12-28'), 23)  AS FechaCargaISO,
      CONVERT(varchar(8),  DATEADD(ms, (NULLIF(HoraCarga,0) - 1) * 10, 0), 108)       AS HoraCargaISO,
      CONVERT(varchar(10), DATEADD(day, NULLIF(FechaCumplido,0), '1800-12-28'), 23) AS FechaCumplidoISO,
      CONVERT(varchar(8),  DATEADD(ms, (NULLIF(HoraCumplido,0) - 1) * 10, 0), 108)      AS HoraCumplidoISO,
      CONVERT(varchar(10), DATEADD(day, NULLIF(FechaProximo,0), '1800-12-28'), 23)  AS FechaProximoISO,
      CONVERT(varchar(8),  DATEADD(ms, (NULLIF(HoraProximo,0) - 1) * 10, 0), 108)       AS HoraProximoISO,
      CONVERT(varchar(10), DATEADD(day, NULLIF(FechaRevision,0), '1800-12-28'), 23) AS FechaRevisionISO,
      CONVERT(varchar(8),  DATEADD(ms, (NULLIF(HoraRevision,0) - 1) * 10, 0), 108)      AS HoraRevisionISO,
      CONVERT(varchar(10), DATEADD(day, NULLIF(FechaExpiro,0), '1800-12-28'), 23)   AS FechaExpiroISO,
      CONVERT(varchar(8),  DATEADD(ms, (NULLIF(HoraExpiro,0) - 1) * 10, 0), 108)        AS HoraExpiroISO
    FROM dbo.imInterIndMedicas
    WHERE NroIndicacion = SCOPE_IDENTITY();
  `;

    const params = [
        { value: sd.NumeroVisita }, // @p0
        { value: 0 }, // @p1
        { value: sd.FechaCarga }, // @p2 (Clarion DATE)
        { value: sd.HoraCarga }, // @p3 (Clarion TIME)
        { value: sd.OperadorCarga }, // @p4
        { value: sd.ProfesionalAsiste }, // @p5
        { value: sd.FechaCumplido }, // @p6
        { value: sd.HoraCumplido }, // @p7
        { value: sd.FechaProximo }, // @p8
        { value: sd.HoraProximo }, // @p9
        { value: sd.FechaRevision }, // @p10
        { value: sd.HoraRevision }, // @p11
        { value: sd.TipoIndicacion }, // @p12
        { value: sd.Codigo }, // @p13
        { value: sd.Cantidad }, // @p14 (real)
        { value: sd.TipoUnidad }, // @p15 char(5)
        { value: sd.Frecuencia }, // @p16 varchar(20)
        { value: sd.Observaciones }, // @p17 varchar(255)
        { value: sd.FechaExpiro }, // @p18
        { value: sd.HoraExpiro }, // @p19
        { value: sd.CantidadIndicada }, // @p20 (real)
        { value: sd.Orden }, // @p21 smallint
        { value: sd.Estado }, // @p22 char(1)
        { value: sd.CantidadPorTurno }, // @p23 (real)
        { value: sd.CantidadEntregada }, // @p24 (real)
        { value: sd.ParaFechaEntrega }, // @p25 date
        { value: sd.FormaAdicional }, // @p26 varchar(15)
        { value: sd.NroIndicacionAnterior }, // @p27
        { value: sd.IdSector }, // @p28 varchar(4)
        { value: sd.AliasMedicamento }, // @p29 varchar(50)
        { value: sd.ExcluidoDeEntrega }, // @p30 bit
    ];

    try {
        console.log("[EJECUTANDO INSERT] Parámetros:", params.map((p, i) => `@p${i}: ${p.value}`));
        const [nueva] = await executeQuery(insert, params);
        console.log("[INSERT EXITOSO] Nueva indicación:", nueva);
        return nueva; // incluye NroIndicacion y los campos ISO auxiliares
    } catch (error) {
        console.error("[ERROR EN INSERT]", error);
        console.error("[DATOS QUE CAUSARON ERROR]", sd);
        throw error;
    }
};

const deleteIndicacion = async (nroIndicacion) => {
    const sql = `
DELETE FROM imInterIndMedicas
WHERE NroIndicacion = @param0
`;
    const params = [{ value: nroIndicacion }];
    await executeQuery(sql, params);
};

const getIndicacionById = async (nroIndicacion) => {
    const sql = `
SELECT 
    iim.NroIndicacion,
    iim.NumeroVisita,
    iim.NroAdicional,
    CONVERT(varchar(10), DATEADD(DAY, CAST(iim.FechaCarga AS int), '1800-12-28'), 23) AS FechaCarga,
    CONVERT(varchar(8), DATEADD(SECOND, iim.HoraCarga / 100, '00:00:00'), 108) AS HoraCarga,    
    iim.OperadorCarga,
    iim.ProfesionalAsiste,
    CONVERT(varchar(10), DATEADD(DAY, iim.FechaCumplido, '1800-12-28'), 23) AS FechaCumplido,
    CONVERT(varchar(8), DATEADD(SECOND, iim.HoraCumplido / 100, '00:00:00'), 108) AS HoraCumplido, 
   
    CONVERT(varchar(10), DATEADD(DAY, iim.FechaProximo, '1800-12-28'), 23) AS FechaProximo,
    CONVERT(varchar(8), DATEADD(SECOND, iim.HoraProximo / 100, '00:00:00'), 108) AS HoraProximo,    

    CONVERT(varchar(10), DATEADD(DAY, iim.FechaRevision, '1800-12-28'), 23) AS FechaRevision,
    CONVERT(varchar(8), DATEADD(SECOND, iim.HoraRevision / 100, '00:00:00'), 108) AS HoraRevision,  
    iim.TipoIndicacion,
    tit.Tipo as TipoIndicacionCodigo,
    iim.Codigo,
    iim.CantidadIndicada,
    iim.TipoUnidad,
    iim.Frecuencia,
    fa.Intervalo as Intervalo,      
    iim.Cantidad,
    iim.Observaciones,
    iim.FechaExpiro,     
    iim.HoraExpiro,       
    iim.Orden,
    iim.Estado,
    iim.CantidadPorTurno,
    iim.CantidadEntregada,
    iim.ParaFechaEntrega,
    iim.FormaAdicional,
    iim.NroIndicacionAnterior,
    iim.IdSector,
    iim.AliasMedicamento,
    iim.ExcluidoDeEntrega,
    CASE 
        WHEN tit.Tipo = 'M' THEN iim.AliasMedicamento
        WHEN tit.Tipo = 'C' THEN tc.Descripcion
        WHEN tit.Tipo = 'D' THEN td.Descripcion
        WHEN tit.Tipo = 'A' THEN ca.Descripcion
        ELSE iim.AliasMedicamento
    END AS DescripcionIndicacion
FROM imInterIndMedicas iim
LEFT JOIN imFrecuenciasAdmin fa ON iim.Frecuencia = fa.Valor
LEFT JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
LEFT JOIN imInterTipoControles tc ON tit.Tipo = 'C' AND iim.Codigo = tc.Valor
LEFT JOIN imTipoDieta td ON tit.Tipo = 'D' AND iim.Codigo = td.Valor
LEFT JOIN imInterCtrlAsistenciales ca ON tit.Tipo = 'A' AND iim.Codigo = ca.Valor
WHERE iim.NroIndicacion = @param0
`;
    const params = [{ value: nroIndicacion }];
    const rows = await executeQuery(sql, params);
    return rows[0] || null;
};

const updateIndicacion = async (nroIndicacion, data) => {
    const sd = {
        // ===== mismos campos que en nuevaIndicacion =====
        NumeroVisita: toNumberOrNull(data.NumeroVisita),
        NroAdicional: toNumberOrNull(data.NroAdicional),

        FechaCarga: data.FechaCarga
            ? convertirFechaAClarion(data.FechaCarga)
            : null,
        HoraCarga: data.HoraCarga
            ? convertirHoraAClarion(data.HoraCarga)
            : null,
        OperadorCarga: toNumberOrNull(data.OperadorCarga),
        ProfesionalAsiste: toNumberOrNull(data.ProfesionalAsiste),

        FechaCumplido: data.FechaCumplido
            ? convertirFechaAClarion(data.FechaCumplido)
            : null,
        HoraCumplido: data.HoraCumplido
            ? convertirHoraAClarion(data.HoraCumplido)
            : null,
        FechaProximo: data.FechaProximo
            ? convertirFechaAClarion(data.FechaProximo)
            : null,
        HoraProximo: data.HoraProximo
            ? convertirHoraAClarion(data.HoraProximo)
            : null,
        FechaRevision: data.FechaRevision
            ? convertirFechaAClarion(data.FechaRevision)
            : null,
        HoraRevision: data.HoraRevision
            ? convertirHoraAClarion(data.HoraRevision)
            : null,

        TipoIndicacion: toNumberOrNull(data.TipoIndicacion),
        Codigo: toNumberOrNull(data.Codigo),

        Cantidad: data.Cantidad == null ? null : Number(data.Cantidad),
        TipoUnidad: limitLength(data.TipoUnidad, 5), // char(5)
        Frecuencia: limitLength(data.Frecuencia, 20), // varchar(20)
        Observaciones: limitLength(data.Observaciones, 255), // varchar(255)

        FechaExpiro: data.FechaExpiro
            ? convertirFechaAClarion(data.FechaExpiro)
            : null,
        HoraExpiro: data.HoraExpiro
            ? convertirHoraAClarion(data.HoraExpiro)
            : null,

        CantidadIndicada:
            data.CantidadIndicada == null
                ? null
                : Number(data.CantidadIndicada),
        Orden: toNumberOrNull(data.Orden), // smallint
        Estado: limitLength(data.Estado, 1), // char(1)
        CantidadPorTurno:
            data.CantidadPorTurno == null
                ? null
                : Number(data.CantidadPorTurno),
        CantidadEntregada:
            data.CantidadEntregada == null
                ? null
                : Number(data.CantidadEntregada),

        // En tu INSERT, ParaFechaEntrega se guarda como DATE (YYYY-MM-DD)
        ParaFechaEntrega: data.ParaFechaEntrega || null,

        FormaAdicional: limitLength(data.FormaAdicional, 15),
        NroIndicacionAnterior: toNumberOrNull(data.NroIndicacionAnterior),
        IdSector: limitLength(data.IdSector, 4),
        AliasMedicamento: limitLength(data.AliasMedicamento, 50),
        ExcluidoDeEntrega: toBitOrNull(data.ExcluidoDeEntrega), // bit
    };

    const sql = `
UPDATE imInterIndMedicas
SET
  NumeroVisita        = @p0,
  NroAdicional        = @p1,
  FechaCarga          = @p2,
  HoraCarga           = @p3,
  OperadorCarga       = @p4,
  ProfesionalAsiste   = @p5,

  FechaCumplido       = @p6,
  HoraCumplido        = @p7,
  FechaProximo        = @p8,
  HoraProximo         = @p9,
  FechaRevision       = @p10,
  HoraRevision        = @p11,

  TipoIndicacion      = @p12,
  Codigo              = @p13,
  Cantidad            = @p14,
  TipoUnidad          = @p15,
  Frecuencia          = @p16,
  Observaciones       = @p17,

  FechaExpiro         = @p18,
  HoraExpiro          = @p19,

  CantidadIndicada    = @p20,
  Orden               = @p21,
  Estado              = @p22,
  CantidadPorTurno    = @p23,
  CantidadEntregada   = @p24,

  ParaFechaEntrega    = @p25,
  FormaAdicional      = @p26,
  NroIndicacionAnterior = @p27,
  IdSector            = @p28,
  AliasMedicamento    = @p29,
  ExcluidoDeEntrega   = @p30
WHERE NroIndicacion = @p31
`;

    const params = [
        { value: sd.NumeroVisita }, // @p0
        { value: sd.NroAdicional }, // @p1
        { value: sd.FechaCarga }, // @p2  (Clarion DATE)
        { value: sd.HoraCarga }, // @p3  (Clarion TIME)
        { value: sd.OperadorCarga }, // @p4
        { value: sd.ProfesionalAsiste }, // @p5

        { value: sd.FechaCumplido }, // @p6
        { value: sd.HoraCumplido }, // @p7
        { value: sd.FechaProximo }, // @p8
        { value: sd.HoraProximo }, // @p9
        { value: sd.FechaRevision }, // @p10
        { value: sd.HoraRevision }, // @p11

        { value: sd.TipoIndicacion }, // @p12
        { value: sd.Codigo }, // @p13
        { value: sd.Cantidad }, // @p14 (real)
        { value: sd.TipoUnidad }, // @p15 char(5)
        { value: sd.Frecuencia }, // @p16 varchar(20)
        { value: sd.Observaciones }, // @p17 varchar(255)

        { value: sd.FechaExpiro }, // @p18
        { value: sd.HoraExpiro }, // @p19

        { value: sd.CantidadIndicada }, // @p20 (real)
        { value: sd.Orden }, // @p21 smallint
        { value: sd.Estado }, // @p22 char(1)
        { value: sd.CantidadPorTurno }, // @p23 (real)
        { value: sd.CantidadEntregada }, // @p24 (real)

        { value: sd.ParaFechaEntrega }, // @p25 date (YYYY-MM-DD)
        { value: sd.FormaAdicional }, // @p26 varchar(15)
        { value: sd.NroIndicacionAnterior }, // @p27
        { value: sd.IdSector }, // @p28 varchar(4)
        { value: sd.AliasMedicamento }, // @p29 varchar(50)
        { value: sd.ExcluidoDeEntrega }, // @p30 bit

        { value: nroIndicacion }, // @p31 WHERE
    ];

    await executeQuery(sql, params);
    // Devuelve el registro actualizado con el mismo selector que ya usas:
    return getIndicacionById(nroIndicacion);
};

const aplicarIndicacion = async (nroIndicacion, data) => {

    try {
        // ✅ NUEVO: Obtener la indicación actual para conocer su frecuencia
        const indicacionActual = await getIndicacionById(nroIndicacion);
        if (!indicacionActual) {
            throw new Error('Indicación no encontrada');
        }

        // ✅ NUEVO: Detectar si es única vez por frecuencia
        const frecuenciaUpper = indicacionActual.Frecuencia ? indicacionActual.Frecuencia.toUpperCase().trim() : '';
        const esUnicaVez = indicacionActual.Estado === 'U' || 
                          frecuenciaUpper.includes('UNICA VEZ') || 
                          frecuenciaUpper.includes('ÚNICA VEZ') ||
                          frecuenciaUpper.includes('POR UNICA');

        // ✅ NUEVO: Validar que indicaciones de única vez no se apliquen más de una vez
        if (esUnicaVez && indicacionActual.FechaCumplido && indicacionActual.FechaCumplido !== '1800-12-28') {
            throw new Error('Esta indicación es de única vez y ya fue aplicada anteriormente');
        }
        
        // ✅ NUEVO: Obtener intervalo de la frecuencia (solo si NO es única vez)
        const intervaloMinutos = esUnicaVez ? null : await obtenerIntervaloFrecuencia(indicacionActual.Frecuencia);
        
        // ✅ NUEVO: Calcular próxima aplicación automáticamente si se está aplicando
        let fechaProximoCalculada = null;
        let horaProximoCalculada = null;
        
        if (!esUnicaVez && data.fechaCumplido && data.horaCumplido && intervaloMinutos) {
            const fechaCumplidoClarion = convertirFechaAClarion(data.fechaCumplido);
            const horaCumplidoClarion = convertirHoraAClarion(data.horaCumplido);
            
            const resultado = calcularProximaAplicacion(
                fechaCumplidoClarion,
                horaCumplidoClarion,
                intervaloMinutos
            );
            
            fechaProximoCalculada = resultado.fechaProximo;
            horaProximoCalculada = resultado.horaProximo;
            
            console.log(`[APLICAR INDICACIÓN ${nroIndicacion}] Próxima aplicación calculada:`, {
                fechaCumplido: data.fechaCumplido,
                horaCumplido: data.horaCumplido,
                intervaloMinutos,
                fechaProximo: fechaProximoCalculada,
                horaProximo: horaProximoCalculada
            });
        } else if (esUnicaVez) {
            console.log(`[APLICAR INDICACIÓN ${nroIndicacion}] Es única vez - NO se calcula próxima aplicación`);
        }

        // Construir el UPDATE dinámicamente - solo campos que vienen en data
        const fieldsToUpdate = [];
        const params = [];
        let paramIndex = 0;

        // Siempre actualizar estos campos si vienen
        if (data.fechaCumplido) {
            fieldsToUpdate.push(`FechaCumplido = @p${paramIndex}`);
            params.push({ value: convertirFechaAClarion(data.fechaCumplido) });
            paramIndex++;
        }

        if (data.horaCumplido) {
            fieldsToUpdate.push(`HoraCumplido = @p${paramIndex}`);
            params.push({ value: convertirHoraAClarion(data.horaCumplido) });
            paramIndex++;
        }

        // ✅ MODIFICADO: Usar valores calculados automáticamente si existen
        if (fechaProximoCalculada !== null) {
            fieldsToUpdate.push(`FechaProximo = @p${paramIndex}`);
            params.push({ value: fechaProximoCalculada });
            paramIndex++;
        } else if (data.fechaProximo) {
            fieldsToUpdate.push(`FechaProximo = @p${paramIndex}`);
            params.push({ value: convertirFechaAClarion(data.fechaProximo) });
            paramIndex++;
        }

        if (horaProximoCalculada !== null) {
            fieldsToUpdate.push(`HoraProximo = @p${paramIndex}`);
            params.push({ value: horaProximoCalculada });
            paramIndex++;
        } else if (data.horaProximo) {
            fieldsToUpdate.push(`HoraProximo = @p${paramIndex}`);
            params.push({ value: convertirHoraAClarion(data.horaProximo) });
            paramIndex++;
        }

        // ✅ NUEVO: Actualizar FechaRevision/HoraRevision con la aplicación anterior
        if (indicacionActual.FechaCumplido && indicacionActual.FechaCumplido !== '1800-12-28') {
            fieldsToUpdate.push(`FechaRevision = @p${paramIndex}`);
            params.push({ value: convertirFechaAClarion(indicacionActual.FechaCumplido) });
            paramIndex++;
        }

        if (indicacionActual.HoraCumplido && indicacionActual.HoraCumplido !== '00:00:00') {
            fieldsToUpdate.push(`HoraRevision = @p${paramIndex}`);
            params.push({ value: convertirHoraAClarion(indicacionActual.HoraCumplido) });
            paramIndex++;
        }

        if (data.observaciones !== undefined) {
            fieldsToUpdate.push(`Observaciones = @p${paramIndex}`);
            params.push({ value: limitLength(data.observaciones, 255) });
            paramIndex++;
        }

        // Agregar campos adicionales si vienen
        if (data.profesionalAsiste) {
            fieldsToUpdate.push(`ProfesionalAsiste = @p${paramIndex}`);
            params.push({ value: toNumberOrNull(data.profesionalAsiste) });
            paramIndex++;
        }

        if (data.cantidadIndicada) {
            fieldsToUpdate.push(`CantidadIndicada = @p${paramIndex}`);
            params.push({ value: Number(data.cantidadIndicada) });
            paramIndex++;
        }

        // Solo hacer el UPDATE si hay campos para actualizar
        if (fieldsToUpdate.length === 0) {
            console.log("No hay campos para actualizar en la indicación principal");
            return;
        }

        // Agregar el WHERE al final
        params.push({ value: nroIndicacion });

        const updateIndicacion = `
        UPDATE dbo.imInterIndMedicas 
        SET ${fieldsToUpdate.join(', ')}
        WHERE NroIndicacion = @p${paramIndex}
    `;


        await executeQuery(updateIndicacion, params);
    } catch (error) {
        console.error(error);
        throw error;
    }


    const dateCarga = new Date();

    if (data.tipoIndicacion === "C") {
        const controlData = {
            NroIndicacion: nroIndicacion,
            NumeroVisita: data.numeroVisita,

            // Convertir fechas y horas a formato Clarion
            FechaCarga: data.fechaCumplido ? convertirFechaAClarion(getLocalDateString(dateCarga)) : null,
            HoraCarga: data.horaCumplido ? convertirHoraAClarion(getLocalTimeString(dateCarga)) : null,
            FechaControl: data.fechaCumplido ? convertirFechaAClarion(data.fechaCumplido) : null,
            HoraControl: data.horaCumplido ? convertirHoraAClarion(data.horaCumplido) : null,

            // Campos de control - solo incluir si tienen valor
            Pulso: data.control.pulso ? toNumberOrNull(data.control.pulso) : null,
            Maximo: data.control.presionArterialMax ? toNumberOrNull(data.control.presionArterialMax) : null,
            Minimo: data.control.presionArterialMin ? toNumberOrNull(data.control.presionArterialMin) : null,
            FrecuenciaRespiratoria: data.control.frResp ? toNumberOrNull(data.control.frResp) : null,
            Axilar: data.control.temperaturaAxilar ? parseFloat(data.control.temperaturaAxilar) : null,
            Rectal: data.control.temperaturaRectal ? parseFloat(data.control.temperaturaRectal) : null,
            Observaciones: limitLength(data.observaciones || '', 255),
            Nroindicacion: nroIndicacion, // Parece que hay dos campos similares
            Hgt: data.control.glucemia ? toNumberOrNull(data.control.glucemia) : null,
            IdSector: limitLength(data.sector || '', 4),
            PAMedia: data.control.presionArterialMedia ? parseFloat(data.control.presionArterialMedia) : null,
            Saturometria: data.control.saturometria ? toNumberOrNull(data.control.saturometria) : null,
            Peso: null, // No viene del frontend por ahora
            Talla: null, // No viene del frontend por ahora
            IdTurno: null, // Se puede calcular o venir de contexto
        };

        const insertControl = `
        INSERT INTO dbo.imInterCtrlFrecuente (
            NumeroVisita, FechaCarga, HoraCarga, FechaControl, HoraControl,
            Pulso, Maximo, Minimo, FrecuenciaRespiratoria,
            Axilar, Rectal, Observaciones, Nroindicacion,
            Hgt, IdSector, PAMedia, Saturometria, Peso, Talla, IdTurno, Profesional, OperadorCarga
        ) VALUES (
            @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7,
            @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16, @p17, @p18, @p19, @p20, @p21
        )
    `;

        const controlParams = [
            { value: controlData.NumeroVisita },
            { value: controlData.FechaCarga },
            { value: controlData.HoraCarga },
            { value: controlData.FechaControl },
            { value: controlData.HoraControl },
            { value: controlData.Pulso },
            { value: controlData.Maximo },
            { value: controlData.Minimo },
            { value: controlData.FrecuenciaRespiratoria },
            { value: controlData.Axilar },
            { value: controlData.Rectal },
            { value: controlData.Observaciones },
            { value: controlData.Nroindicacion },
            { value: controlData.Hgt },
            { value: controlData.IdSector },
            { value: controlData.PAMedia },
            { value: controlData.Saturometria },
            { value: controlData.Peso },
            { value: controlData.Talla },
            { value: controlData.IdTurno },
            { value: data.profesionalAsiste },
            { value: data.profesionalAsiste }
        ];

        try {
            await executeQuery(insertControl, controlParams);
        } catch (e) {
            console.error(e);
            throw e;
        }
    }

    if (data.tipoIndicacion === "D") {
        console.log("[DATA Dieta]", data);
        // ✅ NUEVO: Obtener el siguiente valor para el campo Valor
        const maxValorResult = await executeQuery('SELECT ISNULL(MAX(Valor), 0) + 1 AS NextValor FROM dbo.imInterCtrlDieta');
        const nextValor = maxValorResult[0]?.NextValor || 1;

        const dietaData = {
            Valor: nextValor,
            NumeroVisita: data.numeroVisita,

            // Fecha/Hora Carga (Servidor) - según tu regla
            // Solo se graba si el front envió una fecha de cumplimiento
            FechaCarga: convertirFechaAClarion(getLocalDateString(dateCarga)),
            HoraCarga: convertirHoraAClarion(getLocalTimeString(dateCarga)),

            // Fecha/Hora Dieta (Front) - según tu regla
            FechaDieta: data.fechaCumplido ? convertirFechaAClarion(data.fechaCumplido) : null,
            HoraDieta: data.horaCumplido ? convertirHoraAClarion(data.horaCumplido) : null,

            Observaciones: limitLength(data.observaciones || '', 255),
            Profesional: data.profesionalAsiste ? toNumberOrNull(data.profesionalAsiste) : null,
            OperadorCarga: data.profesionalAsiste ? toNumberOrNull(data.profesionalAsiste) : null, // Asumiendo que es el mismo profesional
            Nroindicacion: nroIndicacion,
            TipoDieta: toNumberOrNull(data.dieta.tipoDieta),
        };

        const insertDieta = `
            INSERT INTO dbo.imInterCtrlDieta (
                Valor, NumeroVisita, FechaCarga, HoraCarga, FechaDieta, HoraDieta,
                Observaciones, Profesional, OperadorCarga, Nroindicacion,
                TipoDieta
            ) VALUES (
                @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10
            )
        `;

        const dietaParams = [
            { value: dietaData.Valor },
            { value: dietaData.NumeroVisita },
            { value: dietaData.FechaCarga },
            { value: dietaData.HoraCarga },
            { value: dietaData.FechaDieta },
            { value: dietaData.HoraDieta },
            { value: dietaData.Observaciones },
            { value: dietaData.Profesional },
            { value: dietaData.OperadorCarga },
            { value: dietaData.Nroindicacion },
            { value: dietaData.TipoDieta }
        ];

        try {
            await executeQuery(insertDieta, dietaParams);
            console.log("Registro de dieta (imInterCtrlDieta) insertado correctamente.");
        } catch (e) {
            console.error("Error al insertar en imInterCtrlDieta:", e);
            throw e; // Relanzar el error para que el try/catch exterior lo maneje
        }
    }

    if (data.tipoIndicacion === "M") {
        console.log("[DATA Dieta]", data);

        const medicamentoData = {
            NumeroVisita: data.numeroVisita,
            Nroindicacion: nroIndicacion,
            Observaciones: limitLength(data.observaciones || '', 255),
            Profesional: data.profesionalAsiste,
            OperadorCarga: data.profesionalAsiste,

            //Fecha
            HoraCarga: convertirHoraAClarion(getLocalTimeString(dateCarga)),
            FechaCarga: convertirFechaAClarion(getLocalDateString(dateCarga)),
            HoraControl: convertirHoraAClarion(data.horaCumplido),
            FechaControl: convertirFechaAClarion(data.fechaCumplido),

            //Data Medicamento
            Sector: data.medicamentoCtrl.sector,
            Cantidad: data.medicamentoCtrl.Cantidad,
            CantidadIndicada: data.medicamentoCtrl.CantidadIndicada,
            TipoUnidad: data.medicamentoCtrl.TipoUnidad,
        }

        const insertMedicamento = `
        INSERT INTO dbo.imInterCtrlMedicamento (
            NumeroVisita, Nroindicacion, Observaciones, Profesional, OperadorCarga, HoraCarga, FechaCarga, HoraControl, FechaControl,
            Sector, Cantidad, CantidadIndicada, TipoUnidad
        ) Values (
            @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12
        )
        `;

        const medicamentoParams = [
            { value: medicamentoData.NumeroVisita },
            { value: medicamentoData.Nroindicacion },
            { value: medicamentoData.Observaciones },
            { value: medicamentoData.Profesional },
            { value: medicamentoData.OperadorCarga },
            { value: medicamentoData.HoraCarga },
            { value: medicamentoData.FechaCarga },
            { value: medicamentoData.HoraControl },
            { value: medicamentoData.FechaControl },
            { value: medicamentoData.Sector },
            { value: medicamentoData.Cantidad },
            { value: medicamentoData.CantidadIndicada },
            { value: medicamentoData.TipoUnidad },
        ]

        try {
            await executeQuery(insertMedicamento, medicamentoParams);
            console.log("Registro de dieta (imInterCtrlMedicamento) insertado correctamente.");
        } catch (e) {
            console.error("Error al insertar en imInterCtrlDieta:", e);
            throw e; // Relanzar el error para que el try/catch exterior lo maneje
        }
    }

    if (data.tipoIndicacion === "A") {
        console.log("[DATA Dieta]", data);

        const medidaAsistencialData = {
            Numero: 0,
            NumeroVisita: data.numeroVisita,
            ValorSector: data.medidaAsistencial.valorSector,
            CodOperador: data.profesionalAsiste,
            HoraGraba: convertirHoraAClarion(getLocalTimeString(dateCarga)),
            FechaGraba: convertirFechaAClarion(getLocalDateString(dateCarga)),
            Observaciones: limitLength(data.observaciones || '', 255),
        }

        const insertMedidaAsistencial = `
        INSERT INTO dbo.imFacPracticas (
            Numero, NumeroVisita, ValorSector, CodOperador, HoraGraba, FechaGraba, Observaciones
        ) VALUES (
            @p0, @p1, @p2, @p3, @p4, @p5, @p6
        )`

        const medidaAsistencialParams = [
            { value: medidaAsistencialData.Numero },
            { value: medidaAsistencialData.NumeroVisita },
            { value: medidaAsistencialData.ValorSector },
            { value: medidaAsistencialData.CodOperador },
            { value: medidaAsistencialData.HoraGraba },
            { value: medidaAsistencialData.FechaGraba },
            { value: medidaAsistencialData.Observaciones }
        ]


        try {
            await executeQuery(insertMedidaAsistencial, medidaAsistencialParams);
            console.log("Registro de dieta (iimFacPracticas) insertado correctamente.");
        } catch (e) {
            console.error("Error al insertar en imInterCtrlDieta:", e);
            throw e; // Relanzar el error para que el try/catch exterior lo maneje
        }
    }
}
module.exports = {
    obtenerUltimaIndicacionPorVisita,
    obtenerUltimasIndicacionesPorVisita,
    getByVisitaAndDate,
    getInsumosByVisitaAndDate,
    obtenerDatosFormulario,
    nuevaIndicacion,
    deleteIndicacion,
    getIndicacionById,
    updateIndicacion,
    aplicarIndicacion,
};
