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
  iim.NroAdicional,
  iim.CantidadIndicada AS Cantidad,
  iim.TipoUnidad,
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
  iim.FormaAdicional,
  tit.Tipo as TipoIndicacion,
  tit.PromptCodigo,
  v.TipoMedicamento,
  
  -- Obtener descripción según el tipo de indicación
  CASE 
    WHEN tit.Tipo = 'M' THEN COALESCE(v.Alias, v.Descripcion, iim.AliasMedicamento)
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
  AND (tit.Tipo <> 'M' OR v.TipoMedicamento IS NULL OR v.TipoMedicamento <> 'DESC' OR ISNULL(v.NROREG1, 0) > 0)
ORDER BY iim.NroIndicacion ASC, iim.NroAdicional ASC;
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
    
    // Agrupar indicaciones padre con sus hijas
    // IMPORTANTE: Las hijas tienen en NroAdicional el NroIndicacion del padre
    const indicacionesPadre = [];
    const indicacionesHijas = new Map(); // Map<NroIndicacion del padre, Array<Hija>>
    
    rows.forEach((r) => {
        const nroAdicional = r.NroAdicional || 0;
        
        if (nroAdicional === 0) {
            // Es una indicación padre (NroAdicional = 0 o NULL)
            indicacionesPadre.push({
                id: String(r.NroIndicacion),
                nroIndicacion: r.NroIndicacion,
                nroAdicional: r.NroAdicional,
                cantidad: r.Cantidad,
                tipoUnidad: r.TipoUnidad,
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
                ultimaAplicacion: r.UltimaAplicacion,
                proximaAplicacion: r.ProximaAplicacion,
                estado: r.Estado,
                suspendida: r.Estado === 'S',
                unicaVez: r.Frecuencia && (
                    r.Frecuencia.toUpperCase().includes('UNICA VEZ') || 
                    r.Frecuencia.toUpperCase().includes('ÚNICA VEZ') ||
                    r.Frecuencia.toUpperCase().includes('POR UNICA') ||
                    r.Estado === 'U'
                ),
                indicacionesHijas: [] // Se llenará después
            });
        } else {
            // Es una indicación hija (NroAdicional contiene el NroIndicacion del padre)
            const hija = {
                nroIndicacion: r.NroIndicacion,
                nroAdicional: r.NroAdicional,
                cantidad: r.Cantidad,
                tipoUnidad: r.TipoUnidad,
                medicamento: r.AliasMedicamento,
                descripcion: r.DescripcionIndicacion,
                observaciones: r.Observaciones,
                frecuencia: r.Frecuencia,
                formaAdicional: r.FormaAdicional,
            };
            
            // Agrupar por el NroIndicacion del padre (que está en NroAdicional de la hija)
            if (!indicacionesHijas.has(r.NroAdicional)) {
                indicacionesHijas.set(r.NroAdicional, []);
            }
            indicacionesHijas.get(r.NroAdicional).push(hija);
        }
    });
    
    // Asignar hijas a sus padres
    indicacionesPadre.forEach((padre) => {
        if (indicacionesHijas.has(padre.nroIndicacion)) {
            padre.indicacionesHijas = indicacionesHijas.get(padre.nroIndicacion);
        }
    });
    
    console.log("🔍 BACKEND - Indicaciones padre:", indicacionesPadre.length);
    console.log("🔍 BACKEND - Indicaciones con hijas:", 
        indicacionesPadre.filter(p => p.indicacionesHijas.length > 0).length);
    
    return indicacionesPadre;
}

