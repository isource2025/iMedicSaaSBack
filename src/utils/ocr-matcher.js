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
async function buscarParametroOCR(textoOCR, tipoEstudio) {
  const normalizado = normalizarTexto(textoOCR);
  
  console.log(`\n🔍 Buscando match para: "${textoOCR}" → "${normalizado}"`);
  
  // ===== 1. MATCH EXACTO =====
  const consultaExacto = `
    SELECT Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal
    FROM imHCExamenesLabDetalleConf
    WHERE IdTipoLaboratorio = @p0 
      AND NombreNormalizado = @p1
  `;
  
  const matchExacto = await executeQuery(consultaExacto, [
    { value: tipoEstudio },
    { value: normalizado }
  ]);
  
  if (matchExacto.length > 0) {
    console.log(`  ✓ MATCH EXACTO: ${matchExacto[0].Estudio}`);
    return {
      parametro: matchExacto[0],
      tipoMatch: 'EXACTO',
      score: 1.0,
      esNuevo: false
    };
  }
  
  // ===== 2. MATCH POR ALIAS =====
  const consultaAlias = `
    SELECT 
      a.Estudio,
      a.Alias,
      conf.NombreNormalizado,
      conf.ValorMinimo,
      conf.ValorMaximo,
      conf.ValorNormal
    FROM imParametroAlias a
    INNER JOIN imHCExamenesLabDetalleConf conf
      ON a.IdTipoLaboratorio = conf.IdTipoLaboratorio
      AND a.Estudio = conf.Estudio
    WHERE a.IdTipoLaboratorio = @p0 
      AND a.AliasNormalizado = @p1
      AND a.Activo = 1
  `;
  
  const matchAlias = await executeQuery(consultaAlias, [
    { value: tipoEstudio },
    { value: normalizado }
  ]);
  
  if (matchAlias.length > 0) {
    console.log(`  ✓ MATCH POR ALIAS: "${matchAlias[0].Alias}" → ${matchAlias[0].Estudio}`);
    return {
      parametro: matchAlias[0],
      tipoMatch: 'ALIAS',
      score: 0.95,
      esNuevo: false
    };
  }
  
  // ===== 3. FUZZY MATCHING =====
  const consultaTodos = `
    SELECT Estudio, NombreNormalizado, ValorMinimo, ValorMaximo, ValorNormal
    FROM imHCExamenesLabDetalleConf
    WHERE IdTipoLaboratorio = @p0
  `;
  
  const todosParametros = await executeQuery(consultaTodos, [
    { value: tipoEstudio }
  ]);
  
  if (todosParametros.length > 0) {
    // Calcular similitud con cada parámetro
    const matches = todosParametros.map(p => ({
      ...p,
      score: stringSimilarity.compareTwoStrings(
        normalizado,
        p.NombreNormalizado || normalizarTexto(p.Estudio)
      )
    }));
    
    // Ordenar por score descendente
    matches.sort((a, b) => b.score - a.score);
    
    const mejor = matches[0];
    
    console.log(`  → Mejor fuzzy match: ${mejor.Estudio} (score: ${mejor.score.toFixed(3)})`);
    
    // Reglas de negocio
    if (mejor.score > 0.90) {
      console.log(`  ✓ MATCH AUTOMÁTICO (score > 0.90)`);
      return {
        parametro: mejor,
        tipoMatch: 'FUZZY_AUTO',
        score: mejor.score,
        esNuevo: false
      };
    } else if (mejor.score >= 0.75) {
      console.log(`  ⚠ MATCH PROBABLE (0.75 ≤ score ≤ 0.90) - requiere revisión`);
      return {
        parametro: mejor,
        tipoMatch: 'FUZZY_PROBABLE',
        score: mejor.score,
        esNuevo: false,
        requiereRevision: true
      };
    }
  }
  
  // ===== 4. NO MATCH - PARÁMETRO NUEVO =====
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
  const {
    idExamen,
    textoOriginal,
    textoNormalizado,
    parametroMatch,
    score,
    tipoMatch,
    numeroVisita,
    tipoEstudio
  } = datos;
  
  const consulta = `
    INSERT INTO imOCRLog 
    (IdExamenLaboratorio, TextoOriginal, TextoNormalizado, ParametroMatch, 
     Score, TipoMatch, NumeroVisita, TipoEstudio)
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)
  `;
  
  await executeQuery(consulta, [
    { value: idExamen },
    { value: textoOriginal?.substring(0, 500) || '' },
    { value: textoNormalizado?.substring(0, 500) || '' },
    { value: parametroMatch },
    { value: score },
    { value: tipoMatch },
    { value: numeroVisita },
    { value: tipoEstudio }
  ]);
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
  validarRango,
  registrarLogOCR,
  crearParametroEnCatalogo,
  crearAlias
};
