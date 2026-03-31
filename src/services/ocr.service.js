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
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
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
const extraerParametros = (texto, tipoEstudio) => {
  const parametros = [];
  const lineas = texto.split('\n');

  console.log('\n=== EXTRAYENDO PARÁMETROS ===');
  console.log('Total de líneas:', lineas.length);

  // Palabras clave a excluir
  const excluir = [
    'protocolo', 'fecha', 'paciente', 'apellido', 'nombre', 'dni', 'edad',
    'sexo', 'medico', 'servicio', 'clinica', 'laboratorio', 'dosaje',
    'resultado', 'valores', 'referencia', 'observaciones', 'firma', 
    'profesional', 'matricula', 'bioquimico', 'pagina', 'page', 'hoja', 
    'codigo', 'practica', 'tel:', 'necochea'
  ];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    
    // Saltar líneas vacías o muy cortas
    if (!linea || linea.length < 2) continue;

    const lineaLower = linea.toLowerCase();
    
    // Saltar líneas que contengan palabras a excluir
    if (excluir.some(palabra => lineaLower.includes(palabra))) {
      continue;
    }

    // FORMATO 1: Nombre del parámetro en una línea (solo letras mayúsculas/minúsculas)
    // Ejemplo: "GLUCEMIA" o "pH" o "pCO2" o "HCO3-"
    const esNombreParametro = /^[A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\-\+]{1,30}$/.test(linea);
    
    if (esNombreParametro && i + 1 < lineas.length) {
      const siguienteLinea = lineas[i + 1].trim();
      
      // Buscar valor en la siguiente línea: "118 mg/dl 70 - 100 mg/dl"
      const patronValor = /^([\d]+[\.,]?[\d]*)\s*(mg\/dl|g\/dl|meq\/l|mmol\/l|U\/l|mmHg|%|\/mm3|mEq\/L)?/i;
      const matchValor = siguienteLinea.match(patronValor);
      
      if (matchValor) {
        const nombreParam = linea;
        const valor = matchValor[1];
        const unidad = matchValor[2] || '';
        
        // Buscar valores de referencia en el resto de la línea
        let valorReferencia = '';
        const restoLinea = siguienteLinea.substring(matchValor[0].length).trim();
        const rangoMatch = restoLinea.match(/([\d]+[\.,]?[\d]*\s*-\s*[\d]+[\.,]?[\d]*)/);
        if (rangoMatch) {
          valorReferencia = rangoMatch[1].trim();
        } else if (restoLinea.length > 0 && restoLinea.length < 50) {
          // Si no hay rango numérico, tomar el texto como referencia
          valorReferencia = restoLinea;
        }

        const parametro = {
          nombreParametro: nombreParam,
          resultado: valor.replace(',', '.'),
          unidadMedida: unidad.trim(),
          valorReferencia: valorReferencia,
          metodo: null,
          marcaReactivo: null
        };

        console.log(`✓ Parámetro encontrado: ${nombreParam} = ${valor} ${unidad} (ref: ${valorReferencia})`);
        parametros.push(parametro);
        
        // Saltar la siguiente línea ya que la procesamos
        i++;
        continue;
      }
    }

    // FORMATO 2: Nombre y valor en la misma línea
    // Ejemplo: "GLUCEMIA 118 mg/dl"
    const patronLinea = /^([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-z0-9ÁÉÍÓÚáéíóúñÑ\-\+\s]{2,40}?)\s+([\d]+[\.,]?[\d]*)\s*(mg\/dl|g\/dl|meq\/l|mmol\/l|U\/l|mmHg|%|\/mm3|mEq\/L)?/i;
    const matchLinea = linea.match(patronLinea);
    
    if (matchLinea) {
      const nombreParam = matchLinea[1].trim();
      const valor = matchLinea[2];
      const unidad = matchLinea[3] || '';
      
      // Validar que no sea solo números
      if (/^\d+$/.test(nombreParam)) {
        continue;
      }

      // Buscar valores de referencia
      let valorReferencia = '';
      const restoLinea = linea.substring(matchLinea.index + matchLinea[0].length).trim();
      const rangoMatch = restoLinea.match(/([\d]+[\.,]?[\d]*\s*-\s*[\d]+[\.,]?[\d]*)/);
      if (rangoMatch) {
        valorReferencia = rangoMatch[1].trim();
      }

      const parametro = {
        nombreParametro: nombreParam,
        resultado: valor.replace(',', '.'),
        unidadMedida: unidad.trim(),
        valorReferencia: valorReferencia,
        metodo: null,
        marcaReactivo: null
      };

      console.log(`✓ Parámetro encontrado: ${nombreParam} = ${valor} ${unidad} (ref: ${valorReferencia})`);
      parametros.push(parametro);
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

    // Extraer parámetros
    const parametros = extraerParametros(textoLimpio, tipoEstudio);

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
