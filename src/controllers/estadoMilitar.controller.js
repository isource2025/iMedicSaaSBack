/**
 * estadoMilitar.controller.js
 * Controlador para las operaciones CRUD de la tabla imEstadoMilitar
 */
const { executeQuery } = require('../models/db');

// Obtener todos los estados militares
const getEstadosMilitares = async (req, res) => {
  try {
    const sql = `SELECT Valor AS valor, Descripcion AS descripcion FROM imEstadoMilitar ORDER BY descripcion`;
    const result = await executeQuery(sql);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los estados militares: ' + error.message, details: error.message });
  }
};

// Obtener un estado militar por su valor (PK)
const getEstadoMilitarByValor = async (req, res) => {
  try {
    const { valor } = req.params;
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    const sql = `SELECT Valor AS valor, Descripcion AS descripcion FROM imEstadoMilitar WHERE Valor = ?`;
    const result = await executeQuery(sql, [valor.toUpperCase()]); // La BD espera mayúscula para 'Valor'
    if (result.length === 0) {
      return res.status(404).json({ error: 'Estado militar no encontrado' });
    }
    res.status(200).json(result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el estado militar: ' + error.message, details: error.message });
  }
};

// Crear un nuevo estado militar
const createEstadoMilitar = async (req, res) => {
  try {
    const { valor, descripcion } = req.body;
    if (!valor || !descripcion) {
      return res.status(400).json({ error: 'Los campos valor y descripcion son obligatorios' });
    }
    const valorDB = valor.toUpperCase(); // La BD espera 'Valor' en mayúscula

    const checkSql = `SELECT COUNT(*) as count FROM imEstadoMilitar WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valorDB]);
    if (checkResult[0].count > 0) {
      return res.status(409).json({ error: 'El valor del estado militar ya existe' });
    }

    const insertSql = `INSERT INTO imEstadoMilitar (Valor, Descripcion) VALUES (?, ?)`;
    await executeQuery(insertSql, [valorDB, descripcion]);
    res.status(201).json({ valor: valorDB, descripcion });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el estado militar: ' + error.message, details: error.message });
  }
};

// Actualizar un estado militar existente
const updateEstadoMilitar = async (req, res) => {
  try {
    const { valor } = req.params;
    const { descripcion } = req.body;
    if (!descripcion) {
      return res.status(400).json({ error: 'El campo descripcion es obligatorio para actualizar' });
    }
    const valorDB = valor.toUpperCase(); // La BD espera 'Valor' en mayúscula

    const checkSql = `SELECT COUNT(*) as count FROM imEstadoMilitar WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valorDB]);
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Estado militar no encontrado para actualizar' });
    }

    const updateSql = `UPDATE imEstadoMilitar SET Descripcion = ? WHERE Valor = ?`;
    await executeQuery(updateSql, [descripcion, valorDB]);
    res.status(200).json({ valor: valorDB, descripcion });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el estado militar: ' + error.message, details: error.message });
  }
};

// Eliminar un estado militar
const deleteEstadoMilitar = async (req, res) => {
  try {
    const { valor } = req.params;
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    const valorDB = valor.toUpperCase(); // La BD espera 'Valor' en mayúscula

    const checkSql = `SELECT COUNT(*) as count FROM imEstadoMilitar WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valorDB]);
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Estado militar no encontrado para eliminar' });
    }

    const deleteSql = `DELETE FROM imEstadoMilitar WHERE Valor = ?`;
    await executeQuery(deleteSql, [valorDB]);
    res.status(200).json({ message: 'Estado militar eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el estado militar: ' + error.message, details: error.message });
  }
};

module.exports = {
  getEstadosMilitares,
  getEstadoMilitarByValor,
  createEstadoMilitar,
  updateEstadoMilitar,
  deleteEstadoMilitar
};
