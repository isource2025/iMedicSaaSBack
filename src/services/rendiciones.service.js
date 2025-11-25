/**
 * Servicio para gestión de rendiciones
 */
const { executeQuery } = require('../models/db');

/**
 * Busca rendiciones con paginación y filtros
 * @param {number} page - Número de página (1-indexed)
 * @param {number} limit - Cantidad de registros por página
 * @param {string} search - Término de búsqueda (opcional)
 * @param {string} estado - Filtro por estado: 'all', 'abierta', 'cerrada' (opcional)
 * @param {number} mes - Filtro por mes (1-12) (opcional)
 * @param {number} anio - Filtro por año (opcional)
 * @returns {Promise<{data: Array, totalCount: number, totalPages: number, currentPage: number, limit: number}>}
 */
const buscarRendicionesPaginadas = async (page = 1, limit = 30, search = '', estado = 'all', mes = null, anio = null) => {
	const offset = (page - 1) * limit;
	
	// Construir condición de búsqueda
	let whereConditions = [];
	const params = [];
	let paramIndex = 0;
	
	// Filtro de búsqueda por texto
	if (search && search.trim()) {
		whereConditions.push(`(
			c.RazonSocial LIKE @p${paramIndex} OR
			cc.Descripcion LIKE @p${paramIndex + 1} OR
			CAST(r.IdRendicion AS VARCHAR) LIKE @p${paramIndex + 2} OR
			CAST(cc.Valor AS VARCHAR) LIKE @p${paramIndex + 3}
		)`);
		const searchPattern = `%${search.trim()}%`;
		params.push(
			{ value: searchPattern },
			{ value: searchPattern },
			{ value: searchPattern },
			{ value: searchPattern }
		);
		paramIndex += 4;
	}
	
	// Filtro por estado
	if (estado === 'abierta') {
		whereConditions.push('r.FechaCierre IS NULL');
	} else if (estado === 'cerrada') {
		whereConditions.push('r.FechaCierre IS NOT NULL');
	}
	
	// Filtro por período (mes y año)
	if (mes && anio) {
		// Convertir mes/año a rango de fechas Clarion
		// Fecha Clarion = días desde 28/12/1800
		const startDate = new Date(anio, mes - 1, 1);
		const endDate = new Date(anio, mes, 0); // Último día del mes
		
		// Calcular días desde 28/12/1800
		const clarionEpoch = new Date(1800, 11, 28);
		const startClarion = Math.floor((startDate - clarionEpoch) / (24 * 60 * 60 * 1000));
		const endClarion = Math.floor((endDate - clarionEpoch) / (24 * 60 * 60 * 1000));
		
		whereConditions.push(`r.Periodo BETWEEN @p${paramIndex} AND @p${paramIndex + 1}`);
		params.push(
			{ value: startClarion },
			{ value: endClarion }
		);
		paramIndex += 2;
	}
	
	const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
	
	// Query principal con JOINs
	const query = `
		SELECT 
			r.IdRendicion,
			r.FechaGraba,
			r.OperGraba,
			r.IdTipoCliente,
			r.idCliente,
			c.RazonSocial AS ClienteRazonSocial,
			r.idPaciente,
			r.idConvenio,
			cc.Valor AS ConvenioNumero,
			cc.Descripcion AS ConvenioDescripcion,
			r.Periodo,
			r.Honorarios,
			r.Gastos,
			r.Medicamentos,
			r.OtrosServicios,
			r.Visitas,
			r.FechaCierre,
			r.HoraCierre,
			r.OperCierre,
			r.Observaciones,
			r.IdEmpresa,
			r.IdSucursal,
			r.IdTransaccion
		FROM dbo.imRendiciones r
		LEFT JOIN dbo.imClientes c ON r.idCliente = c.Valor
		LEFT JOIN dbo.imClientesConvenios cc ON r.idConvenio = cc.Codigo
		${whereClause}
		ORDER BY r.IdRendicion DESC
		OFFSET ${offset} ROWS
		FETCH NEXT ${limit} ROWS ONLY
	`;
	
	// Query de conteo
	const countQuery = `
		SELECT COUNT(*) as total
		FROM dbo.imRendiciones r
		LEFT JOIN dbo.imClientes c ON r.idCliente = c.Valor
		LEFT JOIN dbo.imClientesConvenios cc ON r.idConvenio = cc.Codigo
		${whereClause}
	`;
	
	try {
		// Ejecutar queries en paralelo
		const [data, countResult] = await Promise.all([
			executeQuery(query, params),
			executeQuery(countQuery, params)
		]);
		
		const totalCount = countResult[0]?.total || 0;
		const totalPages = Math.ceil(totalCount / limit);
		
		return {
			data: data || [],
			totalCount,
			totalPages,
			currentPage: page,
			limit
		};
	} catch (error) {
		console.error('Error en buscarRendicionesPaginadas:', error);
		throw error;
	}
};

/**
 * Obtiene una rendición por ID
 * @param {number} id - ID de la rendición
 * @returns {Promise<Object>}
 */
