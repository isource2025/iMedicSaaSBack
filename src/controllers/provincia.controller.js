/**
 * @fileoverview Controlador para manejar las rutas relacionadas con la tabla imProvincia
 * @module controllers/provincia.controller
 */

const provinciaService = require('../services/provincia.service');

/**
 * Controlador para gestionar las operaciones con la tabla imProvincia
 */
const provinciaController = {
  /**
   * Obtiene todas las provincias
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con los resultados o mensaje de error
   */
  getProvincias: async (req, res) => {
    try {
      const provincias = await provinciaService.getProvincias();
      res.json({
        success: true,
        data: provincias
      });
    } catch (error) {
      console.error('Error en el controlador de provincias:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener las provincias',
        error: error.message
      });
    }
  },

  /**
   * Obtiene una provincia por su valor
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la provincia encontrada o mensaje de error
   */
  getProvincia: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      const provincia = await provinciaService.getProvincia(valor);
      
      if (!provincia) {
        return res.status(404).json({
          success: false,
          message: `No se encontró una provincia con el valor ${valor}`
        });
      }
      
      res.json({
        success: true,
        data: provincia
      });
    } catch (error) {
      console.error('Error en el controlador de provincias:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener la provincia',
        error: error.message
      });
    }
  },

  /**
   * Obtiene provincias por nacionalidad
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con las provincias encontradas o mensaje de error
   */
  getProvinciasByNacionalidad: async (req, res) => {
    try {
      const valorNacionalidad = req.params.valorNacionalidad;
      
      if (!valorNacionalidad || valorNacionalidad.length > 2) {
        return res.status(400).json({
          success: false,
          message: 'El valor de nacionalidad debe ser un código de 1-2 caracteres'
        });
      }
      
      const provincias = await provinciaService.getProvinciasByNacionalidad(valorNacionalidad);
      
      res.json({
        success: true,
        data: provincias
      });
    } catch (error) {
      console.error('Error en el controlador de provincias:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener provincias por nacionalidad',
        error: error.message
      });
    }
  },

  /**
   * Crea una nueva provincia
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la provincia creada o mensaje de error
   */
  createProvincia: async (req, res) => {
    try {
      const { Valor, LetraProvincia, Descripcion, ValorNacionalidad } = req.body;
      
      // Validación básica de los datos
      if (!Valor || !LetraProvincia || !Descripcion || !ValorNacionalidad) {
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
      
      const nuevaProvincia = {
        Valor: valorNumerico,
        LetraProvincia,
        Descripcion,
        ValorNacionalidad
      };
      
      const provinciaCreada = await provinciaService.createProvincia(nuevaProvincia);
      
      res.status(201).json({
        success: true,
        message: 'Provincia creada correctamente',
        data: provinciaCreada
      });
    } catch (error) {
      console.error('Error en el controlador de provincias:', error);
      
      // Si es un error de validación (como provincia duplicada)
      if (error.message.includes('Ya existe')) {
        return res.status(409).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al crear la provincia',
        error: error.message
      });
    }
  },

  /**
   * Actualiza una provincia existente
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con la provincia actualizada o mensaje de error
   */
  updateProvincia: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      const { LetraProvincia, Descripcion, ValorNacionalidad } = req.body;
      
      // Verifica que al menos se proporcione un campo para actualizar
      if (!LetraProvincia && !Descripcion && !ValorNacionalidad) {
        return res.status(400).json({
          success: false,
          message: 'Debe proporcionar al menos un campo para actualizar'
        });
      }
      
      const datosActualizacion = {};
      
      if (LetraProvincia !== undefined) {
        datosActualizacion.LetraProvincia = LetraProvincia;
      }
      
      if (Descripcion !== undefined) {
        datosActualizacion.Descripcion = Descripcion;
      }
      
      if (ValorNacionalidad !== undefined) {
        datosActualizacion.ValorNacionalidad = ValorNacionalidad;
      }
      
      const provinciaActualizada = await provinciaService.updateProvincia(valor, datosActualizacion);
      
      res.json({
        success: true,
        message: 'Provincia actualizada correctamente',
        data: provinciaActualizada
      });
    } catch (error) {
      console.error('Error en el controlador de provincias:', error);
      
      // Si no existe la provincia
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al actualizar la provincia',
        error: error.message
      });
    }
  },

  /**
   * Elimina una provincia
   * @param {Object} req - Objeto de solicitud Express
   * @param {Object} res - Objeto de respuesta Express
   * @returns {Object} Respuesta JSON con mensaje de éxito o error
   */
  deleteProvincia: async (req, res) => {
    try {
      const valor = parseInt(req.params.valor);
      
      if (isNaN(valor)) {
        return res.status(400).json({
          success: false,
          message: 'El valor debe ser un número'
        });
      }
      
      await provinciaService.deleteProvincia(valor);
      
      res.json({
        success: true,
        message: `Provincia con valor ${valor} eliminada correctamente`
      });
    } catch (error) {
      console.error('Error en el controlador de provincias:', error);
      
      // Si no existe la provincia
      if (error.message.includes('No existe')) {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }
      
      res.status(500).json({
        success: false,
        message: 'Error al eliminar la provincia',
        error: error.message
      });
    }
  }
};

module.exports = provinciaController;
