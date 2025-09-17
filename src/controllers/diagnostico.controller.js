const { executeQuery } = require('../models/db');

/**
 * Controlador para obtener todos los diagnósticos
 */
const getDiagnosticos = async (req, res) => {
  try {
    const sql = `
      SELECT 
        Valor, 
        Descripcion 
      FROM 
        imDiagnosticos 
      ORDER BY 
        Descripcion
    `;
    
    console.log('Ejecutando consulta SQL para obtener diagnósticos:', sql);
    
    const result = await executeQuery(sql);
    
    console.log(`Diagnósticos encontrados: ${result.length}`);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al obtener diagnósticos:', error);
    return res.status(500).json({ 
      error: 'Error al obtener diagnósticos', 
      details: error.message 
    });
  }
};

/**
 * Controlador para crear un nuevo diagnóstico
 */
const createDiagnostico = async (req, res) => {
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
      'SELECT Valor FROM imDiagnosticos WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length > 0) {
      return res.status(409).json({
        error: `Ya existe un diagnóstico con el valor '${Valor}'`
      });
    }
    
    const insertSql = `
      INSERT INTO imDiagnosticos (Valor, Descripcion)
      VALUES (@p0, @p1);
    `;
    
    console.log('Ejecutando consulta SQL para crear diagnóstico');
    await executeQuery(insertSql, [Valor, Descripcion]);
    
    return res.status(201).json({
      message: 'Diagnóstico creado correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al crear diagnóstico:', error);
    return res.status(500).json({ 
      error: 'Error al crear diagnóstico', 
      details: error.message 
    });
  }
};

/**
 * Controlador para actualizar un diagnóstico existente
 */
const updateDiagnostico = async (req, res) => {
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
      'SELECT Valor FROM imDiagnosticos WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el diagnóstico con el valor '${Valor}'`
      });
    }
    
    const updateSql = `
      UPDATE imDiagnosticos 
      SET Descripcion = @p1
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para actualizar diagnóstico con valor '${Valor}'`);
    await executeQuery(updateSql, [Valor, Descripcion]);
    
    return res.status(200).json({
      message: 'Diagnóstico actualizado correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al actualizar diagnóstico:', error);
    return res.status(500).json({ 
      error: 'Error al actualizar diagnóstico', 
      details: error.message 
    });
  }
};

/**
 * Controlador para eliminar un diagnóstico
 */
const deleteDiagnostico = async (req, res) => {
  try {
    const { Valor } = req.params;
    
    // Verificar si existe el registro
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDiagnosticos WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el diagnóstico con el valor '${Valor}'`
      });
    }
    
    const deleteSql = `
      DELETE FROM imDiagnosticos 
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para eliminar diagnóstico con valor '${Valor}'`);
    await executeQuery(deleteSql, [Valor]);
    
    return res.status(200).json({
      message: 'Diagnóstico eliminado correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar diagnóstico:', error);
    return res.status(500).json({ 
      error: 'Error al eliminar diagnóstico', 
      details: error.message 
    });
  }
};

module.exports = {
  getDiagnosticos,
  createDiagnostico,
  updateDiagnostico,
  deleteDiagnostico
};
