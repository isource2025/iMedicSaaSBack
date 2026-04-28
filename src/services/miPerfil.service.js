const { executeQuery } = require('../models/db');
const personalService = require('./personal.service');
const { convertirFechaAClarion } = require('../utils/dateUtils');

const MAX_RANGE_DAYS = 800;

/**
 * Rango "mes en curso hasta hoy": del día 1 del mes actual al día de hoy (inclusive).
 */
function rangoMesCorrienteHastaHoy() {
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const desde = `${yyyy}-${mm}-01`;
	const hasta = `${yyyy}-${mm}-${dd}`;
	return {
		desdeCalendario: desde,
		hastaCalendario: hasta,
		fechaClarionDesde: convertirFechaAClarion(desde),
		fechaClarionHasta: convertirFechaAClarion(hasta),
	};
}

function isValidYmd(s) {
	return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function parseYmdUtc(s) {
	const [y, m, d] = s.trim().split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

/**
 * @param {string|undefined} desdeStr
 * @param {string|undefined} hastaStr
 */
function resolverRangoCalendario(desdeStr, hastaStr) {
	if (!isValidYmd(desdeStr) || !isValidYmd(hastaStr)) {
		return rangoMesCorrienteHastaHoy();
	}
	let desde = desdeStr.trim();
	let hasta = hastaStr.trim();
	let t0 = parseYmdUtc(desde);
	let t1 = parseYmdUtc(hasta);
	if (t0 > t1) {
		const tmp = desde;
		desde = hasta;
		hasta = tmp;
		t0 = parseYmdUtc(desde);
		t1 = parseYmdUtc(hasta);
	}
	const days = (t1 - t0) / 86400000 + 1;
	if (days > MAX_RANGE_DAYS) {
		const err = new Error(`El rango de fechas no puede superar ${MAX_RANGE_DAYS} días`);
		err.statusCode = 400;
		throw err;
	}
	return {
		desdeCalendario: desde,
		hastaCalendario: hasta,
		fechaClarionDesde: convertirFechaAClarion(desde),
		fechaClarionHasta: convertirFechaAClarion(hasta),
	};
}

/** Lista de IDs de convenio; -1 = sin convenio (NULL / 0). Máx. 40 valores. */
function normalizeIdConvenios(raw) {
	if (raw == null || raw === '') return [];
	const str = Array.isArray(raw) ? raw.join(',') : String(raw);
	const nums = str
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n));
	return [...new Set(nums)].slice(0, 40);
}

/**
 * @param {number[]} idConvenios
 * @param {number} paramOffset siguiente índice @pN (p.ej. 3 tras matrícula + 2 fechas)
 */
function buildConvenioFilterSql(idConvenios, paramOffset) {
	if (!idConvenios.length) return { fragment: '', extraParams: [] };
	const hasSin = idConvenios.includes(-1);
	const positives = idConvenios.filter((x) => x > 0);
	const extraParams = [];

	if (hasSin && positives.length === 0) {
		return { fragment: ' AND (d.IDCONVENIO IS NULL OR d.IDCONVENIO = 0) ', extraParams };
	}

	if (!hasSin && positives.length > 0) {
		const placeholders = positives.map((_, i) => `@p${paramOffset + i}`).join(', ');
		positives.forEach((id) => extraParams.push({ value: id }));
		return { fragment: ` AND d.IDCONVENIO IN (${placeholders}) `, extraParams };
	}

	const placeholders = positives.map((_, i) => `@p${paramOffset + i}`).join(', ');
	positives.forEach((id) => extraParams.push({ value: id }));
	return {
		fragment: ` AND (d.IDCONVENIO IN (${placeholders}) OR d.IDCONVENIO IS NULL OR d.IDCONVENIO = 0) `,
		extraParams,
	};
}

async function obtenerCredencialesResumen(valorPersonal) {
	const rows = await executeQuery(
		`
    SELECT
      pw.ValorPersonal,
      pw.CodOperador,
      LTRIM(RTRIM(ISNULL(pw.NombreRed, ''))) AS NombreRed,
      LTRIM(RTRIM(ISNULL(pw.Nombres, ''))) AS Nombres,
      LTRIM(RTRIM(ISNULL(pw.Apellido, ''))) AS Apellido,
      p.Matricula,
      p.MatriculaNacional,
      LTRIM(RTRIM(ISNULL(p.ApellidoNombre, ''))) AS ApellidoNombrePersonal
    FROM dbo.imPassword pw
    LEFT JOIN dbo.imPersonal p ON p.Valor = pw.ValorPersonal
    WHERE pw.ValorPersonal = @p0
    `,
		[{ value: valorPersonal }],
	);
	return rows?.[0] || null;
}

