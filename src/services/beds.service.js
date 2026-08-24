// src/services/bedsService.ts

const { executeQuery } = require('../models/db');
const { enrichControlesWithIMC } = require('../utils/antropometria');
const vistoEnfermeria = require('./indicacionesVistoEnfermeria.service');

async function queryCamasSeguro(sqlConVisto, sqlSinVisto, params) {
	try {
		const listo = await vistoEnfermeria.tablaLista();
		if (listo) {
			try {
				return await executeQuery(sqlConVisto, params);
			} catch (err) {
				console.warn('[beds] Aviso de indicaciones omitido:', err?.message || err);
			}
		}
	} catch (err) {
		console.warn('[beds] Chequeo de indicaciones nuevas omitido:', err?.message || err);
	}
	const rows = await executeQuery(sqlSinVisto, params);
	void vistoEnfermeria.ensureTable().catch((e) => {
		console.warn('[beds] No se pudo preparar tabla de aviso de indicaciones:', e?.message || e);
	});
	return rows;
}

/**
 * Obtener camas desde imHabitacionCamas.
 * @param {string|null} idSector - Si viene, solo ese sector (login / filtro). Sin filtro = hospital entero.
 */
const obtenerCamas = async (idSector) => {
	const sector = String(idSector || '').trim();
	const whereSector = sector
		? ` WHERE LTRIM(RTRIM(CAST(hc.ValorSector AS VARCHAR(50)))) = LTRIM(RTRIM(@param0)) `
		: '';
	const params = sector ? [{ value: sector, type: 'VarChar' }] : [];

	const sqlList = `
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
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) as fechaIngresoSQL,
      CONVERT(VARCHAR(5), v.FECHAADMISIONS, 114) as horaIngresoSQL,
      CASE WHEN hc.numeroVisita = 0 THEN '' ELSE CAST(hc.numeroVisita AS VARCHAR) END as mostrarNumeroVisita,
      CAST(0 AS INT) AS IndicacionesNuevasEnfermeria
    FROM 
      imHabitacionCamas hc WITH (NOLOCK)
    LEFT JOIN 
      imVisita v WITH (NOLOCK) ON hc.NumeroVisita = v.NumeroVisita
    LEFT JOIN 
      imPacientes p WITH (NOLOCK) ON v.IdPaciente = p.IdPaciente
    LEFT JOIN
      imSexo sx WITH (NOLOCK) ON p.Sexo = sx.Valor
    LEFT JOIN
      imDiagnosticos d WITH (NOLOCK) ON v.Diagnostico = d.CodigoOMS
    LEFT JOIN
      imEstadoCama ec WITH (NOLOCK) ON hc.ValorEstadoCama = ec.Valor
    LEFT JOIN
      imClientes c WITH (NOLOCK) ON v.Cliente = c.Valor
    LEFT JOIN
      imServiciosMedicos sm WITH (NOLOCK) ON v.ServicioHospital = sm.Valor
    ${whereSector}
    ORDER BY
      hc.ValorHabitacionCama ASC`;
	const t0 = Date.now();
	const rows = await executeQuery(sqlList, params);
	console.log(
		`[beds] list sector=${sector || 'ALL'} n=${(rows || []).length} ms=${Date.now() - t0}`,
	);
	return rows;
};

/**
 * Obtener todos los estados de cama desde imEstadoCama
 * @returns {Promise<Array>} Lista de estados de cama
 */
const obtenerEstadosCama = async () => {
	// Usando alias para devolver los campos con nombres en minúsculas
	const consulta = `SELECT Valor as valor, Descripcion as descripcion FROM imEstadoCama WITH (NOLOCK)`;
	return await executeQuery(consulta);
};

/**
 * Filtrar camas por estado usando la relación entre imhabitacioncamas y imestadocama
 * @param {string} estadoValor - Valor del estado a filtrar (del campo valor en imestadocama)
 * @returns {Promise<Array>} Lista de camas filtradas
 */