// ✅ NUEVA FUNCIÓN: Obtener solo insumos/descartables por visita y fecha
async function getInsumosByVisitaAndDate(numeroVisita, ymdDate) {
    const sql = `
SELECT DISTINCT
  iim.NroIndicacion,
  iim.Cantidad,
  iim.Codigo,
  iim.OperadorCarga,
  p.Apellido,
  p.Nombres,
  p.Nombres + ' ' + p.Apellido AS FullName,
  iim.Observaciones,
  
  CONVERT(varchar(10), DATEADD(day, NULLIF(iim.FechaCarga,0), '1800-12-28'), 23) AS FechaCargaISO,
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(iim.HoraCarga,0) - 1) * 10, 0), 108) AS HoraCarga,
  
  iim.IdSector,
  iim.AliasMedicamento,
  tit.Tipo as TipoIndicacion,
  v.TipoMedicamento,
  COALESCE(v.Alias, v.Descripcion, iim.AliasMedicamento) AS DescripcionIndicacion,
  iim.NroAdicional,
  iim.Orden
FROM dbo.imInterIndMedicas AS iim
LEFT JOIN dbo.imPassword AS p ON p.CodOperador = iim.OperadorCarga
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
    
    console.log('🔍 BACKEND INSUMOS - Total registros:', rows.length);
    if (rows.length > 0) {
        console.log('🔍 BACKEND INSUMOS - Todos los registros:');
        rows.forEach((r, idx) => {
            console.log(`  [${idx}] NroIndicacion: ${r.NroIndicacion}, Codigo: ${r.Codigo}, Cantidad: ${r.Cantidad}, Descripcion: ${r.DescripcionIndicacion}, Profesional: ${r.ProfesionalAsiste}, NroAdicional: ${r.NroAdicional}, Orden: ${r.Orden}`);
        });
        
        // Detectar duplicados por código
        const codigosVistos = {};
        rows.forEach(r => {
            if (codigosVistos[r.Codigo]) {
                console.log(`⚠️ DUPLICADO DETECTADO - Codigo: ${r.Codigo}, NroIndicacion: ${r.NroIndicacion}`);
            }
            codigosVistos[r.Codigo] = (codigosVistos[r.Codigo] || 0) + 1;
        });
        
        console.log('🔍 BACKEND INSUMOS - Resumen de códigos:');
        Object.keys(codigosVistos).forEach(codigo => {
            console.log(`  Codigo ${codigo}: ${codigosVistos[codigo]} registro(s)`);
        });
    }
    
    return rows.map((r) => ({
        id: String(r.NroIndicacion),
        cantidad: r.Cantidad,
        codigo: r.Codigo,
        descripcion: r.DescripcionIndicacion,
        profesional: r.OperadorCarga,
        apellido: r.Apellido,
        nombres: r.Nombres,
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
    console.log('🔍 BACKEND - Recibiendo data.NroAdicional:', data.NroAdicional, 'Tipo:', typeof data.NroAdicional);
    
    // ✅ SIMPLIFICADO: Calcular automáticamente fecha y hora actual
    const ahora = new Date();
    const fechaActual = getLocalDateString(ahora);
    const horaActual = getLocalTimeString(ahora) + ':00';
    
    let horaCarga = convertirHoraAClarion(horaActual);
    
    // Si es una indicación adicional, incrementar HoraCarga para que sea única
    if (data.NroAdicional) {
        // Contar cuántas indicaciones adicionales ya existen para este padre
        const sqlContarHijas = `
            SELECT COUNT(*) as Total
            FROM imInterIndMedicas
            WHERE NroAdicional = @param0
        `;
        const contarParams = [{ value: data.NroAdicional }];
        const contarResult = await executeQuery(sqlContarHijas, contarParams);
        const cantidadExistentes = contarResult[0]?.Total || 0;
        
        // Incrementar HoraCarga según la cantidad de hijas existentes + 1
        // Cada indicación adicional tendrá un incremento de 100 (1 segundo en formato Clarion)
        horaCarga = horaCarga + ((cantidadExistentes + 1) * 100);
        
        console.log(`📝 Indicación adicional #${cantidadExistentes + 1} para padre ${data.NroAdicional}, HoraCarga incrementada a: ${horaCarga}`);
    }
    
    const nroAdicionalConvertido = toNumberOrNull(data.NroAdicional);
    console.log('🔍 BACKEND - NroAdicional recibido:', data.NroAdicional, '→ convertido:', nroAdicionalConvertido);
    
    const sd = {
        NumeroVisita: toNumberOrNull(data.NumeroVisita),
        NroAdicional: nroAdicionalConvertido,

        // ✅ SIMPLIFICADO: Usar siempre fecha/hora actual calculada en el backend
        FechaCarga: convertirFechaAClarion(fechaActual),
        HoraCarga: horaCarga,
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
        { value: sd.NroAdicional }, // @p1
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
        
        // ✅ CORREGIDO: Obtener el tipo de indicación (letra) desde la BD para saber si es Dieta, Control, etc.
        let tipoLetra = null;
        if (data.TipoIndicacion) {
            const sqlTipo = `SELECT Tipo FROM imInterTipoIndicacion WHERE Valor = @param0`;
            const tipoResult = await executeQuery(sqlTipo, [{ value: data.TipoIndicacion }]);
            tipoLetra = tipoResult[0]?.Tipo;
            
            console.log(`[TIPO INDICACION] Valor: ${data.TipoIndicacion}, Tipo: ${tipoLetra}`);
        }
        
        // ✅ NUEVO: Insertar en tablas secundarias según el tipo de indicación
        const nroIndicacion = nueva.NroIndicacion;
        const dateCarga = new Date();
        
        if (tipoLetra === "D" && data.Codigo) {
            console.log("[INSERTANDO DIETA] en imInterCtrlDieta");
            const maxValorResult = await executeQuery('SELECT ISNULL(MAX(Valor), 0) + 1 AS NextValor FROM dbo.imInterCtrlDieta');
            const nextValor = maxValorResult[0]?.NextValor || 1;
            
            const insertDieta = `
                INSERT INTO dbo.imInterCtrlDieta (
                    Valor, NumeroVisita, FechaCarga, HoraCarga,
                    Observaciones, Profesional, OperadorCarga, Nroindicacion, TipoDieta
                ) VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)
            `;
            
            await executeQuery(insertDieta, [
                { value: nextValor },
                { value: data.NumeroVisita },
                { value: convertirFechaAClarion(getLocalDateString(dateCarga)) },
                { value: convertirHoraAClarion(getLocalTimeString(dateCarga) + ':00') },
                { value: limitLength(data.Observaciones || '', 255) },
                { value: data.ProfesionalAsiste },
                { value: data.OperadorCarga },
                { value: nroIndicacion },
                { value: data.Codigo }
            ]);
            console.log("[DIETA INSERTADA] correctamente");
        }
        
        return nueva; // incluye NroIndicacion y los campos ISO auxiliares
    } catch (error) {
        console.error("[ERROR EN INSERT]", error);
        console.error("[DATOS QUE CAUSARON ERROR]", sd);
        throw error;
    }
};

