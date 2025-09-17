/**
 * Servicio para manejar operaciones relacionadas con diagnósticos CIE10 (tabla imdiagnosticos)
 * @module services/diagnosticos.service
 */
const { executeQuery } = require('../models/db');

/**
 * Obtiene todos los diagnósticos CIE10 de la tabla imdiagnosticos
 * @returns {Promise<Array>} Lista de diagnósticos CIE10 
 */
const obtenerDiagnosticosCie10 = async () => {
  try {
    // Agregar log para depuración
    console.log('Iniciando servicio obtenerDiagnosticosCie10()');
    
    // Consulta SQL para obtener todos los diagnósticos
    const query = `
      SELECT TOP 1000
        Valor as idDiagnostico, 
        CodigoOMS as CodigoOMS, 
        Descripcion as descripcion,
        Sexo as sexo,
        EdadMinima as edadMinima,
        EdadMaxima as edadMaxima,
        Memo as memo,
        CIE as cie
      FROM 
        imDiagnosticos
      ORDER BY 
        CodigoOMS
    `;

    console.log('Ejecutando consulta de diagnósticos...');
    const resultado = await executeQuery(query);
    console.log(`Resultado consulta diagnósticos: ${resultado ? resultado.length : 0} registros encontrados`);
    return resultado || [];
  } catch (error) {
    console.error("Error al obtener diagnósticos CIE10:", error);
    throw error;
  }
};

/**
 * Busca diagnósticos CIE10 que coincidan con un término de búsqueda
 * @param {string} termino - Término de búsqueda (código o descripción)
 * @returns {Promise<Array>} Lista de diagnósticos CIE10 que coinciden con el término
 */
const buscarDiagnosticosCie10 = async (termino) => {
  try {
    // Validar y sanitizar el término de búsqueda
    if (!termino || typeof termino !== 'string') {
      return [];
    }

    console.log(`Iniciando búsqueda de diagnósticos con término: ${termino}`);
    
    // Consulta SQL para buscar diagnósticos por código o descripción
    const query = `
      SELECT TOP 100
        Valor as idDiagnostico, 
        CodigoOMS as codigoCie10, 
        Descripcion as descripcion,
        Sexo as sexo,
        EdadMinima as edadMinima,
        EdadMaxima as edadMaxima,
        Memo as memo,
        CIE as cie
      FROM 
        imdiagnosticos
      WHERE 
        CodigoOMS LIKE @p0 OR Descripcion LIKE @p1
      ORDER BY 
        CodigoOMS
    `;

    // El término de búsqueda se utiliza con comodines % para buscar coincidencias parciales
    const resultado = await executeQuery(query, [`%${termino}%`, `%${termino}%`]);
    console.log(`Resultado búsqueda de diagnósticos: ${resultado ? resultado.length : 0} registros encontrados para término "${termino}"`);
    return resultado || [];
  } catch (error) {
    console.error(`Error al buscar diagnósticos CIE10 con término "${termino}":`, error);
    throw error;
  }
};

/**
 * Obtiene un diagnóstico CIE10 por su ID
 * @param {number} idDiagnostico - ID del diagnóstico a obtener
 * @returns {Promise<Object|null>} Diagnóstico CIE10 o null si no existe
 */
const obtenerDiagnosticoPorId = async (idDiagnostico) => {
  try {
    // Validar que el ID sea un número
    if (isNaN(parseInt(idDiagnostico))) {
      throw new Error("ID de diagnóstico inválido");
    }

    console.log(`Obteniendo diagnóstico con ID: ${idDiagnostico}`);
    
    // Consulta SQL para obtener un diagnóstico por su ID
    const query = `
      SELECT 
        Valor as idDiagnostico, 
        CodigoOMS as codigoCie10, 
        Descripcion as descripcion,
        Sexo as sexo,
        EdadMinima as edadMinima,
        EdadMaxima as edadMaxima,
        Memo as memo,
        CIE as cie
      FROM 
        imdiagnosticos
      WHERE 
        Valor = @p0
    `;

    const resultado = await executeQuery(query, [idDiagnostico]);
    return resultado && resultado.length > 0 ? resultado[0] : null;
  } catch (error) {
    console.error(`Error al obtener diagnóstico CIE10 con ID ${idDiagnostico}:`, error);
    throw error;
  }
};

module.exports = {
  obtenerDiagnosticosCie10,
  buscarDiagnosticosCie10,
  obtenerDiagnosticoPorId
};
