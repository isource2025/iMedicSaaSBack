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
  if (!valorOCR) return null;
  
  const limpio = valorOCR
    .toString()
    .replace(/\s+/g, '') // Eliminar espacios
    .replace(/,/g, '.') // Comas → puntos
    .replace(/[^0-9.-]/g, ''); // Solo números, puntos y guiones
  
  const numero = parseFloat(limpio);
  return isNaN(numero) ? null : numero;
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
    (r) => (r.NombreNormalizado || '') === normalizado
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
 * Crea o actualiza parámetro en catálogo
 */
async function crearParametroEnCatalogo(tipoEstudio, nombreParametro, valorReferencia, orden) {
  const normalizado = normalizarTexto(nombreParametro);
  
  // Parsear valor de referencia para extraer min/max
  let valorMin = null, valorMax = null, valorNormal = null;
  
  if (valorReferencia) {
    const rangoMatch = valorReferencia.match(/^([\d\.\,]+)\s*[-–]\s*([\d\.\,]+)/);
    if (rangoMatch) {
      valorMin = rangoMatch[1];
      valorMax = rangoMatch[2];
    } else {
      valorNormal = valorReferencia;
    }
  }
  
  const consulta = `
    INSERT INTO imHCExamenesLabDetalleConf
    (IdTipoLaboratorio, Orden, Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal, AlertaCritica)
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)
  `;
  
  await executeQuery(consulta, [
    { value: tipoEstudio },
    { value: orden },
    { value: nombreParametro },
    { value: normalizado },
    { value: valorMin || '' },
    { value: valorMax || '' },
    { value: valorNormal || '' },
    { value: 0 }
  ]);

  console.log(`  ✓ Parámetro creado en catálogo: ${nombreParametro}`);

  return {
    Estudio: nombreParametro,
    NombreNormalizado: normalizado,
    ValorMinimo: valorMin || '',
    ValorMaximo: valorMax || '',
    ValorNormal: valorNormal || ''
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
