/**
 * PIPELINE PROFESIONAL OCR - MATCHER INTELIGENTE
 * Normalización + Fuzzy Matching + Sistema de Alias
 */

const stringSimilarity = require('string-similarity');
const { executeQuery } = require('../models/db');

/**
 * Normaliza texto para matching
 * - Convierte a mayúsculas
 * - Elimina acentos
 * - Elimina símbolos especiales
 * - Limpia espacios múltiples
 */
function normalizarTexto(texto) {
  if (!texto) return '';
  
  return texto
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Elimina acentos
    .replace(/[^A-Z0-9 ]/g, "") // Solo letras, números y espacios
    .replace(/\s+/g, " ") // Espacios múltiples → uno solo
    .trim();
}

/**
 * Parsea número desde texto OCR
 * Maneja: "18.560", "2,660,000", "23.8 %"
 */
function parseNumeroOCR(valorOCR) {
  if (valorOCR === null || valorOCR === undefined || valorOCR === '') return null;

  let s = valorOCR
    .toString()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^0-9.,-]/g, '');

  if (!s) return null;

  // Formato europeo miles: 150.000 o 1.234.567,89
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d+$/.test(s)) {
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  } else if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  }

  const numero = parseFloat(s);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Parsea texto de referencia tipo "70-100", "8.5-10.5", "150.000-450.000"
 */
function parseRangoReferencia(texto) {
  if (!texto) return { min: null, max: null };
  const s = String(texto).trim();
  const match = s.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (!match) return { min: null, max: null };
  return { min: parseNumeroOCR(match[1]), max: parseNumeroOCR(match[2]) };
}

/**
 * Valida resultado contra rangos del catálogo o texto de referencia del informe
 */
function validarResultadoDetalle(resultado, opts = {}) {
  const valorNum = parseNumeroOCR(resultado);
  if (valorNum === null) return { fueraDeRango: false, tipo: null };

  const param = {
    ValorMinimo: opts.ValorMinimo,
    ValorMaximo: opts.ValorMaximo,
    ValorNormal: opts.ValorNormal,
  };

  if (
    (param.ValorMinimo == null || param.ValorMinimo === '') &&
    (param.ValorMaximo == null || param.ValorMaximo === '') &&
    opts.ValorReferencia
  ) {
    const rango = parseRangoReferencia(opts.ValorReferencia);
    param.ValorMinimo = rango.min;
    param.ValorMaximo = rango.max;
  }

  return validarRango(valorNum, param);
}

/**
 * Calcula FueraDeRango en cada detalle al leer desde BD
 */
function enriquecerDetallesLaboratorio(detalles) {
  if (!Array.isArray(detalles)) return [];
  return detalles.map((d) => {
    const validacion = validarResultadoDetalle(d.Resultado, {
      ValorMinimo: d.ValorMinimoConf ?? d.ValorMinimo,
      ValorMaximo: d.ValorMaximoConf ?? d.ValorMaximo,
      ValorNormal: d.ValorNormalConf ?? d.ValorNormal,
      ValorReferencia: d.ValorReferencia,
    });
    const {
      ValorMinimoConf,
      ValorMaximoConf,
      ValorNormalConf,
      ValorMinimo,
      ValorMaximo,
      ValorNormal,
      ...rest
    } = d;
    return {
      ...rest,
      FueraDeRango: !!validacion.fueraDeRango,
    };
  });
}

/**
 * Busca parámetro en catálogo usando matching inteligente
 * 
 * Pipeline:
 * 1. Match exacto (nombre normalizado)
 * 2. Match por alias
 * 3. Fuzzy matching
 * 4. Fallback → null (pendiente revisión)
 * 
 * @param {string} textoOCR - Texto extraído del PDF
 * @param {string} tipoEstudio - Tipo de laboratorio (HEMOGRAMA, etc)
 * @returns {Object} { parametro, tipoMatch, score, esNuevo }
 */
