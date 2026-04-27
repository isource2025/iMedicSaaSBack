const { executeQuery } = require('../models/db');
const ocrService = require('./ocr.service');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');

/** Texto VARCHAR legacy (ANSI / Windows-1252). */
function labStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return normalizarTextoParaClarionAnsi(s);
}

/**
 * Servicio para gestión de exámenes de laboratorio
 */

/**
 * Procesa un archivo con OCR y retorna los datos estructurados
 * @param {Buffer} buffer - Buffer del archivo
 * @param {string} mimeType - Tipo MIME del archivo
 * @returns {Promise<Object>} Datos estructurados del examen
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
 * Obtiene la configuración de un parámetro por su código o nombre
 * @param {string} nombreParametro - Nombre del parámetro
 * @returns {Promise<Object|null>} Configuración del parámetro
 */
const obtenerConfiguracionParametro = async (nombreParametro) => {
  try {
    const consulta = `
      SELECT 
        IdTipoLaboratorio,
        Orden,
        Estudio,
        ValorMaximo,
        ValorMinimo,
        ValorNormal,
        AlertaCritica
      FROM imHCExamenesLabDetalleConf
      WHERE (
          UPPER(RTRIM(LTRIM(NombreParametro))) = UPPER(RTRIM(LTRIM(@p0)))
          OR UPPER(RTRIM(LTRIM(CodigoParametro))) = UPPER(RTRIM(LTRIM(@p0)))
          OR Sinonimos LIKE '%' + @p0 + '%'
        )
    `;

    const resultado = await executeQuery(consulta, [{ value: nombreParametro }]);
    return resultado.length > 0 ? resultado[0] : null;
  } catch (error) {
    console.error('Error al obtener configuración de parámetro:', error);
    return null;
  }
};

/**
 * Valida si un valor está dentro del rango de referencia
 * @param {number} valor - Valor a validar
 * @param {Object} config - Configuración del parámetro
 * @param {string} sexo - Sexo del paciente (M/F)
 * @param {number} edad - Edad del paciente
 * @returns {Object} Resultado de la validación
 */
const validarRango = (valor, config, sexo = null, edad = null) => {
  if (!config || !valor) {
    return { fueraDeRango: false, nivel: 'NORMAL' };
  }

  let valorMinimo = config.ValorMinimoAdulto;
  let valorMaximo = config.ValorMaximoAdulto;

  // Ajustar rangos según edad y sexo
  if (edad !== null && edad < 18 && config.ValorMinimoNino !== null) {
    valorMinimo = config.ValorMinimoNino;
    valorMaximo = config.ValorMaximoNino;
  } else if (sexo === 'M' && config.ValorMinimoHombre !== null) {
    valorMinimo = config.ValorMinimoHombre;
    valorMaximo = config.ValorMaximoHombre;
  } else if (sexo === 'F' && config.ValorMinimoMujer !== null) {
    valorMinimo = config.ValorMinimoMujer;
    valorMaximo = config.ValorMaximoMujer;
  }

  const valorNumerico = parseFloat(valor);
  
  if (isNaN(valorNumerico) || valorMinimo === null || valorMaximo === null) {
    return { fueraDeRango: false, nivel: 'NORMAL', valorMinimo, valorMaximo };
  }

  const fueraDeRango = valorNumerico < valorMinimo || valorNumerico > valorMaximo;
  
  let nivel = 'NORMAL';
  if (fueraDeRango) {
    // Calcular qué tan fuera de rango está
    const porcentajeBajo = valorMinimo > 0 ? (valorNumerico / valorMinimo) : 1;
    const porcentajeAlto = valorMaximo > 0 ? (valorNumerico / valorMaximo) : 1;
    
    if (porcentajeBajo < 0.7 || porcentajeAlto > 1.3) {
      nivel = config.AlertaCritica ? 'CRITICO' : 'ALTO';
    } else {
      nivel = 'FUERA_RANGO';
    }
  }

  return { fueraDeRango, nivel, valorMinimo, valorMaximo };
};

