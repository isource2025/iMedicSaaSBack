/**
 * Controlador para la gestión de movimientos de visitas
 * @module controllers/visitaMovimientos.controller
 */
const visitaMovimientosService = require('../services/visitaMovimientos.service');

/**
 * Obtiene el último movimiento de una visita
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerUltimoMovimientoVisita = async (req, res) => {
  try {
    const numeroVisita = req.params.numeroVisita;
    console.log('Solicitando último movimiento para visita:', numeroVisita);

    if (!numeroVisita) {
      console.log('Error: No se proporcionó número de visita');
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el número de visita'
      });
    }

    // Intentar convertir a entero para validar
    const numeroVisitaInt = parseInt(numeroVisita, 10);
    if (isNaN(numeroVisitaInt)) {
      console.error(`Error: El número de visita '${numeroVisita}' no es un número válido`);
      return res.status(400).json({
        success: false,
        mensaje: `El número de visita '${numeroVisita}' no es un número válido`
      });
    }

    const movimiento = await visitaMovimientosService.obtenerUltimoMovimientoVisita(numeroVisitaInt);

    if (!movimiento) {
      return res.status(404).json({
        success: false,
        mensaje: 'No se encontró ningún movimiento para esta visita'
      });
    }

    console.log('Enviando datos del último movimiento:', JSON.stringify(movimiento));
    res.json({
      success: true,
      data: movimiento
    });
  } catch (error) {
    console.error('Error al obtener último movimiento de visita:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener el último movimiento de la visita',
      error: error.message
    });
  }
};

/**
 * Actualiza el último movimiento de una visita con los datos de egreso
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const actualizarUltimoMovimientoVisita = async (req, res) => {
  try {
    const numeroVisita = req.params.numeroVisita;
    const datosEgreso = req.body;
    
    console.log('=== ACTUALIZACIÓN DE MOVIMIENTO DE VISITA ===');
    console.log(`Parámetro numeroVisita (tipo: ${typeof numeroVisita}): '${numeroVisita}'`);
    console.log('URL completa:', req.originalUrl);
    console.log('Parámetros de ruta:', req.params);
    console.log('Datos de egreso recibidos:', JSON.stringify(datosEgreso, null, 2));
    console.log('================================');

    if (!numeroVisita) {
      console.log('Error: No se proporcionó número de visita');
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el número de visita'
      });
    }

    // Intentar convertir a entero para validar
    const numeroVisitaInt = parseInt(numeroVisita, 10);
    if (isNaN(numeroVisitaInt)) {
      console.error(`Error: El número de visita '${numeroVisita}' no es un número válido`);
      return res.status(400).json({
        success: false,
        mensaje: `El número de visita '${numeroVisita}' no es un número válido`
      });
    }

    // Validar datos de egreso
    if (!datosEgreso || !datosEgreso.fechaEgreso || !datosEgreso.horaEgreso) {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requieren los datos de fecha y hora de egreso'
      });
    }

    // Validar disposicionEgreso si se proporciona
    if (datosEgreso.disposicionEgreso !== undefined) {
      const disposicionEgreso = parseInt(datosEgreso.disposicionEgreso, 10);
      if (isNaN(disposicionEgreso)) {
        return res.status(400).json({
          success: false,
          mensaje: 'La disposición de egreso debe ser un valor numérico'
        });
      }
      // Asignar el valor convertido
      datosEgreso.disposicionEgreso = disposicionEgreso;
    }

    // Validar diagnostico si se proporciona
    if (datosEgreso.diagnostico !== undefined && datosEgreso.diagnostico !== null) {
      if (typeof datosEgreso.diagnostico !== 'string' || datosEgreso.diagnostico.length > 6) {
        return res.status(400).json({
          success: false,
          mensaje: 'El diagnóstico debe ser una cadena de texto con máximo 6 caracteres'
        });
      }
    }

    console.log(`Llamando a visitaMovimientosService.actualizarUltimoMovimientoVisita con numeroVisita=${numeroVisitaInt} y datosEgreso:`, datosEgreso);
    const resultado = await visitaMovimientosService.actualizarUltimoMovimientoVisita(numeroVisitaInt, datosEgreso);

    res.json({
      success: true,
      mensaje: 'Movimiento actualizado correctamente',
      data: resultado.data
    });
  } catch (error) {
    console.error('Error al actualizar último movimiento de visita:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al actualizar el último movimiento de la visita',
      error: error.message
    });
  }
};

/**
 * Obtiene todos los movimientos de una visita
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerMovimientosVisita = async (req, res) => {
  try {
    const numeroVisita = req.params.numeroVisita;
    console.log('Solicitando movimientos para visita:', numeroVisita);

    if (!numeroVisita) {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el número de visita'
      });
    }

    const movimientos = await visitaMovimientosService.obtenerMovimientosVisita(numeroVisita);

    res.json({
      success: true,
      data: movimientos
    });
  } catch (error) {
    console.error('Error al obtener movimientos de visita:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los movimientos de la visita',
      error: error.message
    });
  }
};

module.exports = {
  obtenerUltimoMovimientoVisita,
  actualizarUltimoMovimientoVisita,
  obtenerMovimientosVisita
};