/**
 * Dos SELECT al inicio del guardado; el matching corre en Node (evita 3×N round-trips al SQL remoto).
 */
async function cargarContextoMatcher(tipoEstudio) {
  const confRows = await executeQuery(
    `
    SELECT Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal
    FROM imHCExamenesLabDetalleConf
    WHERE IdTipoLaboratorio = @p0
    `,
    [{ value: tipoEstudio }]
  );

  let aliasRows = [];
  try {
    aliasRows = await executeQuery(
      `
      SELECT
        a.Estudio,
        a.Alias,
        a.AliasNormalizado,
        conf.NombreNormalizado,
        conf.ValorMinimo,
        conf.ValorMaximo,
        conf.ValorNormal
      FROM imParametroAlias a
      INNER JOIN imHCExamenesLabDetalleConf conf
        ON a.IdTipoLaboratorio = conf.IdTipoLaboratorio
        AND a.Estudio = conf.Estudio
      WHERE a.IdTipoLaboratorio = @p0 AND a.Activo = 1
      `,
      [{ value: tipoEstudio }]
    );
  } catch (e) {
    console.warn('⚠ imParametroAlias: catálogo de alias omitido:', e.message);
  }

  return { tipoEstudio, confRows, aliasRows };
}

/**
 * Misma lógica que buscarParametroOCR pero sin idas a BD (usa contexto precargado).
 * Tras crearParametroEnCatalogo, llamar agregarParametroAlContextoMatcher o volver a empujar la fila.
 */
function buscarParametroConContexto(textoOCR, contexto) {
  const normalizado = normalizarTexto(textoOCR);

  console.log(`\n🔍 Buscando match para: "${textoOCR}" → "${normalizado}"`);

  const matchExacto = contexto.confRows.filter(
    (r) =>
      (r.NombreNormalizado || '') === normalizado ||
      normalizarTexto(r.Estudio) === normalizado
  );
  if (matchExacto.length > 0) {
    const p = matchExacto[0];
    console.log(`  ✓ MATCH EXACTO: ${p.Estudio}`);
    return {
      parametro: p,
      tipoMatch: 'EXACTO',
      score: 1.0,
      esNuevo: false,
      textoNormalizado: normalizado
    };
  }

  const matchAlias = contexto.aliasRows.filter((r) => r.AliasNormalizado === normalizado);
  if (matchAlias.length > 0) {
    const p = matchAlias[0];
    console.log(`  ✓ MATCH POR ALIAS: "${p.Alias}" → ${p.Estudio}`);
    return {
      parametro: p,
      tipoMatch: 'ALIAS',
      score: 0.95,
      esNuevo: false,
      textoNormalizado: normalizado
    };
  }

  if (contexto.confRows.length > 0) {
    const matches = contexto.confRows.map((p) => ({
      ...p,
      score: stringSimilarity.compareTwoStrings(
        normalizado,
        p.NombreNormalizado || normalizarTexto(p.Estudio)
      )
    }));
    matches.sort((a, b) => b.score - a.score);
    const mejor = matches[0];
    console.log(`  → Mejor fuzzy match: ${mejor.Estudio} (score: ${mejor.score.toFixed(3)})`);

    if (mejor.score > 0.9) {
      console.log(`  ✓ MATCH AUTOMÁTICO (score > 0.90)`);
      return {
        parametro: mejor,
        tipoMatch: 'FUZZY_AUTO',
        score: mejor.score,
        esNuevo: false,
        textoNormalizado: normalizado
      };
    }
    if (mejor.score >= 0.85) {
      console.log(`  ⚠ MATCH PROBABLE (0.85 ≤ score ≤ 0.90) - requiere revisión`);
      return {
        parametro: mejor,
        tipoMatch: 'FUZZY_PROBABLE',
        score: mejor.score,
        esNuevo: false,
        requiereRevision: true,
        textoNormalizado: normalizado
      };
    }
  }

  console.log(`  ✗ NO MATCH (score < 0.75) - parámetro nuevo`);
  return {
    parametro: null,
    tipoMatch: 'NO_MATCH',
    score: 0,
    esNuevo: true,
    textoOriginal: textoOCR,
    textoNormalizado: normalizado
  };
}

