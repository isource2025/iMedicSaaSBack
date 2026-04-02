const { executeQuery } = require('../models/db');

/**
 * Obtiene todos los sectores activos
 */
const obtenerSectores = async () => {
  try {
    const consulta = `
      SELECT 
        Valor as IdSector,
        Descripcion
      FROM imSectores
      ORDER BY Descripcion
    `;
    
    const sectores = await executeQuery(consulta);
    return sectores;
  } catch (error) {
    console.error('Error al obtener sectores:', error);
    throw error;
  }
};

module.exports = {
  obtenerSectores
};
