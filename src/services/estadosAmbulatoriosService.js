const { executeQuery } = require('../models/db');

/**
 * Servicio para manejar las operaciones relacionadas con los estados ambulatorios
 */
const estadosAmbulatoriosService = {
  /**
   * Obtiene todos los estados ambulatorios
   * @returns {Promise<Array>} Promise con la lista de estados ambulatorios
   */
  getAll: async () => {
    try {
      const query = `
        SELECT 
          Valor as valor, 
          Descripcion as descripcion 
        FROM 
          imEstadoAmbulatorio 
        ORDER BY 
          Descripcion
      `;
      
      return await db.executeQuery(query)
    } catch (error) {
      console.error('Error en el servicio de estados ambulatorios (getAll):', error);
      throw error;
    }
  },

  /**
   * Obtiene un estado ambulatorio por su valor
   * @param {string} valor - Valor del estado ambulatorio
   * @returns {Promise<Object>} Promise con el estado ambulatorio
   */
  getByValor: async (valor) => {
    try {
      const query = `
        SELECT 
          Valor as valor, 
          Descripcion as descripcion 
        FROM 
          imEstadoAmbulatorio 
        WHERE 
          Valor = @valor
      `;
      
      const result = await db.query(query, {
        valor: { type: db.sql.Char(2), value: valor }
      });
      
      return result.recordset[0];
    } catch (error) {
      console.error(`Error en el servicio de estados ambulatorios (getByValor - ${valor}):`, error);
      throw error;
    }
  }
};

module.exports = estadosAmbulatoriosService;
