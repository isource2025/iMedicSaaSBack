/**
 * @fileoverview Controlador para gestionar las operaciones CRUD de la tabla imTipoPaciente
 * @module controllers/tipoPaciente.controller
 */

const tipoPacienteService = require('../services/tipoPaciente.service');

/**
 * Controlador para los tipos de paciente
 */
const tipoPacienteController = {
  /**
   * Obtiene todos los tipos de paciente
   * @param {Object} req - Objeto de solicitud
   * @param {Object} res - Objeto de respuesta
   * @returns {Object} Respuesta con los tipos de paciente
   */
  getTiposPaciente: async (req, res) => {
    try {
      const tiposPaciente = await tipoPacienteService.getTiposPaciente();
      return res.json({
        success: true,
        data: tiposPaciente,
        message: 'Tipos de paciente obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en controlador getTiposPaciente:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al obtener los tipos de paciente',
        error: error.message
      });
    }
  },

  /**
   * Obtiene un tipo de paciente por su valor
   * @param {Object} req - Objeto de solicitud
   * @param {Object} res - Objeto de respuesta
   * @returns {Object} Respuesta con el tipo de paciente
   */
  getTipoPaciente: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere el valor del tipo de paciente'
        });
      }
      
      const tipoPaciente = await tipoPacienteService.getTipoPaciente(valor);
      
      if (!tipoPaciente) {
        return res.status(404).json({
          success: false,
          message: `No se encontró un tipo de paciente con el valor ${valor}`
        });
      }
      
      return res.json({
        success: true,
        data: tipoPaciente,
        message: 'Tipo de paciente obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en controlador getTipoPaciente:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al obtener el tipo de paciente',
        error: error.message
      });
    }
  },

  /**
   * Crea un nuevo tipo de paciente
   * @param {Object} req - Objeto de solicitud con los datos del tipo de paciente
   * @param {Object} res - Objeto de respuesta
   * @returns {Object} Respuesta con el resultado de la operación
   */
  createTipoPaciente: async (req, res) => {
    try {
      const { valor, descripcion } = req.body;
      
      // Validaciones adicionales a nivel de controlador
      if (!valor || !descripcion) {
        return res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios'
        });
      }
      
      if (valor.length !== 1) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe tener exactamente 1 carácter'
        });
      }
      
      if (descripcion.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'La descripción no puede exceder los 20 caracteres'
        });
      }
      
      // Crear el tipo de paciente
      const tipoPacienteCreado = await tipoPacienteService.createTipoPaciente({
        valor,
        descripcion
      });
      
      return res.status(201).json({
        success: true,
        data: tipoPacienteCreado,
        message: 'Tipo de paciente creado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador createTipoPaciente:', error);
      
      // Si es un error de duplicación, devolver un mensaje específico
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Error al crear el tipo de paciente',
        error: error.message
      });
    }
  },

  /**
   * Actualiza un tipo de paciente existente
   * @param {Object} req - Objeto de solicitud con los datos del tipo de paciente
   * @param {Object} res - Objeto de respuesta
   * @returns {Object} Respuesta con el resultado de la operación
   */
  updateTipoPaciente: async (req, res) => {
    try {
      const { valor } = req.params;
      const { descripcion } = req.body;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere el valor del tipo de paciente'
        });
      }
      
      if (!descripcion) {
        return res.status(400).json({
          success: false,
          message: 'La descripción es obligatoria'
        });
      }
      
      if (descripcion.length > 20) {
        return res.status(400).json({
          success: false,
          message: 'La descripción no puede exceder los 20 caracteres'
        });
      }
      
      // Actualizar el tipo de paciente
      const tipoPacienteActualizado = await tipoPacienteService.updateTipoPaciente(valor, descripcion);
      
      return res.json({
        success: true,
        data: tipoPacienteActualizado,
        message: 'Tipo de paciente actualizado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador updateTipoPaciente:', error);
      
      // Si es un error de registro no encontrado, devolver un mensaje específico
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Error al actualizar el tipo de paciente',
        error: error.message
      });
    }
  },

  /**
   * Elimina un tipo de paciente
   * @param {Object} req - Objeto de solicitud con el valor del tipo de paciente a eliminar
   * @param {Object} res - Objeto de respuesta
   * @returns {Object} Respuesta con el resultado de la operación
   */
  deleteTipoPaciente: async (req, res) => {
    try {
      const { valor } = req.params;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'Se requiere el valor del tipo de paciente'
        });
      }
      
      // Eliminar el tipo de paciente
      const resultado = await tipoPacienteService.deleteTipoPaciente(valor);
      
      return res.json({
        success: true,
        data: resultado,
        message: 'Tipo de paciente eliminado correctamente'
      });
    } catch (error) {
      console.error('Error en controlador deleteTipoPaciente:', error);
      
      // Si es un error de registro no encontrado, devolver un mensaje específico
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      return res.status(500).json({
        success: false,
        message: 'Error al eliminar el tipo de paciente',
        error: error.message
      });
    }
  }
};

module.exports = tipoPacienteController;