async function obtenerPerfilCompleto(valorPersonal) {
	const cred = await obtenerCredencialesResumen(valorPersonal);
	const personal = await personalService.obtenerPorId(valorPersonal);

	return {
		valorPersonal,
		resumenOperador: cred
			? {
					ValorPersonal: cred.ValorPersonal,
					CodOperador: cred.CodOperador,
					NombreRed: cred.NombreRed,
					Nombres: cred.Nombres,
					Apellido: cred.Apellido,
					Matricula: cred.Matricula != null ? Number(cred.Matricula) : null,
					MatriculaNacional: cred.MatriculaNacional != null ? Number(cred.MatriculaNacional) : null,
					ApellidoNombrePersonal: cred.ApellidoNombrePersonal,
			  }
			: null,
		personal: personal || null,
	};
}

/**
 * Obra sociales distintas en imFacDetalle para la matrícula en el rango (para armar filtros).
 */
async function listarConveniosProduccion(valorPersonal, desdeStr, hastaStr) {
	const cred = await obtenerCredencialesResumen(valorPersonal);
	const matricula = cred?.Matricula != null ? Number(cred.Matricula) : null;
	const rango = resolverRangoCalendario(desdeStr, hastaStr);

	if (matricula == null || !Number.isFinite(matricula)) {
		return { convenios: [], periodo: rango };
	}

	const rows = await executeQuery(
		`
    SELECT DISTINCT
      COALESCE(NULLIF(d.IDCONVENIO, 0), -1) AS idConvenio,
      CASE
        WHEN d.IDCONVENIO IS NULL OR d.IDCONVENIO = 0 THEN '(Sin convenio)'
        ELSE COALESCE(
          NULLIF(LTRIM(RTRIM(cc.Descripcion)), ''),
          CONCAT('Convenio ', d.IDCONVENIO)
        )
      END AS obraSocial
    FROM dbo.imFacDetalle d
    LEFT JOIN dbo.imClientesConvenios cc ON cc.Codigo = d.IDCONVENIO
    WHERE d.MATRICULA = @p0
      AND d.FECHA IS NOT NULL
      AND d.FECHA <> 0
      AND d.FECHA BETWEEN @p1 AND @p2
    ORDER BY obraSocial
    `,
		[{ value: matricula }, { value: rango.fechaClarionDesde }, { value: rango.fechaClarionHasta }],
	);

	return {
		periodo: rango,
		convenios: (rows || []).map((r) => ({
			idConvenio: Number(r.idConvenio),
			obraSocial: String(r.obraSocial || ''),
		})),
	};
}

/**
 * Producción valorizada con filtros opcionales de fecha (calendario YYYY-MM-DD) y obra social (IDs; -1 = sin convenio).
 */
