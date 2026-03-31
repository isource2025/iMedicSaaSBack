const pdf = require('pdf-parse');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

/**
 * Servicio para procesamiento OCR de documentos de laboratorio
 */

/**
 * Extrae texto de un PDF
 * @param {Buffer} buffer - Buffer del archivo PDF
 * @returns {Promise<string>} Texto extraído
 */
const extraerTextoDePDF = async (buffer) => {
  try {
    const data = await pdf(buffer);
    console.log('\n=== PDF EXTRAÍDO ===');
    console.log('Número de páginas:', data.numpages);
    console.log('Longitud del texto:', data.text.length);
    console.log('Primeros 500 caracteres:', data.text.substring(0, 500));
    console.log('==================\n');
    return data.text;
  } catch (error) {
    console.error('Error al extraer texto del PDF:', error);
    throw new Error('Error al procesar el PDF');
  }
};

/**
 * Extrae texto de una imagen usando Tesseract OCR
 * @param {Buffer} buffer - Buffer de la imagen
 * @returns {Promise<string>} Texto extraído
 */
const extraerTextoDeImagen = async (buffer) => {
  try {
    // Preprocesar imagen con sharp para mejorar OCR
    const processedImage = await sharp(buffer)
      .greyscale()
      .normalize()
      .sharpen()
      .toBuffer();

    const { data: { text } } = await Tesseract.recognize(
      processedImage,
      'spa', // Idioma español
      {
        logger: m => console.log(m)
      }
    );

    return text;
  } catch (error) {
    console.error('Error al extraer texto de la imagen:', error);
    throw new Error('Error al procesar la imagen');
  }
};

/**
 * Limpia y normaliza el texto extraído por OCR
 * @param {string} texto - Texto crudo del OCR
 * @returns {string} Texto limpio
 */
const limpiarTextoOCR = (texto) => {
  if (!texto) return '';
  
  return texto
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
};

/**
 * Detecta el tipo de estudio de laboratorio basado en el texto
 * @param {string} texto - Texto del documento
 * @returns {string} Tipo de estudio detectado
 */
const detectarTipoEstudio = (texto) => {
  const textoLower = texto.toLowerCase();
  
  // Patrones para cada tipo de estudio
  const patrones = {
    'HEMOGRAMA': ['hemograma', 'globulos blancos', 'globulos rojos', 'hematocrito', 'hemoglobina', 'formula leucocitaria'],
    'QUIMICA_CLINICA': ['glucemia', 'uremia', 'creatininemia', 'uricemia', 'quimica clinica'],
    'HEPATOGRAMA': ['hepatograma', 'got', 'gpt', 'ast', 'alt', 'fosfatasa alcalina', 'bilirrubina'],
    'GASOMETRIA': ['gasometria', 'estado acido base', 'ph', 'pco2', 'po2', 'hco3'],
    'IONOGRAMA': ['ionograma', 'ionograma plasmatico', 'sodio', 'potasio', 'cloro'],
    'COAGULOGRAMA': ['coagulograma', 'tiempo de protrombina', 'kptt', 'inr'],
    'PERFIL_LIPIDICO': ['perfil lipidico', 'colesterol', 'trigliceridos', 'hdl', 'ldl']
  };

  // Contar coincidencias para cada tipo
  let maxCoincidencias = 0;
  let tipoDetectado = 'GENERAL';

  for (const [tipo, keywords] of Object.entries(patrones)) {
    const coincidencias = keywords.filter(keyword => textoLower.includes(keyword)).length;
    if (coincidencias > maxCoincidencias) {
      maxCoincidencias = coincidencias;
      tipoDetectado = tipo;
    }
  }

  return tipoDetectado;
};

/**
 * Extrae información de la cabecera del documento
 * @param {string} texto - Texto del documento
 * @returns {Object} Información de cabecera
 */
