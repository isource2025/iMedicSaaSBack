const { executeQuery } = require('../models/db');
const ocrService = require('./ocr.service');
const {
  buscarParametroOCR,
  validarRango,
  registrarLogOCR,
  crearParametroEnCatalogo,
  parseNumeroOCR
} = require('../utils/ocr-matcher');

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

    // Mantener fecha en formato YYYY-MM-DD sin hora para evitar problemas de timezone
    let fechaExamen = cabecera.FechaExamen;
    if (typeof fechaExamen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaExamen)) {
      // Si hay hora, agregarla; si no, usar mediodía (12:00) para evitar cambios de día por timezone
      if (cabecera.HoraExamen && cabecera.HoraExamen !== '00:00') {
        fechaExamen = `${fechaExamen} ${cabecera.HoraExamen}:00`;
      } else {
        fechaExamen = `${fechaExamen} 12:00:00`;
      }
    }
    console.log('Fecha convertida para SQL:', fechaExamen);

    // 1. Obtener el próximo ID disponible (ya que IdExamenLaboratorio NO es IDENTITY)
    const consultaMaxId = `SELECT ISNULL(MAX(IdExamenLaboratorio), 0) + 1 as NuevoId FROM imHCExamenesLabCabecera`;
    const resultMaxId = await executeQuery(consultaMaxId);
    const idExamen = resultMaxId[0].NuevoId;
    console.log('Nuevo ID generado:', idExamen);

    // 2. Insertar cabecera con el ID generado
    const consultaCabecera = `
      INSERT INTO imHCExamenesLabCabecera 
      (IdExamenLaboratorio, NroProtocolo, FechaEstudio, IdPaciente, IdTipoLaboratorio)
      VALUES (@p0, @p1, @p2, @p3, @p4)
    `;

    const params = [
      { value: idExamen },
      { value: cabecera.Protocolo || '' },
      { value: fechaExamen },
      { value: cabecera.NumeroVisita }, // Usar NumeroVisita como IdPaciente
      { value: cabecera.TipoEstudio }
    ];

    console.log('Parámetros SQL:', params);
    await executeQuery(consultaCabecera, params);
    console.log('✓ Cabecera guardada con ID:', idExamen);

    // ═══════════════════════════════════════════════════════════════
    // PIPELINE PROFESIONAL OCR
    // OCR → NORMALIZACIÓN → MATCHING → VALIDACIÓN → PERSISTENCIA
    // ═══════════════════════════════════════════════════════════════
    
    console.log(`\n╔═══════════════════════════════════════════════════════╗`);
    console.log(`║  PIPELINE PROFESIONAL OCR - ${detalles.length} PARÁMETROS  ║`);
    console.log(`╚═══════════════════════════════════════════════════════╝`);
    
    const detallesProcesados = [];
    let parametrosNuevos = 0;
    let parametrosMatcheados = 0;
    let parametrosFueraRango = 0;
    
    for (let i = 0; i < detalles.length; i++) {
      const detalle = detalles[i];
      
      console.log(`\n[${i + 1}/${detalles.length}] Procesando: "${detalle.NombreParametro}"`);
      
      // ─────────────────────────────────────────────────
      // ETAPA 1: MATCHING INTELIGENTE
      // ─────────────────────────────────────────────────
      const match = await buscarParametroOCR(
        detalle.NombreParametro,
        cabecera.TipoEstudio
      );
      
      let nombreFinal = detalle.NombreParametro;
      let parametroCatalogo = match.parametro;
      
      // Si es parámetro nuevo, crearlo en catálogo
      if (match.esNuevo) {
        console.log(`  → Creando parámetro nuevo en catálogo...`);
        await crearParametroEnCatalogo(
          cabecera.TipoEstudio,
          detalle.NombreParametro,
          detalle.ValorReferencia,
          i + 1
        );
        parametrosNuevos++;
        
        // Recargar parámetro recién creado
        const recargado = await buscarParametroOCR(
          detalle.NombreParametro,
          cabecera.TipoEstudio
        );
        parametroCatalogo = recargado.parametro;
      } else {
        // Si es fuzzy match que requiere revisión, usar nombre original del OCR
        // para evitar duplicados si el parámetro real aparece después
        if (match.requiereRevision) {
          console.log(`  → Usando nombre original del OCR para evitar duplicados`);
          nombreFinal = detalle.NombreParametro;
        } else {
          // Match exacto o automático: usar nombre canónico del catálogo
          nombreFinal = match.parametro.Estudio;
        }
        parametrosMatcheados++;
      }
      
      // ─────────────────────────────────────────────────
      // ETAPA 2: VALIDACIÓN DE RANGO
      // ─────────────────────────────────────────────────
      const valorNumerico = parseNumeroOCR(detalle.Resultado);
      const validacion = validarRango(valorNumerico, parametroCatalogo);
      
      if (validacion.fueraDeRango) {
        console.log(`  ⚠ FUERA DE RANGO (${validacion.tipo}): ${detalle.Resultado}`);
        parametrosFueraRango++;
      }
      
      // ─────────────────────────────────────────────────
      // ETAPA 3: LOG DE AUDITORÍA
      // ─────────────────────────────────────────────────
      await registrarLogOCR({
        idExamen: idExamen,
        textoOriginal: detalle.NombreParametro,
        textoNormalizado: match.textoNormalizado || '',
        parametroMatch: nombreFinal,
        score: match.score,
        tipoMatch: match.tipoMatch,
        numeroVisita: cabecera.NumeroVisita,
        tipoEstudio: cabecera.TipoEstudio
      });
      
      // ─────────────────────────────────────────────────
      // ETAPA 4: PERSISTENCIA
      // ─────────────────────────────────────────────────
      detallesProcesados.push({
        nombreFinal,
        resultado: detalle.Resultado,
        fueraDeRango: validacion.fueraDeRango ? 1 : 0,
        orden: i + 1
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // INSERCIÓN MASIVA DE DETALLES
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n--- Insertando ${detallesProcesados.length} detalles en BD ---`);
    
    for (let i = 0; i < detallesProcesados.length; i++) {
      const det = detallesProcesados[i];
      
      const consultaDetalle = `
        INSERT INTO imHCExamenesLabDetalle
        (IdExamenLaboratorio, Orden, IdTipoLaboratorio, Estudio, Valor)
        VALUES (@p0, @p1, @p2, @p3, @p4)
      `;

      await executeQuery(consultaDetalle, [
        { value: idExamen },
        { value: det.orden },
        { value: cabecera.TipoEstudio },
        { value: det.nombreFinal },
        { value: det.resultado }
      ]);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // RESUMEN DEL PIPELINE
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n╔═══════════════════════════════════════════════════════╗`);
    console.log(`║  RESUMEN DEL PIPELINE                                 ║`);
    console.log(`╠═══════════════════════════════════════════════════════╣`);
    console.log(`║  Total parámetros:        ${detalles.length.toString().padStart(3)}                        ║`);
    console.log(`║  Matcheados (catálogo):   ${parametrosMatcheados.toString().padStart(3)}                        ║`);
    console.log(`║  Nuevos (creados):        ${parametrosNuevos.toString().padStart(3)}                        ║`);
    console.log(`║  Fuera de rango:          ${parametrosFueraRango.toString().padStart(3)}                        ║`);
    console.log(`╚═══════════════════════════════════════════════════════╝`);

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
          d.Estudio as NombreParametro,
          d.Valor as Resultado,
          d.Orden,
          CASE 
            WHEN conf.ValorMinimo IS NOT NULL AND conf.ValorMaximo IS NOT NULL 
            THEN conf.ValorMinimo + '-' + conf.ValorMaximo
            WHEN conf.ValorNormal IS NOT NULL 
            THEN conf.ValorNormal
            ELSE NULL
          END as ValorReferencia,
          '' as UnidadMedida,
          0 as FueraDeRango
        FROM imHCExamenesLabDetalle d
        LEFT JOIN imHCExamenesLabDetalleConf conf 
          ON d.IdTipoLaboratorio = conf.IdTipoLaboratorio 
          AND d.Estudio = conf.Estudio
        WHERE d.IdExamenLaboratorio = @p0
        ORDER BY d.Orden
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
        d.Estudio as NombreParametro,
        d.Valor as Resultado,
        d.Orden,
        CASE 
          WHEN conf.ValorMinimo IS NOT NULL AND conf.ValorMaximo IS NOT NULL 
          THEN conf.ValorMinimo + '-' + conf.ValorMaximo
          WHEN conf.ValorNormal IS NOT NULL 
          THEN conf.ValorNormal
          ELSE NULL
        END as ValorReferencia,
        '' as UnidadMedida,
        0 as FueraDeRango
      FROM imHCExamenesLabDetalle d
      LEFT JOIN imHCExamenesLabDetalleConf conf 
        ON d.IdTipoLaboratorio = conf.IdTipoLaboratorio 
        AND d.Estudio = conf.Estudio
      WHERE d.IdExamenLaboratorio = @p0
      ORDER BY d.Orden
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
