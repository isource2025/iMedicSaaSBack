/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la tabla imTipoAdmision
 * @module services/tipoAdmision.service
 */

const { executeQuery } = require('../config/database');

/**
 * Servicio para gestionar los tipos de admisión
 */
const tipoAdmisionService = {
  /**
   * Obtiene todos los tipos de admisión
   * @returns {Promise<Array>} Lista de tipos de admisión
   */
  getTiposAdmision: async () => {
    try {
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(1)) AS valor, 
          descripcion 
        FROM 
          imTipoAdmision 
        ORDER BY 
          descripcion
      `;
      
      const result = await executeQuery(query);
      return result || [];
    } catch (error) {
      console.error('Error al obtener tipos de admisión:', error);
      throw error;
    }
  },

  /**
   * Obtiene un tipo de admisión específico por su valor
   * @param {string} valor - Valor del tipo de admisión a buscar
   * @returns {Promise<Object|null>} Tipo de admisión encontrado o null
   */
  getTipoAdmision: async (valor) => {
    try {
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(1)) AS valor, 
          descripcion 
        FROM 
          imTipoAdmision 
        WHERE 
          valor = @p0
      `;
      
      const result = await executeQuery(query, [
        { value: valor }
      ]);
      
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener tipo de admisión con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea un nuevo tipo de admisión
   * @param {Object} tipoAdmision - Datos del tipo de admisión a crear
   * @param {string} tipoAdmision.valor - Valor del tipo de admisión (1 carácter)
   * @param {string} tipoAdmision.descripcion - Descripción del tipo de admisión
   * @returns {Promise<Object>} Resultado de la operación
   */
  createTipoAdmision: async (tipoAdmision) => {
    try {
      // Validar que todos los campos requeridos estén presentes
      if (!tipoAdmision.valor || !tipoAdmision.descripcion) {
        throw new Error('Todos los campos son obligatorios');
      }
      
      // Validar que el valor tenga el formato correcto (1 carácter)
      if (tipoAdmision.valor.length !== 1) {
        throw new Error('El valor debe tener exactamente 1 carácter');
      }
      
      // Validar longitud de la descripción
      if (tipoAdmision.descripcion.length > 40) {
        throw new Error('La descripción no puede exceder los 40 caracteres');
      }
      
      // Verificar si ya existe un tipo de admisión con el mismo valor
      const existingTipoAdmision = await tipoAdmisionService.getTipoAdmision(tipoAdmision.valor);
      if (existingTipoAdmision) {
        throw new Error(`Ya existe un tipo de admisión con el valor ${tipoAdmision.valor}`);
      }
      
      // Insertar el nuevo tipo de admisión
      const query = `
        INSERT INTO imTipoAdmision (valor, descripcion) 
        VALUES (@p0, @p1)
      `;
      
      await executeQuery(query, [
        { value: tipoAdmision.valor },
        { value: tipoAdmision.descripcion }
      ]);
      
      // Devolver el tipo de admisión recién creado
      return await tipoAdmisionService.getTipoAdmision(tipoAdmision.valor);
    } catch (error) {
      console.error('Error al crear tipo de admisión:', error);
      throw error;
    }
  },

  /**
   * Actualiza un tipo de admisión existente
   * @param {string} valor - Valor del tipo de admisión a actualizar
   * @param {string} descripcion - Nueva descripción
   * @returns {Promise<Object>} Resultado de la operación
   */
  updateTipoAdmision: async (valor, descripcion) => {
    try {
      // Validar que la descripción no esté vacía
      if (!descripcion) {
        throw new Error('La descripción no puede estar vacía');
      }
      
      // Validar longitud de la descripción
      if (descripcion.length > 40) {
        throw new Error('La descripción no puede exceder los 40 caracteres');
      }
      
      // Verificar si el tipo de admisión existe
      const existingTipoAdmision = await tipoAdmisionService.getTipoAdmision(valor);
      if (!existingTipoAdmision) {
        throw new Error(`No existe un tipo de admisión con el valor ${valor}`);
      }
      
      // Actualizar el tipo de admisión
      const query = `
        UPDATE imTipoAdmision 
        SET descripcion = @p0 
        WHERE valor = @p1
      `;
      
      await executeQuery(query, [
        { value: descripcion },
        { value: valor }
      ]);
      
      // Devolver el tipo de admisión actualizado
      return await tipoAdmisionService.getTipoAdmision(valor);
    } catch (error) {
      console.error(`Error al actualizar tipo de admisión con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina un tipo de admisión
   * @param {string} valor - Valor del tipo de admisión a eliminar
   * @returns {Promise<Object>} Resultado de la operación
   */
  deleteTipoAdmision: async (valor) => {
    try {
      // Verificar si el tipo de admisión existe
      const existingTipoAdmision = await tipoAdmisionService.getTipoAdmision(valor);
      if (!existingTipoAdmision) {
        throw new Error(`No existe un tipo de admisión con el valor ${valor}`);
      }
      
      // Eliminar el tipo de admisión
      const query = `
        DELETE FROM imTipoAdmision 
        WHERE valor = @p0
      `;
      
      await executeQuery(query, [
        { value: valor }
      ]);
      
      return { success: true, message: 'Tipo de admisión eliminado correctamente' };
    } catch (error) {
      console.error(`Error al eliminar tipo de admisión con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = tipoAdmisionService;