const extraerInfoCabecera = (texto) => {
  const info = {
    paciente: null,
    dni: null,
    fecha: null,
    protocolo: null,
    laboratorio: null
  };

  // === PACIENTE ===
  // Formato 1: "TOLEDO, KEVIN - D.N.I.:"
  const nombreMatch1 = texto.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,]+)\s*-\s*D\.N\.I\./im);
  if (nombreMatch1) {
    info.paciente = nombreMatch1[1].trim();
  }
  // Formato 2: "Apellido y Nombre: TOLEDO, KEVIN"
  if (!info.paciente) {
    const nombreMatch2 = texto.match(/Apellido y Nombre:\s*(.+)/i);
    if (nombreMatch2) info.paciente = nombreMatch2[1].trim();
  }

  // === DNI ===
  // Formato 1: "D.N.I.: 40508927"
  const dniMatch1 = texto.match(/D\.N\.I\.:\s*([\d\.]+)/i);
  if (dniMatch1) {
    info.dni = dniMatch1[1].replace(/\./g, '');
  }
  // Formato 2: "DNI: 40.508.927"
  if (!info.dni) {
    const dniMatch2 = texto.match(/DNI:\s*([\d\.]+)/i);
    if (dniMatch2) info.dni = dniMatch2[1].replace(/\./g, '');
  }

  // === FECHA ===
  // Formato 1: "/ 31-03-2026"
  const fechaMatch1 = texto.match(/\/\s*(\d{2}-\d{2}-\d{4})/);
  if (fechaMatch1) {
    info.fecha = fechaMatch1[1];
  }
  // Formato 2: "Fecha: 30/03/2026"
  if (!info.fecha) {
    const fechaMatch2 = texto.match(/Fecha:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (fechaMatch2) info.fecha = fechaMatch2[1];
  }

  // === PROTOCOLO ===
  const protocoloMatch = texto.match(/Protocolo\s+(\d+)/i);
  if (protocoloMatch) {
    info.protocolo = protocoloMatch[1];
  }

  // === LABORATORIO ===
  // Formato 1: "Protocolo 061330 CLINICA - ..."
  const laboratorioMatch1 = texto.match(/Protocolo\s+\d+\s+([A-ZÁÉÍÓÚÑ\s]+)\s*-/i);
  if (laboratorioMatch1) {
    info.laboratorio = laboratorioMatch1[1].trim();
  }
  // Formato 2: "LABORATORIO del SERVICIO DE HEMATOLOGIA"
  if (!info.laboratorio) {
    const laboratorioMatch2 = texto.match(/LABORATORIO\s+del\s+SERVICIO\s+DE\s+(\w+)/i);
    if (laboratorioMatch2) info.laboratorio = laboratorioMatch2[1].trim();
  }

  return info;
};

/**
 * Extrae parámetros y valores de un estudio
 * @param {string} texto - Texto del documento
 * @param {string} tipoEstudio - Tipo de estudio detectado
 * @returns {Array} Array de parámetros extraídos
 */
