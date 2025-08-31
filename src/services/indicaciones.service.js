const { executeQuery } = require('../models/db');

/**
 * Obtener la última indicación por número de visita
 * @param {number} numeroVisita - Número de visita
 * @returns {Promise<Object>} Última indicación para la visita
 */
const obtenerUltimaIndicacionPorVisita = async (numeroVisita) => {
  const consulta = `
    SELECT TOP 1
      iim.NumeroVisita,
      iim.NroIndicacion,
      iim.NroAdicional,
      CASE
        WHEN FechaCarga IS NULL OR FechaCarga <= 0 OR FechaCarga > 2958465 THEN NULL
        ELSE TRY_CONVERT(DATETIME, DATEADD(DAY, FechaCarga - 2, '19000101'))
      END AS FechaCarga,
      CASE
        WHEN HoraCarga IS NULL OR HoraCarga < 0 OR HoraCarga > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraCarga / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraCarga,
      iim.OperadorCarga,
      pw.Apellido AS OperadorApellido,
      pw.Nombres AS OperadorNombres,
      iim.ProfesionalAsiste,
      iim.TipoIndicacion,
      iim.Codigo,
      iim.Cantidad,
      iim.TipoUnidad,
      iim.Frecuencia,
      iim.Observaciones,
      CASE
        WHEN FechaExpiro IS NULL OR FechaExpiro <= 0 OR FechaExpiro > 2958465 THEN NULL
        ELSE TRY_CONVERT(DATETIME, DATEADD(DAY, FechaExpiro - 2, '19000101'))
      END AS FechaExpiro,
      CASE
        WHEN HoraExpiro IS NULL OR HoraExpiro < 0 OR HoraExpiro > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraExpiro / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraExpiro,
      iim.CantidadIndicada,
      iim.Orden,
      iim.Estado,
      iim.CantidadPorTurno,
      iim.CantidadEntregada,
      iim.ParaFechaEntrega,
      iim.FormaAdicional,
      iim.NroIndicacionAnterior,
      iim.IdSector,
      iim.AliasMedicamento,
      iim.ExcluidoDeEntrega
    FROM dbo.imInterIndMedicas AS iim
    LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = iim.OperadorCarga
    WHERE iim.NumeroVisita = @param0
    ORDER BY iim.FechaCarga DESC, iim.HoraCarga DESC, iim.NroIndicacion DESC
  `;
  const parametros = [{ value: numeroVisita }];
  try {
    return await executeQuery(consulta, parametros);
  } catch (error) {
    console.error('Error al obtener última indicación por visita:', error);
    console.error('Parámetros:', JSON.stringify(parametros));
    throw error;
  }
};

/**
 * Obtener las últimas N indicaciones por número de visita
 * @param {number} numeroVisita
 * @param {number} limit
 * @returns {Promise<Array>} Lista de indicaciones ordenadas por más recientes
 */
const obtenerUltimasIndicacionesPorVisita = async (numeroVisita, limit = 3) => {
  const consulta = `
    SELECT TOP (@param1)
      iim.NumeroVisita,
      iim.NroIndicacion,
      iim.NroAdicional,
      CASE
        WHEN FechaCarga IS NULL OR FechaCarga <= 0 OR FechaCarga > 2958465 THEN NULL
        ELSE TRY_CONVERT(DATETIME, DATEADD(DAY, FechaCarga - 2, '19000101'))
      END AS FechaCarga,
      CASE
        WHEN HoraCarga IS NULL OR HoraCarga < 0 OR HoraCarga > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraCarga / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraCarga,
      iim.OperadorCarga,
      pw.Apellido AS OperadorApellido,
      pw.Nombres AS OperadorNombres,
      iim.ProfesionalAsiste,
      iim.TipoIndicacion,
      iim.Codigo,
      iim.Cantidad,
      iim.TipoUnidad,
      iim.Frecuencia,
      iim.Observaciones,
      CASE
        WHEN FechaExpiro IS NULL OR FechaExpiro <= 0 OR FechaExpiro > 2958465 THEN NULL
        ELSE TRY_CONVERT(DATETIME, DATEADD(DAY, FechaExpiro - 2, '19000101'))
      END AS FechaExpiro,
      CASE
        WHEN HoraExpiro IS NULL OR HoraExpiro < 0 OR HoraExpiro > 8639999 THEN NULL
        ELSE FORMAT(DATEADD(SECOND, HoraExpiro / 100, '00:00:00'), 'HH:mm:ss')
      END AS HoraExpiro,
      iim.CantidadIndicada,
      iim.Orden,
      iim.Estado,
      iim.CantidadPorTurno,
      iim.CantidadEntregada,
      iim.ParaFechaEntrega,
      iim.FormaAdicional,
      iim.NroIndicacionAnterior,
      iim.IdSector,
      iim.AliasMedicamento,
      iim.ExcluidoDeEntrega
    FROM dbo.imInterIndMedicas AS iim
    LEFT JOIN dbo.imPassword AS pw ON pw.CodOperador = iim.OperadorCarga
    WHERE iim.NumeroVisita = @param0
    ORDER BY iim.FechaCarga DESC, iim.HoraCarga DESC, iim.NroIndicacion DESC
  `;
  const parametros = [{ value: numeroVisita }, { value: limit }];
  try {
    return await executeQuery(consulta, parametros);
  } catch (error) {
    console.error('Error al obtener últimas indicaciones por visita:', error);
    console.error('Parámetros:', JSON.stringify(parametros));
    throw error;
  }
};

module.exports = {
  obtenerUltimaIndicacionPorVisita,
  obtenerUltimasIndicacionesPorVisita,
};