/**
 * Guarda un examen de laboratorio completo (cabecera + detalles)
 * @param {Object} cabecera - Datos de la cabecera
 * @param {Array} detalles - Array de detalles del examen
 * @param {Object} pacienteInfo - Información del paciente (sexo, edad)
 * @returns {Promise<Object>} Examen guardado con su ID
 */
const guardarExamen = async (cabecera, detalles, pacienteInfo = {}) => {
  try {
    // Insertar cabecera
    const consultaCabecera = `
      INSERT INTO imHCExamenesLabCabecera (
        NumeroVisita,
        FechaExamen,
        HoraExamen,
        TipoEstudio,
        Laboratorio,
        Protocolo,
        Observaciones,
        ArchivoAdjunto,
        FechaCarga,
        UsuarioCarga,
        Estado
      )
      OUTPUT INSERTED.IdExamen
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, GETDATE(), @p8, @p9)
    `;

    const paramsCabecera = [
      { value: cabecera.numeroVisita },
      { value: cabecera.fechaExamen },
      { value: cabecera.horaExamen || '00:00' },
      { value: labStr(cabecera.tipoEstudio) || '' },
      { value: labStr(cabecera.laboratorio) },
      { value: labStr(cabecera.protocolo) },
      { value: labStr(cabecera.observaciones) },
      { value: labStr(cabecera.archivoAdjunto) },
      { value: labStr(cabecera.usuarioCarga || 'SISTEMA') || 'SISTEMA' },
      { value: labStr(cabecera.estado || 'PENDIENTE') || 'PENDIENTE' }
    ];

    const resultadoCabecera = await executeQuery(consultaCabecera, paramsCabecera);
    const idExamen = resultadoCabecera[0].IdExamen;

    // Insertar detalles
    for (let i = 0; i < detalles.length; i++) {
      const detalle = detalles[i];
      
      // Obtener configuración del parámetro
      const config = await obtenerConfiguracionParametro(detalle.nombreParametro);
      
      // Validar rango
      const validacion = validarRango(
        detalle.resultado,
        config,
        pacienteInfo.sexo,
        pacienteInfo.edad
      );

      const consultaDetalle = `
        INSERT INTO imHCExamenesLabDetalle (
          IdExamen,
          CodigoParametro,
          NombreParametro,
          Resultado,
          UnidadMedida,
          ValorReferencia,
          ValorMinimo,
          ValorMaximo,
          FueraDeRango,
          Metodo,
          MarcaReactivo,
          Orden
        )
        VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11)
      `;

      const paramsDetalle = [
        { value: idExamen },
        { value: config ? config.CodigoParametro : null },
        { value: labStr(detalle.nombreParametro) || '' },
        { value: detalle.resultado == null || detalle.resultado === '' ? null : labStr(String(detalle.resultado)) },
        { value: labStr(detalle.unidadMedida) || labStr(config ? config.UnidadMedida : null) },
        { value: labStr(detalle.valorReferencia) },
        { value: validacion.valorMinimo },
        { value: validacion.valorMaximo },
        { value: validacion.fueraDeRango ? 1 : 0 },
        { value: labStr(detalle.metodo) },
        { value: labStr(detalle.marcaReactivo) },
        { value: i + 1 }
      ];

      await executeQuery(consultaDetalle, paramsDetalle);
    }

    // Retornar el examen completo
    return await obtenerExamenPorId(idExamen);
  } catch (error) {
    console.error('Error al guardar examen:', error);
    throw error;
  }
};

/**
 * Obtiene todos los exámenes de una visita
 * @param {number} numeroVisita - Número de visita
 * @returns {Promise<Array>} Array de exámenes
 */
