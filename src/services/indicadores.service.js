const sql = require('mssql');
const { connectDB } = require('../config/database');

/**
 * Obtiene indicadores de pacientes usando la función fn_GetIndicadores
 * @param {string} tipoIndicador - Tipo de indicador (ej: 'Ingresos')
 * @param {string} fechaInicio - Fecha de inicio en formato YYYY-MM-DD
 * @param {string} fechaFin - Fecha de fin en formato YYYY-MM-DD
 * @returns {Array} Array de indicadores con Fecha, ClasePaciente y TotalIngresos
 */
const obtenerIndicadores = async (tipoIndicador = 'Ingresos', fechaInicio, fechaFin) => {
  try {
    const pool = await connectDB();
    
    const query = `
      SELECT 
        Fecha,
        ClasePaciente,
        TotalIngresos
      FROM dbo.fn_GetIndicadores(@tipoIndicador, @fechaInicio, @fechaFin)
      ORDER BY Fecha DESC, ClasePaciente
    `;
    
    const result = await pool.request()
      .input('tipoIndicador', sql.VarChar(50), tipoIndicador)
      .input('fechaInicio', sql.Date, fechaInicio)
      .input('fechaFin', sql.Date, fechaFin)
      .query(query);
    
    return result.recordset;
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
const obtenerResumenIndicadores = async (tipoIndicador = 'Ingresos', fechaInicio, fechaFin) => {
  try {
    const indicadores = await obtenerIndicadores(tipoIndicador, fechaInicio, fechaFin);
    
    // Agrupar por clase de paciente
    const resumen = indicadores.reduce((acc, item) => {
      const clase = item.ClasePaciente || 'Sin clasificar';
      if (!acc[clase]) {
        acc[clase] = 0;
      }
      acc[clase] += item.TotalIngresos || 0;
      return acc;
    }, {});
    
    // Calcular total general
    const totalGeneral = Object.values(resumen).reduce((sum, value) => sum + value, 0);
    
    return {
      resumenPorClase: resumen,
      totalGeneral,
      periodo: {
        fechaInicio,
        fechaFin
      }
    };
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
    
    // Agrupar por fecha
    const porFecha = indicadores.reduce((acc, item) => {
      const fecha = item.Fecha;
      if (!acc[fecha]) {
        acc[fecha] = {
          fecha,
          total: 0,
          porClase: {}
        };
      }
      
      const clase = item.ClasePaciente || 'Sin clasificar';
      acc[fecha].total += item.TotalIngresos || 0;
      acc[fecha].porClase[clase] = (acc[fecha].porClase[clase] || 0) + (item.TotalIngresos || 0);
      
      return acc;
    }, {});
    
    return Object.values(porFecha).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
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
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const formatDate = (date) => date.toISOString().split('T')[0];

    const fechaHoy = formatDate(today);
    const fechaAyer = formatDate(yesterday);

    const resumenHoy = await obtenerResumenIndicadores('Ingresos', fechaHoy, fechaHoy);
    const resumenAyer = await obtenerResumenIndicadores('Ingresos', fechaAyer, fechaAyer);

    const totalHoy = resumenHoy.totalGeneral || 0;
    const totalAyer = resumenAyer.totalGeneral || 0;

    let porcentajeCambio = 0;
    if (totalAyer > 0) {
      porcentajeCambio = ((totalHoy - totalAyer) / totalAyer) * 100;
    } else if (totalHoy > 0) {
      porcentajeCambio = 100; // Si ayer fue 0 y hoy hay pacientes, es un 100% de aumento
    }

    return {
      totalHoy,
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
  obtenerResumenPacientesHoy
};

/**
 * ============================
 *  ANALÍTICA DE CAMAS (Camas)
 * ============================
 * Basado en la función dbo.fn_OcupacionPromedioCamas(fechaInicio, fechaFin)
 */

/**
 * Obtiene registros de ocupación promedio de camas desde la función SQL
 * Se espera que la función devuelva al menos una columna de fecha (Fecha)
 * y métricas de ocupación como Ocupadas, Disponibles, TotalCamas o PorcentajeOcupacion.
 * @param {string} fechaInicio YYYY-MM-DD
 * @param {string} fechaFin YYYY-MM-DD
 */
const obtenerOcupacionCamas = async (fechaInicio, fechaFin, sector) => {
  const startTime = Date.now();
  console.log(`🔍 [CAMAS] Iniciando consulta - Rango: ${fechaInicio} a ${fechaFin}, Sector: ${sector || 'TODOS'}`);
  
  try {
    const pool = await connectDB();
    console.log(`⏱️ [CAMAS] Conexión DB establecida en ${Date.now() - startTime}ms`);
    
    const query = `
      SELECT *
      FROM dbo.fn_OcupacionPromedioCamas(@fechaInicio, @fechaFin)
      ORDER BY ValorSector, Periodo
    `;
    
    console.log(`📋 [CAMAS] Ejecutando query SQL con parámetros:`, {
      fechaInicio,
      fechaFin,
      queryLength: query.length,
      fechaInicioType: typeof fechaInicio,
      fechaFinType: typeof fechaFin
    });
    
    const queryStartTime = Date.now();
    const result = await pool
      .request()
      .input('fechaInicio', sql.Date, fechaInicio)
      .input('fechaFin', sql.Date, fechaFin)
      .query(query);

    const queryTime = Date.now() - queryStartTime;
    console.log(`✅ [CAMAS] Query SQL completada en ${queryTime}ms`);
    console.log(`📊 [CAMAS] Registros obtenidos: ${result.recordset?.length || 0}`);
    
    let datos = result.recordset || [];
    
    // Log de muestra de datos
    if (datos.length > 0) {
      console.log(`🔍 [CAMAS] Muestra de datos (primeros 3 registros):`, 
        datos.slice(0, 3).map(row => ({
          ValorSector: row.ValorSector,
          Periodo: row.Periodo,
          PacientesDia: row.PacientesDia,
          TotalCamas: row.TotalCamas,
          OcupacionPromedioPct: row.OcupacionPromedioPct
        }))
      );
      
      // Log de sectores únicos
      const sectoresUnicos = [...new Set(datos.map(row => row.ValorSector))];
      console.log(`🏥 [CAMAS] Sectores encontrados (${sectoresUnicos.length}):`, sectoresUnicos);
      
      // Log de períodos únicos
      const periodosUnicos = [...new Set(datos.map(row => row.Periodo))];
      console.log(`📅 [CAMAS] Períodos encontrados (${periodosUnicos.length}):`, periodosUnicos);
    }
    
    // Filtrar por sector si se especifica
    if (sector && sector.trim()) {
      const sectorTrim = sector.trim().toUpperCase();
      const datosSinFiltrar = datos.length;
      datos = datos.filter(row => 
        row.ValorSector && row.ValorSector.toString().trim().toUpperCase() === sectorTrim
      );
      console.log(`🔽 [CAMAS] Filtrado por sector '${sector}': ${datosSinFiltrar} → ${datos.length} registros`);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`🏁 [CAMAS] Proceso completado en ${totalTime}ms total`);
    
    return datos;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [CAMAS] Error después de ${totalTime}ms:`, {
      message: error.message,
      code: error.code,
      number: error.number,
      stack: error.stack?.split('\n').slice(0, 3)
    });
    throw new Error('Error al obtener ocupación promedio de camas');
  }
};

/**
 * Construye un resumen de ocupación en el período
 */
const obtenerResumenOcupacionCamas = async (fechaInicio, fechaFin, sector) => {
  const startTime = Date.now();
  console.log(`🔍 [RESUMEN] Iniciando cálculo de resumen - Rango: ${fechaInicio} a ${fechaFin}`);
  
  try {
    const filas = await obtenerOcupacionCamas(fechaInicio, fechaFin, sector);
    console.log(`📊 [RESUMEN] Filas recibidas para resumen: ${filas.length}`);

    if (!filas.length) {
      console.log(`⚠️ [RESUMEN] Sin datos para el período, retornando resumen vacío`);
      return {
        totalCamasPromedio: 0,
        ocupadasPromedio: 0,
        disponiblesPromedio: 0,
        porcentajeOcupacionPromedio: 0,
        periodo: { fechaInicio, fechaFin }
      };
    }

    // Log de datos para cálculo
    console.log(`🧮 [RESUMEN] Calculando promedios de ${filas.length} registros`);
    const totalCamasArray = filas.map(f => toNumberSafe(f.TotalCamas));
    const ocupacionArray = filas.map(f => toNumberSafe(f.OcupacionPromedioPct));
    
    console.log(`📈 [RESUMEN] Arrays para cálculo:`, {
      totalCamasRange: `${Math.min(...totalCamasArray)} - ${Math.max(...totalCamasArray)}`,
      ocupacionRange: `${Math.min(...ocupacionArray)}% - ${Math.max(...ocupacionArray)}%`,
      totalCamasSum: totalCamasArray.reduce((a, b) => a + b, 0),
      ocupacionAvg: ocupacionArray.reduce((a, b) => a + b, 0) / ocupacionArray.length
    });

    // Calcular promedios basados en la nueva estructura
    const totalCamas = average(totalCamasArray);
    const pacientesDiaPromedio = average(filas.map(f => toNumberSafe(f.PacientesDia)));
    const ocupacionPromedio = average(ocupacionArray);
    
    // Calcular ocupadas y disponibles basado en el porcentaje
    const ocupadas = Math.round((ocupacionPromedio / 100) * totalCamas);
    const disponibles = Math.round(totalCamas - ocupadas);

    const resultado = {
      totalCamasPromedio: Math.round(totalCamas),
      ocupadasPromedio: ocupadas,
      disponiblesPromedio: disponibles,
      porcentajeOcupacionPromedio: Math.round(ocupacionPromedio * 100) / 100,
      periodo: { fechaInicio, fechaFin }
    };

    const totalTime = Date.now() - startTime;
    console.log(`🏁 [RESUMEN] Resumen completado en ${totalTime}ms:`, resultado);

    return resultado;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [RESUMEN] Error después de ${totalTime}ms:`, error.message);
    throw new Error('Error al obtener resumen de ocupación de camas');
  }
};

/**
 * Datos por fecha para gráficos temporales
 * Mapea la nueva estructura: ValorSector, Periodo, PacientesDia, TotalCamas, DiasDelMes, OcupacionPromedioPct
 */
const obtenerOcupacionCamasPorFecha = async (fechaInicio, fechaFin, sector) => {
  const startTime = Date.now();
  console.log(`🔍 [POR-FECHA] Iniciando procesamiento temporal - Rango: ${fechaInicio} a ${fechaFin}`);
  
  try {
    const filas = await obtenerOcupacionCamas(fechaInicio, fechaFin, sector);
    console.log(`📊 [POR-FECHA] Filas recibidas para procesamiento temporal: ${filas.length}`);
    
    // Agrupar por período (mes) y sumar datos de todos los sectores
    const porPeriodo = filas.reduce((acc, f) => {
      const periodo = f.Periodo; // formato 'yyyy-MM'
      if (!periodo) return acc;
      
      if (!acc[periodo]) {
        acc[periodo] = {
          totalCamas: 0,
          pacientesDiaTotal: 0,
          ocupacionPctTotal: 0,
          sectores: 0
        };
      }
      
      acc[periodo].totalCamas += toNumberSafe(f.TotalCamas);
      acc[periodo].pacientesDiaTotal += toNumberSafe(f.PacientesDia);
      acc[periodo].ocupacionPctTotal += toNumberSafe(f.OcupacionPromedioPct);
      acc[periodo].sectores += 1;
      
      return acc;
    }, {});

    console.log(`📅 [POR-FECHA] Períodos agrupados: ${Object.keys(porPeriodo).length}`, Object.keys(porPeriodo));

    // Convertir a array y calcular promedios
    const mapped = Object.entries(porPeriodo).map(([periodo, data]) => {
      const ocupacionPromedio = data.sectores > 0 ? data.ocupacionPctTotal / data.sectores : 0;
      const ocupadas = Math.round((ocupacionPromedio / 100) * data.totalCamas);
      const disponibles = data.totalCamas - ocupadas;
      
      // Convertir período 'yyyy-MM' a fecha del primer día del mes
      const fechaPeriodo = new Date(periodo + '-01').toISOString();
      
      return {
        fecha: fechaPeriodo,
        totalCamas: data.totalCamas,
        ocupadas,
        disponibles,
        porcentajeOcupacion: Number(ocupacionPromedio.toFixed(2))
      };
    }).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    const totalTime = Date.now() - startTime;
    console.log(`🏁 [POR-FECHA] Procesamiento temporal completado en ${totalTime}ms - ${mapped.length} puntos de datos`);
    console.log(`📈 [POR-FECHA] Muestra de datos temporales:`, mapped.slice(0, 3));

    return mapped;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ [POR-FECHA] Error después de ${totalTime}ms:`, error.message);
    throw new Error('Error al obtener ocupación de camas por fecha');
  }
};

// Helpers locales
function toNumberSafe(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function average(arr) {
  if (!arr || !arr.length) return 0;
  const sum = arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return sum / arr.length;
}

/**
 * Obtiene el estado actual REAL de ocupación de camas (tiempo real, no estadísticas)
 */
const obtenerEstadoActualCamas = async () => {
  const startTime = Date.now();
  console.log(`🔍 [ESTADO-ACTUAL] Iniciando consulta de estado actual en tiempo real`);
  
  try {
    const pool = await connectDB();
    console.log(`⏱️ [ESTADO-ACTUAL] Conexión DB establecida en ${Date.now() - startTime}ms`);
    
    // Query para obtener estado actual real de camas ocupadas HOY
    // Basada en la estructura real: imHabitacionCamas usa ValorHabitacionCama como ID y NumeroVisita para ocupación
    const query = `
      SELECT 
        COUNT(*) AS TotalCamas,
        SUM(CASE WHEN hc.NumeroVisita > 0 THEN 1 ELSE 0 END) AS CamasOcupadas,
        SUM(CASE WHEN hc.NumeroVisita = 0 OR hc.NumeroVisita IS NULL THEN 1 ELSE 0 END) AS CamasDisponibles
      FROM dbo.imHabitacionCamas hc
    `;
    
    console.log(`📋 [ESTADO-ACTUAL] Ejecutando query de estado real`);
    
    const queryStartTime = Date.now();
    const result = await pool.request().query(query);
    
    const queryTime = Date.now() - queryStartTime;
    console.log(`✅ [ESTADO-ACTUAL] Query completada en ${queryTime}ms`);
    
    const datos = result.recordset[0];
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