const obtenerRendicionPorId = async (id) => {
	const query = `
		SELECT 
			r.IdRendicion,
			r.FechaGraba,
			r.OperGraba,
			r.IdTipoCliente,
			r.idCliente,
			c.RazonSocial AS ClienteRazonSocial,
			r.idPaciente,
			r.idConvenio,
			cc.Valor AS ConvenioNumero,
			cc.Descripcion AS ConvenioDescripcion,
			r.Periodo,
			r.Honorarios,
			r.Gastos,
			r.Medicamentos,
			r.OtrosServicios,
			r.Visitas,
			r.FechaCierre,
			r.HoraCierre,
			r.OperCierre,
			r.Observaciones,
			r.IdEmpresa,
			r.IdSucursal,
			r.IdTransaccion
		FROM dbo.imRendiciones r
		LEFT JOIN dbo.imClientes c ON r.idCliente = c.Valor
		LEFT JOIN dbo.imClientesConvenios cc ON r.idConvenio = cc.Codigo
		WHERE r.IdRendicion = @p0
	`;
	
	try {
		const result = await executeQuery(query, [{ value: id }]);
		return result && result.length > 0 ? result[0] : null;
	} catch (error) {
		console.error('Error en obtenerRendicionPorId:', error);
		throw error;
	}
};

/**
 * Crea una nueva rendición
 * @param {Object} data - Datos de la rendición
 * @returns {Promise<Object>}
 */
const crearRendicion = async (data) => {
	const query = `
		INSERT INTO dbo.imRendiciones (
			FechaGraba,
			OperGraba,
			IdTipoCliente,
			idCliente,
			idPaciente,
			idConvenio,
			Periodo,
			Honorarios,
			Gastos,
			Medicamentos,
			OtrosServicios,
			Visitas,
			Observaciones,
			IdEmpresa,
			IdSucursal
		) VALUES (
			GETDATE(),
			@p0,
			@p1,
			@p2,
			@p3,
			@p4,
			@p5,
			@p6,
			@p7,
			@p8,
			@p9,
			@p10,
			@p11,
			@p12,
			@p13
		);
		SELECT SCOPE_IDENTITY() AS IdRendicion;
	`;
	
	const params = [
		{ value: data.OperGraba || 0 },
		{ value: data.IdTipoCliente || '' },
		{ value: data.idCliente },
		{ value: data.idPaciente },
		{ value: data.idConvenio },
		{ value: data.Periodo },
		{ value: data.Honorarios || 0 },
		{ value: data.Gastos || 0 },
		{ value: data.Medicamentos || null },
		{ value: data.OtrosServicios || null },
		{ value: data.Visitas || null },
		{ value: data.Observaciones || null },
		{ value: data.IdEmpresa || null },
		{ value: data.IdSucursal || null }
	];
	
	try {
		const result = await executeQuery(query, params);
		const newId = result[0]?.IdRendicion;
		
		if (newId) {
			return await obtenerRendicionPorId(newId);
		}
		
		throw new Error('No se pudo crear la rendición');
	} catch (error) {
		console.error('Error en crearRendicion:', error);
		throw error;
	}
};

/**
 * Actualiza una rendición existente
 * @param {number} id - ID de la rendición
 * @param {Object} data - Datos a actualizar
 * @returns {Promise<Object>}
 */
const actualizarRendicion = async (id, data) => {
	const query = `
		UPDATE dbo.imRendiciones
		SET
			IdTipoCliente = @p0,
			idCliente = @p1,
			idPaciente = @p2,
			idConvenio = @p3,
			Periodo = @p4,
			Honorarios = @p5,
			Gastos = @p6,
			Medicamentos = @p7,
			OtrosServicios = @p8,
			Visitas = @p9,
			Observaciones = @p10,
			IdEmpresa = @p11,
			IdSucursal = @p12
		WHERE IdRendicion = @p13
	`;
	
	const params = [
		{ value: data.IdTipoCliente || '' },
		{ value: data.idCliente },
		{ value: data.idPaciente },
		{ value: data.idConvenio },
		{ value: data.Periodo },
		{ value: data.Honorarios || 0 },
		{ value: data.Gastos || 0 },
		{ value: data.Medicamentos || null },
		{ value: data.OtrosServicios || null },
		{ value: data.Visitas || null },
		{ value: data.Observaciones || null },
		{ value: data.IdEmpresa || null },
		{ value: data.IdSucursal || null },
		{ value: id }
	];
	
	try {
		await executeQuery(query, params);
		return await obtenerRendicionPorId(id);
	} catch (error) {
		console.error('Error en actualizarRendicion:', error);
		throw error;
	}
};

/**
 * Elimina una rendición
 * @param {number} id - ID de la rendición
 * @returns {Promise<boolean>}
 */
const eliminarRendicion = async (id) => {
	const query = `DELETE FROM dbo.imRendiciones WHERE IdRendicion = @p0`;
	
	try {
		await executeQuery(query, [{ value: id }]);
		return true;
	} catch (error) {
		console.error('Error en eliminarRendicion:', error);
		throw error;
	}
};

module.exports = {
	buscarRendicionesPaginadas,
	obtenerRendicionPorId,
	crearRendicion,
	actualizarRendicion,
	eliminarRendicion
};