const filtrarCamasPorEstado = async (estadoValor) => {
	const sqlBase = (conVisto) => `
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
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) as fechaIngresoSQL,
      CONVERT(VARCHAR(5), v.FECHAADMISIONS, 114) as horaIngresoSQL,
      CASE WHEN hc.numeroVisita = 0 THEN '' ELSE CAST(hc.numeroVisita AS VARCHAR) END as mostrarNumeroVisita,
      ${conVisto ? vistoEnfermeria.SELECT_COUNT : vistoEnfermeria.SELECT_COUNT_ZERO}
    FROM 
      imHabitacionCamas hc
    ${conVisto ? vistoEnfermeria.OUTER_APPLY_COUNT : ''}
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
		return await queryCamasSeguro(sqlBase(true), sqlBase(false), parametros);
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
	const [ValorSector, ValorHabitacionCama] = id.split('-');
	const sqlBase = (conVisto) => `
    SELECT 
      hc.*,
      p.ApellidoYNombre as NombrePaciente,
      p.NumeroDocumento as documentoPaciente,
      p.Sexo as SexoPaciente,
	  p.Domicilio as ubicacionPaciente,
      sx.Descripcion as DescripcionSexo,
      c.RazonSocial as RazonSocialCliente,
      sm.Descripcion as ServicioMedicoDescripcion,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) as fechaIngresoSQL,
      CONVERT(VARCHAR(5), v.FECHAADMISIONS, 114) as horaIngresoSQL,
      ${conVisto ? vistoEnfermeria.SELECT_COUNT : vistoEnfermeria.SELECT_COUNT_ZERO}
    FROM 
      imHabitacionCamas hc
    ${conVisto ? vistoEnfermeria.OUTER_APPLY_COUNT : ''}
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
    WHERE hc.ValorHabitacionCama = @param0 AND hc.ValorSector = @param1`;
	const parametros = [{ value: ValorHabitacionCama }, { value: ValorSector }];
	try {
		const resultado = await queryCamasSeguro(sqlBase(true), sqlBase(false), parametros);
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
	const idStr = String(id || '');
	const dash = idStr.indexOf('-');
	const ValorSector = dash >= 0 ? idStr.slice(0, dash) : null;
	const ValorHabitacionCama = dash >= 0 ? idStr.slice(dash + 1) : idStr;

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

	if (!ValorSector) {
		throw new Error('ValorSector es obligatorio para actualizar el estado de una cama');
	}

	console.log(`Actualizando cama ID ${id} (sector ${ValorSector}) a estado: ${estado}, valor en DB: ${valorEstado}`);

	const consulta = `
    UPDATE imHabitacionCamas
    SET ValorEstadoCama = @param1
    WHERE ValorHabitacionCama = @param0 AND ValorSector = @param2;

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
    WHERE hc.ValorHabitacionCama = @param0 AND hc.ValorSector = @param2;
  `;

	const parametros = [
		{ value: ValorHabitacionCama },
		{ value: valorEstado },
		{ value: ValorSector },
	];

	try {
		const resultado = await executeQuery(consulta, parametros);
		return resultado.length > 0 ? resultado[0] : null;
	} catch (error) {
		console.error('Error al actualizar estado de cama:', error);
		console.error('Parámetros:', JSON.stringify(parametros));
		throw error;
	}
};

function _col(row, ...names) {
	if (!row) return undefined;
	for (const n of names) {
		if (Object.prototype.hasOwnProperty.call(row, n) && row[n] != null) return row[n];
	}
	const lower = {};
	for (const [k, v] of Object.entries(row)) lower[String(k).toLowerCase()] = v;
	for (const n of names) {
		const v = lower[String(n).toLowerCase()];
		if (v !== undefined && v !== null) return v;
	}
	return undefined;
}

function _mapSectorInternacion(r) {
	const valor = String(_col(r, 'valor', 'Valor', 'IdSector', 'idSector') || '').trim();
	if (!valor) return null;
	const descripcion = String(_col(r, 'descripcion', 'Descripcion') || '').trim();
	return { valor, descripcion: descripcion || valor };
}

/**
 * Sectores de internación (AmbInt = I). Todos, no solo los asignados al personal.
 * El sector del login solo preselecciona el filtro en el front.
 */
const obtenerSectores = async () => {
	const sqlTodosI = `
    SELECT
      LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) AS valor,
      LTRIM(RTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion
    FROM dbo.imSectores s WITH (NOLOCK)
    WHERE UPPER(LTRIM(RTRIM(ISNULL(s.AmbInt, '')))) = 'I'
      AND LTRIM(RTRIM(ISNULL(s.Valor, ''))) <> ''
    ORDER BY s.Descripcion`;
	const sqlTodos = `
    SELECT
      LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) AS valor,
      LTRIM(RTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS descripcion
    FROM dbo.imSectores s WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ISNULL(s.Valor, ''))) <> ''
    ORDER BY s.Descripcion`;

	const byKey = new Map();
	const add = (row) => {
		const m = _mapSectorInternacion(row);
		if (!m) return;
		const k = m.valor.toUpperCase();
		if (!byKey.has(k)) byKey.set(k, m);
	};

	const t0 = Date.now();
	try {
		for (const r of (await executeQuery(sqlTodosI)) || []) add(r);
	} catch (err) {
		console.warn('[beds] sectores internación AmbInt:', err?.message || err);
	}
	if (!byKey.size) {
		try {
			for (const r of (await executeQuery(sqlTodos)) || []) add(r);
		} catch (err) {
			console.warn('[beds] sectores catálogo:', err?.message || err);
		}
	}
	const list = [...byKey.values()].sort((a, b) =>
		String(a.descripcion).localeCompare(String(b.descripcion), 'es'),
	);
	console.log(`[beds] sectores n=${list.length} ms=${Date.now() - t0}`);
	return list;
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
 * @param {string|number} dias Número de días hacia atrás (0=hoy, 7, 30, 'all'=todos)
 * @returns {Promise<Array>} Lista de registros de control frecuente
 */
const obtenerControlesFrecuentesPorVisita = async (numeroVisita, dias = 'all') => {
	// Construir la cláusula WHERE según el filtro de días
	let whereClause = 'icf.NumeroVisita = @param0';
	
	if (dias !== 'all' && dias !== undefined) {
		const numDias = Number(dias);
		if (!isNaN(numDias)) {
			// Calcular la fecha límite en formato Clarion
			const hoy = new Date();
			const fechaLimite = new Date(hoy);
			fechaLimite.setDate(hoy.getDate() - numDias);
			
			// Convertir a formato Clarion (días desde 28/12/1800)
			const clarionEpoch = new Date(1800, 11, 28);
			const diffTime = fechaLimite.getTime() - clarionEpoch.getTime();
			const fechaClarion = Math.floor(diffTime / (24 * 60 * 60 * 1000));
			
			whereClause += ` AND icf.FechaControl >= ${fechaClarion}`;
		}
	}

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
      icf.Peso,
      icf.Talla,
      icf.IMC,
      icf.Observaciones,
      icf.Profesional
    FROM 
      imInterCtrlFrecuente icf
    WHERE 
      ${whereClause}
    ORDER BY 
      icf.FechaControl DESC, icf.HoraControl DESC
  `;

	const parametros = [{ value: numeroVisita }];
	try {
		const rows = await executeQuery(consulta, parametros);
		return enrichControlesWithIMC(rows);
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