function agregarParametroAlContextoMatcher(contexto, filaCatalogo) {
  contexto.confRows.push(filaCatalogo);
}

async function buscarParametroOCR(textoOCR, tipoEstudio) {
  const ctx = await cargarContextoMatcher(tipoEstudio);
  return buscarParametroConContexto(textoOCR, ctx);
}

/**
 * Valida si un valor está dentro del rango de referencia
 * @param {number} valor - Valor numérico del resultado
 * @param {Object} parametro - Parámetro con rangos de referencia
 * @returns {Object} { fueraDeRango, tipo }
 */
function validarRango(valor, parametro) {
  if (!parametro || valor === null || valor === undefined) {
    return { fueraDeRango: false, tipo: null };
  }
  
  const valorNum = typeof valor === 'number' ? valor : parseNumeroOCR(valor);
  if (valorNum === null) {
    return { fueraDeRango: false, tipo: null };
  }
  
  // Si tiene rango min-max
  if (parametro.ValorMinimo && parametro.ValorMaximo) {
    const min = parseNumeroOCR(parametro.ValorMinimo);
    const max = parseNumeroOCR(parametro.ValorMaximo);
    
    if (min !== null && max !== null) {
      if (valorNum < min) {
        return { fueraDeRango: true, tipo: 'BAJO' };
      } else if (valorNum > max) {
        return { fueraDeRango: true, tipo: 'ALTO' };
      }
    }
  }
  
  // Si tiene valor normal único
  if (parametro.ValorNormal) {
    const normal = parseNumeroOCR(parametro.ValorNormal);
    if (normal !== null && valorNum !== normal) {
      return { 
        fueraDeRango: true, 
        tipo: valorNum > normal ? 'ALTO' : 'BAJO' 
      };
    }
  }
  
  return { fueraDeRango: false, tipo: null };
}

/**
 * Registra en log de auditoría OCR
 */
async function registrarLogOCR(datos) {
  await registrarLogsOCRLote([datos]);
}

/** Una sola ida a SQL para todas las filas del examen (8 columnas por fila). */
async function registrarLogsOCRLote(entradas) {
  if (!entradas || entradas.length === 0) return;

  const COLS = 8;
  const params = [];
  const valueGroups = entradas.map((_, rowIdx) => {
    const o = rowIdx * COLS;
    return `(@p${o},@p${o + 1},@p${o + 2},@p${o + 3},@p${o + 4},@p${o + 5},@p${o + 6},@p${o + 7})`;
  });

  for (const e of entradas) {
    params.push(
      { value: e.idExamen },
      { value: e.textoOriginal?.substring(0, 500) || '' },
      { value: e.textoNormalizado?.substring(0, 500) || '' },
      { value: e.parametroMatch },
      { value: e.score },
      { value: e.tipoMatch },
      { value: e.numeroVisita },
      { value: e.tipoEstudio }
    );
  }

  const consulta = `
    INSERT INTO imOCRLog 
    (IdExamenLaboratorio, TextoOriginal, TextoNormalizado, ParametroMatch, 
     Score, TipoMatch, NumeroVisita, TipoEstudio)
    VALUES ${valueGroups.join(', ')}
  `;

  await executeQuery(consulta, params);
}

/**
 * Crea parámetro en catálogo si no existe (PK: IdTipoLaboratorio + Orden).
 */
