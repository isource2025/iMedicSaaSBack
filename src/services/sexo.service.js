const { executeQuery } = require('../models/db');

/**
 * Servicio para gestionar la tabla imSexo
 */
const sexoService = {
  /**
   * Obtiene todos los registros de la tabla imSexo
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */
  getSexos: async () => {
    try {
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(1)) AS valor, 
          descripcion 
        FROM 
          imSexo 
        ORDER BY 
          descripcion
      `;
      
      const result = await executeQuery(query);
      return result || [];
    } catch (error) {
      console.error('Error al obtener sexos:', error);
      throw error;
    }
  },

  /**
   * Obtiene un registro de la tabla imSexo por su valor
   * @param {string} valor - Valor del sexo a buscar
   * @returns {Promise<Object>} Promesa con el resultado de la consulta
   */
  getSexoByValor: async (valor) => {
    try {
      const query = `
        SELECT 
          CAST(valor AS VARCHAR(1)) AS valor, 
          descripcion 
        FROM 
          imSexo 
        WHERE 
          valor = @p0
      `;
      
      const result = await executeQuery(query, [
        { value: valor }
      ]);
      
      return result && result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener sexo con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Crea un nuevo registro en la tabla imSexo
   * @param {Object} sexo - Objeto con los datos del sexo a crear
   * @param {string} sexo.valor - Valor del sexo (char(1))
   * @param {string} sexo.descripcion - Descripción del sexo (varchar(15))
   * @returns {Promise<Object>} Promesa con el resultado de la operación
   */
  createSexo: async (sexo) => {
    try {
      // Verificar si ya existe un registro con el mismo valor
      const existente = await sexoService.getSexoByValor(sexo.valor);
      
      if (existente) {
        throw new Error(`Ya existe un registro con el valor ${sexo.valor}`);
      }
      
      const query = `
        INSERT INTO imSexo (valor, descripcion) 
        VALUES (@p0, @p1)
      `;
      
      await executeQuery(query, [
        { value: sexo.valor },
        { value: sexo.descripcion }
      ]);
      
      return { success: true, message: 'Registro creado correctamente' };
    } catch (error) {
      console.error('Error al crear sexo:', error);
      throw error;
    }
  },

  /**
   * Actualiza un registro existente en la tabla imSexo
   * @param {string} valor - Valor del sexo a actualizar
   * @param {Object} sexo - Objeto con los datos actualizados
   * @param {string} sexo.descripcion - Nueva descripción del sexo
   * @returns {Promise<Object>} Promesa con el resultado de la operación
   */
  updateSexo: async (valor, sexo) => {
    try {
      // Verificar si existe el registro
      const existente = await sexoService.getSexoByValor(valor);
      
      if (!existente) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        UPDATE imSexo 
        SET descripcion = @p0 
        WHERE valor = @p1
      `;
      
      await executeQuery(query, [
        { value: sexo.descripcion },
        { value: valor }
      ]);
      
      return { success: true, message: 'Registro actualizado correctamente' };
    } catch (error) {
      console.error(`Error al actualizar sexo con valor ${valor}:`, error);
      throw error;
    }
  },

  /**
   * Elimina un registro de la tabla imSexo
   * @param {string} valor - Valor del sexo a eliminar
   * @returns {Promise<Object>} Promesa con el resultado de la operación
   */
  deleteSexo: async (valor) => {
    try {
      // Verificar si existe el registro
      const existente = await sexoService.getSexoByValor(valor);
      
      if (!existente) {
        throw new Error(`No existe un registro con el valor ${valor}`);
      }
      
      const query = `
        DELETE FROM imSexo 
        WHERE valor = @p0
      `;
      
      await executeQuery(query, [
        { value: valor }
      ]);
      
      return { success: true, message: 'Registro eliminado correctamente' };
    } catch (error) {
      console.error(`Error al eliminar sexo con valor ${valor}:`, error);
      throw error;
    }
  }
};

module.exports = sexoService;