async function obtenerProduccionConFiltros(valorPersonal, { desde, hasta, idConvenio } = {}) {
	const cred = await obtenerCredencialesResumen(valorPersonal);
	const matricula = cred?.Matricula != null ? Number(cred.Matricula) : null;
	const rango = resolverRangoCalendario(desde, hasta);
	const idConvenios = normalizeIdConvenios(idConvenio);

	if (matricula == null || !Number.isFinite(matricula)) {
		return {
			periodo: rango,
			filtros: { idConvenios },
			matricula: null,
			mensaje: 'No hay matrícula provincial cargada en el legajo; no se puede listar producción valorizada.',
			valorizacion: [],
			totales: { lineas: 0, importeFinal: 0, cantidadSumada: 0 },
			practicasCabecera: [],
		};
	}

	const { fragment, extraParams } = buildConvenioFilterSql(idConvenios, 3);
	const params = [
		{ value: matricula },
		{ value: rango.fechaClarionDesde },
		{ value: rango.fechaClarionHasta },
		...extraParams,
	];

	const valorizacion = await executeQuery(
		`
    SELECT
      d.IDDETALLE AS id,
      CONVERT(varchar(10), DATEADD(day, NULLIF(d.FECHA, 0), '1800-12-28'), 23) AS fecha,
      d.IDCONVENIO AS idConvenio,
      COALESCE(NULLIF(LTRIM(RTRIM(cc.Descripcion)), ''), CONCAT('Convenio ', NULLIF(d.IDCONVENIO, 0))) AS obraSocial,
      d.NUMEROVISITA AS numeroVisita,
      LTRIM(RTRIM(ISNULL(d.DESCRIPCION, ''))) AS descripcionPrestacion,
      CAST(d.CANTIDAD AS DECIMAL(19, 4)) AS cantidad,
      CAST(d.PORCENTAJE AS DECIMAL(19, 4)) AS porcentaje,
      CAST(d.IMPORTE_FINAL AS DECIMAL(19, 4)) AS importeFinal,
      d.IDPRACTICA AS idPracticaCabecera,
      d.FACTURA AS factura,
      d.IDFACTURA AS idFactura
    FROM dbo.imFacDetalle d
    LEFT JOIN dbo.imClientesConvenios cc ON cc.Codigo = d.IDCONVENIO
    WHERE d.MATRICULA = @p0
      AND d.FECHA IS NOT NULL
      AND d.FECHA <> 0
      AND d.FECHA BETWEEN @p1 AND @p2
      ${fragment}
    ORDER BY d.FECHA DESC, d.IDDETALLE DESC
    `,
		params,
	);

	let importeFinal = 0;
	let cantidadSumada = 0;
	for (const row of valorizacion || []) {
		const imp = Number(row.importeFinal);
		const cant = Number(row.cantidad);
		if (!Number.isNaN(imp)) importeFinal += imp;
		if (!Number.isNaN(cant)) cantidadSumada += cant;
	}

	const practicasCabecera = await executeQuery(
		`
    SELECT DISTINCT
      fp.Valor AS id,
      fp.NumeroVisita,
      fp.Practica AS codigoPractica,
      LTRIM(RTRIM(ISNULL(fp.TipoPractica, ''))) AS tipoPractica,
      CAST(fp.CantidadPractica AS DECIMAL(19, 4)) AS cantidadPractica,
      CONVERT(varchar(10), fp.FechaPractica, 23) AS fechaPractica,
      CONVERT(varchar(8), fp.HoraPracticaInicio, 108) AS horaPracticaInicio,
      LTRIM(RTRIM(ISNULL(fp.DescPractica, ''))) AS descPractica,
      fp.IdConvenio AS idConvenio,
      LTRIM(RTRIM(ISNULL(fp.ValorSector, ''))) AS valorSector,
      fp.CodOperador AS codOperador,
      fp.Factura AS factura,
      fp.Estado AS estado,
      LEFT(LTRIM(RTRIM(ISNULL(fp.Observaciones, ''))), 300) AS observacionesPreview
    FROM dbo.imFacpracticas fp
    WHERE EXISTS (
      SELECT 1
      FROM dbo.imFacDetalle d
      WHERE d.IDPRACTICA = fp.Valor
        AND d.MATRICULA = @p0
        AND d.FECHA IS NOT NULL
        AND d.FECHA <> 0
        AND d.FECHA BETWEEN @p1 AND @p2
        ${fragment}
    )
    ORDER BY fp.Valor DESC
    `,
		params,
	);

	return {
		periodo: {
			desdeCalendario: rango.desdeCalendario,
			hastaCalendario: rango.hastaCalendario,
			fechaClarionDesde: rango.fechaClarionDesde,
			fechaClarionHasta: rango.fechaClarionHasta,
		},
		filtros: {
			idConvenios,
		},
		matricula,
		valorizacion: valorizacion || [],
		totales: {
			lineas: (valorizacion || []).length,
			importeFinal: Math.round(importeFinal * 100) / 100,
			cantidadSumada: Math.round(cantidadSumada * 10000) / 10000,
		},
		practicasCabecera: practicasCabecera || [],
	};
}

/** @deprecated usar obtenerProduccionConFiltros sin query */
async function obtenerProduccionMesCorriente(valorPersonal) {
	return obtenerProduccionConFiltros(valorPersonal, {});
}

module.exports = {
	obtenerPerfilCompleto,
	obtenerProduccionMesCorriente,
	obtenerProduccionConFiltros,
	listarConveniosProduccion,
	rangoMesCorrienteHastaHoy,
	resolverRangoCalendario,
};
