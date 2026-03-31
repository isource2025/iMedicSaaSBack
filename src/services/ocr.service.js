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

  // Extraer nombre del paciente
  const nombreMatch = texto.match(/(?:Apellido y Nombre|Paciente|Nombre):\s*([A-ZÁÉÍÓÚÑ\s,]+)/i);
  if (nombreMatch) {
    info.paciente = nombreMatch[1].trim();
  }

  // Extraer DNI
  const dniMatch = texto.match(/(?:DNI|D\.N\.I\.|Documento):\s*(\d+[\.\d]*)/i);
  if (dniMatch) {
    info.dni = dniMatch[1].replace(/\./g, '');
  }

  // Extraer fecha
  const fechaMatch = texto.match(/(?:Fecha|Date):\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (fechaMatch) {
    info.fecha = fechaMatch[1];
  }

  // Extraer protocolo
  const protocoloMatch = texto.match(/(?:Protocolo|Protocol|Código|Cod\.):\s*(\d+)/i);
  if (protocoloMatch) {
    info.protocolo = protocoloMatch[1];
  }

  // Extraer laboratorio
  const laboratorioMatch = texto.match(/(?:LABORATORIO|LAB\.)(?:\s+del\s+)?(?:\s+SERVICIO\s+DE\s+)?([A-ZÁÉÍÓÚÑ\s]+)/i);
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

  // Patrones más flexibles para diferentes formatos de laboratorio
  // Formato 1: NOMBRE  VALOR  UNIDAD  RANGO
  // Formato 2: NOMBRE VALOR UNIDAD
  const patrones = [
    // Patrón principal: nombre en mayúsculas seguido de número
    /^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{2,40})\s+([\d]+[\.,]?[\d]*)\s*(mg\/dl|g\/dl|meq\/l|U\/l|mmHg|%|\/mm3|mEq\/L)?/i,
    // Patrón alternativo: nombre con minúsculas
    /^([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-zÁÉÍÓÚáéíóúñÑ\s]{2,40})\s+([\d]+[\.,]?[\d]*)\s*(mg\/dl|g\/dl|meq\/l|U\/l|mmHg|%|\/mm3|mEq\/L)?/i
  ];

  // Palabras clave a excluir
  const excluir = [
    'protocolo', 'fecha', 'paciente', 'apellido', 'nombre', 'dni', 'edad',
    'sexo', 'medico', 'servicio', 'clinica', 'laboratorio', 'dosaje',
    'resultado', 'valores', 'referencia', 'metodo', 'marca', 'reactivo',
    'observaciones', 'firma', 'profesional', 'matricula', 'bioquimico',
    'pagina', 'page', 'hoja', 'codigo'
  ];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    
    // Saltar líneas vacías o muy cortas
    if (!linea || linea.length < 5) continue;

    // Saltar líneas que contengan palabras a excluir
    const lineaLower = linea.toLowerCase();
    if (excluir.some(palabra => lineaLower.includes(palabra))) {
      continue;
    }

    // Intentar con cada patrón
    for (const patron of patrones) {
      const match = linea.match(patron);
      if (match) {
        const nombreParam = match[1].trim();
        const valor = match[2];
        const unidad = match[3] || '';
        
        // Validaciones adicionales
        if (nombreParam.length < 3 || /^\d+$/.test(nombreParam)) {
          continue;
        }

        // Buscar valores de referencia en la misma línea
        let valorReferencia = '';
        const restoLinea = linea.substring(match.index + match[0].length);
        const rangoMatch = restoLinea.match(/([\d]+[\.,]?[\d]*\s*-\s*[\d]+[\.,]?[\d]*)/);        if (rangoMatch) {
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

        console.log(`✓ Parámetro encontrado: ${nombreParam} = ${valor} ${unidad}`);
        parametros.push(parametro);
        break; // Salir del loop de patrones si encontramos match
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
