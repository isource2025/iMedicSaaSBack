/**
 * @fileoverview CRUD de imRequisitos
 * @module services/requisito.service
 */
const { executeQuery } = require('../models/db');

const COL = 'AplicableAlPacienteOVisita';

const requisitoService = {
  getRequisitos: async () => {
    return executeQuery(
      `SELECT Valor, Descripcion, ${COL} AS AplicableAlPaciente FROM imRequisitos ORDER BY Descripcion`,
    );
  },

  getRequisito: async (valor) => {
    const result = await executeQuery(
      `SELECT Valor, Descripcion, ${COL} AS AplicableAlPaciente FROM imRequisitos WHERE Valor = @p0`,
      [{ value: valor }],
    );
    return result.length > 0 ? result[0] : null;
  },

  createRequisito: async (requisito) => {
    if ((requisito.Valor == null && requisito.Valor !== 0) || !requisito.Descripcion || !requisito.AplicableAlPaciente) {
      throw new Error('Todos los campos son obligatorios');
    }
    if (String(requisito.Descripcion).length > 40) {
      throw new Error('La descripción no puede exceder los 40 caracteres');
    }
    if (String(requisito.AplicableAlPaciente).length > 10) {
      throw new Error('El campo AplicableAlPaciente no puede exceder los 10 caracteres');
    }
    const existing = await requisitoService.getRequisito(requisito.Valor);
    if (existing) throw new Error(`Ya existe un requisito con el valor ${requisito.Valor}`);

    await executeQuery(
      `INSERT INTO imRequisitos (Valor, Descripcion, ${COL}) VALUES (@p0, @p1, @p2)`,
      [
        { value: requisito.Valor },
        { value: requisito.Descripcion },
        { value: requisito.AplicableAlPaciente },
      ],
    );
    return requisitoService.getRequisito(requisito.Valor);
  },

  updateRequisito: async (valor, datos) => {
    const existing = await requisitoService.getRequisito(valor);
    if (!existing) throw new Error(`No existe un requisito con el valor ${valor}`);

    if (datos.Descripcion && String(datos.Descripcion).length > 40) {
      throw new Error('La descripción no puede exceder los 40 caracteres');
    }
    if (datos.AplicableAlPaciente && String(datos.AplicableAlPaciente).length > 10) {
      throw new Error('El campo AplicableAlPaciente no puede exceder los 10 caracteres');
    }

    const updateFields = [];
    const params = [];
    if (datos.Descripcion !== undefined) {
      updateFields.push(`Descripcion = @p${params.length}`);
      params.push({ value: datos.Descripcion });
    }
    if (datos.AplicableAlPaciente !== undefined) {
      updateFields.push(`${COL} = @p${params.length}`);
      params.push({ value: datos.AplicableAlPaciente });
    }
    if (!updateFields.length) throw new Error('No hay datos para actualizar');

    params.push({ value: valor });
    await executeQuery(
      `UPDATE imRequisitos SET ${updateFields.join(', ')} WHERE Valor = @p${params.length - 1}`,
      params,
    );
    return requisitoService.getRequisito(valor);
  },

  deleteRequisito: async (valor) => {
    const existing = await requisitoService.getRequisito(valor);
    if (!existing) throw new Error(`No existe un requisito con el valor ${valor}`);
    await executeQuery('DELETE FROM imRequisitos WHERE Valor = @p0', [{ value: valor }]);
  },
};

module.exports = requisitoService;
