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

  // Patrones para detectar líneas con resultados
  // Formato típico: "Parámetro    Resultado    Valores de referencia"
  const patronResultado = /^([A-Za-zÁÉÍÓÚáéíóúñÑ\s\(\)\-\/]+?)\s+([\d\.,]+)\s*([a-zA-Z\/\%]+)?\s+([\d\.,\s\-]+)?/;

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    
    // Saltar líneas vacías o de encabezado
    if (!linea || linea.includes('Dosaje') || linea.includes('Resultado') || linea.includes('Valores de referencia')) {
      continue;
    }

    const match = linea.match(patronResultado);
    if (match) {
      const parametro = {
        nombreParametro: match[1].trim(),
        resultado: match[2].replace(',', '.'),
        unidadMedida: match[3] ? match[3].trim() : '',
        valorReferencia: match[4] ? match[4].trim() : '',
        metodo: null,
        marcaReactivo: null
      };

      // Buscar método en las siguientes líneas
      if (i + 1 < lineas.length) {
        const siguienteLinea = lineas[i + 1].trim();
        if (siguienteLinea.includes('Metodo:') || siguienteLinea.includes('Método:')) {
          const metodoMatch = siguienteLinea.match(/(?:Metodo|Método):\s*(.+)/i);
          if (metodoMatch) {
            parametro.metodo = metodoMatch[1].trim();
          }
        }
        if (siguienteLinea.includes('Marca de Reactivo:')) {
          const marcaMatch = siguienteLinea.match(/Marca de Reactivo:\s*(.+)/i);
          if (marcaMatch) {
            parametro.marcaReactivo = marcaMatch[1].trim();
          }
        }
      }

      parametros.push(parametro);
    }
  }

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

    // Detectar tipo de estudio
    const tipoEstudio = detectarTipoEstudio(textoLimpio);

    // Extraer información de cabecera
    const infoCabecera = extraerInfoCabecera(textoLimpio);

    // Extraer parámetros
    const parametros = extraerParametros(textoLimpio, tipoEstudio);

    return {
      success: true,
      tipoEstudio,
      cabecera: infoCabecera,
      parametros,
      textoCompleto: textoLimpio
    };
  } catch (error) {
    console.error('Error al procesar documento:', error);
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
