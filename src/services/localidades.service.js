const { executeQuery } = require('../models/db');

const LocalidadesService = {
    /**
   * Obtiene todos los registros de la tabla Localidades
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */

    getLocalidades: async () => {
    try {
      const query = `
        SELECT 
          Valor as valor, 
          NombreLocalidad as descripcion,
          ValorProvincia as valorProvincia
        FROM 
          imLocalidades 
        ORDER BY 
          Descripcion
      `;
      
      const result = await executeQuery(query);
      return result || [];
    } catch (error) {
      console.error('Error al obtener las localidades:', error);
      throw error;
    }
  },
}

module.exports = LocalidadesService;