const { executeQuery } = require('../models/db');

/**
 * Controlador para obtener todas las clases de paciente
 */
const getClasesPaciente = async (req, res) => {
  try {
    const sql = `
      SELECT 
        Valor, 
        Descripcion 
      FROM 
        imClasePaciente 
      ORDER BY 
        Descripcion
    `;
    
    console.log('Ejecutando consulta SQL para obtener clases de paciente:', sql);
    
    const result = await executeQuery(sql);
    
    console.log(`Clases de paciente encontradas: ${result.length}`);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al obtener clases de paciente:', error);
    return res.status(500).json({ 
      error: 'Error al obtener clases de paciente', 
      details: error.message 
    });
  }
};

/**
 * Controlador para crear una nueva clase de paciente
 */
const createClasePaciente = async (req, res) => {
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
      'SELECT Valor FROM imClasePaciente WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length > 0) {
      return res.status(409).json({
        error: `Ya existe una clase de paciente con el valor '${Valor}'`
      });
    }
    
    const insertSql = `
      INSERT INTO imClasePaciente (Valor, Descripcion)
      VALUES (@p0, @p1);
    `;
    
    console.log('Ejecutando consulta SQL para crear clase de paciente');
    await executeQuery(insertSql, [Valor, Descripcion]);
    
    return res.status(201).json({
      message: 'Clase de paciente creada correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al crear clase de paciente:', error);
    return res.status(500).json({ 
      error: 'Error al crear clase de paciente', 
      details: error.message 
    });
  }
};

/**
 * Controlador para actualizar una clase de paciente existente
 */
const updateClasePaciente = async (req, res) => {
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
      'SELECT Valor FROM imClasePaciente WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró la clase de paciente con el valor '${Valor}'`
      });
    }
    
    const updateSql = `
      UPDATE imClasePaciente 
      SET Descripcion = @p1
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para actualizar clase de paciente con valor '${Valor}'`);
    await executeQuery(updateSql, [Valor, Descripcion]);
    
    return res.status(200).json({
      message: 'Clase de paciente actualizada correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al actualizar clase de paciente:', error);
    return res.status(500).json({ 
      error: 'Error al actualizar clase de paciente', 
      details: error.message 
    });
  }
};
/**
 * Controlador para eliminar una clase de paciente
 */
const deleteClasePaciente = async (req, res) => {
  try {
    const { Valor } = req.params;
    
    // Verificar si existe el registro
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imClasePaciente WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró la clase de paciente con el valor '${Valor}'`
      });
    }
    
    // Verificar si está siendo utilizada en otras tablas
    // Esto dependerá de las relaciones en la base de datos
    // Ejemplo ficticio:
    // const usages = await executeQuery(
    //   'SELECT COUNT(*) as count FROM otherTable WHERE ClasePaciente = @p0',
    //   [Valor]
    // );
    // 
    // if (usages[0].count > 0) {
    //   return res.status(409).json({
    //     error: `No se puede eliminar la clase de paciente porque está siendo utilizada`
    //   });
    // }
    
    const deleteSql = `
      DELETE FROM imClasePaciente 
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para eliminar clase de paciente con valor '${Valor}'`);
    await executeQuery(deleteSql, [Valor]);
    
    return res.status(200).json({
      message: 'Clase de paciente eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar clase de paciente:', error);
    return res.status(500).json({ 
      error: 'Error al eliminar clase de paciente', 
      details: error.message 
    });
  }
};

module.exports = {
  getClasesPaciente,
  createClasePaciente,
  updateClasePaciente,
  deleteClasePaciente
};