async function crearParametroEnCatalogo(tipoEstudio, nombreParametro, valorReferencia, _ordenIgnorado) {
  const normalizado = normalizarTexto(nombreParametro);
  const estudio = String(nombreParametro || '').trim().toUpperCase();

  const existente = await executeQuery(
    `
    SELECT TOP 1 Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal
    FROM imHCExamenesLabDetalleConf
    WHERE IdTipoLaboratorio = @p0
      AND (
        LTRIM(RTRIM(Estudio)) = @p1
        OR LTRIM(RTRIM(NombreNormalizado)) = @p2
      )
    `,
    [
      { value: tipoEstudio },
      { value: estudio },
      { value: normalizado },
    ]
  );
  if (existente.length > 0) {
    console.log(`  ✓ Parámetro ya existe en catálogo: ${existente[0].Estudio}`);
    return existente[0];
  }

  let valorMin = null;
  let valorMax = null;
  let valorNormal = null;

  if (valorReferencia) {
    const rangoMatch = String(valorReferencia).match(/^([\d.,]+)\s*[-–]\s*([\d.,]+)/);
    if (rangoMatch) {
      valorMin = rangoMatch[1];
      valorMax = rangoMatch[2];
    } else {
      valorNormal = valorReferencia;
    }
  }

  const ordenRows = await executeQuery(
    `
    SELECT ISNULL(MAX(Orden), 0) + 1 AS SiguienteOrden
    FROM imHCExamenesLabDetalleConf
    WHERE IdTipoLaboratorio = @p0
    `,
    [{ value: tipoEstudio }]
  );
  const siguienteOrden = Number(ordenRows[0]?.SiguienteOrden) || 1;

  const consulta = `
    INSERT INTO imHCExamenesLabDetalleConf
    (IdTipoLaboratorio, Orden, Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal, AlertaCritica)
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)
  `;

  try {
    await executeQuery(consulta, [
      { value: tipoEstudio },
      { value: siguienteOrden },
      { value: estudio },
      { value: normalizado },
      { value: valorMin || '' },
      { value: valorMax || '' },
      { value: valorNormal || '' },
      { value: 0 },
    ]);
    console.log(`  ✓ Parámetro creado en catálogo: ${estudio} (orden ${siguienteOrden})`);
  } catch (err) {
    if (err.number === 2627) {
      const dup = await executeQuery(
        `
        SELECT TOP 1 Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal
        FROM imHCExamenesLabDetalleConf
        WHERE IdTipoLaboratorio = @p0 AND LTRIM(RTRIM(Estudio)) = @p1
        `,
        [{ value: tipoEstudio }, { value: estudio }]
      );
      if (dup.length > 0) {
        console.log(`  ✓ Parámetro en catálogo (concurrencia): ${dup[0].Estudio}`);
        return dup[0];
      }
    }
    throw err;
  }

  return {
    Estudio: estudio,
    NombreNormalizado: normalizado,
    ValorMinimo: valorMin || '',
    ValorMaximo: valorMax || '',
    ValorNormal: valorNormal || '',
  };
}

/**
 * Crea alias para un parámetro
 */
async function crearAlias(tipoEstudio, nombreParametro, alias) {
  const aliasNormalizado = normalizarTexto(alias);
  
  const consulta = `
    INSERT INTO imParametroAlias
    (IdTipoLaboratorio, Estudio, Alias, AliasNormalizado, Activo)
    VALUES (@p0, @p1, @p2, @p3, 1)
  `;
  
  await executeQuery(consulta, [
    { value: tipoEstudio },
    { value: nombreParametro },
    { value: alias },
    { value: aliasNormalizado }
  ]);
  
  console.log(`  ✓ Alias creado: "${alias}" → ${nombreParametro}`);
}

module.exports = {
  normalizarTexto,
  parseNumeroOCR,
  parseRangoReferencia,
  validarResultadoDetalle,
  enriquecerDetallesLaboratorio,
  buscarParametroOCR,
  cargarContextoMatcher,
  buscarParametroConContexto,
  agregarParametroAlContextoMatcher,
  validarRango,
  registrarLogOCR,
  registrarLogsOCRLote,
  crearParametroEnCatalogo,
  crearAlias
};
