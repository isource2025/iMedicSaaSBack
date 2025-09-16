const indicadoresService = require('../services/indicadores.service');

/**
 * Obtiene indicadores de pacientes
 */
const obtenerIndicadores = async (req, res) => {
  try {
    const { 
      tipoIndicador = 'Ingresos', 
      fechaInicio, 
      fechaFin 
    } = req.query;

    // Validar parámetros requeridos
    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({
        success: false,
        message: 'Los parámetros fechaInicio y fechaFin son requeridos'
      });
    }

    // Validar formato de fechas
    const fechaInicioDate = new Date(fechaInicio);
    const fechaFinDate = new Date(fechaFin);
    
    if (isNaN(fechaInicioDate.getTime()) || isNaN(fechaFinDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Formato de fecha inválido. Use YYYY-MM-DD'
      });
    }

    if (fechaInicioDate > fechaFinDate) {
      return res.status(400).json({
        success: false,
        message: 'La fecha de inicio no puede ser mayor que la fecha de fin'
      });
    }

    const indicadores = await indicadoresService.obtenerIndicadores(
      tipoIndicador, 
      fechaInicio, 
      fechaFin
    );

    res.json({
      success: true,
      data: indicadores,
      total: indicadores.length,
      parametros: {
        tipoIndicador,
        fechaInicio,
        fechaFin
      }
    });

  } catch (error) {
    console.error('Error en obtenerIndicadores:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Obtiene resumen de indicadores agrupados por clase de paciente
 */
const obtenerResumenIndicadores = async (req, res) => {
  try {
    const { 
      tipoIndicador = 'Ingresos', 
      fechaInicio, 
      fechaFin 
    } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({
        success: false,
        message: 'Los parámetros fechaInicio y fechaFin son requeridos'
      });
    }

    const resumen = await indicadoresService.obtenerResumenIndicadores(
      tipoIndicador, 
      fechaInicio, 
      fechaFin
    );

    res.json({
      success: true,
      data: resumen
    });

  } catch (error) {
    console.error('Error en obtenerResumenIndicadores:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Obtiene indicadores agrupados por fecha para gráficos temporales
 */
const obtenerIndicadoresPorFecha = async (req, res) => {
  try {
    const { 
      tipoIndicador = 'Ingresos', 
      fechaInicio, 
      fechaFin 
    } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({
        success: false,
        message: 'Los parámetros fechaInicio y fechaFin son requeridos'
      });
    }

    const indicadoresPorFecha = await indicadoresService.obtenerIndicadoresPorFecha(
      tipoIndicador, 
      fechaInicio, 
      fechaFin
    );

    res.json({
      success: true,
      data: indicadoresPorFecha
    });

  } catch (error) {
    console.error('Error en obtenerIndicadoresPorFecha:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

/**
 * Obtiene un resumen de pacientes para el día actual y lo compara con el día anterior.
 */
const obtenerResumenPacientesHoy = async (req, res) => {
  try {
    const resumen = await indicadoresService.obtenerResumenPacientesHoy();
    res.json({
      success: true,
      data: resumen
    });
  } catch (error) {
    console.error('Error en obtenerResumenPacientesHoy:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
};

const obtenerEstadoActualCamas = async (req, res) => {
  try {
    const data = await indicadoresService.obtenerEstadoActualCamas();
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Error en obtenerEstadoActualCamas:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
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
 */

const validarRangoFechas = (req, res) => {
  const { fechaInicio, fechaFin } = req.query;
  if (!fechaInicio || !fechaFin) {
    res.status(400).json({ success: false, message: 'Los parámetros fechaInicio y fechaFin son requeridos' });
    return null;
  }
  const fi = new Date(fechaInicio);
  const ff = new Date(fechaFin);
  if (isNaN(fi.getTime()) || isNaN(ff.getTime())) {
    res.status(400).json({ success: false, message: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    return null;
  }
  if (fi > ff) {
    res.status(400).json({ success: false, message: 'La fecha de inicio no puede ser mayor que la fecha de fin' });
    return null;
  }
  return { fechaInicio, fechaFin };
};

const obtenerOcupacionCamas = async (req, res) => {
  try {
    const params = validarRangoFechas(req, res);
    if (!params) return;
    const { sector } = req.query;
    const data = await indicadoresService.obtenerOcupacionCamas(params.fechaInicio, params.fechaFin, sector);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en obtenerOcupacionCamas:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
};

const obtenerResumenOcupacionCamas = async (req, res) => {
  try {
    const params = validarRangoFechas(req, res);
    if (!params) return;
    const { sector } = req.query;
    const data = await indicadoresService.obtenerResumenOcupacionCamas(params.fechaInicio, params.fechaFin, sector);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en obtenerResumenOcupacionCamas:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
};

const obtenerOcupacionCamasPorFecha = async (req, res) => {
  try {
    const params = validarRangoFechas(req, res);
    if (!params) return;
    const { sector } = req.query;
    const data = await indicadoresService.obtenerOcupacionCamasPorFecha(params.fechaInicio, params.fechaFin, sector);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en obtenerOcupacionCamasPorFecha:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
};

module.exports.obtenerOcupacionCamas = obtenerOcupacionCamas;
module.exports.obtenerResumenOcupacionCamas = obtenerResumenOcupacionCamas;
module.exports.obtenerOcupacionCamasPorFecha = obtenerOcupacionCamasPorFecha;
module.exports.obtenerEstadoActualCamas = obtenerEstadoActualCamas;
