/**
 * idiomasISO.controller.js
 * Controlador para las operaciones CRUD de la tabla imIdiomasISO
 */
const { executeQuery } = require('../models/db');

// Obtener todos los idiomas ISO
const getIdiomasISO = async (req, res) => {
  try {
    const sql = `SELECT Valor, descripcion AS Descripcion FROM imIdiomaISO ORDER BY descripcion`;
    const result = await executeQuery(sql);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los idiomas ISO: ' + error.message, details: error.message });
  }
};

// Obtener un idioma ISO por su valor (PK)
const getIdiomaISOByValor = async (req, res) => {
  try {
    const { valor } = req.params;
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    const sql = `SELECT Valor, descripcion AS Descripcion FROM imIdiomaISO WHERE Valor = @p0`;
    const result = await executeQuery(sql, [{ value: String(valor).toUpperCase() }]);
    if (result.length === 0) {
      return res.status(404).json({ error: 'Idioma ISO no encontrado' });
    }
    res.status(200).json(result[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el idioma ISO: ' + error.message, details: error.message });
  }
};

// Crear un nuevo idioma ISO
const createIdiomaISO = async (req, res) => {
  try {
    const { Valor, Descripcion } = req.body;
    
    // Validaciones
    if (!Valor || !Descripcion) {
      return res.status(400).json({ error: 'El valor y la descripción son obligatorios' });
    }
    
    if (Valor.length > 3) {
      return res.status(400).json({ error: 'El valor no puede superar los 3 caracteres' });
    }
    
    if (Descripcion.length > 40) {
      return res.status(400).json({ error: 'La descripción no puede superar los 40 caracteres' });
    }
    
    // Verificar si ya existe
    const checkSql = `SELECT COUNT(*) as count FROM imIdiomaISO WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [Valor.toUpperCase()]);
    
    if (checkResult[0].count > 0) {
      return res.status(409).json({ error: `El idioma ISO con valor ${Valor} ya existe` });
    }
    
    // Insertar nuevo idioma ISO
    const sql = `INSERT INTO imIdiomaISO (Valor, descripcion) VALUES (?, ?)`;
    await executeQuery(sql, [Valor.toUpperCase(), Descripcion]);
    
    res.status(201).json({ message: 'Idioma ISO creado con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el idioma ISO: ' + error.message, details: error.message });
  }
};

// Actualizar un idioma ISO existente
const updateIdiomaISO = async (req, res) => {
  try {
    const { valor } = req.params;
    const { Descripcion } = req.body;
    
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    
    if (!Descripcion) {
      return res.status(400).json({ error: 'La descripción es obligatoria' });
    }
    
    if (Descripcion.length > 40) {
      return res.status(400).json({ error: 'La descripción no puede superar los 40 caracteres' });
    }
    
    // Verificar si existe
    const checkSql = `SELECT COUNT(*) as count FROM imIdiomaISO WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valor.toUpperCase()]);
    
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: `El idioma ISO con valor ${valor} no existe` });
    }
    
    // Actualizar idioma ISO
    const sql = `UPDATE imIdiomaISO SET descripcion = ? WHERE Valor = ?`;
    await executeQuery(sql, [Descripcion, valor.toUpperCase()]);
    
    res.status(200).json({ message: 'Idioma ISO actualizado con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el idioma ISO: ' + error.message, details: error.message });
  }
};

// Eliminar un idioma ISO
const deleteIdiomaISO = async (req, res) => {
  try {
    const { valor } = req.params;
    
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido en los parámetros de la ruta' });
    }
    
    // Verificar si existe
    const checkSql = `SELECT COUNT(*) as count FROM imIdiomaISO WHERE Valor = ?`;
    const checkResult = await executeQuery(checkSql, [valor.toUpperCase()]);
    
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: `El idioma ISO con valor ${valor} no existe` });
    }
    
    // Eliminar idioma ISO
    const sql = `DELETE FROM imIdiomasISO WHERE Valor = ?`;
    await executeQuery(sql, [valor.toUpperCase()]);
    
    res.status(200).json({ message: 'Idioma ISO eliminado con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el idioma ISO: ' + error.message, details: error.message });
  }
};

module.exports = {
  getIdiomasISO,
  getIdiomaISOByValor,
  createIdiomaISO,
  updateIdiomaISO,
  deleteIdiomaISO
};
