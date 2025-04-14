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
};