const obtenerExamenesPorVisita = async (numeroVisita) => {
  try {
    const consulta = `
      SELECT 
        IdExamen,
        NumeroVisita,
        FechaExamen,
        HoraExamen,
        TipoEstudio,
        Laboratorio,
        Protocolo,
        Observaciones,
        ArchivoAdjunto,
        FechaCarga,
        UsuarioCarga,
        Estado
      FROM imHCExamenesLabCabecera
      WHERE NumeroVisita = @p0
      ORDER BY FechaExamen DESC, HoraExamen DESC
    `;

    const examenes = await executeQuery(consulta, [{ value: numeroVisita }]);
    
    // Para cada examen, obtener sus detalles
    for (let examen of examenes) {
      const detalles = await obtenerDetallesPorExamen(examen.IdExamen);
      examen.detalles = detalles;
      
      // Contar valores fuera de rango
      examen.totalParametros = detalles.length;
      examen.parametrosFueraDeRango = detalles.filter(d => d.FueraDeRango).length;
    }

    return examenes;
  } catch (error) {
    console.error('Error al obtener exámenes por visita:', error);
    throw error;
  }
};

/**
 * Obtiene un examen por su ID
 * @param {number} idExamen - ID del examen
 * @returns {Promise<Object>} Examen completo
 */
const obtenerExamenPorId = async (idExamen) => {
  try {
    const consulta = `
      SELECT 
        IdExamen,
        NumeroVisita,
        FechaExamen,
        HoraExamen,
        TipoEstudio,
        Laboratorio,
        Protocolo,
        Observaciones,
        ArchivoAdjunto,
        FechaCarga,
        UsuarioCarga,
        Estado
      FROM imHCExamenesLabCabecera
      WHERE IdExamen = @p0
    `;

    const resultado = await executeQuery(consulta, [{ value: idExamen }]);
    
    if (resultado.length === 0) {
      return null;
    }

    const examen = resultado[0];
    examen.detalles = await obtenerDetallesPorExamen(idExamen);
    
    return examen;
  } catch (error) {
    console.error('Error al obtener examen por ID:', error);
    throw error;
  }
};

/**
 * Obtiene los detalles de un examen
 * @param {number} idExamen - ID del examen
 * @returns {Promise<Array>} Array de detalles
 */
const obtenerDetallesPorExamen = async (idExamen) => {
  try {
    const consulta = `
      SELECT 
        IdDetalle,
        IdExamen,
        CodigoParametro,
        NombreParametro,
        Resultado,
        UnidadMedida,
        ValorReferencia,
        ValorMinimo,
        ValorMaximo,
        FueraDeRango,
        Metodo,
        MarcaReactivo,
        Orden
      FROM imHCExamenesLabDetalle
      WHERE IdExamen = @p0
      ORDER BY Orden
    `;

    return await executeQuery(consulta, [{ value: idExamen }]);
  } catch (error) {
    console.error('Error al obtener detalles del examen:', error);
    throw error;
  }
};

/**
 * Actualiza un examen existente
 * @param {number} idExamen - ID del examen
 * @param {Object} datos - Datos a actualizar
 * @returns {Promise<Object>} Examen actualizado
 */
const actualizarExamen = async (idExamen, datos) => {
  try {
    const consulta = `
      UPDATE imHCExamenesLabCabecera
      SET 
        FechaExamen = @p0,
        HoraExamen = @p1,
        TipoEstudio = @p2,
        Laboratorio = @p3,
        Protocolo = @p4,
        Observaciones = @p5,
        Estado = @p6
      WHERE IdExamen = @p7
    `;

    const params = [
      { value: datos.fechaExamen },
      { value: datos.horaExamen },
      { value: labStr(datos.tipoEstudio) || '' },
      { value: labStr(datos.laboratorio) },
      { value: labStr(datos.protocolo) },
      { value: labStr(datos.observaciones) },
      { value: datos.estado == null ? null : labStr(datos.estado) },
      { value: idExamen }
    ];

    await executeQuery(consulta, params);
    
    return await obtenerExamenPorId(idExamen);
  } catch (error) {
    console.error('Error al actualizar examen:', error);
    throw error;
  }
};

