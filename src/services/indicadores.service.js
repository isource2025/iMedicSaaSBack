const { executeQuery, sql } = require('../models/db');
const { normalizarFilas } = require('../utils/codigoSector');
const { createTenantOnce, tenantCacheKey } = require('../context/tenantCache');
const { TtlCache, ttlDesdeEnv } = require('../utils/ttlCache');
const { sumarCacheHit } = require('../context/requestTiming');

const CAMA_ONLY_WHERE = "UPPER(LTRIM(RTRIM(ISNULL(hc.Tipo, '')))) = 'CAMA'";

/**
 * Caches por tenant de la analítica (resultados de queries pesadas sobre
 * imVisitaMovimiento). El dashboard las pide con el mismo rango de 30 días
 * para todos los usuarios de la clínica; con TTL de 2 min la segunda persona
 * que entra no toca SQL Server.
 *  - ANALYTICS_CACHE_MS: ocupación por rango / serie diaria / indicadores (default 120 s)
 *  - ESTADO_CAMAS_CACHE_MS: conteo actual de camas (default 15 s)
 */
const ANALYTICS_CACHE_MS = ttlDesdeEnv('ANALYTICS_CACHE_MS', 120_000);
const ESTADO_CAMAS_CACHE_MS = ttlDesdeEnv('ESTADO_CAMAS_CACHE_MS', 15_000);
const analyticsCache = new TtlCache({ ttlMs: ANALYTICS_CACHE_MS, max: 2000, nombre: 'analytics' });
const estadoCamasCache = new TtlCache({ ttlMs: ESTADO_CAMAS_CACHE_MS, max: 200, nombre: 'estadoCamas' });

function claveAnalytics(nombre, ...partes) {
  return `${tenantCacheKey()}|${nombre}|${partes.map((p) => (p == null ? '' : String(p))).join('|')}`;
}

/** Ejecuta `cargar` con cache por tenant + dedup de llamadas concurrentes. */
async function conCache(cache, key, cargar) {
  if (cache.ttlMs <= 0) return cargar();
  const hit = cache.get(key);
  if (hit !== undefined) {
    sumarCacheHit();
    return hit;
  }
  return cache.getOrLoad(key, cargar);
}

/** Permite purgar la analítica del tenant actual (p. ej. tras cambios masivos de camas). */
function invalidarCacheAnalitica() {
  const prefijo = `${tenantCacheKey()}|`;
  analyticsCache.deletePrefix(prefijo);
  estadoCamasCache.deletePrefix(prefijo);
}

/**
 * Bases Clarion viejas no tienen imHabitacionCamas.Tipo: ahí toda fila cuenta como cama.
 * El esquema no cambia en caliente → se consulta una sola vez por tenant.
 */
const camaOnlyWhere = createTenantOnce(async () => {
  const rows = await executeQuery(
    "SELECT COL_LENGTH('dbo.imHabitacionCamas', 'Tipo') AS Largo",
  );
  return rows?.[0]?.Largo == null ? '1 = 1' : CAMA_ONLY_WHERE;
});

function esObjetoSqlMissing(error) {
	return (
		Number(error?.number) === 208 ||
		/Invalid object name/i.test(String(error?.message || ''))
	);
}

async function obtenerMapaCamasInternacionPorSector() {
  const soloCamas = await camaOnlyWhere();
  const rows = await executeQuery(
    `
      SELECT
        LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) AS ValorSector,
        COUNT(*) AS TotalCamasInternacion
      FROM dbo.imHabitacionCamas hc
      WHERE ${soloCamas}
      GROUP BY LTRIM(RTRIM(ISNULL(hc.ValorSector, '')))
    `,
  );

  const mapa = new Map();
  for (const row of rows || []) {
    const key = String(row.ValorSector || '').trim().toUpperCase();
    if (!key) continue;
    mapa.set(key, Number(row.TotalCamasInternacion || 0));
  }
  return mapa;
}

