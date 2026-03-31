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

  // Extraer nombre del paciente - formato: "TOLEDO, KEVIN MATIAS - D.N.I.:"
  const nombreMatch = texto.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,]+)\s*-\s*D\.N\.I\./im);
  if (nombreMatch) {
    info.paciente = nombreMatch[1].trim();
  }

  // Extraer DNI - formato: "D.N.I.: 40508927"
  const dniMatch = texto.match(/D\.N\.I\.:\s*(\d+)/i);
  if (dniMatch) {
    info.dni = dniMatch[1];
  }

  // Extraer fecha - formato: "/ 27-03-2026" o "/ 31-03-2026"
  const fechaMatch = texto.match(/\/\s*(\d{2}-\d{2}-\d{4})/);
  if (fechaMatch) {
    info.fecha = fechaMatch[1];
  }

  // Extraer protocolo - formato: "Protocolo 331832" o "Protocolo 061330"
  const protocoloMatch = texto.match(/Protocolo\s+(\d+)/i);
  if (protocoloMatch) {
    info.protocolo = protocoloMatch[1];
  }

  // Extraer laboratorio - formato: "CLINICA - Quimica Clinica"
  const laboratorioMatch = texto.match(/Protocolo\s+\d+\s+([A-ZÁÉÍÓÚÑ\s]+)\s*-/i);
  if (laboratorioMatch) {
    info.laboratorio = laboratorioMatch[1].trim();
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

  console.log('\n=== EXTRAYENDO PARÁMETROS (BÚSQUEDA GLOBAL) ===');

  // Usar el texto CRUDO del PDF (con saltos de línea originales)
  // Primero normalizar saltos de línea pero NO colapsar espacios
  const texto = textoOriginal
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Mostrar TODAS las líneas para debug
  const lineas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  console.log('Líneas no vacías:');
  lineas.forEach((l, idx) => console.log(`  [${idx}] "${l}"`));

  // ESTRATEGIA PRINCIPAL: Recorrer línea por línea
  // Si una línea es SOLO un nombre (letras, números, guiones), 
  // buscar el valor en la SIGUIENTE línea no vacía
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaLower = linea.toLowerCase();

    // Saltar líneas de metadata/encabezado
    if (lineaLower.includes('protocolo') ||
        lineaLower.includes('d.n.i') ||
        lineaLower.includes('resultado') ||
        lineaLower.includes('practica') ||
        lineaLower.includes('dosaje') ||
        lineaLower.includes('metodo:') ||
        lineaLower.includes('marca de reactivo') ||
        lineaLower.includes('hombre:') ||
        lineaLower.includes('mujer:') ||
        lineaLower.includes('pagina ') ||
        lineaLower.includes('necochea') ||
        lineaLower.includes('tel:') ||
        lineaLower.includes('h.c:')) {
      continue;
    }

    // ¿Es un nombre de parámetro? (solo texto, sin números sueltos al inicio)
    // Acepta: "pH", "pCO2", "HCO3-", "EB", "SatO2", "GLUCEMIA", "ESTADO ACIDO BASE"
    const esNombre = /^[A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\s\-\+\.]*$/.test(linea) && linea.length <= 40;

    if (esNombre) {
      // Buscar la siguiente línea que empiece con un número
      if (i + 1 < lineas.length) {
        const sigLinea = lineas[i + 1];
        const matchVal = sigLinea.match(/^(-?[\d]+[\.,]?[\d]*)\s*(.*)/);
        
        if (matchVal) {
          const nombre = linea;
          const valor = matchVal[1];
          const resto = matchVal[2].trim();

          // Extraer unidad del resto
          let unidad = '';
          let valorRef = '';
          const matchUnidad = resto.match(/^(mg\/dl|g\/dl|meq\/l|mmol\/l|U\/[lL]|mmHg|%|\/mm3|mEq\/L|ml\/min|seg|segundos)/i);
          if (matchUnidad) {
            unidad = matchUnidad[1];
            valorRef = resto.substring(matchUnidad[0].length).trim();
          } else {
            // Sin unidad conocida, todo el resto es referencia
            valorRef = resto;
          }

          // Limpiar valor de referencia: quitar nombres de parámetros que se pegaron al final
          // Ej: "7.35 - 7.45 pCO2" -> ref="7.35 - 7.45", y pCO2 se procesará después
          // No hacer nada aquí, lo dejamos como está

          const key = nombre.toUpperCase();
          if (!parametrosEncontrados.has(key) && 
              !lineaLower.includes('estado acido') &&
              !lineaLower.includes('quimica') &&
              !lineaLower.includes('hematologia') &&
              !lineaLower.includes('ionograma') &&
              !lineaLower.includes('hepatograma') &&
              !lineaLower.includes('hemograma') &&
              !lineaLower.includes('coagulograma')) {
            parametrosEncontrados.add(key);

            // Limpiar valorRef de nombres de params pegados
            valorRef = valorRef.replace(/\s+[A-Za-z][A-Za-z0-9\-\+]*\s*$/g, '').trim();

            parametros.push({
              nombreParametro: nombre,
              resultado: valor.replace(',', '.'),
              unidadMedida: unidad,
              valorReferencia: valorRef,
              metodo: null,
              marcaReactivo: null
            });

            console.log(`✓ ${nombre} = ${valor} ${unidad} (ref: ${valorRef})`);
            i++; // Saltar línea del valor
          }
          continue;
        }
      }
      // Si es un título de sección (ESTADO ACIDO BASE, QUIMICA CLINICA), simplemente seguir
      continue;
    }

    // ESTRATEGIA 2: Línea con "Observaciones: CLORO" u otros datos pegados
    // Buscar si hay un nombre de parámetro después de "Observaciones:"
    const matchObs = linea.match(/Observaciones:\s*([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\-\+]{1,20})\s*$/i);
    if (matchObs && i + 1 < lineas.length) {
      // El nombre del parámetro está pegado después de "Observaciones:"
      const nombrePegado = matchObs[1].trim();
      const sigLinea = lineas[i + 1];
      const matchVal = sigLinea.match(/^(-?[\d]+[\.,]?[\d]*)\s*(.*)/);
      
      if (matchVal) {
        const valor = matchVal[1];
        const resto = matchVal[2].trim();
        let unidad = '';
        let valorRef = '';
        const matchUnidad = resto.match(/^(mg\/dl|g\/dl|meq\/l|mmol\/l|U\/[lL]|mmHg|%|\/mm3|mEq\/L|ml\/min|seg|segundos)/i);
        if (matchUnidad) {
          unidad = matchUnidad[1];
          valorRef = resto.substring(matchUnidad[0].length).trim();
        } else {
          valorRef = resto;
        }

        const key = nombrePegado.toUpperCase();
        if (!parametrosEncontrados.has(key)) {
          parametrosEncontrados.add(key);
          valorRef = valorRef.replace(/\s+[A-Za-z][A-Za-z0-9\-\+]*\s*$/g, '').trim();
          
          parametros.push({
            nombreParametro: nombrePegado,
            resultado: valor.replace(',', '.'),
            unidadMedida: unidad,
            valorReferencia: valorRef,
            metodo: null,
            marcaReactivo: null
          });

          console.log(`✓ ${nombrePegado} = ${valor} ${unidad} (ref: ${valorRef}) [rescatado de Observaciones]`);
          i++;
        }
        continue;
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