const extraerParametros = (textoOriginal, tipoEstudio) => {
  const parametros = [];
  const parametrosEncontrados = new Set();

  console.log('\n=== EXTRAYENDO PARÁMETROS (ULTRA-FLEXIBLE) ===');

  const texto = textoOriginal.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  console.log('Líneas no vacías:');
  lineas.forEach((l, idx) => console.log(`  [${idx}] "${l}"`));

  // Títulos de sección a ignorar (no son parámetros)
  const titulosSecciones = [
    'hemograma', 'quimica clinica', 'hematologia', 'ionograma', 'hepatograma',
    'coagulograma', 'gasometria', 'estado acido base', 'formula leucocitaria',
    'perfil lipidico', 'recuento de plaquetas', 'serie roja', 'serie blanca',
    'valores de referencia'
  ];

  // Líneas de metadata a ignorar
  const esMetadata = (l) => {
    const low = l.toLowerCase();
    return low.includes('protocolo') || low.includes('d.n.i') || low.includes('dni:') ||
      low.includes('apellido') || low.includes('nombre:') || low.includes('fecha:') ||
      low.includes('pagina ') || low.includes('necochea') || low.includes('tel:') ||
      low.includes('h.c:') || low.includes('hospital') || low.includes('laboratorio del') ||
      low.includes('corrientes') || low.includes('capital') || low.includes('firma') ||
      low.includes('bioquim') || low.includes('matricula') || /^cód/i.test(low) ||
      low.includes('practica') || low.includes('dosaje') ||
      low.includes('metodo:') || low.includes('marca de reactivo');
  };

  const esTituloSeccion = (l) => {
    const low = l.toLowerCase().replace(/\s+/g, ' ').trim();
    return titulosSecciones.some(t => low.includes(t));
  };

  // Unidades de laboratorio conocidas (con trim del espacio inicial)
  const UNIDADES_REGEX = /^\s*(mg\/dl|g\/dl|g%|meq\/l|mmol\/l|U\/[lL]|mmHg|%|\/mm3|mEq\/L|ml\/min|seg|segundos|fl|pg|p'g)/i;

  const agregarParametro = (nombre, valor, unidad, valorRef) => {
    const key = nombre.toUpperCase().replace(/[:\s]+$/g, '').trim();
    if (parametrosEncontrados.has(key)) return false;
    if (esTituloSeccion(nombre)) return false;
    
    // Limpiar nombre (quitar : al final)
    nombre = nombre.replace(/[:\s]+$/g, '').trim();
    if (!nombre || nombre.length < 1) return false;

    parametrosEncontrados.add(key);
    
    // Limpiar valorRef de nombres de params pegados al final
    if (valorRef) {
      valorRef = valorRef.replace(/\s+[A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\-\+]*\s*$/g, '').trim();
    }

    parametros.push({
      nombreParametro: nombre,
      resultado: valor.replace(',', '.'),
      unidadMedida: unidad || '',
      valorReferencia: valorRef || '',
      metodo: null,
      marcaReactivo: null
    });
    console.log(`✓ ${nombre} = ${valor} ${unidad || ''} (ref: ${valorRef || ''})`);
    return true;
  };

  // Función para extraer unidad y referencia de un texto restante
  const extraerUnidadYRef = (resto) => {
    let unidad = '';
    let valorRef = '';
    const trimmed = resto.trim();
    const matchU = trimmed.match(UNIDADES_REGEX);
    if (matchU) {
      unidad = matchU[1].trim();
      valorRef = trimmed.substring(matchU[0].length).trim();
    } else {
      valorRef = trimmed;
    }
    return { unidad, valorRef };
  };

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];

    // Saltar metadata y títulos
    if (esMetadata(linea)) continue;
    if (esTituloSeccion(linea)) continue;
    // Saltar líneas que son solo rangos de referencia (ej: "3.800-10.000/mm3", "42-50%")
    if (/^[\d\.\,\-\–]+\s*(\/mm3|%|g\/dl|fl|pg|p'g|g\/dl|meq\/l|mmol\/l)?$/i.test(linea)) continue;
    // Saltar líneas que son solo "0"
    if (/^0$/.test(linea)) continue;
    // Saltar líneas que son solo números sueltos sin contexto
    if (/^[\d\.\-\–]+$/.test(linea) && linea.length < 8) continue;
    // Saltar líneas de observaciones textuales sin parámetros
    if (/^Serie (Roja|Blanca):/i.test(linea)) continue;
    if (/^Se observan/i.test(linea)) continue;

    // ═══════════════════════════════════════════════
    // FORMATO A: "Nombre: VALOR UNIDAD" o "Nombre: VALOR UNIDAD  REFERENCIA"
    // Ej: "Glóbulos Blancos: 18.560 /mm3", "Hematocrito: 23.8 %", "Neutrófilos en Cayado: 2%"
    // ═══════════════════════════════════════════════
    // Regex: captura número con puntos de miles Y/O coma decimal: 18.560, 2.660.000, 23.8, 7,5
    const fmtA = linea.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\s\-\+\.'']*?)\s*:\s*(-?[\d]+(?:[\.\,]\d+)*)\s*(.*)/);
    if (fmtA) {
      const nombre = fmtA[1].trim();
      const valor = fmtA[2];
      const resto = fmtA[3].trim();
      const { unidad, valorRef } = extraerUnidadYRef(resto);
      
      if (agregarParametro(nombre, valor, unidad, valorRef)) {
        continue;
      }
    }

    // ═══════════════════════════════════════════════
    // FORMATO B: "Nombre VALOR UNIDAD" (sin dos puntos)
    // Ej: "Glóbulos Rojos 2.660.000 /mm3", "GLUCEMIA 118 mg/dl"
    // ═══════════════════════════════════════════════
    const matchSinDosPuntos = linea.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\s\-\+\.'']*?)\s+(-?[\d]+(?:[\.\,]\d+)*)\s*(.*)/);

    if (matchSinDosPuntos) {
      const nombre = matchSinDosPuntos[1].trim();
      const valor = matchSinDosPuntos[2];
      const resto = matchSinDosPuntos[3].trim();
      
      // Validar que el nombre no sea solo números o muy corto
      if (!/^\d+$/.test(nombre) && nombre.length >= 1) {
        const { unidad, valorRef } = extraerUnidadYRef(resto);
        if (agregarParametro(nombre, valor, unidad, valorRef)) {
          continue;
        }
      }
    }

    // ═══════════════════════════════════════════════
    // FORMATO C: Nombre solo en una línea, valor en la siguiente
    // Ej: "pH" seguido de "7.34  7.35 - 7.45"
    // ═══════════════════════════════════════════════
    const esNombreSolo = /^[A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\s\-\+\.'']*$/.test(linea) && linea.length <= 40;
    if (esNombreSolo && i + 1 < lineas.length) {
      const sigLinea = lineas[i + 1];
      const matchVal = sigLinea.match(/^(-?[\d]+[\.,]?[\d]*)\s*(.*)/);
      if (matchVal) {
        const nombre = linea;
        const valor = matchVal[1];
        const resto = matchVal[2].trim();
        const { unidad, valorRef } = extraerUnidadYRef(resto);
        if (agregarParametro(nombre, valor, unidad, valorRef)) {
          i++; // Saltar línea de valor
          continue;
        }
      }
    }

    // ═══════════════════════════════════════════════
    // FORMATO D: "Resultado:  210 .000 /mm3" (plaquetas y similares)
    // Limpiar espacios dentro del número primero
    // ═══════════════════════════════════════════════
    // Limpiar espacios entre números y puntos: "210 .000" -> "210.000", también múltiples
    let lineaLimpia = linea;
    while (/(\d)\s+\.(\d)/.test(lineaLimpia)) {
      lineaLimpia = lineaLimpia.replace(/(\d)\s+\.(\d)/g, '$1.$2');
    }
    const matchResultado = lineaLimpia.match(/^Resultado:\s*(-?[\d]+(?:[\.\,]\d+)*)\s*(.*)/i);
    if (matchResultado) {
      let nombreParam = 'Resultado';
      for (let j = i - 1; j >= 0; j--) {
        const prevLinea = lineas[j];
        if (/recuento de plaquetas/i.test(prevLinea)) {
          nombreParam = 'Recuento de Plaquetas';
          break;
        }
        if (/^[A-Za-z]/.test(prevLinea) && prevLinea.length > 3) {
          nombreParam = prevLinea.replace(/\s*Cód\..*$/i, '').trim();
          break;
        }
      }
      const valor = matchResultado[1];
      const resto = matchResultado[2].trim();
      const { unidad, valorRef } = extraerUnidadYRef(resto);
      agregarParametro(nombreParam, valor, unidad, valorRef);
      continue;
    }

    // ═══════════════════════════════════════════════
    // FORMATO E: Parámetro pegado después de "Observaciones:"
    // Ej: "Observaciones: CLORO" seguido de "98 meq/l"
    // ═══════════════════════════════════════════════
    const matchObs = linea.match(/Observaciones:\s*([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\-\+\s]{1,25})\s*$/i);
    if (matchObs && i + 1 < lineas.length) {
      const nombrePegado = matchObs[1].trim();
      const sigLinea = lineas[i + 1];
      const matchVal = sigLinea.match(/^(-?[\d]+[\.,]?[\d]*)\s*(.*)/);
      if (matchVal) {
        const valor = matchVal[1];
        const resto = matchVal[2].trim();
        const { unidad, valorRef } = extraerUnidadYRef(resto);
        if (agregarParametro(nombrePegado, valor, unidad, valorRef)) {
          i++;
          continue;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════
  // POST-PROCESAMIENTO: Mapear valores de referencia huérfanos
  // PDFs con columnas separadas extraen referencias como líneas sueltas
  // Ej: "3.800-10.000/mm3", "42-50%", "55-65" -> asignar en orden
  // ═══════════════════════════════════════════════
  const lineasReferencia = [];
  for (const linea of lineas) {
    // Detectar líneas que son rangos de referencia: "3.800-10.000/mm3", "42-50%", "55-65", "0.5-4", "0"
    const esRango = /^[\d\.\,]+\s*[-–]\s*[\d\.\,]+/.test(linea); // "3.800-10.000", "42-50"
    const esCero = /^0$/.test(linea); // "0" solo
    if (esRango || esCero) {
      lineasReferencia.push(linea);
    }
  }

  if (lineasReferencia.length > 0) {
    console.log(`\n--- Asignando ${lineasReferencia.length} valores de referencia huérfanos ---`);
    let refIdx = 0;
    for (let p = 0; p < parametros.length && refIdx < lineasReferencia.length; p++) {
      if (!parametros[p].valorReferencia || parametros[p].valorReferencia.trim() === '') {
        parametros[p].valorReferencia = lineasReferencia[refIdx];
        console.log(`  → ${parametros[p].nombreParametro}: ref = "${lineasReferencia[refIdx]}"`);
        refIdx++;
      }
    }
  }

  console.log(`Total parámetros extraídos: ${parametros.length}`);
  console.log('===========================\n');

  return parametros;
};

/**
 * Procesa un documento completo (PDF o imagen) y extrae la información estructurada
 * @param {Buffer} buffer - Buffer del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @returns {Promise<Object>} Información estructurada del documento
 */
const procesarDocumento = async (buffer, mimeType) => {
  try {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   PROCESANDO DOCUMENTO DE LABORATORIO  ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('Tipo MIME:', mimeType);
    console.log('Tamaño buffer:', buffer.length, 'bytes');

    let textoExtraido = '';

    // Determinar tipo de archivo y extraer texto
    if (mimeType === 'application/pdf') {
      textoExtraido = await extraerTextoDePDF(buffer);
    } else if (mimeType.startsWith('image/')) {
      textoExtraido = await extraerTextoDeImagen(buffer);
    } else {
      throw new Error('Tipo de archivo no soportado');
    }

    // Limpiar texto
    const textoLimpio = limpiarTextoOCR(textoExtraido);
    console.log('Texto limpio - longitud:', textoLimpio.length);

    // Detectar tipo de estudio
    const tipoEstudio = detectarTipoEstudio(textoLimpio);
    console.log('Tipo de estudio detectado:', tipoEstudio);

    // Extraer información de cabecera
    const infoCabecera = extraerInfoCabecera(textoLimpio);
    console.log('Cabecera extraída:', JSON.stringify(infoCabecera, null, 2));

    // Extraer parámetros - usar texto ORIGINAL (no limpio) para preservar saltos de línea
    const parametros = extraerParametros(textoExtraido, tipoEstudio);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   PROCESAMIENTO COMPLETADO             ║');
    console.log('╚════════════════════════════════════════╝\n');

    return {
      success: true,
      tipoEstudio,
      cabecera: infoCabecera,
      parametros,
      textoCompleto: textoLimpio
    };
  } catch (error) {
    console.error('\n✗ Error al procesar documento:', error);
    console.error(error.stack);
    throw error;
  }
};

module.exports = {
  extraerTextoDePDF,
  extraerTextoDeImagen,
  limpiarTextoOCR,
  detectarTipoEstudio,
  extraerInfoCabecera,
  extraerParametros,
  procesarDocumento
};
