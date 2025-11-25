const { executeQuery } = require('../models/db');

/**
 * Obtiene todos los estados ambulatorios
 */
const getEstadosAmbulatorios = async (req, res) => {
  try {
    const sql = `
      SELECT 
        Valor AS valor, 
        Descripcion AS descripcion 
      FROM 
        imEstadoAmbulatorio 
      ORDER BY 
        descripcion
    `;
    const result = await executeQuery(sql);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener estados ambulatorios', details: error.message });
  }
};

/**
 * Obtiene un estado ambulatorio por su valor
 */
const getEstadoAmbulatorio = async (req, res) => {
  try {
    const { Valor } = req.params;
    
    if (!Valor) {
      return res.status(400).json({ error: 'El valor es requerido' });
    }
    
    const sql = `
      SELECT 
        Valor AS valor, 
        Descripcion AS descripcion 
      FROM 
        imEstadoAmbulatorio 
      WHERE 
        Valor = ?
    `;
    const result = await executeQuery(sql, [Valor]);
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Estado ambulatorio no encontrado' });
    }
    
    return res.status(200).json(result[0]);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener el estado ambulatorio', details: error.message });
  }
};

/**
 * Crea un nuevo estado ambulatorio
 */
const createEstadoAmbulatorio = async (req, res) => {
  try {
    const { valor, descripcion } = req.body; // Esperar claves en minúscula
    
    // Validaciones básicas
    if (!valor || !descripcion) { // Validar claves en minúscula
      return res.status(400).json({ error: 'El valor y la descripción son requeridos' });
    }
    
    if (valor.length > 2) { // Validar 'valor'
      return res.status(400).json({ error: 'El valor no puede tener más de 2 caracteres' });
    }
    
    if (descripcion.length > 60) { // Validar 'descripcion' (minúscula)
      return res.status(400).json({ error: 'La descripción no puede tener más de 60 caracteres' });
    }
    
    // Verificar si ya existe un registro con ese valor
    const checkSql = `
      SELECT COUNT(*) as count 
      FROM imEstadoAmbulatorio 
      WHERE Valor = ?
    `;
    const checkResult = await executeQuery(checkSql, [valor]); // Usar 'valor' (minúscula) para la consulta
    
    if (checkResult[0].count > 0) {
      return res.status(409).json({ error: 'Ya existe un estado ambulatorio con ese valor' });
    }
    
    // Insertar el nuevo registro
    const insertSql = `
      INSERT INTO imEstadoAmbulatorio (Valor, Descripcion) 
      VALUES (?, ?)
    `;
    await executeQuery(insertSql, [valor, descripcion]); // Insertar 'valor' y 'descripcion'
    
    return res.status(201).json({ valor, descripcion }); // Devolver claves en minúscula
  } catch (error) {
    return res.status(500).json({ error: 'Error al crear el estado ambulatorio', details: error.message });
  }
};

/**
 * Actualiza un estado ambulatorio existente
 */
const updateEstadoAmbulatorio = async (req, res) => {
  try {
    const { Valor } = req.params;
    const { descripcion } = req.body; // Esperar 'descripcion' en minúscula
    
    // Validaciones básicas
    if (!valor) {
      return res.status(400).json({ error: 'El valor es requerido' });
    }
    
    if (!descripcion) { // Validar 'descripcion' en minúscula
      return res.status(400).json({ error: 'La descripción es requerida' });
    }
    
    if (descripcion.length > 60) {
      return res.status(400).json({ error: 'La descripción no puede tener más de 60 caracteres' });
    }
    
    // Verificar si existe el registro a actualizar
    const checkSql = `
      SELECT COUNT(*) as count 
      FROM imEstadoAmbulatorio 
      WHERE Valor = ?
    `;
    const checkResult = await executeQuery(checkSql, [Valor]);
    
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Estado ambulatorio no encontrado' });
    }
    
    // Actualizar el registro
    const updateSql = `
      UPDATE imEstadoAmbulatorio 
      SET Descripcion = ? 
      WHERE Valor = ?
    `;
    await executeQuery(updateSql, [descripcion, Valor]); // Usar 'descripcion' para actualizar, Valor (de params) para identificar
    
    return res.status(200).json({ valor: Valor, descripcion }); // Devolver 'valor' (de params) y 'descripcion' (actualizada) en minúscula
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar el estado ambulatorio', details: error.message });
  }
};

/**
 * Elimina un estado ambulatorio
 */
const deleteEstadoAmbulatorio = async (req, res) => {
  try {
    const { Valor } = req.params;
    
    if (!Valor) {
      return res.status(400).json({ error: 'El valor es requerido' });
    }
    
    // Verificar si existe el registro a eliminar
    const checkSql = `
      SELECT COUNT(*) as count 
      FROM imEstadoAmbulatorio 
      WHERE Valor = ?
    `;
    const checkResult = await executeQuery(checkSql, [Valor]);
    
    if (checkResult[0].count === 0) {
      return res.status(404).json({ error: 'Estado ambulatorio no encontrado' });
    }
    
    // Eliminar el registro
    const deleteSql = `
      DELETE FROM imEstadoAmbulatorio 
      WHERE Valor = ?
    `;
    await executeQuery(deleteSql, [Valor]);
    
    return res.status(200).json({ message: 'Estado ambulatorio eliminado con éxito' });
  } catch (error) {
    return res.status(500).json({ error: 'Error al eliminar el estado ambulatorio', details: error.message });
  }
};

module.exports = {
  getEstadosAmbulatorios,
  getEstadoAmbulatorio,
  createEstadoAmbulatorio,
  updateEstadoAmbulatorio,
  deleteEstadoAmbulatorio
};
