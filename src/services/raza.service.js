/**
 * @fileoverview Servicio para gestionar las operaciones CRUD de la entidad Raza
 * @module services/raza.service
 */

const { executeQuery } = require('../models/db');

const razaService = {
  getRazas: async () => {
    try {
      return await executeQuery('SELECT Valor, Descripcion FROM imRaza ORDER BY Descripcion');
    } catch (error) {
      console.error('Error al obtener razas:', error);
      throw error;
    }
  },

  getRaza: async (valor) => {
    try {
      const result = await executeQuery('SELECT Valor, Descripcion FROM imRaza WHERE Valor = @p0', [
        { value: valor },
      ]);
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error(`Error al obtener raza con valor ${valor}:`, error);
      throw error;
    }
  },

  createRaza: async (raza) => {
    try {
      if (!raza.Descripcion) {
        throw new Error('La descripción es obligatoria');
      }
      await executeQuery('INSERT INTO imRaza (Descripcion) VALUES (@p0)', [
        { value: raza.Descripcion, type: 'VarChar', length: 50 },
      ]);
      const created = await executeQuery(
        'SELECT TOP 1 Valor, Descripcion FROM imRaza WHERE Descripcion = @p0 ORDER BY Valor DESC',
        [{ value: raza.Descripcion, type: 'VarChar', length: 50 }],
      );
      return created[0] || { Descripcion: raza.Descripcion };
    } catch (error) {
      console.error('Error al crear raza:', error);
      throw error;
    }
  },

  updateRaza: async (valor, descripcion) => {
    try {
      if (!descripcion) {
        throw new Error('La descripción no puede estar vacía');
      }
      const existingRaza = await razaService.getRaza(valor);
      if (!existingRaza) {
        throw new Error(`No existe una raza con el valor ${valor}`);
      }
      await executeQuery('UPDATE imRaza SET Descripcion = @p0 WHERE Valor = @p1', [
        { value: descripcion },
        { value: valor },
      ]);
      return await razaService.getRaza(valor);
    } catch (error) {
      console.error(`Error al actualizar raza con valor ${valor}:`, error);
      throw error;
    }
  },

  deleteRaza: async (valor) => {
    try {
      const existingRaza = await razaService.getRaza(valor);
      if (!existingRaza) {
        throw new Error(`No existe una raza con el valor ${valor}`);
      }
      await executeQuery('DELETE FROM imRaza WHERE Valor = @p0', [{ value: valor }]);
    } catch (error) {
      console.error(`Error al eliminar raza con valor ${valor}:`, error);
      throw error;
    }
  },
};

module.exports = razaService;
