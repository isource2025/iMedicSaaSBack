const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar la tabla imNacionalidad
 */
const nacionalidadService = {
  /**
   * Obtiene todos los registros de la tabla imNacionalidad
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */
  getNacionalidades: async () => {
    try {
      const query = `
        SELECT 
          Valor, 
          Descripcion
        FROM 
          imNacionalidad 
        ORDER BY 
          Descripcion
      `;
      
      const result = await executeQuery(query);
      return result || [];
    } catch (error) {
      console.error('Error al obtener nacionalidades:', error);
      throw new Error('Error al obtener nacionalidades: ' + error.message);
    }
  },

  /**
   * Obtiene un registro de la tabla imNacionalidad por su valor
   * @param {string} valor - Valor de la nacionalidad a buscar
   * @returns {Promise<Object|null>} Promesa con el resultado de la consulta
   */
  getNacionalidadByValor: async (valor) => {
    try {
      const query = `
        SELECT 
          Valor, 
          Descripcion 
        FROM 
          imNacionalidad 
        WHERE 
          Valor = ?
      `;
      
      const result = await executeQuery(query, [valor]);
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener nacionalidad con valor ${valor}:`, error);
      throw new Error(`Error al obtener nacionalidad: ${error.message}`);
    }
  },

  /**
   * Crea un nuevo registro en la tabla imNacionalidad
   * @param {Object} data - Datos del registro a crear
   * @param {string} data.Valor - Valor de la nacionalidad (2 caracteres)
   * @param {string} data.Descripcion - Descripción de la nacionalidad
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  createNacionalidad: async (data) => {
    try {
      // Verificar si ya existe un registro con el mismo valor
      const existingRecord = await nacionalidadService.getNacionalidadByValor(data.Valor);
      if (existingRecord) {
        throw new Error(`Ya existe un registro con el valor ${data.Valor}`);
      }
      
      const query = `
        INSERT INTO imNacionalidad (Valor, Descripcion)
        VALUES (?, ?)
      `;
      
      await executeQuery(query, [data.Valor, data.Descripcion]);
      return true;
    } catch (error) {
      console.error('Error al crear nacionalidad:', error);
      throw new Error('Error al crear nacionalidad: ' + error.message);
    }
  },

  /**
   * Actualiza un registro existente en la tabla imNacionalidad
   * @param {string} valor - Valor de la nacionalidad a actualizar
   * @param {Object} data - Datos actualizados
   * @param {string} data.Descripcion - Nueva descripción de la nacionalidad
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  updateNacionalidad: async (valor, data) => {
    try {
      // Verificar si existe el registro
      const existingRecord = await nacionalidadService.getNacionalidadByValor(valor);
      if (!existingRecord) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        UPDATE imNacionalidad
        SET Descripcion = ?
        WHERE Valor = ?
      `;
      
      await executeQuery(query, [data.Descripcion, valor]);
      return true;
    } catch (error) {
      console.error(`Error al actualizar nacionalidad con valor ${valor}:`, error);
      throw new Error(`Error al actualizar nacionalidad: ${error.message}`);
    }
  },

  /**
   * Elimina un registro de la tabla imNacionalidad
   * @param {string} valor - Valor de la nacionalidad a eliminar
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  deleteNacionalidad: async (valor) => {
    try {
      // Verificar si existe el registro
      const existingRecord = await nacionalidadService.getNacionalidadByValor(valor);
      if (!existingRecord) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        DELETE FROM imNacionalidad
        WHERE Valor = ?
      `;
      
      await executeQuery(query, [valor]);
      return true;
    } catch (error) {
      console.error(`Error al eliminar nacionalidad con valor ${valor}:`, error);
      throw new Error(`Error al eliminar nacionalidad: ${error.message}`);
    }
  }
};

module.exports = nacionalidadService;
