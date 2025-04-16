// src/services/bedsService.ts

const { executeQuery } = require('../models/db');

/**
 * Obtener todas las camas desde imHabitacionCamas
 * @returns {Promise<Array>} Lista de camas con información del paciente y diagnóstico
 */
const obtenerCamas = async () => {
  const consulta = `
    SELECT 
      hc.*,
      p.ApellidoYNombre as NombrePaciente,
      d.Descripcion as DiagnosticoDescripcion,
      ec.Descripcion as EstadoDescripcion,
      CASE WHEN hc.numeroVisita = 0 THEN '' ELSE CAST(hc.numeroVisita AS VARCHAR) END as mostrarNumeroVisita
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN
      imDiagnosticos d ON v.Diagnostico = d.CodigoOMS
    LEFT JOIN
      imEstadoCama ec ON hc.ValorEstadoCama = ec.Valor
    ORDER BY
      hc.ValorHabitacionCama ASC`;
  return await executeQuery(consulta);
};

/**
 * Obtener todos los estados de cama desde imEstadoCama
 * @returns {Promise<Array>} Lista de estados de cama
 */
const obtenerEstadosCama = async () => {
  // Usando alias para devolver los campos con nombres en minúsculas
  const consulta = `SELECT Valor as valor, Descripcion as descripcion FROM imEstadoCama`;
  return await executeQuery(consulta);
};

/**
 * Filtrar camas por estado usando la relación entre imhabitacioncamas y imestadocama
 * @param {string} estadoValor - Valor del estado a filtrar (del campo valor en imestadocama)
 * @returns {Promise<Array>} Lista de camas filtradas
 */
const filtrarCamasPorEstado = async (estadoValor) => {
  const consulta = `
    SELECT 
      hc.*,
      ec.valor as valorEstadoCama, 
      ec.descripcion as descripcionEstadoCama,
      ec.Descripcion as EstadoDescripcion,
      p.ApellidoYNombre as NombrePaciente,
      d.Descripcion as DiagnosticoDescripcion,
      CASE WHEN hc.numeroVisita = 0 THEN '' ELSE CAST(hc.numeroVisita AS VARCHAR) END as mostrarNumeroVisita
    FROM 
      imHabitacionCamas hc
    INNER JOIN 
      imEstadoCama ec ON hc.ValorEstadoCama = ec.valor
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN
      imDiagnosticos d ON v.Diagnostico = d.CodigoOMS
    WHERE 
      ec.valor = @p0
    ORDER BY
      hc.ValorHabitacionCama ASC
  `;
  
  const parametros = [{ value: estadoValor }];
  return await executeQuery(consulta, parametros);
};

/**
 * Obtener una cama por ID
 * @param {number} id - ID de la cama
 * @returns {Promise<Object|null>} Cama encontrada o null
 */
const obtenerCamaPorId = async (id) => {
  const consulta = `
    SELECT 
      hc.*,
      p.ApellidoYNombre as NombrePaciente
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    WHERE hc.id = @p0`;
  const parametros = [{ value: id }];
  const resultado = await executeQuery(consulta, parametros);
  return resultado.length > 0 ? resultado[0] : null;
};

/**
 * Actualizar el estado de una cama
 * @param {number} id - ID de la cama
 * @param {'disponible' | 'ocupada' | 'mantenimiento'} estado - Nuevo estado
 * @returns {Promise<Object>} Cama actualizada
 */
const actualizarEstadoCama = async (id, estado) => {
  const consulta = `
    UPDATE imHabitacionCamas
    SET estado = @p1
    WHERE id = @p0;

    SELECT 
      hc.*,
      p.ApellidoYNombre as NombrePaciente
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    WHERE hc.id = @p0;
  `;
  const parametros = [
    { value: id },
    { value: estado }
  ];

  const resultado = await executeQuery(consulta, parametros);
  return resultado.length > 0 ? resultado[0] : null;
};

/**
 * Obtener todos los sectores desde imSectores
 * @returns {Promise<Array>} Lista de sectores donde ambint='I' y que tengan camas asociadas
 */
const obtenerSectores = async () => {
  const consulta = `
    SELECT DISTINCT
      s.Valor as valor,
      s.Descripcion as descripcion
    FROM 
      imSectores s
    INNER JOIN
      imHabitacionCamas hc ON s.Valor = hc.ValorSector
    WHERE
      s.AmbInt = 'I'
    ORDER BY
      s.Descripcion
  `;
  return await executeQuery(consulta);
};

module.exports = {
  obtenerCamas,
  obtenerCamaPorId,
  actualizarEstadoCama,
  obtenerEstadosCama,
  filtrarCamasPorEstado,
  obtenerSectores,
};