/** Misma lógica que dbo.fn_GetIndicadores (fallback si la UDF no está desplegada). */
async function obtenerIndicadoresInline(tipoIndicador, fechaInicio, fechaFin) {
  const tipo = String(tipoIndicador || 'Ingresos');
  const params = [
    { value: fechaInicio },
    { value: fechaFin },
  ];

  if (tipo === 'TotalesPorClase') {
    return executeQuery(
      `
      SELECT
        CAST(NULL AS DATE) AS Fecha,
        cp.Descripcion AS ClasePaciente,
        COUNT(*) AS TotalIngresos
      FROM dbo.imVisita v
      INNER JOIN dbo.imClasePaciente cp ON v.ClasePaciente = cp.Valor
      WHERE (@p0 IS NULL OR v.FechaAdmisionS >= @p0)
        AND (@p1 IS NULL OR v.FechaAdmisionS < DATEADD(DAY, 1, @p1))
      GROUP BY cp.Descripcion
      ORDER BY cp.Descripcion
      `,
      params,
    );
  }

  if (tipo === 'TotalesGenerales') {
    return executeQuery(
      `
      SELECT
        CAST(NULL AS DATE) AS Fecha,
        'TOTAL' AS ClasePaciente,
        COUNT(*) AS TotalIngresos
      FROM dbo.imVisita v
      WHERE (@p0 IS NULL OR v.FechaAdmisionS >= @p0)
        AND (@p1 IS NULL OR v.FechaAdmisionS < DATEADD(DAY, 1, @p1))
      `,
      params,
    );
  }

  // Ingresos (default)
  return executeQuery(
    `
    SELECT
      CAST(v.FechaAdmisionS AS DATE) AS Fecha,
      cp.Descripcion AS ClasePaciente,
      COUNT(*) AS TotalIngresos
    FROM dbo.imVisita v
    INNER JOIN dbo.imClasePaciente cp ON v.ClasePaciente = cp.Valor
    WHERE (@p0 IS NULL OR v.FechaAdmisionS >= @p0)
      AND (@p1 IS NULL OR v.FechaAdmisionS < DATEADD(DAY, 1, @p1))
    GROUP BY CAST(v.FechaAdmisionS AS DATE), cp.Descripcion
    ORDER BY Fecha DESC, ClasePaciente
    `,
    params,
  );
}

/**
 * Obtiene indicadores de pacientes usando la función fn_GetIndicadores
 * @param {string} tipoIndicador - Tipo de indicador (ej: 'Ingresos')
 * @param {string} fechaInicio - Fecha de inicio en formato YYYY-MM-DD
 * @param {string} fechaFin - Fecha de fin en formato YYYY-MM-DD
 * @returns {Array} Array de indicadores con Fecha, ClasePaciente y TotalIngresos
 */
const obtenerIndicadores = async (tipoIndicador = 'Ingresos', fechaInicio, fechaFin) => {
  const key = claveAnalytics('indicadores', tipoIndicador, fechaInicio, fechaFin);
  return conCache(analyticsCache, key, () =>
    obtenerIndicadoresSinCache(tipoIndicador, fechaInicio, fechaFin),
  );
};

const obtenerIndicadoresSinCache = async (tipoIndicador = 'Ingresos', fechaInicio, fechaFin) => {
  try {
    const query = `
      SELECT 
        Fecha,
        ClasePaciente,
        TotalIngresos
      FROM dbo.fn_GetIndicadores(@p0, @p1, @p2)
      ORDER BY Fecha DESC, ClasePaciente
    `;
    
    const params = [
      { value: tipoIndicador },
      { value: fechaInicio },
      { value: fechaFin }
    ];
    
    try {
      return await executeQuery(query, params);
    } catch (udfErr) {
      if (!esObjetoSqlMissing(udfErr)) throw udfErr;
      console.warn(
        '[indicadores] fn_GetIndicadores ausente — usando consulta inline. Desplegá scripts/sql/fn_indicadores_dashboard.sql en el tenant.',
      );
      return await obtenerIndicadoresInline(tipoIndicador, fechaInicio, fechaFin);
    }
  } catch (error) {
    console.error('Error al obtener indicadores:', error);
    throw new Error('Error al obtener indicadores de pacientes');
  }
};

/**
 * Obtiene resumen de indicadores agrupados por clase de paciente
 * @param {string} tipoIndicador - Tipo de indicador
 * @param {string} fechaInicio - Fecha de inicio
 * @param {string} fechaFin - Fecha de fin
 * @returns {Object} Resumen con totales por clase de paciente
 */
