const { executeQuery } = require('../models/db');
const ocrService = require('./ocr.service');

/**
 * Servicio simplificado para laboratorios usando tablas existentes
 */

/**
 * Procesa archivo con OCR
 */
const procesarArchivoConOCR = async (buffer, mimeType) => {
  try {
    const resultado = await ocrService.procesarDocumento(buffer, mimeType);
    return resultado;
  } catch (error) {
    console.error('Error al procesar archivo con OCR:', error);
    throw error;
  }
};

/**
 * Guarda un examen de laboratorio
 */
const guardarExamen = async (cabecera, detalles) => {
  try {
    console.log('\n=== GUARDANDO EXAMEN DE LABORATORIO ===');
    console.log('Cabecera recibida:', JSON.stringify(cabecera, null, 2));
    console.log('Cantidad de detalles:', detalles.length);

    // Convertir fecha de YYYY-MM-DD a DATETIME para SQL Server
    let fechaExamen = cabecera.FechaExamen;
    if (typeof fechaExamen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaExamen)) {
      // Agregar hora si no la tiene
      if (cabecera.HoraExamen) {
        fechaExamen = `${fechaExamen} ${cabecera.HoraExamen}:00`;
      } else {
        fechaExamen = `${fechaExamen} 00:00:00`;
      }
    }
    console.log('Fecha convertida para SQL:', fechaExamen);

    // 1. Insertar cabecera
    const consultaCabecera = `
      INSERT INTO imHCExamenesLabCabecera 
      (NroProtocolo, FechaEstudio, IdPaciente, IdTipoLaboratorio)
      OUTPUT INSERTED.IdExamenLaboratorio
      VALUES (@p0, @p1, @p2, @p3)
    `;

    const params = [
      { value: cabecera.Protocolo || '' },
      { value: fechaExamen },
      { value: cabecera.NumeroVisita }, // Usar NumeroVisita como IdPaciente
      { value: cabecera.TipoEstudio }
    ];

    console.log('Parámetros SQL:', params);
    const resultCabecera = await executeQuery(consultaCabecera, params);
    const idExamen = resultCabecera[0].IdExamenLaboratorio;
    console.log('✓ Cabecera guardada con ID:', idExamen);

    // 2. Insertar detalles
    console.log(`Insertando ${detalles.length} detalles...`);
    for (let i = 0; i < detalles.length; i++) {
      const detalle = detalles[i];
      console.log(`  Detalle ${i + 1}:`, detalle.NombreParametro, '=', detalle.Resultado);
      
      const consultaDetalle = `
        INSERT INTO imHCExamenesLabDetalle
        (IdTipoLaboratorio, Estudio, Valor, Indice, IdExamenLaboratorio, Orden)
        VALUES (@p0, @p1, @p2, @p3, @p4, @p5)
      `;

      const paramsDetalle = [
        { value: cabecera.TipoEstudio },
        { value: detalle.NombreParametro },
        { value: detalle.Resultado },
        { value: i + 1 },
        { value: idExamen },
        { value: i + 1 }
      ];

      await executeQuery(consultaDetalle, paramsDetalle);
    }

    console.log('✓ Examen guardado exitosamente con ID:', idExamen);
    console.log('=======================================\n');
    return { IdExamen: idExamen, success: true };
  } catch (error) {
    console.error('✗ Error al guardar examen:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
};

/**
 * Obtiene exámenes por número de visita (IdPaciente)
 */
const obtenerExamenesPorVisita = async (numeroVisita) => {
  try {
    // Obtener cabeceras
    const consultaCabecera = `
      SELECT 
        IdExamenLaboratorio as IdExamen,
        NroProtocolo as Protocolo,
        FechaEstudio as FechaExamen,
        IdTipoLaboratorio as TipoEstudio,
        IdPaciente as NumeroVisita
      FROM imHCExamenesLabCabecera
      WHERE IdPaciente = @p0
      ORDER BY FechaEstudio DESC
    `;

    const cabeceras = await executeQuery(consultaCabecera, [{ value: numeroVisita }]);

    // Para cada cabecera, obtener sus detalles
    const examenes = [];
    for (const cab of cabeceras) {
      const consultaDetalle = `
        SELECT 
          Estudio as NombreParametro,
          Valor as Resultado,
          Orden,
          0 as FueraDeRango
        FROM imHCExamenesLabDetalle
        WHERE IdExamenLaboratorio = @p0
        ORDER BY Orden
      `;

      const detalles = await executeQuery(consultaDetalle, [{ value: cab.IdExamen }]);

      examenes.push({
        ...cab,
        detalles: detalles,
        totalParametros: detalles.length,
        parametrosFueraDeRango: 0
      });
    }

    return examenes;
  } catch (error) {
    console.error('Error al obtener exámenes:', error);
    throw error;
  }
};

/**
 * Obtiene un examen por ID
 */
const obtenerExamenPorId = async (idExamen) => {
  try {
    const consultaCabecera = `
      SELECT 
        IdExamenLaboratorio as IdExamen,
        NroProtocolo as Protocolo,
        FechaEstudio as FechaExamen,
        IdTipoLaboratorio as TipoEstudio,
        IdPaciente as NumeroVisita
      FROM imHCExamenesLabCabecera
      WHERE IdExamenLaboratorio = @p0
    `;

    const cabeceras = await executeQuery(consultaCabecera, [{ value: idExamen }]);
    if (cabeceras.length === 0) return null;

    const cab = cabeceras[0];

    const consultaDetalle = `
      SELECT 
        Estudio as NombreParametro,
        Valor as Resultado,
        Orden,
        0 as FueraDeRango
      FROM imHCExamenesLabDetalle
      WHERE IdExamenLaboratorio = @p0
      ORDER BY Orden
    `;

    const detalles = await executeQuery(consultaDetalle, [{ value: idExamen }]);

    return {
      ...cab,
      detalles: detalles,
      totalParametros: detalles.length,
      parametrosFueraDeRango: 0
    };
  } catch (error) {
    console.error('Error al obtener examen:', error);
    throw error;
  }
};

/**
 * Elimina un examen
 */
const eliminarExamen = async (idExamen) => {
  try {
    // Primero eliminar detalles
    await executeQuery(
      'DELETE FROM imHCExamenesLabDetalle WHERE IdExamenLaboratorio = @p0',
      [{ value: idExamen }]
    );

    // Luego eliminar cabecera
    await executeQuery(
      'DELETE FROM imHCExamenesLabCabecera WHERE IdExamenLaboratorio = @p0',
      [{ value: idExamen }]
    );

    return { success: true };
  } catch (error) {
    console.error('Error al eliminar examen:', error);
    throw error;
  }
};

module.exports = {
  procesarArchivoConOCR,
  guardarExamen,
  obtenerExamenesPorVisita,
  obtenerExamenPorId,
  eliminarExamen
};
