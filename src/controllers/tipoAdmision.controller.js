/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imTipoAdmision
 * @module controllers/tipoAdmision.controller
 */

const tipoAdmisionService = require('../services/tipoAdmision.service');

/**
 * Controlador para gestionar las operaciones con la tabla imTipoAdmision
 */
const tipoAdmisionController = {
  /**
   * Obtiene todos los tipos de admisión
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con los resultados o mensaje de error
   */
  getTiposAdmision: async (req, res) => {
    try {
      const tiposAdmision = await tipoAdmisionService.getTiposAdmision();
      res.json({
        success: true,
        data: tiposAdmision,
        message: 'Tipos de admisión obtenidos correctamente'
      });
    } catch (error) {
      console.error('Error en el controlador de tipos de admisión:', error);
      res.status(500).json({
        success: false,
        data: [],
        message: error.message || 'Error al obtener los tipos de admisión'
      });
    }
  },

  /**
   * Obtiene un tipo de admisión por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el tipo de admisión encontrado o mensaje de error
   */
  getTipoAdmision: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          data: null,
          message: 'El valor es obligatorio'
        });
      }
      
      const tipoAdmision = await tipoAdmisionService.getTipoAdmision(valor);
      
      if (!tipoAdmision) {
        return res.status(404).json({
          success: false,
          data: null,
          message: `No se encontró un tipo de admisión con el valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: tipoAdmision,
        message: 'Tipo de admisión obtenido correctamente'
      });
    } catch (error) {
      console.error('Error en el controlador de tipos de admisión:', error);
      res.status(500).json({
        success: false,
        data: null,
        message: error.message || 'Error al obtener el tipo de admisión'
      });
    }
  },

  /**
   * Crea un nuevo tipo de admisión
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el tipo de admisión creado o mensaje de error
   */
  createTipoAdmision: async (req, res) => {
    try {
      const { valor, descripcion } = req.body;
      
      // Validación básica de los datos
      if (!valor || !descripcion) {
        return res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios'
        });
      }
      
      // Validar formato del valor (1 carácter exactamente)
      if (valor.length !== 1) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe tener exactamente 1 carácter'
        });
      }
      
      // Validar longitud de la descripción
      if (descripcion.length > 40) {
        return res.status(400).json({
          success: false,
          message: 'La descripción no puede exceder los 40 caracteres'
        });
      }
      
      const nuevoTipoAdmision = { valor, descripcion };
      
      const tipoAdmisionCreado = await tipoAdmisionService.createTipoAdmision(nuevoTipoAdmision);
      
      res.status(201).json({
        success: true,
        message: 'Tipo de admisión creado correctamente',
        data: tipoAdmisionCreado
      });
    } catch (error) {
      console.error('Error en el controlador de tipos de admisión:', error);
      
      // Si es un error de validación (como tipo de admisión duplicado)
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al crear el tipo de admisión'
      });
    }
  },

  /**
   * Actualiza un tipo de admisión existente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con el tipo de admisión actualizado o mensaje de error
   */
  updateTipoAdmision: async (req, res) => {
    try {
      const valor = req.params.valor;
      const { descripcion } = req.body;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      if (!descripcion) {
        return res.status(400).json({
          success: false,
          message: 'La descripción es obligatoria'
        });
      }
      
      // Validar longitud de la descripción
      if (descripcion.length > 40) {
        return res.status(400).json({
          success: false,
          message: 'La descripción no puede exceder los 40 caracteres'
        });
      }
      
      const tipoAdmisionActualizado = await tipoAdmisionService.updateTipoAdmision(valor, descripcion);
      
      res.json({
        success: true,
        message: 'Tipo de admisión actualizado correctamente',
        data: tipoAdmisionActualizado
      });
    } catch (error) {
      console.error('Error en el controlador de tipos de admisión:', error);
      
      // Si no existe el tipo de admisión
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al actualizar el tipo de admisión'
      });
    }
  },

  /**
   * Elimina un tipo de admisión
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con mensaje de éxito o error
   */
  deleteTipoAdmision: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      await tipoAdmisionService.deleteTipoAdmision(valor);
      
      res.json({
        success: true,
        message: `Tipo de admisión con valor ${valor} eliminado correctamente`
      });
    } catch (error) {
      console.error('Error en el controlador de tipos de admisión:', error);
      
      // Si no existe el tipo de admisión
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: error.message || 'Error al eliminar el tipo de admisión'
      });
    }
  }
};

module.exports = tipoAdmisionController;