/** Resumen (promedio por clase + total) a partir de filas ya obtenidas. Puro. */
function resumenDesdeFilas(indicadores, fechaInicio, fechaFin) {
  const resumenPorSector = {};

  const sectoresData = (indicadores || []).reduce((acc, item) => {
    const sectorKey = item.ClasePaciente || 'Sin clasificar';
    if (!acc[sectorKey]) {
      acc[sectorKey] = { totalIngresos: 0, registros: 0 };
    }
    acc[sectorKey].totalIngresos += item.TotalIngresos || 0;
    acc[sectorKey].registros += 1;
    return acc;
  }, {});

  Object.keys(sectoresData).forEach((sector) => {
    const data = sectoresData[sector];
    const promedio = data.registros > 0 ? data.totalIngresos / data.registros : 0;
    resumenPorSector[sector] = Number(promedio.toFixed(1));
  });

  const totalGeneral = Object.values(resumenPorSector).reduce((sum, value) => sum + value, 0);

  return {
    resumenPorSector,
    totalGeneral,
    periodo: { fechaInicio, fechaFin },
  };
}

/** Clave YYYY-MM-DD de una fila (mssql devuelve Date para columnas DATE). */
function fechaClave(fecha) {
  if (fecha == null) return '';
  if (fecha instanceof Date) return fecha.toISOString().slice(0, 10);
  return String(fecha).slice(0, 10);
}

/** Serie por fecha a partir de filas ya obtenidas. Puro. */
function porFechaDesdeFilas(indicadores) {
  const porFecha = (indicadores || []).reduce((acc, item) => {
    const fecha = item.Fecha;
    const k = fechaClave(fecha);
    if (!acc[k]) {
      acc[k] = { fecha, total: 0, porClase: {} };
    }
    const clase = item.ClasePaciente || 'Sin clasificar';
    acc[k].total += item.TotalIngresos || 0;
    acc[k].porClase[clase] = (acc[k].porClase[clase] || 0) + (item.TotalIngresos || 0);
    return acc;
  }, {});

  return Object.values(porFecha).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}

const obtenerResumenIndicadores = async (tipoIndicador = 'Ingresos', fechaInicio, fechaFin) => {
  try {
    const indicadores = await obtenerIndicadores(tipoIndicador, fechaInicio, fechaFin);
    return resumenDesdeFilas(indicadores, fechaInicio, fechaFin);
  } catch (error) {
    console.error('Error al obtener resumen de indicadores:', error);
    throw new Error('Error al obtener resumen de indicadores');
  }
};

/**
 * Obtiene indicadores agrupados por fecha para gráficos temporales
 * @param {string} tipoIndicador - Tipo de indicador
 * @param {string} fechaInicio - Fecha de inicio
 * @param {string} fechaFin - Fecha de fin
 * @returns {Array} Array con datos agrupados por fecha
 */
const obtenerIndicadoresPorFecha = async (tipoIndicador = 'Ingresos', fechaInicio, fechaFin) => {
  try {
    const indicadores = await obtenerIndicadores(tipoIndicador, fechaInicio, fechaFin);
    return porFechaDesdeFilas(indicadores);
  } catch (error) {
    console.error('Error al obtener indicadores por fecha:', error);
    throw new Error('Error al obtener indicadores por fecha');
  }
};

/**
 * Obtiene un resumen de pacientes para el día actual y lo compara con el día anterior.
 * @returns {Object} Objeto con el total de hoy, y la comparación con el día anterior.
 */
const obtenerResumenPacientesHoy = async () => {
  try {
    // Usar zona horaria de Argentina (UTC-3)
    const argentinaOffset = -3 * 60; // UTC-3 en minutos
    const now = new Date();
    const today = new Date(now.getTime() + (argentinaOffset * 60 * 1000));
    const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));

    const formatDate = (date) => date.toISOString().split('T')[0];

    const fechaHoy = formatDate(today);
    const fechaAyer = formatDate(yesterday);

    // Una sola query ayer..hoy; se separa por fecha en memoria (antes eran 2 viajes a SQL Server).
    const filas = await obtenerIndicadores('Ingresos', fechaAyer, fechaHoy);
    const filasHoy = filas.filter((f) => fechaClave(f.Fecha) === fechaHoy);
    const filasAyer = filas.filter((f) => fechaClave(f.Fecha) === fechaAyer);

    const totalHoy = resumenDesdeFilas(filasHoy, fechaHoy, fechaHoy).totalGeneral || 0;
    const totalAyer = resumenDesdeFilas(filasAyer, fechaAyer, fechaAyer).totalGeneral || 0;

    let porcentajeCambio = 0;
    if (totalAyer > 0) {
      porcentajeCambio = ((totalHoy - totalAyer) / totalAyer) * 100;
    } else if (totalHoy > 0 && totalAyer === 0) {
      // Cuando ayer fue 0 y hoy hay pacientes, mostrar la cantidad exacta como porcentaje
      // 0 a 3 = +300%, 0 a 4 = +400%, etc.
      porcentajeCambio = totalHoy * 100;
    } else if (totalHoy === 0 && totalAyer > 0) {
      porcentajeCambio = -100; // Si hoy es 0 y ayer había pacientes, es -100%
    }
    // Si ambos son 0, porcentajeCambio permanece en 0

    return {
      totalHoy,
      totalAyer,
      porcentajeCambio: parseFloat(porcentajeCambio.toFixed(1)),
    };
  } catch (error) {
    console.error('Error al obtener el resumen de pacientes de hoy:', error);
    throw new Error('Error al obtener el resumen de pacientes de hoy');
  }
};

