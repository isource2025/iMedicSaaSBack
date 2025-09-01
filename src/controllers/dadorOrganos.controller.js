const { executeQuery } = require('../config/database');

/**
 * Controlador para obtener todos los registros de dador de órganos
 */
const getDadoresOrganos = async (req, res) => {
  try {
    const sql = `
      SELECT 
        Valor, 
        Descripcion 
      FROM 
        imDadorOrganos 
      ORDER BY 
        Descripcion
    `;
    
    console.log('Ejecutando consulta SQL para obtener dadores de órganos:', sql);
    
    const result = await executeQuery(sql);
    
    console.log(`Dadores de órganos encontrados: ${result.length}`);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al obtener dadores de órganos:', error);
    return res.status(500).json({ 
      error: 'Error al obtener dadores de órganos', 
      details: error.message 
    });
  }
};

/**
 * Controlador para crear un nuevo registro de dador de órganos
 */
const createDadorOrganos = async (req, res) => {
  try {
    const { Valor, Descripcion } = req.body;
    
    // Validación básica
    if (!Valor || !Descripcion) {
      return res.status(400).json({ 
        error: 'El valor y la descripción son obligatorios' 
      });
    }
    
    // Validar que Valor sea un solo carácter
    if (Valor.length !== 1) {
      return res.status(400).json({
        error: 'El valor debe ser un único carácter'
      });
    }
    
    // Verificar si ya existe un registro con ese Valor
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDadorOrganos WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length > 0) {
      return res.status(409).json({
        error: `Ya existe un registro de dador de órganos con el valor '${Valor}'`
      });
    }
    
    const insertSql = `
      INSERT INTO imDadorOrganos (Valor, Descripcion)
      VALUES (@p0, @p1);
    `;
    
    console.log('Ejecutando consulta SQL para crear dador de órganos');
    await executeQuery(insertSql, [Valor, Descripcion]);
    
    return res.status(201).json({
      message: 'Registro de dador de órganos creado correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al crear dador de órganos:', error);
    return res.status(500).json({ 
      error: 'Error al crear dador de órganos', 
      details: error.message 
    });
  }
};

/**
 * Controlador para actualizar un registro de dador de órganos existente
 */
const updateDadorOrganos = async (req, res) => {
  try {
    const { Valor } = req.params;
    const { Descripcion } = req.body;
    
    // Validación básica
    if (!Descripcion) {
      return res.status(400).json({ 
        error: 'La descripción es obligatoria' 
      });
    }
    
    // Verificar si existe el registro
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDadorOrganos WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el registro de dador de órganos con el valor '${Valor}'`
      });
    }
    
    const updateSql = `
      UPDATE imDadorOrganos 
      SET Descripcion = @p1
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para actualizar dador de órganos con valor '${Valor}'`);
    await executeQuery(updateSql, [Valor, Descripcion]);
    
    return res.status(200).json({
      message: 'Registro de dador de órganos actualizado correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al actualizar dador de órganos:', error);
    return res.status(500).json({ 
      error: 'Error al actualizar dador de órganos', 
      details: error.message 
    });
  }
};

/**
 * Controlador para eliminar un registro de dador de órganos
 */
const deleteDadorOrganos = async (req, res) => {
  try {
    const { Valor } = req.params;
    
    // Verificar si existe el registro
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDadorOrganos WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el registro de dador de órganos con el valor '${Valor}'`
      });
    }
    
    const deleteSql = `
      DELETE FROM imDadorOrganos 
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para eliminar dador de órganos con valor '${Valor}'`);
    await executeQuery(deleteSql, [Valor]);
    
    return res.status(200).json({
      message: 'Registro de dador de órganos eliminado correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar dador de órganos:', error);
    return res.status(500).json({ 
      error: 'Error al eliminar dador de órganos', 
      details: error.message 
    });
  }
};

module.exports = {
  getDadoresOrganos,
  createDadorOrganos,
  updateDadorOrganos,
  deleteDadorOrganos
};
