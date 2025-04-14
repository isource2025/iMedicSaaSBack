// src/services/bedsService.ts

const { executeQuery } = require('../models/db');

/**
 * Obtener todas las camas desde imHabitacionCamas
 * @returns {Promise<Array>} Lista de camas
 */
const obtenerCamas = async () => {
  const consulta = `SELECT * FROM imHabitacionCamas`;
  return await executeQuery(consulta);
};

/**
 * Obtener todos los estados de cama desde imEstadoCama
 * @returns {Promise<Array>} Lista de estados de cama
 */
const obtenerEstadosCama = async () => {
  // Usando alias para devolver los campos con nombres en minúsculas
  const consulta = `SELECT Valor as valor, Descripcion as descripcion FROM imEstadoCama`;
  return await executeQuery(consulta);
};

/**
 * Filtrar camas por estado usando la relación entre imhabitacioncamas y imestadocama
 * @param {string} estadoValor - Valor del estado a filtrar (del campo valor en imestadocama)
 * @returns {Promise<Array>} Lista de camas filtradas
 */
const filtrarCamasPorEstado = async (estadoValor) => {
  const consulta = `
    SELECT 
      hc.*,
      ec.valor as valorEstadoCama, 
      ec.descripcion as descripcionEstadoCama
    FROM 
      imHabitacionCamas hc
    INNER JOIN 
      imEstadoCama ec ON hc.ValorEstadoCama = ec.valor
    WHERE 
      ec.valor = @p0
  `;
  
  const parametros = [{ value: estadoValor }];
  return await executeQuery(consulta, parametros);
};

/**
 * Obtener una cama por ID
 * @param {number} id - ID de la cama
 * @returns {Promise<Object|null>} Cama encontrada o null
 */
const obtenerCamaPorId = async (id) => {
  const consulta = `SELECT * FROM imHabitacionCamas WHERE id = @p0`;
  const parametros = [{ value: id }];
  const resultado = await executeQuery(consulta, parametros);
  return resultado.length > 0 ? resultado[0] : null;
};

/**
 * Actualizar el estado de una cama
 * @param {number} id - ID de la cama
 * @param {'disponible' | 'ocupada' | 'mantenimiento'} estado - Nuevo estado
 * @returns {Promise<Object>} Cama actualizada
 */
const actualizarEstadoCama = async (id, estado) => {
  const consulta = `
    UPDATE imHabitacionCamas
    SET estado = @p1
    WHERE id = @p0;

    SELECT * FROM imHabitacionCamas WHERE id = @p0;
  `;
  const parametros = [
    { value: id },
    { value: estado }
  ];

  const resultado = await executeQuery(consulta, parametros);
  return resultado.length > 0 ? resultado[0] : null;
};

module.exports = {
  obtenerCamas,
  obtenerCamaPorId,
  actualizarEstadoCama,
  obtenerEstadosCama,
  filtrarCamasPorEstado,
};