module.exports = {
  obtenerIndicadores,
  obtenerResumenIndicadores,
  obtenerIndicadoresPorFecha,
  obtenerResumenPacientesHoy,
  resumenDesdeFilas,
  porFechaDesdeFilas,
  invalidarCacheAnalitica,
};

/**
 * ============================
 *  ANALÍTICA DE CAMAS (Camas)
 * ============================
 * Ocupación por rango real [fechaInicio, fechaFin]:
 * - Días-cama solo dentro del rango (sin proyectar hasta fin de mes)
 * - Solo camas Tipo='CAMA' (internación)
 * - Serie diaria real (sin Math.random)
 */

/** Días-cama por sector/mes acotados al rango solicitado. */
async function obtenerOcupacionCamasInline(fechaInicio, fechaFin) {
  const soloCamas = await camaOnlyWhere();
  return executeQuery(
    `
    ;WITH Internados AS (
      SELECT
        vm.NumeroVisita,
        LTRIM(RTRIM(ISNULL(vm.ValorSector, ''))) AS ValorSector,
        CAST(DATEADD(day, vm.FechaAdmision - 4, '1801-01-01') AS date) AS FechaAdmision,
        CASE
          WHEN vm.FechaEgreso IS NULL OR vm.FechaEgreso = 0 THEN NULL
          ELSE CAST(DATEADD(day, vm.FechaEgreso - 4, '1801-01-01') AS date)
        END AS FechaEgreso
      FROM dbo.imVisitaMovimiento vm
      WHERE vm.FechaAdmision IS NOT NULL AND vm.FechaAdmision > 0
    ),
    CamasPorSector AS (
      SELECT
        LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) AS ValorSector,
        COUNT(*) AS TotalCamas
      FROM dbo.imHabitacionCamas hc
      WHERE ${soloCamas}
      GROUP BY LTRIM(RTRIM(ISNULL(hc.ValorSector, '')))
    ),
    Meses AS (
      SELECT DATEFROMPARTS(YEAR(@p0), MONTH(@p0), 1) AS Mes
      UNION ALL
      SELECT DATEADD(MONTH, 1, Mes)
      FROM Meses
      WHERE Mes < DATEFROMPARTS(YEAR(@p1), MONTH(@p1), 1)
    ),
    Periodos AS (
      SELECT
        m.Mes,
        CASE WHEN m.Mes > @p0 THEN m.Mes ELSE @p0 END AS PeriodoInicio,
        CASE
          WHEN EOMONTH(m.Mes) < @p1 THEN EOMONTH(m.Mes)
          ELSE @p1
        END AS PeriodoFin
      FROM Meses m
    ),
    PacientesMes AS (
      SELECT
        i.ValorSector,
        p.Mes,
        p.PeriodoInicio,
        p.PeriodoFin,
        SUM(
          CASE
            WHEN
              CASE
                WHEN i.FechaAdmision > p.PeriodoInicio THEN i.FechaAdmision
                ELSE p.PeriodoInicio
              END
              <=
              CASE
                WHEN i.FechaEgreso IS NULL OR i.FechaEgreso > p.PeriodoFin THEN p.PeriodoFin
                ELSE i.FechaEgreso
              END
            THEN
              DATEDIFF(
                DAY,
                CASE
                  WHEN i.FechaAdmision > p.PeriodoInicio THEN i.FechaAdmision
                  ELSE p.PeriodoInicio
                END,
                DATEADD(
                  DAY,
                  1,
                  CASE
                    WHEN i.FechaEgreso IS NULL OR i.FechaEgreso > p.PeriodoFin THEN p.PeriodoFin
                    ELSE i.FechaEgreso
                  END
                )
              )
            ELSE 0
          END
        ) AS PacientesDia
      FROM Internados i
      CROSS JOIN Periodos p
      WHERE i.FechaAdmision <= p.PeriodoFin
        AND (i.FechaEgreso IS NULL OR i.FechaEgreso >= p.PeriodoInicio)
      GROUP BY i.ValorSector, p.Mes, p.PeriodoInicio, p.PeriodoFin
    )
    SELECT
      'Mensual' AS TipoIndicador,
      FORMAT(pm.Mes, 'yyyy-MM') AS Periodo,
      pm.ValorSector,
      pm.PacientesDia,
      c.TotalCamas,
      DATEDIFF(DAY, pm.PeriodoInicio, pm.PeriodoFin) + 1 AS DiasDelMes,
      CAST(
        pm.PacientesDia * 1.0
          / NULLIF(c.TotalCamas * (DATEDIFF(DAY, pm.PeriodoInicio, pm.PeriodoFin) + 1), 0)
          * 100 AS DECIMAL(10,2)
      ) AS OcupacionPromedioPct
    FROM PacientesMes pm
    JOIN CamasPorSector c ON pm.ValorSector = c.ValorSector
    WHERE pm.PacientesDia > 0
    ORDER BY pm.ValorSector, Periodo
    OPTION (MAXRECURSION 120)
    `,
    [{ value: fechaInicio }, { value: fechaFin }],
  );
}

