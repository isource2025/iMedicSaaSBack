const { executeQuery } = require('../models/db');

const LocalidadesService = {
    /**
   * Obtiene todos los registros de la tabla Localidades
   * @returns {Promise<Array>} Promesa con los resultados de la consulta
   */

    getLocalidades: async (idProvincia) => {
    try {
      const query = `
        SELECT 
          IdLocalidad as valor, 
          Descripcion as descripcion
        FROM 
          Localidades 
        WHERE
            IdProvincia = @p0
        ORDER BY 
          Descripcion
      `;
      
      const result = await executeQuery(query, [
        { value: idProvincia }
      ]);
      return result || [];
    } catch (error) {
      console.error('Error al obtener las localidades:', error);
      throw error;
    }
  },
}

module.exports = LocalidadesService;