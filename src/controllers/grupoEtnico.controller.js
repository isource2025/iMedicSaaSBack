/**
 * grupoEtnico.controller.js
 * Controlador para las operaciones CRUD de la tabla imGrupoEtnico
 */
const { executeQuery } = require('../models/db');

// Obtener todos los grupos étnicos
const getGruposEtnicos = async (req, res) => {
  try {
    const sql = `SELECT Valor, descripcion AS Descripcion FROM imGrupoEtnico ORDER BY descripcion`;
    const result = await executeQuery(sql);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los grupos étnicos: ' + error.message, details: error.message });
  }
};

// Obtener un grupo étnico por su valor (PK)
const getGrupoEtnicoByValor = async (req, res) => {
  try {
    const { valor } = req.params;
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    const sql = `SELECT Valor AS valor, descripcion FROM imGrupoEtnico WHERE Valor = ?`;
    const result = await executeQuery(sql, [valor.toUpperCase()]); // La BD espera mayúscula para 'Valor'
    if (result.length === 0) {
      return res.status(404).json({ error: 'Grupo étnico no encontrado' });
    }
    res.status(200).json(result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el grupo étnico: ' + error.message, details: error.message });
  }
};

// Crear un nuevo grupo étnico
const createGrupoEtnico = async (req, res) => {
  try {
    const { valor, descripcion } = req.body;
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido' });
    }
    
    // Verificar longitud del valor (máximo 1 carácter)
    if (valor.length > 1) {
      return res.status(400).json({ error: 'El valor debe tener un máximo de 1 carácter' });
    }
    
    // Verificar si ya existe
    const checkSql = `SELECT COUNT(*) AS count FROM imGrupoEtnico WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valor.toUpperCase()]);
    if (checkResult[0].count > 0) {
      return res.status(400).json({ error: 'Ya existe un grupo étnico con este valor' });
    }
    
    // Insertar nuevo registro
    const sql = `INSERT INTO imGrupoEtnico (Valor, descripcion) VALUES (?, ?)`;
    await executeQuery(sql, [valor.toUpperCase(), descripcion]);
    
    // Devolver el registro creado
    const newRecord = { valor: valor.toUpperCase(), descripcion };
    res.status(201).json(newRecord);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el grupo étnico: ' + error.message, details: error.message });
  }
};

// Actualizar un grupo étnico existente
const updateGrupoEtnico = async (req, res) => {
  try {
    const { valor } = req.params;
    const { descripcion } = req.body;
    
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    
    // Verificar si existe
    const checkSql = `SELECT COUNT(*) AS count FROM imGrupoEtnico WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valor.toUpperCase()]);
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Grupo étnico no encontrado' });
    }
    
    // Actualizar registro
    const sql = `UPDATE imGrupoEtnico SET descripcion = ? WHERE Valor = ?`;
    await executeQuery(sql, [descripcion, valor.toUpperCase()]);
    
    // Devolver el registro actualizado
    const updatedRecord = { valor: valor.toUpperCase(), descripcion };
    res.status(200).json(updatedRecord);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el grupo étnico: ' + error.message, details: error.message });
  }
};

// Eliminar un grupo étnico
const deleteGrupoEtnico = async (req, res) => {
  try {
    const { valor } = req.params;
    
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    
    // Verificar si existe
    const checkSql = `SELECT COUNT(*) AS count FROM imGrupoEtnico WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valor.toUpperCase()]);
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Grupo étnico no encontrado' });
    }
    
    // Eliminar registro
    const sql = `DELETE FROM imGrupoEtnico WHERE Valor = ?`;
    await executeQuery(sql, [valor.toUpperCase()]);
    
    res.status(200).json({ message: 'Grupo étnico eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el grupo étnico: ' + error.message, details: error.message });
  }
};

module.exports = {
  getGruposEtnicos,
  getGrupoEtnicoByValor,
  createGrupoEtnico,
  updateGrupoEtnico,
  deleteGrupoEtnico
};
