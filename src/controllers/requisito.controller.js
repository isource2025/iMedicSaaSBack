/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imRequisitos
 * @module controllers/requisito.controller
 */

const requisitoService = require('../services/requisito.service');

/**
 * Controlador para gestionar las operaciones con la tabla imRequisitos
 */
const requisitoController = {
  /**
   * Obtiene todos los requisitos
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con los resultados o mensaje de error
   */
  getRequisitos: async (req, res) => {
    try {
      const requisitos = await requisitoService.getRequisitos();
      res.json({
        success: true,
        data: requisitos
      });
    } catch (error) {
      console.error('Error en el controlador de requisitos:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener los requisitos',
        error: error.message
      });
    }
  },

  /**
   * Obtiene un requisito por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el requisito encontrado o mensaje de error
   */
  getRequisito: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      const requisito = await requisitoService.getRequisito(valor);
      
      if (!requisito) {
        return res.status(404).json({
          success: false,
          message: `No se encontró un requisito con el valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: requisito
      });
    } catch (error) {
      console.error('Error en el controlador de requisitos:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener el requisito',
        error: error.message
      });
    }
  },

  /**
   * Crea un nuevo requisito
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el requisito creado o mensaje de error
   */
  createRequisito: async (req, res) => {
    try {
      const { Valor, Descripcion, AplicableAlPaciente } = req.body;
      
      // Validación básica de los datos
      if (Valor === undefined || !Descripcion || !AplicableAlPaciente) {
        return res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios'
        });
      }
      
      // Validar tipo y rango del Valor
      const valorNumero = parseInt(Valor);
      if (isNaN(valorNumero) || valorNumero < 0 || valorNumero > 255) {
        return res.status(400).json({
          success: false,
          message: 'El Valor debe ser un número entre 0 y 255'
        });
      }
      
      // Validar longitud de los campos
      if (Descripcion.length > 40) {
        return res.status(400).json({
          success: false,
          message: 'La Descripción no puede exceder los 40 caracteres'
        });
      }
      
      if (AplicableAlPaciente.length > 10) {
        return res.status(400).json({
          success: false,
          message: 'El campo AplicableAlPaciente no puede exceder los 10 caracteres'
        });
      }
      
      const nuevoRequisito = {
        Valor: valorNumero,
        Descripcion,
        AplicableAlPaciente
      };
      
      const requisitoCreado = await requisitoService.createRequisito(nuevoRequisito);
      
      res.status(201).json({
        success: true,
        message: 'Requisito creado correctamente',
        data: requisitoCreado
      });
    } catch (error) {
      console.error('Error en el controlador de requisitos:', error);
      
      // Si es un error de validación (como requisito duplicado)
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al crear el requisito',
        error: error.message
      });
    }
  },

  /**
   * Actualiza un requisito existente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el requisito actualizado o mensaje de error
   */
  updateRequisito: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      const { Descripcion, AplicableAlPaciente } = req.body;
      
      // Validar que al menos un campo esté presente
      if (!Descripcion && AplicableAlPaciente === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Debe proporcionar al menos un campo para actualizar'
        });
      }
      
      // Validar longitud de los campos si están presentes
      if (Descripcion && Descripcion.length > 40) {
        return res.status(400).json({
          success: false,
          message: 'La Descripción no puede exceder los 40 caracteres'
        });
      }
      
      if (AplicableAlPaciente && AplicableAlPaciente.length > 10) {
        return res.status(400).json({
          success: false,
          message: 'El campo AplicableAlPaciente no puede exceder los 10 caracteres'
        });
      }
      
      const datosActualizacion = {};
      if (Descripcion !== undefined) datosActualizacion.Descripcion = Descripcion;
      if (AplicableAlPaciente !== undefined) datosActualizacion.AplicableAlPaciente = AplicableAlPaciente;
      
      const requisitoActualizado = await requisitoService.updateRequisito(valor, datosActualizacion);
      
      res.json({
        success: true,
        message: 'Requisito actualizado correctamente',
        data: requisitoActualizado
      });
    } catch (error) {
      console.error('Error en el controlador de requisitos:', error);
      
      // Si no existe el requisito
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al actualizar el requisito',
        error: error.message
      });
    }
  },

  /**
   * Elimina un requisito
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con mensaje de éxito o error
   */
  deleteRequisito: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      await requisitoService.deleteRequisito(valor);
      
      res.json({
        success: true,
        message: `Requisito con valor ${valor} eliminado correctamente`
      });
    } catch (error) {
      console.error('Error en el controlador de requisitos:', error);
      
      // Si no existe el requisito
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al eliminar el requisito',
        error: error.message
      });
    }
  }
};

module.exports = requisitoController;
