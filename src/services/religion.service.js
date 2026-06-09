/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la entidad Religion
 * @module services/religion.service
 */

const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar las religiones
 */
const religionService = {
  /**
   * Obtiene todas las religiones
   * @returns {Promise<Array>} Lista de religiones
   */
  getReligiones: async () => {
    try {
      const query = 'SELECT Valor, Descripcion FROM imReligion ORDER BY Descripcion';
      const result = await executeQuery(query);
      
      return result;
    } catch (error) {
      console.error('Error al obtener religiones:', error);
      throw error;
    }
  },

  /**
   * Obtiene una religión específica por su valor
   * @param {string} valor - Valor de la religión a buscar
   * @returns {Promise<Object|null>} Religión encontrada o null
   */
  getReligion: async (valor) => {
    try {
      const query = 'SELECT Valor, Descripcion FROM imReligion WHERE Valor = @p0';
      const result = await executeQuery(query, [{ value: valor }]);
      
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener religión con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea una nueva religión
   * @param {Object} religion - Datos de la religión a crear
   * @param {string} religion.Valor - Código de la religión (3 caracteres)
   * @param {string} religion.Descripcion - Descripción de la religión
   * @returns {Promise<Object>} Religión creada
   */
  createReligion: async (religion) => {
    try {
      // Validar que todos los campos requeridos estén presentes
      if (!religion.Valor || !religion.Descripcion) {
        throw new Error('Todos los campos son obligatorios');
      }
      
      // Validar que el valor tenga el formato correcto (3 caracteres)
      if (religion.Valor.length > 3) {
        throw new Error('El valor debe tener como máximo 3 caracteres');
      }
      
      // Verificar si ya existe una religión con el mismo valor
      const existingReligion = await religionService.getReligion(religion.Valor);
      if (existingReligion) {
        throw new Error(`Ya existe una religión con el valor ${religion.Valor}`);
      }
      
      // Insertar la nueva religión
      const query = 'INSERT INTO imReligion (Valor, Descripcion) VALUES (?, ?)';
      await executeQuery(query, [religion.Valor, religion.Descripcion]);
      
      // Devolver la religión recién creada
      return await religionService.getReligion(religion.Valor);
    } catch (error) {
      console.error('Error al crear religión:', error);
      throw error;
    }
  },

  /**
   * Actualiza una religión existente
   * @param {string} valor - Valor de la religión a actualizar
   * @param {string} descripcion - Nueva descripción
   * @returns {Promise<Object>} Religión actualizada
   */
  updateReligion: async (valor, descripcion) => {
    try {
      // Validar que la descripción no esté vacía
      if (!descripcion) {
        throw new Error('La descripción no puede estar vacía');
      }
      
      // Verificar si la religión existe
      const existingReligion = await religionService.getReligion(valor);
      if (!existingReligion) {
        throw new Error(`No existe una religión con el valor ${valor}`);
      }
      
      // Actualizar la religión
      const query = 'UPDATE imReligion SET Descripcion = ? WHERE Valor = ?';
      await executeQuery(query, [descripcion, valor]);
      
      // Devolver la religión actualizada
      return await religionService.getReligion(valor);
    } catch (error) {
      console.error(`Error al actualizar religión con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina una religión
   * @param {string} valor - Valor de la religión a eliminar
   * @returns {Promise<void>}
   */
  deleteReligion: async (valor) => {
    try {
      // Verificar si la religión existe
      const existingReligion = await religionService.getReligion(valor);
      if (!existingReligion) {
        throw new Error(`No existe una religión con el valor ${valor}`);
      }
      
      // Eliminar la religión
      const query = 'DELETE FROM imReligion WHERE Valor = ?';
      await executeQuery(query, [valor]);
    } catch (error) {
      console.error(`Error al eliminar religión con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = religionService;
