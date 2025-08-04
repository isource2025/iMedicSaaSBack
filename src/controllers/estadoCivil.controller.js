/**
 * estadoCivil.controller.js
 * Controlador para las operaciones CRUD de la tabla imEstadoCivil
 */
const { executeQuery } = require('../config/database');

// Obtener todos los estados civiles
const getEstadosCiviles = async (req, res) => {
  try {
    const sql = `SELECT Valor AS valor, Descripcion AS descripcion FROM imEstadoCivil ORDER BY descripcion`;
    const result = await executeQuery(sql);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los estados civiles: ' + error.message, details: error.message });
  }
};

// Obtener un estado civil por su valor (PK)
const getEstadoCivilByValor = async (req, res) => {
  try {
    const { valor } = req.params; // El parámetro de ruta ya es 'valor' (minúscula)
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    const sql = `SELECT Valor AS valor, Descripcion AS descripcion FROM imEstadoCivil WHERE Valor = ?`;
    const result = await executeQuery(sql, [valor.toUpperCase()]); // La BD espera mayúscula para 'Valor'
    if (result.length === 0) {
      return res.status(404).json({ error: 'Estado civil no encontrado' });
    }
    res.status(200).json(result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el estado civil: ' + error.message, details: error.message });
  }
};

// Crear un nuevo estado civil
const createEstadoCivil = async (req, res) => {
  try {
    const { valor, descripcion } = req.body; // Esperar claves en minúscula
    if (!valor || !descripcion) {
      return res.status(400).json({ error: 'Los campos valor y descripcion son obligatorios' });
    }
    // Aquí puedes añadir validaciones de longitud si son necesarias, ej: valor.length > 1, descripcion.length > 50
    const valorDB = valor.toUpperCase(); // La BD espera 'Valor' en mayúscula

    const checkSql = `SELECT COUNT(*) as count FROM imEstadoCivil WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valorDB]);
    if (checkResult[0].count > 0) {
      return res.status(409).json({ error: 'El valor del estado civil ya existe' });
    }

    const insertSql = `INSERT INTO imEstadoCivil (Valor, Descripcion) VALUES (?, ?)`;
    await executeQuery(insertSql, [valorDB, descripcion]);
    res.status(201).json({ valor: valorDB, descripcion }); // Devolver claves en minúscula (valor original o valorDB)
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el estado civil: ' + error.message, details: error.message });
  }
};

// Actualizar un estado civil existente
const updateEstadoCivil = async (req, res) => {
  try {
    const { valor } = req.params; // El parámetro de ruta ya es 'valor' (minúscula)
    const { descripcion } = req.body; // Esperar 'descripcion' en minúscula
    if (!descripcion) {
      return res.status(400).json({ error: 'El campo descripcion es obligatorio para actualizar' });
    }
    // Aquí puedes añadir validaciones de longitud para descripcion si es necesario
    const valorDB = valor.toUpperCase(); // La BD espera 'Valor' en mayúscula

    const checkSql = `SELECT COUNT(*) as count FROM imEstadoCivil WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valorDB]);
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Estado civil no encontrado para actualizar' });
    }

    const updateSql = `UPDATE imEstadoCivil SET Descripcion = ? WHERE Valor = ?`;
    await executeQuery(updateSql, [descripcion, valorDB]);
    res.status(200).json({ valor: valorDB, descripcion }); // Devolver claves en minúscula
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el estado civil: ' + error.message, details: error.message });
  }
};

// Eliminar un estado civil
const deleteEstadoCivil = async (req, res) => {
  try {
    const { valor } = req.params; // El parámetro de ruta ya es 'valor' (minúscula)
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    const valorDB = valor.toUpperCase(); // La BD espera 'Valor' en mayúscula

    const checkSql = `SELECT COUNT(*) as count FROM imEstadoCivil WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valorDB]);
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Estado civil no encontrado para eliminar' });
    }

    const deleteSql = `DELETE FROM imEstadoCivil WHERE Valor = ?`;
    await executeQuery(deleteSql, [valorDB]);
    res.status(200).json({ message: 'Estado civil eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el estado civil: ' + error.message, details: error.message });
  }
};

module.exports = {
  getEstadosCiviles,
  getEstadoCivilByValor,
  createEstadoCivil,
  updateEstadoCivil,
  deleteEstadoCivil
};