/** Ocupación real día a día en el rango (visitas presentes cada día). */
async function obtenerOcupacionCamasDiariaInline(fechaInicio, fechaFin, sector) {
  const sectorTrim = sector && String(sector).trim() ? String(sector).trim().toUpperCase() : null;
  const params = [
    { value: fechaInicio },
    { value: fechaFin },
  ];
  let sectorFilter = '';
  if (sectorTrim) {
    params.push({ value: sectorTrim });
    sectorFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(i.ValorSector, '')))) = @p2`;
  }
  const soloCamas = await camaOnlyWhere();

  return executeQuery(
    `
    ;WITH Internados AS (
      SELECT
        vm.NumeroVisita,
        LTRIM(RTRIM(ISNULL(vm.ValorSector, ''))) AS ValorSector,
        CAST(DATEADD(day, vm.FechaAdmision - 4, '1801-01-01') AS date) AS FechaAdmision,
        CASE
          WHEN vm.FechaEgreso IS NULL OR vm.FechaEgreso = 0 THEN NULL
          ELSE CAST(DATEADD(day, vm.FechaEgreso - 4, '1801-01-01') AS date)
        END AS FechaEgreso
      FROM dbo.imVisitaMovimiento vm
      WHERE vm.FechaAdmision IS NOT NULL AND vm.FechaAdmision > 0
    ),
    SectoresValidos AS (
      SELECT DISTINCT LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) AS ValorSector
      FROM dbo.imHabitacionCamas hc
      WHERE ${soloCamas}
    ),
    Dias AS (
      SELECT CAST(@p0 AS date) AS Fecha
      UNION ALL
      SELECT DATEADD(DAY, 1, Fecha)
      FROM Dias
      WHERE Fecha < CAST(@p1 AS date)
    ),
    Capacidad AS (
      SELECT COUNT(*) AS TotalCamas
      FROM dbo.imHabitacionCamas hc
      WHERE ${soloCamas}
      ${sectorTrim ? `AND UPPER(LTRIM(RTRIM(ISNULL(hc.ValorSector, '')))) = @p2` : ''}
    ),
    OcupacionDia AS (
      SELECT
        d.Fecha,
        COUNT(DISTINCT i.NumeroVisita) AS Ocupadas
      FROM Dias d
      INNER JOIN Internados i
        ON i.FechaAdmision <= d.Fecha
       AND (i.FechaEgreso IS NULL OR i.FechaEgreso >= d.Fecha)
      INNER JOIN SectoresValidos s ON i.ValorSector = s.ValorSector
      WHERE 1 = 1
        ${sectorFilter}
      GROUP BY d.Fecha
    )
    SELECT
      d.Fecha,
      c.TotalCamas,
      ISNULL(o.Ocupadas, 0) AS Ocupadas,
      CASE WHEN c.TotalCamas > ISNULL(o.Ocupadas, 0)
        THEN c.TotalCamas - ISNULL(o.Ocupadas, 0)
        ELSE 0
      END AS Disponibles,
      CAST(
        CASE WHEN c.TotalCamas > 0
          THEN ISNULL(o.Ocupadas, 0) * 100.0 / c.TotalCamas
          ELSE 0
        END AS DECIMAL(10,2)
      ) AS PorcentajeOcupacion
    FROM Dias d
    CROSS JOIN Capacidad c
    LEFT JOIN OcupacionDia o ON o.Fecha = d.Fecha
    ORDER BY d.Fecha
    OPTION (MAXRECURSION 4000)
    `,
    params,
  );
}

/**
 * Obtiene ocupación promedio de camas por sector en el rango.
 * @param {string} fechaInicio YYYY-MM-DD
 * @param {string} fechaFin YYYY-MM-DD
 */
const obtenerOcupacionCamas = async (fechaInicio, fechaFin, sector) => {
  const startTime = Date.now();
  console.log(`🔍 [CAMAS] Iniciando consulta - Rango: ${fechaInicio} a ${fechaFin}, Sector: ${sector || 'TODOS'}`);

  try {
    // Filas normalizadas (sin filtro de sector) cacheadas por tenant+rango.
    let datos = await conCache(
      analyticsCache,
      claveAnalytics('ocupacionCamas', fechaInicio, fechaFin),
      () => cargarOcupacionCamasNormalizada(fechaInicio, fechaFin),
    );

    if (sector && sector.trim()) {
      const sectorTrim = sector.trim().toUpperCase();
      const antes = datos.length;
      datos = datos.filter(
        (row) => row.ValorSector && row.ValorSector.toString().trim().toUpperCase() === sectorTrim,
      );
      console.log(`🔽 [CAMAS] Filtrado por sector '${sector}': ${antes} → ${datos.length}`);
    }

    console.log(`🏁 [CAMAS] Proceso completado en ${Date.now() - startTime}ms total`);
    return datos;
  } catch (error) {
    console.error(`❌ [CAMAS] Error después de ${Date.now() - startTime}ms:`, {
      message: error.message,
      code: error.code,
      number: error.number,
    });
    throw new Error('Error al obtener ocupación promedio de camas');
  }
};

async function cargarOcupacionCamasNormalizada(fechaInicio, fechaFin) {
  const queryStartTime = Date.now();
  // Consulta inline: respeta el rango (la UDF histórica proyecta hasta fin de mes).
  // Las dos queries son independientes → en paralelo.
  const [result, camasPorSector] = await Promise.all([
    obtenerOcupacionCamasInline(fechaInicio, fechaFin),
    obtenerMapaCamasInternacionPorSector(),
  ]);
  console.log(`✅ [CAMAS] Query SQL completada en ${Date.now() - queryStartTime}ms`);
  console.log(`📊 [CAMAS] Registros obtenidos: ${result?.length || 0}`);

  const datos = normalizarFilas(result || [])
      .map((row) => {
        const sectorKey = String(row.ValorSector || '').trim().toUpperCase();
        const totalCamasInternacion = Number(camasPorSector.get(sectorKey) || 0);
        if (totalCamasInternacion <= 0) return null;

        const pacientesDia = toNumberSafe(row.PacientesDia);
        const diasDelPeriodo = Math.max(1, toNumberSafe(row.DiasDelMes) || 1);
        const ocupacionPromedioPct =
          totalCamasInternacion > 0
            ? Number(((pacientesDia / (totalCamasInternacion * diasDelPeriodo)) * 100).toFixed(2))
            : 0;

        return {
          ...row,
          ValorSector: String(row.ValorSector || '').trim(),
          TotalCamas: totalCamasInternacion,
          DiasDelMes: diasDelPeriodo,
          OcupacionPromedioPct: ocupacionPromedioPct,
        };
      })
      .filter(Boolean);

  if (datos.length > 0) {
    console.log(
      `🔍 [CAMAS] Muestra (primeros 3):`,
      datos.slice(0, 3).map((row) => ({
        ValorSector: row.ValorSector,
        Periodo: row.Periodo,
        PacientesDia: row.PacientesDia,
        TotalCamas: row.TotalCamas,
        DiasDelMes: row.DiasDelMes,
        OcupacionPromedioPct: row.OcupacionPromedioPct,
      })),
    );
  }

  return datos;
}

/**
 * Resumen de ocupación en el período (días-cama, tasa global, distribución por sector).
 */
const obtenerResumenOcupacionCamas = async (fechaInicio, fechaFin, sector) => {
  const startTime = Date.now();
  console.log(`🔍 [RESUMEN] Iniciando cálculo de resumen - Rango: ${fechaInicio} a ${fechaFin}`);

  try {
    const filas = await obtenerOcupacionCamas(fechaInicio, fechaFin, sector);
    console.log(`📊 [RESUMEN] Filas recibidas: ${filas.length}`);

    if (!filas.length) {
      return {
        totalGeneral: 0,
        totalCamasPromedio: 0,
        ocupadasPromedio: 0,
        disponiblesPromedio: 0,
        porcentajeOcupacionPromedio: 0,
        resumenPorSector: {},
        ocupacionPorSector: {},
        periodo: { fechaInicio, fechaFin },
      };
    }

    // Capacidad instalada = suma de camas por sector (una vez por sector)
    const camasPorSectorUnico = new Map();
    for (const f of filas) {
      const key = String(f.ValorSector || '').trim();
      if (!key) continue;
      if (!camasPorSectorUnico.has(key)) {
        camasPorSectorUnico.set(key, toNumberSafe(f.TotalCamas));
      }
    }
    const totalCapacidad = [...camasPorSectorUnico.values()].reduce((a, b) => a + b, 0);

    // Días-cama disponibles = Σ (camas × días del tramo) por fila
    const totalDiasCamaDisponibles = filas.reduce(
      (sum, f) => sum + toNumberSafe(f.TotalCamas) * Math.max(1, toNumberSafe(f.DiasDelMes)),
      0,
    );
    const totalDiasCamaOcupados = filas.reduce((sum, f) => sum + toNumberSafe(f.PacientesDia), 0);
    const tasaOcupacion =
      totalDiasCamaDisponibles > 0 ? (totalDiasCamaOcupados / totalDiasCamaDisponibles) * 100 : 0;

    const ocupadasPromedio = totalCapacidad > 0 ? (tasaOcupacion / 100) * totalCapacidad : 0;
    const disponiblesPromedio = Math.max(0, totalCapacidad - ocupadasPromedio);

    // Distribución: días-cama ocupados por sector (para donut)
    const resumenPorSector = {};
    // Tasa de ocupación % por sector (para insights)
    const ocupacionPorSector = {};
    const sectoresAgg = {};

    for (const f of filas) {
      const key = String(f.ValorSector || '').trim();
      if (!key) continue;
      if (!sectoresAgg[key]) {
        sectoresAgg[key] = { pacientesDia: 0, diasCamaDisponibles: 0, totalCamas: toNumberSafe(f.TotalCamas) };
      }
      sectoresAgg[key].pacientesDia += toNumberSafe(f.PacientesDia);
      sectoresAgg[key].diasCamaDisponibles +=
        toNumberSafe(f.TotalCamas) * Math.max(1, toNumberSafe(f.DiasDelMes));
    }

    Object.keys(sectoresAgg).forEach((key) => {
      const s = sectoresAgg[key];
      resumenPorSector[key] = Number(s.pacientesDia.toFixed(2));
      ocupacionPorSector[key] =
        s.diasCamaDisponibles > 0
          ? Number(((s.pacientesDia / s.diasCamaDisponibles) * 100).toFixed(2))
          : 0;
    });

    const resultado = {
      totalGeneral: Number(totalDiasCamaOcupados.toFixed(2)),
      totalCamasPromedio: totalCapacidad,
      ocupadasPromedio: Number(ocupadasPromedio.toFixed(2)),
      disponiblesPromedio: Number(disponiblesPromedio.toFixed(2)),
      porcentajeOcupacionPromedio: Number(tasaOcupacion.toFixed(2)),
      resumenPorSector,
      ocupacionPorSector,
      periodo: { fechaInicio, fechaFin },
    };

    console.log(`🏁 [RESUMEN] Completado en ${Date.now() - startTime}ms:`, {
      totalGeneral: resultado.totalGeneral,
      porcentajeOcupacionPromedio: resultado.porcentajeOcupacionPromedio,
      sectores: Object.keys(resumenPorSector).length,
    });

    return resultado;
  } catch (error) {
    console.error(`❌ [RESUMEN] Error después de ${Date.now() - startTime}ms:`, error.message);
    throw new Error('Error al obtener resumen de ocupación de camas');
  }
};

/**
 * Serie diaria real de ocupación en el rango (sin datos sintéticos).
 */
const obtenerOcupacionCamasPorFecha = async (fechaInicio, fechaFin, sector) => {
  const startTime = Date.now();
  console.log(`🔍 [POR-FECHA] Serie diaria real - Rango: ${fechaInicio} a ${fechaFin}`);

  try {
    const rows = await conCache(
      analyticsCache,
      claveAnalytics('ocupacionDiaria', fechaInicio, fechaFin, sector),
      () => obtenerOcupacionCamasDiariaInline(fechaInicio, fechaFin, sector),
    );
    const mapped = (rows || []).map((r) => {
      const totalCamas = toNumberSafe(r.TotalCamas);
      const ocupadas = toNumberSafe(r.Ocupadas);
      const disponibles = toNumberSafe(r.Disponibles);
      const porcentajeOcupacion = toNumberSafe(r.PorcentajeOcupacion);
      const fechaRaw = r.Fecha;
      const fechaIso =
        fechaRaw instanceof Date
          ? fechaRaw.toISOString()
          : new Date(`${String(fechaRaw).slice(0, 10)}T12:00:00.000Z`).toISOString();

      return {
        fecha: fechaIso,
        totalCamas,
        ocupadas,
        disponibles,
        porcentajeOcupacion,
      };
    });

    console.log(
      `🏁 [POR-FECHA] ${mapped.length} días en ${Date.now() - startTime}ms`,
      mapped.slice(0, 3),
    );
    return mapped;
  } catch (error) {
    console.error(`❌ [POR-FECHA] Error después de ${Date.now() - startTime}ms:`, error.message);
    throw new Error('Error al obtener ocupación de camas por fecha');
  }
};

// Helpers locales
function toNumberSafe(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Obtiene el estado actual REAL de ocupación de camas (tiempo real, no estadísticas)
 */
const obtenerEstadoActualCamas = async () =>
  conCache(estadoCamasCache, claveAnalytics('estadoActual'), obtenerEstadoActualCamasSinCache);

const obtenerEstadoActualCamasSinCache = async () => {
  const startTime = Date.now();
  console.log(`🔍 [ESTADO-ACTUAL] Iniciando consulta de estado actual en tiempo real`);
  
  try {
    // Query para obtener estado actual real de camas ocupadas HOY
    // Basada en la estructura real: imHabitacionCamas usa ValorHabitacionCama como ID y NumeroVisita para ocupación
    const soloCamas = await camaOnlyWhere();
    const query = `
      SELECT 
        COUNT(*) AS TotalCamas,
        SUM(CASE WHEN hc.NumeroVisita > 0 THEN 1 ELSE 0 END) AS CamasOcupadas,
        SUM(CASE WHEN hc.NumeroVisita = 0 OR hc.NumeroVisita IS NULL THEN 1 ELSE 0 END) AS CamasDisponibles
      FROM dbo.imHabitacionCamas hc
      WHERE ${soloCamas}
    `;
    
    const queryStartTime = Date.now();
    const result = await executeQuery(query);
    
    const queryTime = Date.now() - queryStartTime;
    console.log(`✅ [ESTADO-ACTUAL] Query completada en ${queryTime}ms`);
    
    const datos = result[0];
    console.log(`📊 [ESTADO-ACTUAL] Datos obtenidos:`, {
      TotalCamas: datos.TotalCamas,
      CamasOcupadas: datos.CamasOcupadas,
      CamasDisponibles: datos.CamasDisponibles
    });
    
    const totalCamas = toNumberSafe(datos.TotalCamas);
    const ocupadas = toNumberSafe(datos.CamasOcupadas);
    const disponibles = toNumberSafe(datos.CamasDisponibles);
    const porcentajeOcupacion = totalCamas > 0 ? Number(((ocupadas / totalCamas) * 100).toFixed(2)) : 0;
    
    const resultado = {
      fecha: new Date().toISOString().split('T')[0],
      totalCamas,
      ocupadas,
      disponibles,
      porcentajeOcupacion
    };
    
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [ESTADO-ACTUAL] Proceso completado en ${totalTime}ms:`, resultado);
    
    return resultado;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [ESTADO-ACTUAL] Error después de ${totalTime}ms:`, {
      message: error.message,
      code: error.code,
      number: error.number,
      stack: error.stack?.split('\n').slice(0, 3)
    });
    throw new Error('Error al obtener estado actual de camas');
  }
};


// Exportaciones adicionales
module.exports.obtenerOcupacionCamas = obtenerOcupacionCamas;
module.exports.obtenerResumenOcupacionCamas = obtenerResumenOcupacionCamas;
module.exports.obtenerOcupacionCamasPorFecha = obtenerOcupacionCamasPorFecha;
module.exports.obtenerEstadoActualCamas = obtenerEstadoActualCamas;
