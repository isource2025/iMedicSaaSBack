/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imRaza
 * @module controllers/raza.controller
 */

const razaService = require('../services/raza.service');

/**
 * Controlador para gestionar las operaciones con la tabla imRaza
 */
const razaController = {
  /**
   * Obtiene todas las razas
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con los resultados o mensaje de error
   */
  getRazas: async (req, res) => {
    try {
      const razas = await razaService.getRazas();
      res.json({
        success: true,
        data: razas
      });
    } catch (error) {
      console.error('Error en el controlador de razas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener las razas',
        error: error.message
      });
    }
  },

  /**
   * Obtiene una raza por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la raza encontrada o mensaje de error
   */
  getRaza: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      const raza = await razaService.getRaza(valor);
      
      if (!raza) {
        return res.status(404).json({
          success: false,
          message: `No se encontró una raza con el valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: raza
      });
    } catch (error) {
      console.error('Error en el controlador de razas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener la raza',
        error: error.message
      });
    }
  },

  /**
   * Crea una nueva raza
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la raza creada o mensaje de error
   */
  createRaza: async (req, res) => {
    try {
      const { Valor, Descripcion } = req.body;
      
      // Validación básica de los datos
      if (!Valor || !Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios'
        });
      }
      
      const valorNumerico = parseInt(Valor);
      if (isNaN(valorNumerico)) {
        return res.status(400).json({
          success: false,
          message: 'El Valor debe ser un número'
        });
      }
      
      const nuevaRaza = {
        Valor: valorNumerico,
        Descripcion
      };
      
      const razaCreada = await razaService.createRaza(nuevaRaza);
      
      res.status(201).json({
        success: true,
        message: 'Raza creada correctamente',
        data: razaCreada
      });
    } catch (error) {
      console.error('Error en el controlador de razas:', error);
      
      // Si es un error de validación (como raza duplicada)
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al crear la raza',
        error: error.message
      });
    }
  },

  /**
   * Actualiza una raza existente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la raza actualizada o mensaje de error
   */
  updateRaza: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      const { Descripcion } = req.body;
      
      if (!Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'La descripción es obligatoria'
        });
      }
      
      const razaActualizada = await razaService.updateRaza(valor, Descripcion);
      
      res.json({
        success: true,
        message: 'Raza actualizada correctamente',
        data: razaActualizada
      });
    } catch (error) {
      console.error('Error en el controlador de razas:', error);
      
      // Si no existe la raza
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al actualizar la raza',
        error: error.message
      });
    }
  },

  /**
   * Elimina una raza
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con mensaje de éxito o error
   */
  deleteRaza: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      await razaService.deleteRaza(valor);
      
      res.json({
        success: true,
        message: `Raza con valor ${valor} eliminada correctamente`
      });
    } catch (error) {
      console.error('Error en el controlador de razas:', error);
      
      // Si no existe la raza
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al eliminar la raza',
        error: error.message
      });
    }
  }
};

module.exports = razaController;
