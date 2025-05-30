const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar la tabla imLocalidades
 */
const localidadService = {
  /**
   * Obtiene todos los registros de la tabla imLocalidades
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */
  getLocalidades: async () => {
    try {
      const query = `
        SELECT 
          valor, 
          NombreLocalidad,
          Localidad,
          CodigoPostal,
          ValorProvincia
        FROM 
          imLocalidades 
        ORDER BY 
          Localidad
      `;
      
      const result = await executeQuery(query);
      return result || [];
    } catch (error) {
      console.error('Error al obtener localidades:', error);
      throw new Error('Error al obtener localidades: ' + error.message);
    }
  },

  /**
   * Obtiene un registro de la tabla imLocalidades por su valor
   * @param {string} valor - Valor de la localidad a buscar
   * @returns {Promise<Object|null>} Promesa con el resultado de la consulta
   */
  getLocalidadByValor: async (valor) => {
    try {
      const query = `
        SELECT 
          valor, 
          descripcion 
        FROM 
          imLocalidades 
        WHERE 
          valor = ?
      `;
      
      const result = await executeQuery(query, [valor]);
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener localidad con valor ${valor}:`, error);
      throw new Error(`Error al obtener localidad: ${error.message}`);
    }
  },

  /**
   * Crea un nuevo registro en la tabla imLocalidades
   * @param {Object} data - Datos del registro a crear
   * @param {string} data.valor - Valor de la localidad
   * @param {string} data.descripcion - Descripción de la localidad
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  createLocalidad: async (data) => {
    try {
      // Verificar si ya existe un registro con el mismo valor
      const existingRecord = await localidadService.getLocalidadByValor(data.valor);
      if (existingRecord) {
        throw new Error(`Ya existe un registro con el valor ${data.valor}`);
      }
      
      const query = `
        INSERT INTO imLocalidades (valor, descripcion)
        VALUES (?, ?)
      `;
      
      await executeQuery(query, [data.valor, data.descripcion]);
      return true;
    } catch (error) {
      console.error('Error al crear localidad:', error);
      throw new Error('Error al crear localidad: ' + error.message);
    }
  },

  /**
   * Actualiza un registro existente en la tabla imLocalidades
   * @param {string} valor - Valor de la localidad a actualizar
   * @param {Object} data - Datos actualizados
   * @param {string} data.descripcion - Nueva descripción de la localidad
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  updateLocalidad: async (valor, data) => {
    try {
      // Verificar si existe el registro
      const existingRecord = await localidadService.getLocalidadByValor(valor);
      if (!existingRecord) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        UPDATE imLocalidades
        SET descripcion = ?
        WHERE valor = ?
      `;
      
      await executeQuery(query, [data.descripcion, valor]);
      return true;
    } catch (error) {
      console.error(`Error al actualizar localidad con valor ${valor}:`, error);
      throw new Error(`Error al actualizar localidad: ${error.message}`);
    }
  },

  /**
   * Elimina un registro de la tabla imLocalidades
   * @param {string} valor - Valor de la localidad a eliminar
   * @returns {Promise<boolean>} Promesa con el resultado de la operación
   */
  deleteLocalidad: async (valor) => {
    try {
      // Verificar si existe el registro
      const existingRecord = await localidadService.getLocalidadByValor(valor);
      if (!existingRecord) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        DELETE FROM imLocalidades
        WHERE valor = ?
      `;
      
      await executeQuery(query, [valor]);
      return true;
    } catch (error) {
      console.error(`Error al eliminar localidad con valor ${valor}:`, error);
      throw new Error(`Error al eliminar localidad: ${error.message}`);
    }
  }
};

module.exports = localidadService;
