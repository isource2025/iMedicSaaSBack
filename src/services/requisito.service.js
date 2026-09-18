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
    if (!requisito.Descripcion) {
      throw new Error('La descripción es obligatoria');
    }
    if (String(requisito.Descripcion).length > 40) {
      throw new Error('La descripción no puede exceder los 40 caracteres');
    }
    const aplicable = requisito.AplicableAlPaciente || 'No';
    if (String(aplicable).length > 10) {
      throw new Error('El campo AplicableAlPaciente no puede exceder los 10 caracteres');
    }

    await executeQuery(
      `INSERT INTO imRequisitos (Descripcion, ${COL}) VALUES (@p0, @p1)`,
      [
        { value: requisito.Descripcion, type: 'VarChar', length: 40 },
        { value: aplicable, type: 'VarChar', length: 10 },
      ],
    );
    const created = await executeQuery(
      `SELECT TOP 1 Valor, Descripcion, ${COL} AS AplicableAlPaciente
       FROM imRequisitos WHERE Descripcion = @p0 ORDER BY Valor DESC`,
      [{ value: requisito.Descripcion, type: 'VarChar', length: 40 }],
    );
    return created[0];
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
