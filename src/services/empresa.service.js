/**
 * Servicio para gestionar la información de la empresa
 */
const { executeQuery } = require('../models/db');

/**
 * Obtiene la información de la empresa desde la base de datos
 * @returns {Promise<Object>} Información de la empresa
 */
const obtenerInfoEmpresa = async () => {
  try {
    // Consulta ajustada para la tabla empresas en la base de datos escuela
    const consulta = `
      SELECT 
        idEmpresa as id,
        descripcion,
        DESCRIPCION as razonSocial,
        nro_cuit,
        CONCAT( calle, calle_nro, Depto, piso, localidad ) as direccion,
        TEEmpresa,
        email
      FROM 
        empresas
    `;
    
    const resultado = await executeQuery(consulta);
    
    // Si hay resultados, devolver el primero
    if (resultado && resultado.length > 0) {
      return resultado[0];
    }
    
    // Si no hay resultados, devolver un objeto con valores por defecto
    return {
      id: '1',
      descripcion: 'iMedicWS'
    };
  } catch (error) {
    console.error('Error al obtener información de la empresa:', error);
    throw error;
  }
};

module.exports = {
  obtenerInfoEmpresa
};
