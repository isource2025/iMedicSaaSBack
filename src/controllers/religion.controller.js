/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imReligion
 * @module controllers/religion.controller
 */

const religionService = require('../services/religion.service');

/**
 * Controlador para gestionar las operaciones con la tabla imReligion
 */
const religionController = {
  /**
   * Obtiene todas las religiones
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con los resultados o mensaje de error
   */
  getReligiones: async (req, res) => {
    try {
      const religiones = await religionService.getReligiones();
      res.json({
        success: true,
        data: religiones
      });
    } catch (error) {
      console.error('Error en el controlador de religiones:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener las religiones',
        error: error.message
      });
    }
  },

  /**
   * Obtiene una religión por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la religión encontrada o mensaje de error
   */
  getReligion: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      const religion = await religionService.getReligion(valor);
      
      if (!religion) {
        return res.status(404).json({
          success: false,
          message: `No se encontró una religión con el valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: religion
      });
    } catch (error) {
      console.error('Error en el controlador de religiones:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener la religión',
        error: error.message
      });
    }
  },

  /**
   * Crea una nueva religión
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la religión creada o mensaje de error
   */
  createReligion: async (req, res) => {
    try {
      const { Valor, Descripcion } = req.body;
      
      // Validación básica de los datos
      if (!Valor || !Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios'
        });
      }
      
      // Validar formato del valor (3 caracteres máximo)
      if (Valor.length > 3) {
        return res.status(400).json({
          success: false,
          message: 'El Valor debe tener como máximo 3 caracteres'
        });
      }
      
      const nuevaReligion = {
        Valor,
        Descripcion
      };
      
      const religionCreada = await religionService.createReligion(nuevaReligion);
      
      res.status(201).json({
        success: true,
        message: 'Religión creada correctamente',
        data: religionCreada
      });
    } catch (error) {
      console.error('Error en el controlador de religiones:', error);
      
      // Si es un error de validación (como religión duplicada)
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al crear la religión',
        error: error.message
      });
    }
  },

  /**
   * Actualiza una religión existente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la religión actualizada o mensaje de error
   */
  updateReligion: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      const { Descripcion } = req.body;
      
      if (!Descripcion) {
        return res.status(400).json({
          success: false,
          message: 'La descripción es obligatoria'
        });
      }
      
      const religionActualizada = await religionService.updateReligion(valor, Descripcion);
      
      res.json({
        success: true,
        message: 'Religión actualizada correctamente',
        data: religionActualizada
      });
    } catch (error) {
      console.error('Error en el controlador de religiones:', error);
      
      // Si no existe la religión
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al actualizar la religión',
        error: error.message
      });
    }
  },

  /**
   * Elimina una religión
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con mensaje de éxito o error
   */
  deleteReligion: async (req, res) => {
    try {
      const valor = req.params.valor;
      
      if (!valor) {
        return res.status(400).json({
          success: false,
          message: 'El valor es obligatorio'
        });
      }
      
      await religionService.deleteReligion(valor);
      
      res.json({
        success: true,
        message: `Religión con valor ${valor} eliminada correctamente`
      });
    } catch (error) {
      console.error('Error en el controlador de religiones:', error);
      
      // Si no existe la religión
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al eliminar la religión',
        error: error.message
      });
    }
  }
};

module.exports = religionController;
