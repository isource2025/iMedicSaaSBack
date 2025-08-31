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

module.exports = {
  obtenerIndicadores,
  obtenerResumenIndicadores,
  obtenerIndicadoresPorFecha
};
