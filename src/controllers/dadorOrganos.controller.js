const { executeQuery } = require('../models/db');
const { statusDeError } = require('../utils/httpError');

const getDadoresOrganos = async (req, res) => {
  try {
    const result = await executeQuery(`
      SELECT Valor, Descripcion
      FROM imDadorOrganos
      ORDER BY Descripcion
    `);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al obtener dadores de órganos:', error);
    return res.status(statusDeError(error)).json({
      error: 'Error al obtener dadores de órganos',
      details: error.message,
    });
  }
};

const createDadorOrganos = async (req, res) => {
  try {
    const { Valor, Descripcion } = req.body;
    if (!Valor || !Descripcion) {
      return res.status(400).json({ error: 'El valor y la descripción son obligatorios' });
    }
    if (String(Valor).length !== 1) {
      return res.status(400).json({ error: 'El valor debe ser un único carácter' });
    }
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDadorOrganos WHERE Valor = @p0',
      [{ value: Valor }],
    );
    if (existingRecord.length > 0) {
      return res.status(409).json({
        error: `Ya existe un registro de dador de órganos con el valor '${Valor}'`,
      });
    }
    await executeQuery('INSERT INTO imDadorOrganos (Valor, Descripcion) VALUES (@p0, @p1)', [
      { value: Valor },
      { value: Descripcion },
    ]);
    return res.status(201).json({
      message: 'Registro de dador de órganos creado correctamente',
      data: { Valor, Descripcion },
    });
  } catch (error) {
    console.error('Error al crear dador de órganos:', error);
    return res.status(statusDeError(error)).json({
      error: 'Error al crear dador de órganos',
      details: error.message,
    });
  }
};

const updateDadorOrganos = async (req, res) => {
  try {
    const { Valor } = req.params;
    const { Descripcion } = req.body;
    if (!Descripcion) {
      return res.status(400).json({ error: 'La descripción es obligatoria' });
    }
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDadorOrganos WHERE Valor = @p0',
      [{ value: Valor }],
    );
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el registro de dador de órganos con el valor '${Valor}'`,
      });
    }
    await executeQuery('UPDATE imDadorOrganos SET Descripcion = @p1 WHERE Valor = @p0', [
      { value: Valor },
      { value: Descripcion },
    ]);
    return res.status(200).json({
      message: 'Registro de dador de órganos actualizado correctamente',
      data: { Valor, Descripcion },
    });
  } catch (error) {
    console.error('Error al actualizar dador de órganos:', error);
    return res.status(statusDeError(error)).json({
      error: 'Error al actualizar dador de órganos',
      details: error.message,
    });
  }
};

const deleteDadorOrganos = async (req, res) => {
  try {
    const { Valor } = req.params;
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDadorOrganos WHERE Valor = @p0',
      [{ value: Valor }],
    );
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el registro de dador de órganos con el valor '${Valor}'`,
      });
    }
    await executeQuery('DELETE FROM imDadorOrganos WHERE Valor = @p0', [{ value: Valor }]);
    return res.status(200).json({
      message: 'Registro de dador de órganos eliminado correctamente',
    });
  } catch (error) {
    console.error('Error al eliminar dador de órganos:', error);
    return res.status(statusDeError(error)).json({
      error: 'Error al eliminar dador de órganos',
      details: error.message,
    });
  }
};

module.exports = {
  getDadoresOrganos,
  createDadorOrganos,
  updateDadorOrganos,
  deleteDadorOrganos,
};
