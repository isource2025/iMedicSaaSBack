const { executeQuery } = require('../models/db');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

/**
 * Controlador para obtener todos los diagnósticos
 */
const getDiagnosticos = async (req, res) => {
  try {
    const sql = `
      SELECT 
        Valor, 
        LTRIM(RTRIM(ISNULL(CodigoOMS, ''))) AS CodigoOMS,
        Descripcion 
      FROM 
        imDiagnosticos 
      ORDER BY 
        CodigoOMS, Descripcion
    `;
    
    console.log('Ejecutando consulta SQL para obtener diagnósticos:', sql);
    
    const result = await executeQuery(sql);
    
    console.log(`Diagnósticos encontrados: ${result.length}`);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error al obtener diagnósticos:', error);
    return res.status(statusDeError(error)).json({ 
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
    const CodigoOMS = String(req.body.CodigoOMS ?? req.body.Valor ?? '').trim();
    const Descripcion = String(req.body.Descripcion ?? '').trim();

    if (!CodigoOMS || !Descripcion) {
      return res.status(400).json({
        error: 'El código CIE y la descripción son obligatorios',
      });
    }
    if (CodigoOMS.length > 6) {
      return res.status(400).json({
        error: 'El código CIE no puede superar 6 caracteres',
      });
    }

    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDiagnosticos WHERE CodigoOMS = @p0',
      [{ value: CodigoOMS, type: 'VarChar', length: 6 }],
    );

    if (existingRecord.length > 0) {
      return res.status(409).json({
        error: `Ya existe un diagnóstico con el código '${CodigoOMS}'`,
      });
    }

    await executeQuery(
      'INSERT INTO imDiagnosticos (CodigoOMS, Descripcion) VALUES (@p0, @p1)',
      [
        { value: CodigoOMS, type: 'VarChar', length: 6 },
        { value: Descripcion, type: 'VarChar', length: 80 },
      ],
    );

    return res.status(201).json({
      message: 'Diagnóstico creado correctamente',
      data: { CodigoOMS, Descripcion },
    });
  } catch (error) {
    console.error('Error al crear diagnóstico:', error);
    return res.status(statusDeError(error)).json({
      error: 'Error al crear diagnóstico',
      details: error.message,
    });
  }
};

/**
 * Controlador para actualizar un diagnóstico existente
 */
const updateDiagnostico = async (req, res) => {
  try {
    const { Valor } = req.params;
    const Descripcion = String(req.body.Descripcion ?? '').trim();
    const CodigoOMS = req.body.CodigoOMS != null ? String(req.body.CodigoOMS).trim() : null;

    if (!Descripcion) {
      return res.status(400).json({
        error: 'La descripción es obligatoria',
      });
    }

    const existingRecord = await executeQuery(
      'SELECT Valor FROM imDiagnosticos WHERE Valor = @p0',
      [{ value: Number(Valor), type: 'Int' }],
    );

    if (existingRecord.length === 0) {
      return res.status(404).json({
        error: `No se encontró el diagnóstico con el valor '${Valor}'`,
      });
    }

    if (CodigoOMS) {
      await executeQuery(
        'UPDATE imDiagnosticos SET Descripcion = @p1, CodigoOMS = @p2 WHERE Valor = @p0',
        [
          { value: Number(Valor), type: 'Int' },
          { value: Descripcion, type: 'VarChar', length: 80 },
          { value: CodigoOMS.slice(0, 6), type: 'VarChar', length: 6 },
        ],
      );
    } else {
      await executeQuery('UPDATE imDiagnosticos SET Descripcion = @p1 WHERE Valor = @p0', [
        { value: Number(Valor), type: 'Int' },
        { value: Descripcion, type: 'VarChar', length: 80 },
      ]);
    }

    return res.status(200).json({
      message: 'Diagnóstico actualizado correctamente',
      data: { Valor, Descripcion, CodigoOMS },
    });
  } catch (error) {
    console.error('Error al actualizar diagnóstico:', error);
    return res.status(statusDeError(error)).json({
      error: 'Error al actualizar diagnóstico',
      details: error.message,
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
    return res.status(statusDeError(error)).json({ 
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
