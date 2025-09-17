const { executeQuery } = require('../models/db');

/**
 * Controlador para obtener todas las disposiciones de egreso
 */
const getDisposicionesEgreso = async (req, res) => {
  try {
    const sql = `
      SELECT 
        Valor, 
        Descripcion 
      FROM 
        imDisposicionEgreso 
      ORDER BY 
        Descripcion
    `;
    
    console.log('Ejecutando consulta SQL para obtener disposiciones de egreso:', sql);
    
    const result = await executeQuery(sql);
    
    console.log(`Disposiciones de egreso encontradas: ${result.length}`);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al obtener disposiciones de egreso:', error);
    return res.status(500).json({ 
      error: 'Error al obtener disposiciones de egreso', 
      details: error.message 
    });
  }
};

/**
 * Controlador para crear una nueva disposición de egreso
 */
const createDisposicionEgreso = async (req, res) => {
  try {
    const { Valor, Descripcion } = req.body;
    
    // Validación básica
    if (Valor === undefined || Valor === null || !Descripcion) {
      return res.status(400).json({ 
        error: 'El valor y la descripción son obligatorios' 
      });
    }
    
    // Convertir a número si es necesario
    const valorNumerico = Number(Valor);
    
    if (isNaN(valorNumerico)) {
      return res.status(400).json({
        error: 'El valor debe ser un número'
      });
    }
    
    // Verificar si ya existe un registro con ese Valor
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDisposicionEgreso WHERE Valor = @p0',
      [valorNumerico]
    );
    
    if (existingRecord.length > 0) {
      return res.status(409).json({
        error: `Ya existe una disposición de egreso con el valor ${valorNumerico}`
      });
    }
    
    const insertSql = `
      INSERT INTO imDisposicionEgreso (Valor, Descripcion)
      VALUES (@p0, @p1);
    `;
    
    console.log('Ejecutando consulta SQL para crear disposición de egreso');
    await executeQuery(insertSql, [valorNumerico, Descripcion]);
    
    return res.status(201).json({
      message: 'Disposición de egreso creada correctamente',
      data: { Valor: valorNumerico, Descripcion }
    });
  } catch (error) {
    console.error('Error al crear disposición de egreso:', error);
    return res.status(500).json({ 
      error: 'Error al crear disposición de egreso', 
      details: error.message 
    });
  }
};

/**
 * Controlador para actualizar una disposición de egreso existente
 */
const updateDisposicionEgreso = async (req, res) => {
  try {
    const valorParam = req.params.Valor;
    const { Descripcion } = req.body;
    
    // Convertir a número
    const Valor = Number(valorParam);
    
    if (isNaN(Valor)) {
      return res.status(400).json({
        error: 'El valor debe ser un número'
      });
    }
    
    // Validación básica
    if (!Descripcion) {
      return res.status(400).json({ 
        error: 'La descripción es obligatoria' 
      });
    }
    
    // Verificar si existe el registro
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDisposicionEgreso WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró la disposición de egreso con el valor ${Valor}`
      });
    }
    
    const updateSql = `
      UPDATE imDisposicionEgreso 
      SET Descripcion = @p1
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para actualizar disposición de egreso con valor ${Valor}`);
    await executeQuery(updateSql, [Valor, Descripcion]);
    
    return res.status(200).json({
      message: 'Disposición de egreso actualizada correctamente',
      data: { Valor, Descripcion }
    });
  } catch (error) {
    console.error('Error al actualizar disposición de egreso:', error);
    return res.status(500).json({ 
      error: 'Error al actualizar disposición de egreso', 
      details: error.message 
    });
  }
};

/**
 * Controlador para eliminar una disposición de egreso
 */
const deleteDisposicionEgreso = async (req, res) => {
  try {
    const valorParam = req.params.Valor;
    
    // Convertir a número
    const Valor = Number(valorParam);
    
    if (isNaN(Valor)) {
      return res.status(400).json({
        error: 'El valor debe ser un número'
      });
    }
    
    // Verificar si existe el registro
    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDisposicionEgreso WHERE Valor = @p0',
      [Valor]
    );
    
    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró la disposición de egreso con el valor ${Valor}`
      });
    }
    
    const deleteSql = `
      DELETE FROM imDisposicionEgreso 
      WHERE Valor = @p0
    `;
    
    console.log(`Ejecutando consulta SQL para eliminar disposición de egreso con valor ${Valor}`);
    await executeQuery(deleteSql, [Valor]);
    
    return res.status(200).json({
      message: 'Disposición de egreso eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar disposición de egreso:', error);
    return res.status(500).json({ 
      error: 'Error al eliminar disposición de egreso', 
      details: error.message 
    });
  }
};

module.exports = {
  getDisposicionesEgreso,
  createDisposicionEgreso,
  updateDisposicionEgreso,
  deleteDisposicionEgreso
};
