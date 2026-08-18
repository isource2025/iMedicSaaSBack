/**
 * Controlador para la gestión de movimientos de visitas
 * @module controllers/visitaMovimientos.controller
 */
const visitaMovimientosService = require('../services/visitaMovimientos.service');
const { requireOperadorCarga } = require('../utils/sessionIdentity');

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
    if (datosEgreso.diagnostico !== undefined && datosEgreso.diagnostico !== null && datosEgreso.diagnostico !== '') {
      if (typeof datosEgreso.diagnostico !== 'string' || datosEgreso.diagnostico.trim().length > 8) {
        return res.status(400).json({
          success: false,
          mensaje: 'El diagnóstico debe ser una cadena de texto con máximo 8 caracteres'
        });
      }
    }

    const codOperador = requireOperadorCarga(req, res);
    if (codOperador == null) return;
    datosEgreso.codOperador = codOperador;
    datosEgreso.operadorEgreso = codOperador;

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
      mensaje: error.message || 'Error al actualizar el último movimiento de la visita',
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

/**
 * Mueve un paciente de una cama a otra
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const moverPacienteACamaVacia = async (req, res) => {
  try {
    const numeroVisita = req.params.numeroVisita;
    const datosMover = req.body;
    
    console.log('=== MOVER PACIENTE A NUEVA CAMA ===');
    console.log(`Parámetro numeroVisita: '${numeroVisita}'`);
    console.log('Datos recibidos:', JSON.stringify(datosMover, null, 2));
    console.log('================================');

    if (!numeroVisita) {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el número de visita'
      });
    }

    // Validar número de visita
    const numeroVisitaInt = parseInt(numeroVisita, 10);
    if (isNaN(numeroVisitaInt)) {
      return res.status(400).json({
        success: false,
        mensaje: `El número de visita '${numeroVisita}' no es un número válido`
      });
    }

    // Validar datos requeridos (EstadoAmbulatorio y Diagnostico son opcionales)
    const camposRequeridos = [
      'FechaAdmision', 'HoraAdmision', 'FechaEgreso', 'HoraEgreso',
      'bedId', 'ValorSector', 'FechaCarga', 'HoraCarga'
    ];
    
    const camposFaltantes = camposRequeridos.filter(campo => !datosMover[campo]);
    
    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        mensaje: `Faltan los siguientes campos requeridos: ${camposFaltantes.join(', ')}`
      });
    }

    const codOperador = requireOperadorCarga(req, res);
    if (codOperador == null) return;
    datosMover.Operador = String(codOperador);

    // Llamar al servicio para mover al paciente
    const resultado = await visitaMovimientosService.moverPacienteACamaVacia(numeroVisitaInt, datosMover);

    res.json({
      success: true,
      mensaje: 'Paciente trasladado correctamente',
      data: resultado.data
    });
  } catch (error) {
    console.error('Error al mover paciente a nueva cama:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al mover al paciente a la nueva cama',
      error: error.message
    });
  }
};

/**
 * Intercambia las camas entre dos pacientes
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const intercambiarCamasPacientes = async (req, res) => {
  try {
    const { numeroVisita1, numeroVisita2 } = req.params;
    const datos = req.body;

    // Validar datos requeridos (EstadoAmbulatorio y Diagnostico son opcionales)
    const camposRequeridos = [
      'FechaEgreso', 'HoraEgreso', 'FechaAdmision', 'HoraAdmision',
      'FechaCarga', 'HoraCarga'
    ];

    const camposFaltantes = camposRequeridos.filter(campo => !datos[campo]);
    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        mensaje: `Faltan campos requeridos: ${camposFaltantes.join(', ')}`
      });
    }

    const codOperador = requireOperadorCarga(req, res);
    if (codOperador == null) return;
    datos.Operador = String(codOperador);

    // Realizar el intercambio
    const resultado = await visitaMovimientosService.intercambiarCamasPacientes(
      numeroVisita1,
      numeroVisita2,
      datos
    );

    res.json(resultado);
  } catch (error) {
    console.error('Error al intercambiar camas:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al intercambiar las camas entre pacientes',
      error: error.message
    });
  }
};

/**
 * Obtiene los movimientos de internación más recientes para el dashboard
 * @param {Object} req - Objeto de solicitud Express
 * @param {Object} res - Objeto de respuesta Express
 */
const obtenerMovimientosRecientes = async (req, res) => {
  try {
    const limite = parseInt(req.query.limite) || 10;
    
    if (limite > 50) {
      return res.status(400).json({
        success: false,
        mensaje: 'El límite máximo es 50 registros'
      });
    }

    const movimientos = await visitaMovimientosService.obtenerMovimientosRecientes(limite);

    res.json({
      success: true,
      data: movimientos,
      count: movimientos.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error al obtener movimientos recientes:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los movimientos recientes de internación',
      error: error.message
    });
  }
};

/**
 * Lista internados vigentes sin cama asignada
 */
const obtenerPacientesInternadosSinCama = async (req, res) => {
  try {
    const termino = req.query.termino || req.query.q || '';
    const data = await visitaMovimientosService.obtenerPacientesInternadosSinCama(termino);
    res.json({
      success: true,
      data,
      count: data.length,
    });
  } catch (error) {
    console.error('Error al listar internados sin cama:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener pacientes internados sin cama',
      error: error.message,
    });
  }
};

/**
 * Asigna una cama libre a un internado sin ubicación
 */
const asignarPacienteACama = async (req, res) => {
  try {
    const numeroVisita = req.params.numeroVisita;
    const datos = req.body;

    if (!numeroVisita) {
      return res.status(400).json({
        success: false,
        mensaje: 'Se requiere el número de visita',
      });
    }

    const numeroVisitaInt = parseInt(numeroVisita, 10);
    if (isNaN(numeroVisitaInt)) {
      return res.status(400).json({
        success: false,
        mensaje: `El número de visita '${numeroVisita}' no es un número válido`,
      });
    }

    // Compat: clientes viejos enviaban EstadoAmbulatorio con valor de clase
    if (!datos.ClasePaciente && datos.EstadoAmbulatorio) {
      datos.ClasePaciente = datos.EstadoAmbulatorio;
    }

    const camposRequeridos = [
      'FechaAdmision',
      'HoraAdmision',
      'ClasePaciente',
      'bedId',
      'ValorSector',
      'FechaCarga',
      'HoraCarga',
    ];
    const faltantes = camposRequeridos.filter((c) => !datos[c]);
    if (faltantes.length) {
      return res.status(400).json({
        success: false,
        mensaje: `Faltan campos requeridos: ${faltantes.join(', ')}`,
      });
    }

    const codOperador = requireOperadorCarga(req, res);
    if (codOperador == null) return;
    datos.Operador = String(codOperador);

    const resultado = await visitaMovimientosService.asignarPacienteACama(numeroVisitaInt, datos);
    res.json({
      success: true,
      mensaje: 'Cama asignada correctamente',
      data: resultado.data,
    });
  } catch (error) {
    console.error('Error al asignar cama:', error);
    res.status(500).json({
      success: false,
      mensaje: error.message || 'Error al asignar la cama',
      error: error.message,
    });
  }
};

module.exports = {
  obtenerUltimoMovimientoVisita,
  actualizarUltimoMovimientoVisita,
  obtenerMovimientosVisita,
  moverPacienteACamaVacia,
  intercambiarCamasPacientes,
  obtenerMovimientosRecientes,
  obtenerPacientesInternadosSinCama,
  asignarPacienteACama,
};