/**
 * Elimina un examen y sus detalles
 * @param {number} idExamen - ID del examen
 * @returns {Promise<void>}
 */
const eliminarExamen = async (idExamen) => {
  try {
    // Eliminar detalles primero
    await executeQuery('DELETE FROM imHCExamenesLabDetalle WHERE IdExamen = @p0', [{ value: idExamen }]);
    
    // Eliminar cabecera
    await executeQuery('DELETE FROM imHCExamenesLabCabecera WHERE IdExamen = @p0', [{ value: idExamen }]);
  } catch (error) {
    console.error('Error al eliminar examen:', error);
    throw error;
  }
};

/**
 * Obtiene todos los parámetros configurados
 * @returns {Promise<Array>} Array de parámetros
 */
const obtenerParametrosConfiguracion = async () => {
  try {
    const consulta = `
      SELECT 
        IdParametro,
        CodigoParametro,
        NombreParametro,
        Categoria,
        UnidadMedida,
        ValorMinimoAdulto,
        ValorMaximoAdulto,
        ValorMinimoNino,
        ValorMaximoNino,
        ValorMinimoHombre,
        ValorMaximoHombre,
        ValorMinimoMujer,
        ValorMaximoMujer,
        Activo,
        Sinonimos,
        AlertaCritica
      FROM imHCExamenesLabDetalleConf
      ORDER BY Categoria, NombreParametro
    `;

    return await executeQuery(consulta);
  } catch (error) {
    console.error('Error al obtener parámetros de configuración:', error);
    throw error;
  }
};

/**
 * Actualiza la configuración de un parámetro
 * @param {number} idParametro - ID del parámetro
 * @param {Object} datos - Datos a actualizar
 * @returns {Promise<Object>} Parámetro actualizado
 */
const actualizarParametroConfiguracion = async (idParametro, datos) => {
  try {
    const consulta = `
      UPDATE imHCExamenesLabDetalleConf
      SET 
        Estudio LIKE @param0
        ValorMinimoAdulto = @p3,
        ValorMaximoAdulto = @p4,
        ValorMinimoNino = @p5,
        ValorMaximoNino = @p6,
        ValorMinimoHombre = @p7,
        ValorMaximoHombre = @p8,
        ValorMinimoMujer = @p9,
        ValorMaximoMujer = @p10,
        Activo = @p11,
        Sinonimos = @p12,
        AlertaCritica = @p13
      WHERE IdParametro = @p14
    `;

    const params = [
      { value: datos.nombreParametro },
      { value: datos.categoria },
      { value: datos.unidadMedida },
      { value: datos.valorMinimoAdulto },
      { value: datos.valorMaximoAdulto },
      { value: datos.valorMinimoNino },
      { value: datos.valorMaximoNino },
      { value: datos.valorMinimoHombre },
      { value: datos.valorMaximoHombre },
      { value: datos.valorMinimoMujer },
      { value: datos.valorMaximoMujer },
      { value: datos.activo ? 1 : 0 },
      { value: datos.sinonimos },
      { value: datos.alertaCritica ? 1 : 0 },
      { value: idParametro }
    ];

    await executeQuery(consulta, params);
    
    // Retornar el parámetro actualizado
    const resultado = await executeQuery(
      'SELECT * FROM imHCExamenesLabDetalleConf WHERE IdParametro = @p0',
      [{ value: idParametro }]
    );
    
    return resultado[0];
  } catch (error) {
    console.error('Error al actualizar parámetro de configuración:', error);
    throw error;
  }
};

module.exports = {
  procesarArchivoConOCR,
  obtenerConfiguracionParametro,
  validarRango,
  guardarExamen,
  obtenerExamenesPorVisita,
  obtenerExamenPorId,
  obtenerDetallesPorExamen,
  actualizarExamen,
  eliminarExamen,
  obtenerParametrosConfiguracion,
  actualizarParametroConfiguracion
};
