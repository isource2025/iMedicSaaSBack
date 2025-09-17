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
      p.NumeroDocumento as DocumentoPaciente,
      p.Sexo as SexoPaciente,
      sx.Descripcion as DescripcionSexo,
      d.Descripcion as DiagnosticoDescripcion,
      ec.Descripcion as EstadoDescripcion,
      c.RazonSocial as RazonSocialCliente,
      sm.Descripcion as ServicioMedicoDescripcion,
      CASE WHEN hc.numeroVisita = 0 THEN '' ELSE CAST(hc.numeroVisita AS VARCHAR) END as mostrarNumeroVisita
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN
      imSexo sx ON p.Sexo = sx.Valor
    LEFT JOIN
      imDiagnosticos d ON v.Diagnostico = d.CodigoOMS
    LEFT JOIN
      imEstadoCama ec ON hc.ValorEstadoCama = ec.Valor
    LEFT JOIN
      imClientes c ON v.Cliente = c.Valor
    LEFT JOIN
      imServiciosMedicos sm ON v.ServicioHospital = sm.Valor
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
      p.NumeroDocumento as DocumentoPaciente,
      p.Sexo as SexoPaciente,
      sx.Descripcion as DescripcionSexo,
      d.Descripcion as DiagnosticoDescripcion,
      c.RazonSocial as RazonSocialCliente,
      sm.Descripcion as ServicioMedicoDescripcion,
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
      imSexo sx ON p.Sexo = sx.Valor
    LEFT JOIN
      imDiagnosticos d ON v.Diagnostico = d.CodigoOMS
    LEFT JOIN
      imClientes c ON v.Cliente = c.Valor
    LEFT JOIN
      imServiciosMedicos sm ON v.ServicioHospital = sm.Valor
    WHERE 
      ec.valor = @param0
    ORDER BY
      hc.ValorHabitacionCama ASC
  `;

	const parametros = [{ value: estadoValor }];
	try {
		return await executeQuery(consulta, parametros);
	} catch (error) {
		console.error('Error al filtrar camas por estado:', error);
		console.error('Parámetros:', JSON.stringify(parametros));
		throw error;
	}
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
      p.ApellidoYNombre as NombrePaciente,
      p.Sexo as SexoPaciente,
	  p.Domicilio as ubicacionPaciente,
      sx.Descripcion as DescripcionSexo,
      c.RazonSocial as RazonSocialCliente,
      sm.Descripcion as ServicioMedicoDescripcion
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN
      imSexo sx ON p.Sexo = sx.Valor
    LEFT JOIN
      imClientes c ON v.Cliente = c.Valor
    LEFT JOIN
      imServiciosMedicos sm ON v.ServicioHospital = sm.Valor
    WHERE hc.ValorHabitacionCama = @param0`;
	const parametros = [{ value: id }];
	try {
		const resultado = await executeQuery(consulta, parametros);
		return resultado.length > 0 ? resultado[0] : null;
	} catch (error) {
		console.error('Error al obtener cama por ID:', error);
		console.error('Parámetros:', JSON.stringify(parametros));
		throw error;
	}
};

/**
 * Actualizar el estado de una cama
 * @param {number} id - ID de la cama
 * @param {'disponible' | 'ocupada' | 'mantenimiento'} estado - Nuevo estado
 * @returns {Promise<Object>} Cama actualizada
 */
