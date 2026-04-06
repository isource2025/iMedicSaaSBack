const { executeQuery } = require('../models/db');
const ocrService = require('./ocr.service');
const {
  validarRango,
  crearParametroEnCatalogo,
  parseNumeroOCR,
  cargarContextoMatcher,
  buscarParametroConContexto,
  agregarParametroAlContextoMatcher,
  registrarLogsOCRLote
} = require('../utils/ocr-matcher');

/**
 * Servicio simplificado para laboratorios usando tablas existentes
 */

let _cabeceraColumnsCache = null;
let _cabeceraColumnsPromise = null;

/** Columnas reales de imHCExamenesLabCabecera (cache por proceso). */
async function getCabeceraColumnNames() {
  if (_cabeceraColumnsCache) return _cabeceraColumnsCache;
  if (_cabeceraColumnsPromise) return _cabeceraColumnsPromise;
  _cabeceraColumnsPromise = (async () => {
    // INFORMATION_SCHEMA mezcla tablas del mismo nombre en distintos esquemas;
    // hay que usar la tabla real (prioridad dbo) como en imPassword.
    const objs = await executeQuery(`
      SELECT TOP 1 t.object_id AS oid
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE LOWER(t.name) = N'imhcexameneslabcabecera'
      ORDER BY CASE WHEN s.name = N'dbo' THEN 0 ELSE 1 END, s.name
    `);
    if (!objs || !objs.length) {
      _cabeceraColumnsCache = new Set();
      return _cabeceraColumnsCache;
    }
    const rows = await executeQuery(
      `SELECT name AS COLUMN_NAME FROM sys.columns WHERE object_id = @p0 ORDER BY column_id`,
      [{ value: objs[0].oid }]
    );
    const set = new Set(rows.map((r) => String(r.COLUMN_NAME).toLowerCase()));
    _cabeceraColumnsCache = set;
    return set;
  })();
  return _cabeceraColumnsPromise;
}

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

    // 2. Insertar cabecera: NumeroVisita no existe en todas las BDs (solo IdPaciente).
    const col = await getCabeceraColumnNames();
    const nv = col.has('numerovisita');
    const idp = col.has('idpaciente');
    const visitaVal = cabecera.NumeroVisita;

    const insertCols = ['IdExamenLaboratorio'];
    const params = [{ value: idExamen }];
    if (nv) {
      insertCols.push('NumeroVisita');
      params.push({ value: visitaVal });
    }
    insertCols.push('NroProtocolo', 'FechaEstudio');
    params.push(
      { value: cabecera.Protocolo || '' },
      { value: fechaExamen }
    );
    if (idp) {
      insertCols.push('IdPaciente');
      params.push({ value: visitaVal });
    }
    insertCols.push('IdTipoLaboratorio');
    params.push({ value: cabecera.TipoEstudio });

    if (!nv && !idp) {
      throw new Error(
        'imHCExamenesLabCabecera: no hay columna NumeroVisita ni IdPaciente para vincular la visita.'
      );
    }

    const placeholders = insertCols.map((_, i) => `@p${i}`).join(', ');
    const consultaCabecera = `
      INSERT INTO imHCExamenesLabCabecera 
      (${insertCols.join(', ')})
      VALUES (${placeholders})
    `;

    console.log('INSERT cabecera columnas:', insertCols.join(', '));
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

    const matcherCtx = await cargarContextoMatcher(cabecera.TipoEstudio);
    const ocrLogsPendientes = [];

    for (let i = 0; i < detalles.length; i++) {
      const detalle = detalles[i];
      
      console.log(`\n[${i + 1}/${detalles.length}] Procesando: "${detalle.NombreParametro}"`);
      
      // ─────────────────────────────────────────────────
      // ETAPA 1: MATCHING INTELIGENTE
      // ─────────────────────────────────────────────────
      let match = buscarParametroConContexto(detalle.NombreParametro, matcherCtx);

      let nombreFinal = detalle.NombreParametro;
      let parametroCatalogo = match.parametro;

      if (match.esNuevo) {
        console.log(`  → Creando parámetro nuevo en catálogo...`);
        const nuevaFila = await crearParametroEnCatalogo(
          cabecera.TipoEstudio,
          detalle.NombreParametro,
          detalle.ValorReferencia,
          i + 1
        );
        parametrosNuevos++;
        agregarParametroAlContextoMatcher(matcherCtx, nuevaFila);
        match = buscarParametroConContexto(detalle.NombreParametro, matcherCtx);
        parametroCatalogo = match.parametro;
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
      // ETAPA 3: LOG (se envía en lote al final)
      // ─────────────────────────────────────────────────
      ocrLogsPendientes.push({
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
      // ETAPA 4: acumular detalle
      // ─────────────────────────────────────────────────
      detallesProcesados.push({
        nombreFinal,
        resultado: detalle.Resultado,
        fueraDeRango: validacion.fueraDeRango ? 1 : 0,
        orden: i + 1
      });
    }

    await registrarLogsOCRLote(ocrLogsPendientes);

    // ═══════════════════════════════════════════════════════════════
    // INSERCIÓN DE DETALLES (un INSERT con varias filas = 1 round-trip)
    // ═══════════════════════════════════════════════════════════════
    console.log(`\n--- Insertando ${detallesProcesados.length} detalles en BD ---`);

    if (detallesProcesados.length > 0) {
      const COLS = 5;
      const paramsDet = [];
      const gruposValores = detallesProcesados.map((_, rowIdx) => {
        const o = rowIdx * COLS;
        return `(@p${o},@p${o + 1},@p${o + 2},@p${o + 3},@p${o + 4})`;
      });
      for (const det of detallesProcesados) {
        paramsDet.push(
          { value: idExamen },
          { value: det.orden },
          { value: cabecera.TipoEstudio },
          { value: det.nombreFinal },
          { value: det.resultado }
        );
      }
      await executeQuery(
        `
        INSERT INTO imHCExamenesLabDetalle
        (IdExamenLaboratorio, Orden, IdTipoLaboratorio, Estudio, Valor)
        VALUES ${gruposValores.join(', ')}
        `,
        paramsDet
      );
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
    const col = await getCabeceraColumnNames();
    const visitCol = col.has('idpaciente')
      ? 'c.IdPaciente'
      : col.has('numerovisita')
        ? 'c.NumeroVisita'
        : null;
    if (!visitCol) {
      throw new Error(
        'imHCExamenesLabCabecera: falta IdPaciente o NumeroVisita para listar por visita.'
      );
    }
    const visitSelect = col.has('idpaciente')
      ? 'c.IdPaciente as NumeroVisita'
      : 'c.NumeroVisita as NumeroVisita';

    // IdSector no existe en todas las instalaciones.
    const consultaCabecera = `
      SELECT 
        c.IdExamenLaboratorio as IdExamen,
        c.NroProtocolo as Protocolo,
        c.FechaEstudio as FechaExamen,
        c.IdTipoLaboratorio as TipoEstudio,
        ${visitSelect},
        CAST(NULL AS VARCHAR(20)) AS IdSector,
        CAST(NULL AS VARCHAR(255)) AS SectorDescripcion
      FROM imHCExamenesLabCabecera c
      WHERE ${visitCol} = @p0
      ORDER BY c.FechaEstudio DESC
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
    const col = await getCabeceraColumnNames();
    const visitSelect = col.has('idpaciente')
      ? 'IdPaciente as NumeroVisita'
      : col.has('numerovisita')
        ? 'NumeroVisita as NumeroVisita'
        : 'CAST(NULL AS INT) as NumeroVisita';

    const consultaCabecera = `
      SELECT 
        IdExamenLaboratorio as IdExamen,
        NroProtocolo as Protocolo,
        FechaEstudio as FechaExamen,
        IdTipoLaboratorio as TipoEstudio,
        ${visitSelect},
        CAST(NULL AS VARCHAR(20)) AS IdSector,
        CAST(NULL AS VARCHAR(255)) AS SectorDescripcion
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
 * Actualiza un examen existente
 */
const actualizarExamen = async (idExamen, cabecera, detalles) => {
  try {
    console.log('\n=== ACTUALIZANDO EXAMEN ===');
    console.log('ID Examen:', idExamen);
    console.log('Cabecera:', cabecera);
    console.log('Cantidad de detalles:', detalles.length);

    // Convertir fecha para SQL
    let fechaExamen = cabecera.FechaExamen;
    if (fechaExamen && !fechaExamen.includes(':')) {
      if (cabecera.HoraExamen && cabecera.HoraExamen !== '00:00') {
        fechaExamen = `${fechaExamen} ${cabecera.HoraExamen}:00`;
      } else {
        fechaExamen = `${fechaExamen} 12:00:00`;
      }
    }

    // 1. Actualizar cabecera
    const consultaCabecera = `
      UPDATE imHCExamenesLabCabecera
      SET NroProtocolo = @p0,
          FechaEstudio = @p1,
          IdTipoLaboratorio = @p2
      WHERE IdExamenLaboratorio = @p3
    `;

    await executeQuery(consultaCabecera, [
      { value: cabecera.Protocolo || '' },
      { value: fechaExamen },
      { value: cabecera.TipoEstudio },
      { value: idExamen }
    ]);
    console.log('✓ Cabecera actualizada');

    // 2. Eliminar detalles existentes
    await executeQuery(
      'DELETE FROM imHCExamenesLabDetalle WHERE IdExamenLaboratorio = @p0',
      [{ value: idExamen }]
    );
    console.log('✓ Detalles anteriores eliminados');

    // 3. Insertar detalles actualizados
    for (let i = 0; i < detalles.length; i++) {
      const det = detalles[i];
      const consultaDetalle = `
        INSERT INTO imHCExamenesLabDetalle
        (IdExamenLaboratorio, Orden, IdTipoLaboratorio, Estudio, Valor)
        VALUES (@p0, @p1, @p2, @p3, @p4)
      `;

      await executeQuery(consultaDetalle, [
        { value: idExamen },
        { value: det.Orden || i + 1 },
        { value: cabecera.TipoEstudio },
        { value: det.NombreParametro },
        { value: det.Resultado }
      ]);
    }
    console.log(`✓ ${detalles.length} detalles actualizados`);

    return { success: true, idExamen };
  } catch (error) {
    console.error('Error al actualizar examen:', error);
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
  actualizarExamen,
  eliminarExamen
};
