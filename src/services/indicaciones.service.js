const { executeQuery } = require('../models/db');
const { convertirFechaDesdeFormatoClarion } = require('../utils/dateUtils');

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
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaCarga - 2, '19000101'))
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
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaExpiro - 2, '19000101'))
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
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaCarga - 2, '19000101'))
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
        ELSE CONVERT(DATETIME, DATEADD(DAY, FechaExpiro - 2, '19000101'))
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

async function getByVisitaAndDate(numeroVisita, ymdDate) {
	const sql = `
    SELECT
      iim.NroIndicacion,
      iim.Cantidad,
      iim.ProfesionalAsiste,
      iim.Frecuencia,
      iim.Observaciones,
      iim.FechaProximo,
      iim.FechaRevision,
      iim.FechaCarga,
      iim.IdSector,
      iim.AliasMedicamento
    FROM dbo.imInterIndMedicas AS iim
    WHERE iim.NumeroVisita = @param0
      AND CONVERT(date, DATEADD(day, iim.FechaCarga, '1800-12-28')) = @param1
    ORDER BY iim.FechaCarga DESC, iim.NroIndicacion DESC
  `;

	const params = [
		{ value: numeroVisita },
		{ value: ymdDate }, // 'YYYY-MM-DD'
	];

	const rows = await executeQuery(sql, params);

	return rows.map((r) => ({
		id: String(r.NroIndicacion),
		cantidad: r.Cantidad,
		descripcion: r.AliasMedicamento,
		profesional: r.ProfesionalAsiste,
		frecuencia: r.Frecuencia,
		observaciones: r.Observaciones,
		// 🔽 Aquí usamos TU utilidad
		proximo: convertirFechaDesdeFormatoClarion(r.FechaProximo),
		anterior: convertirFechaDesdeFormatoClarion(r.FechaRevision),
		vigenteDesde: convertirFechaDesdeFormatoClarion(r.FechaCarga),
		nro: r.NroIndicacion,
		idSector: r.IdSector,
		medicamento: r.AliasMedicamento,
	}));
}

/**
 * Obtener datos para el formulario de creación de indicaciones
 * @returns {Promise<Object>} Objeto con todos los catálogos necesarios
 */
const obtenerDatosFormulario = async () => {
	try {
		// Consultar todas las tablas en paralelo para mejor rendimiento
		const [
			tiposIndicacion,
			vademecum,
			tiposDieta,
			tiposControles,
			controlesAsistenciales,
			unidadesMedida,
			frecuenciasAdmin,
		] = await Promise.all([
			// imInterTipoIndicacion - Tipos de indicaciones
			executeQuery(`
				SELECT
					Valor,
					Descripcion,
					Tipo,
					Orden as OrdenMedicacion
				FROM imInterTipoIndicacion
				ORDER BY Descripcion
			`),

			// // imVademecum - Medicamentos
			executeQuery(`
				SELECT
					Troquel as Valor,
					Nombre,
					Descripcion
				FROM imVademecum
				ORDER BY Nombre
			`),

			// // imTipoDieta - Tipos de dieta
			executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imTipoDieta
				ORDER BY Descripcion
			`),

			// // imInterTipoControles - Tipos de controles
			executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imInterTipoControles
				ORDER BY Descripcion
			`),

			// // imInterCtrlAsistenciales - Controles asistenciales
			executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imInterCtrlAsistenciales
				ORDER BY Descripcion
			`),

			// // imTipoUnidadMedida - Unidades de medida
			executeQuery(`
				SELECT
					Valor,
					Descripcion
				FROM imTipoUnidadMedida
				ORDER BY Descripcion
			`),

			// // imFrecuenciasAdmin - Frecuencias de administración
			executeQuery(`
				SELECT
					Valor,
					Intervalo
				FROM imFrecuenciasAdmin
			`),
		]);

		return {
			tiposIndicacion: tiposIndicacion || [],
			vademecum: vademecum || [],
			tiposDieta: tiposDieta || [],
			tiposControles: tiposControles || [],
			controlesAsistenciales: controlesAsistenciales || [],
			unidadesMedida: unidadesMedida || [],
			frecuenciasAdmin: frecuenciasAdmin || [],
		};
	} catch (error) {
		console.error('Error al obtener datos del formulario:', error);
		throw error;
	}
};

module.exports = {
	obtenerUltimaIndicacionPorVisita,
	obtenerUltimasIndicacionesPorVisita,
	getByVisitaAndDate,
	obtenerDatosFormulario,
};