const actualizarEstadoCama = async (id, estado) => {
	// Mapear estados descriptivos a valores de la tabla imEstadoCama
	let valorEstado;
	switch (estado) {
		case 'disponible':
			valorEstado = 'U'; // Libre
			break;
		case 'ocupada':
			valorEstado = 'O'; // Ocupada
			break;
		case 'mantenimiento':
			valorEstado = 'M'; // Mantenimiento
			break;
		default:
			valorEstado = estado; // Usar el valor directamente si no es uno de los predefinidos
	}

	console.log(`Actualizando cama ID ${id} a estado: ${estado}, valor en DB: ${valorEstado}`);

	const consulta = `
    UPDATE imHabitacionCamas
    SET ValorEstadoCama = @param1
    WHERE ValorHabitacionCama = @param0;

    SELECT 
      hc.*,
      p.ApellidoYNombre as NombrePaciente,
      p.Sexo as SexoPaciente,
      sx.Descripcion as DescripcionSexo,
      c.RazonSocial as RazonSocialCliente,
      sm.Descripcion as ServicioMedicoDescripcion
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imVisita v ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN
      imSexo sx ON p.Sexo = sx.Valor
    LEFT JOIN
      imClientes c ON v.Cliente = c.Valor
    LEFT JOIN
      imServiciosMedicos sm ON v.ServicioHospital = sm.Valor
    WHERE hc.ValorHabitacionCama = @param0;
  `;

	const parametros = [{ value: id }, { value: valorEstado }];

	try {
		const resultado = await executeQuery(consulta, parametros);
		return resultado.length > 0 ? resultado[0] : null;
	} catch (error) {
		console.error('Error al actualizar estado de cama:', error);
		console.error('Parámetros:', JSON.stringify(parametros));
		throw error;
	}
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

/**
 * Obtener el total de camas desde imHabitacionCamas
 * @returns {Promise<Object>} Objeto con estadísticas de camas
 */
const obtenerTotalCamas = async () => {
	const consulta = `
    SELECT 
      COUNT(*) as totalCamas,
      SUM(CASE WHEN ec.Valor IN ('U', 'A', 'H') THEN 1 ELSE 0 END) as camasDisponibles,
      SUM(CASE WHEN ec.Valor = 'O' THEN 1 ELSE 0 END) as camasOcupadas,
      SUM(CASE WHEN ec.Valor IN ('C', 'R', 'I') THEN 1 ELSE 0 END) as camasNoDisponibles
    FROM 
      imHabitacionCamas hc
    LEFT JOIN 
      imEstadoCama ec ON hc.ValorEstadoCama = ec.Valor
  `;
	try {
		const resultado = await executeQuery(consulta);
		return resultado.length > 0
			? resultado[0]
			: {
					totalCamas: 0,
					camasDisponibles: 0,
					camasOcupadas: 0,
					camasNoDisponibles: 0,
			  };
	} catch (error) {
		console.error('Error al obtener total de camas:', error);
		throw error;
	}
};

/**
 * Obtener los registros de control frecuente por número de visita
 * @param {number} numeroVisita Número de visita para filtrar
 * @returns {Promise<Array>} Lista de registros de control frecuente
 */
const obtenerControlesFrecuentesPorVisita = async (numeroVisita) => {
	const consulta = `
    SELECT 
      dbo.fn_ClarionDATE2SQL(icf.FechaControl) as FechaControl,
      dbo.fn_ClarionTIME2SQL(icf.HoraControl) as HoraControl,
      icf.IdSector,
      icf.Pulso,
      icf.Maximo,
      icf.Minimo,
      icf.PAMedia,
      icf.FrecuenciaRespiratoria,
      icf.Axilar,
      icf.Rectal,
      icf.Saturometria,
      icf.HGT,
      icf.Observaciones,
      icf.Profesional
    FROM 
      imInterCtrlFrecuente icf
    WHERE 
      icf.NumeroVisita = @param0
    ORDER BY 
      icf.FechaControl DESC, icf.HoraControl DESC
  `;

	const parametros = [{ value: numeroVisita }];
	try {
		return await executeQuery(consulta, parametros);
	} catch (error) {
		console.error('Error al obtener controles frecuentes por visita:', error);
		console.error('Parámetros:', JSON.stringify(parametros));
		throw error;
	}
};

module.exports = {
	obtenerCamas,
	obtenerCamaPorId,
	actualizarEstadoCama,
	obtenerEstadosCama,
	filtrarCamasPorEstado,
	obtenerSectores,
	obtenerTotalCamas,
	obtenerControlesFrecuentesPorVisita,
};