const deleteIndicacion = async (nroIndicacion) => {
    // Verificar que no sea una indicación padre con hijas
    const checkHijas = `
SELECT COUNT(*) as CantidadHijas
FROM imInterIndMedicas
WHERE NroAdicional = @param0
`;
    const checkParams = [{ value: nroIndicacion }];
    const result = await executeQuery(checkHijas, checkParams);
    
    if (result[0].CantidadHijas > 0) {
        throw new Error('No se puede eliminar una indicación padre que tiene indicaciones hijas. Elimine primero las hijas.');
    }
    
    const sql = `
DELETE FROM imInterIndMedicas
WHERE NroIndicacion = @param0
`;
    const params = [{ value: nroIndicacion }];
    await executeQuery(sql, params);
};

const crearIndicacionHija = async (data) => {
    // Validar que la indicación padre existe y es realmente un padre
    const sqlValidarPadre = `
SELECT NroIndicacion, NumeroVisita, NroAdicional, IdSector
FROM imInterIndMedicas
WHERE NroIndicacion = @param0
  AND (NroAdicional IS NULL OR NroAdicional = 0)
`;
    const validarParams = [{ value: data.nroIndicacionPadre }];
    const padreRows = await executeQuery(sqlValidarPadre, validarParams);
    
    if (padreRows.length === 0) {
        throw new Error('La indicación padre no existe o no es una indicación padre válida');
    }
    
    const padre = padreRows[0];
    
    // Obtener próximo NroIndicacion
    const sqlProximoNro = `
SELECT ISNULL(MAX(NroIndicacion), 0) + 1 AS ProximoNro
FROM imInterIndMedicas
`;
    const proximoRows = await executeQuery(sqlProximoNro, []);
    const proximoNro = proximoRows[0].ProximoNro;
    
    // Preparar datos para inserción
    const ahora = new Date();
    const fechaCarga = convertirFechaAClarion(getLocalDateString(ahora));
    const horaCarga = convertirHoraAClarion(ahora.toTimeString().slice(0, 8));
    
    const sd = {
        NroIndicacion: proximoNro,
        NumeroVisita: padre.NumeroVisita,
        NroAdicional: data.nroIndicacionPadre, // Clave: NroAdicional = NroIndicacion del padre
        FechaCarga: fechaCarga,
        HoraCarga: horaCarga,
        OperadorCarga: toNumberOrNull(data.operadorCarga),
        ProfesionalAsiste: toNumberOrNull(data.profesionalAsiste),
        TipoIndicacion: toNumberOrNull(data.tipoIndicacion),
        Codigo: toNumberOrNull(data.codigo),
        CantidadIndicada: data.cantidadIndicada == null ? null : Number(data.cantidadIndicada),
        TipoUnidad: limitLength(data.tipoUnidad, 5),
        Frecuencia: limitLength(data.frecuencia, 20),
        Observaciones: limitLength(data.observaciones, 255),
        IdSector: padre.IdSector, // Mismo sector que el padre
        Estado: null,
        Cantidad: data.cantidadIndicada, // Por ahora igual a CantidadIndicada
        AliasMedicamento: limitLength(data.aliasMedicamento, 255),
    };
    
    const sql = `
INSERT INTO imInterIndMedicas (
    NroIndicacion, NumeroVisita, NroAdicional, FechaCarga, HoraCarga,
    OperadorCarga, ProfesionalAsiste, TipoIndicacion, Codigo,
    CantidadIndicada, TipoUnidad, Frecuencia, Observaciones,
    IdSector, Estado, Cantidad, AliasMedicamento
) VALUES (
    @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14, @p15, @p16
)
`;
    
    const params = [
        { value: sd.NroIndicacion },
        { value: sd.NumeroVisita },
        { value: sd.NroAdicional },
        { value: sd.FechaCarga },
        { value: sd.HoraCarga },
        { value: sd.OperadorCarga },
        { value: sd.ProfesionalAsiste },
        { value: sd.TipoIndicacion },
        { value: sd.Codigo },
        { value: sd.CantidadIndicada },
        { value: sd.TipoUnidad },
        { value: sd.Frecuencia },
        { value: sd.Observaciones },
        { value: sd.IdSector },
        { value: sd.Estado },
        { value: sd.Cantidad },
        { value: sd.AliasMedicamento },
    ];
    
    try {
        await executeQuery(sql, params);
        console.log('✅ Indicación hija creada:', proximoNro, 'para padre:', data.nroIndicacionPadre);
        return {
            nroIndicacion: proximoNro,
            nroAdicional: data.nroIndicacionPadre,
        };
    } catch (error) {
        console.error('❌ Error al crear indicación hija:', error);
        console.error('[DATOS QUE CAUSARON ERROR]', sd);
        throw error;
    }
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
  AND (iim.NroAdicional IS NULL OR iim.NroAdicional = 0)
`;
    const params = [{ value: nroIndicacion }];
    const rows = await executeQuery(sql, params);
    const indicacionPadre = rows[0] || null;
    
    if (!indicacionPadre) return null;
    
    // Obtener indicaciones hijas (donde NroAdicional = NroIndicacion del padre)
    const sqlHijas = `
SELECT 
    iim.NroIndicacion,
    iim.NroAdicional,
    iim.CantidadIndicada AS Cantidad,
    iim.TipoUnidad,
    iim.AliasMedicamento,
    iim.Observaciones,
    iim.Frecuencia,
    iim.Codigo,
    iim.FormaAdicional,
    tit.Tipo as TipoIndicacion,
    v.TipoMedicamento,
    CASE 
        WHEN tit.Tipo = 'M' THEN COALESCE(v.Alias, v.Descripcion, iim.AliasMedicamento)
        WHEN tit.Tipo = 'C' THEN tc.Descripcion
        WHEN tit.Tipo = 'D' THEN td.Descripcion
        WHEN tit.Tipo = 'A' THEN ca.Descripcion
        ELSE iim.AliasMedicamento
    END AS DescripcionIndicacion
FROM imInterIndMedicas iim
LEFT JOIN imInterTipoIndicacion tit ON iim.TipoIndicacion = tit.Valor
LEFT JOIN imInterTipoControles tc ON tit.Tipo = 'C' AND iim.Codigo = tc.Valor
LEFT JOIN imTipoDieta td ON tit.Tipo = 'D' AND iim.Codigo = td.Valor
LEFT JOIN imInterCtrlAsistenciales ca ON tit.Tipo = 'A' AND iim.Codigo = ca.Valor
LEFT JOIN imVademecum v ON tit.Tipo = 'M' AND iim.Codigo = v.Troquel
WHERE iim.NroAdicional = @param0
ORDER BY iim.NroIndicacion ASC
`;
    const hijasRows = await executeQuery(sqlHijas, params);
    
    // Agregar indicaciones hijas al objeto padre
    indicacionPadre.indicacionesHijas = hijasRows.map(h => ({
        nroIndicacion: h.NroIndicacion,
        nroAdicional: h.NroAdicional,
        cantidad: h.Cantidad,
        tipoUnidad: h.TipoUnidad,
        medicamento: h.AliasMedicamento,
        descripcion: h.DescripcionIndicacion,
        observaciones: h.Observaciones,
        frecuencia: h.Frecuencia,
        formaAdicional: h.FormaAdicional,
    }));
    
    console.log('🔍 BACKEND - Indicación padre cargada:', indicacionPadre.NroIndicacion);
    console.log('🔍 BACKEND - Indicaciones hijas encontradas:', indicacionPadre.indicacionesHijas.length);
    
    return indicacionPadre;
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

        // ✅ Insertar en tablas secundarias según el tipo de indicación
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

    // ✅ CORREGIDO: Obtener el tipo de indicación desde la BD
    let tipoIndicacion = data.tipoIndicacion;
    if (!tipoIndicacion && indicacionActual) {
        const sqlTipo = `SELECT Tipo FROM imInterTipoIndicacion WHERE Valor = @param0`;
        const tipoResult = await executeQuery(sqlTipo, [{ value: indicacionActual.TipoIndicacion }]);
        tipoIndicacion = tipoResult[0]?.Tipo;
        console.log(`[APLICAR INDICACION] Tipo obtenido de BD: ${tipoIndicacion}`);
    }

    if (tipoIndicacion === "M") {
        console.log("[APLICAR MEDICAMENTO] Insertando en imInterCtrlMedicamento");
        console.log("[DEBUG] Valores recibidos:", {
            profesionalAsiste_data: data.profesionalAsiste,
            operadorCarga_data: data.operadorCarga,
            profesionalAsiste_indicacion: indicacionActual.ProfesionalAsiste,
            operadorCarga_indicacion: indicacionActual.OperadorCarga
        });

        const medicamentoData = {
            NumeroVisita: indicacionActual.NumeroVisita,
            Nroindicacion: nroIndicacion,
            Observaciones: limitLength(data.observaciones || indicacionActual.Observaciones || '', 255),
            Profesional: data.profesionalAsiste || indicacionActual.ProfesionalAsiste,
            OperadorCarga: data.operadorCarga || indicacionActual.OperadorCarga,

            //Fecha
            HoraCarga: convertirHoraAClarion(getLocalTimeString(dateCarga)),
            FechaCarga: convertirFechaAClarion(getLocalDateString(dateCarga)),
            HoraControl: data.horaCumplido ? convertirHoraAClarion(data.horaCumplido) : null,
            FechaControl: data.fechaCumplido ? convertirFechaAClarion(data.fechaCumplido) : null,

            //Data Medicamento - usar datos de la indicación actual
            Sector: indicacionActual.IdSector,
            Cantidad: indicacionActual.Cantidad,
            CantidadIndicada: indicacionActual.CantidadIndicada,
            TipoUnidad: indicacionActual.TipoUnidad,
        }

        console.log("[DEBUG] Datos finales a insertar:", medicamentoData);

        const insertMedicamento = `
        INSERT INTO dbo.imInterCtrlMedicamento (
            NumeroVisita, Nroindicacion, Observaciones, Profesional, OperadorCarga, HoraCarga, FechaCarga, HoraControl, FechaControl,
            Sector, Cantidad, CantidadIndicada, TipoUnidad, Troquel
        ) Values (
            @p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13
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
            { value: indicacionActual.Codigo }, // ✅ Troquel del medicamento
        ]

        try {
            await executeQuery(insertMedicamento, medicamentoParams);
            console.log("Registro de medicamento (imInterCtrlMedicamento) insertado correctamente.");
            
            // ✅ NUEVO: Buscar y aplicar también las indicaciones adicionales
            const sqlAdicionales = `
                SELECT NroIndicacion, Codigo, CantidadIndicada, Cantidad, TipoUnidad, FormaAdicional, AliasMedicamento
                FROM imInterIndMedicas
                WHERE NroAdicional = @param0
            `;
            const adicionales = await executeQuery(sqlAdicionales, [{ value: nroIndicacion }]);
            
            if (adicionales && adicionales.length > 0) {
                console.log(`[APLICAR MEDICAMENTO] Encontradas ${adicionales.length} indicaciones adicionales`);
                
                for (const adicional of adicionales) {
                    const adicionalData = {
                        NumeroVisita: indicacionActual.NumeroVisita,
                        Nroindicacion: adicional.NroIndicacion,
                        Observaciones: limitLength(data.observaciones || '', 255),
                        Profesional: medicamentoData.Profesional,
                        OperadorCarga: medicamentoData.OperadorCarga,
                        HoraCarga: medicamentoData.HoraCarga,
                        FechaCarga: medicamentoData.FechaCarga,
                        HoraControl: medicamentoData.HoraControl,
                        FechaControl: medicamentoData.FechaControl,
                        Sector: medicamentoData.Sector,
                        Cantidad: adicional.Cantidad,
                        CantidadIndicada: adicional.CantidadIndicada,
                        TipoUnidad: adicional.TipoUnidad,
                        Troquel: adicional.Codigo
                    };
                    
                    const adicionalParams = [
                        { value: adicionalData.NumeroVisita },
                        { value: adicionalData.Nroindicacion },
                        { value: adicionalData.Observaciones },
                        { value: adicionalData.Profesional },
                        { value: adicionalData.OperadorCarga },
                        { value: adicionalData.HoraCarga },
                        { value: adicionalData.FechaCarga },
                        { value: adicionalData.HoraControl },
                        { value: adicionalData.FechaControl },
                        { value: adicionalData.Sector },
                        { value: adicionalData.Cantidad },
                        { value: adicionalData.CantidadIndicada },
                        { value: adicionalData.TipoUnidad },
                        { value: adicionalData.Troquel }
                    ];
                    
                    await executeQuery(insertMedicamento, adicionalParams);
                    console.log(`[APLICAR MEDICAMENTO] Indicación adicional ${adicional.NroIndicacion} insertada (${adicional.AliasMedicamento})`);
                }
            }
        } catch (e) {
            console.error("Error al insertar en imInterCtrlMedicamento:", e);
            throw e; // Relanzar el error para que el try/catch exterior lo maneje
        }
    }

    if (tipoIndicacion === "A") {
        console.log("[APLICAR MEDIDA ASISTENCIAL] Insertando en imFacPracticas");

        const medidaAsistencialData = {
            Numero: 0,
            NumeroVisita: indicacionActual.NumeroVisita,
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
            console.log("Registro de medida asistencial (imFacPracticas) insertado correctamente.");
        } catch (e) {
            console.error("Error al insertar en imFacPracticas:", e);
            throw e; // Relanzar el error para que el try/catch exterior lo maneje
        }
    }
    
    } catch (error) {
        console.error("[ERROR APLICAR INDICACION]", error);
        throw error;
    }
};

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
    crearIndicacionHija,
};
