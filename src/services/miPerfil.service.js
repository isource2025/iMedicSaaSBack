const { executeQuery } = require('../models/db');
const personalService = require('./personal.service');
const { convertirFechaAClarion } = require('../utils/dateUtils');

const MAX_RANGE_DAYS = 800;
let fechaPracticaTipoCache = null;
let practicasNomencladorResolverPromise = null;

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
function buildConvenioFilterSql(idConvenios, paramOffset, alias = 'd') {
	if (!idConvenios.length) return { fragment: '', extraParams: [] };
	const hasSin = idConvenios.includes(-1);
	const positives = idConvenios.filter((x) => x > 0);
	const extraParams = [];
	const field = `${alias}.IDCONVENIO`;

	if (hasSin && positives.length === 0) {
		return { fragment: ` AND (${field} IS NULL OR ${field} = 0) `, extraParams };
	}

	if (!hasSin && positives.length > 0) {
		const placeholders = positives.map((_, i) => `@p${paramOffset + i}`).join(', ');
		positives.forEach((id) => extraParams.push({ value: id }));
		return { fragment: ` AND ${field} IN (${placeholders}) `, extraParams };
	}

	const placeholders = positives.map((_, i) => `@p${paramOffset + i}`).join(', ');
	positives.forEach((id) => extraParams.push({ value: id }));
	return {
		fragment: ` AND (${field} IN (${placeholders}) OR ${field} IS NULL OR ${field} = 0) `,
		extraParams,
	};
}

async function resolverTipoFechaPractica() {
	if (fechaPracticaTipoCache) return fechaPracticaTipoCache;
	const rows = await executeQuery(
		`
    SELECT DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'imFacpracticas'
      AND COLUMN_NAME = 'FechaPractica'
    `,
	);
	const t = String(rows?.[0]?.DATA_TYPE || '').toLowerCase();
	fechaPracticaTipoCache = t || 'int';
	return fechaPracticaTipoCache;
}

function tipoEsNumericoSql(dataType) {
	return ['int', 'smallint', 'tinyint', 'bigint', 'numeric', 'decimal', 'float', 'real'].includes(
		String(dataType || '').toLowerCase(),
	);
}

async function getPracticasNomencladorResolver() {
	if (practicasNomencladorResolverPromise) return practicasNomencladorResolverPromise;
	practicasNomencladorResolverPromise = (async () => {
		try {
			const cols = await executeQuery(
				`
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VUnionModuladasNomenclador'
        `,
			);
			const set = new Set((cols || []).map((r) => String(r.COLUMN_NAME || '').trim().toLowerCase()));
			if (!set.size) return null;
			const pick = (candidates) => candidates.find((c) => set.has(c.toLowerCase())) || null;
			const codeCol = pick(['IDPractica', 'Practica', 'CodigoPractica', 'Codigo', 'CodPractica', 'Valor']);
			const descCol = pick(['Descripcion', 'DescPractica', 'DescripcionPractica', 'Prestacion', 'Denominacion']);
			if (!codeCol || !descCol) return null;
			return { codeCol, descCol };
		} catch (_) {
			return null;
		}
	})();
	return practicasNomencladorResolverPromise;
}

function normalizarMatchKey(v) {
	if (v == null) return '';
	const s0 = String(v).trim();
	if (!s0) return '';
	const s = s0.replace(/,/g, '.');
	const num = Number(s);
	if (!Number.isNaN(num) && Number.isFinite(num)) {
		return String(Math.trunc(num));
	}
	return s0.toUpperCase();
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
	const foto = await personalService.obtenerFirmaPersonal(valorPersonal).catch(() => ({ hasFirma: false }));

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
		fotoPerfil: foto || { hasFirma: false },
	};
}

async function actualizarPerfilPersonal(valorPersonal, data = {}) {
	const existente = await personalService.obtenerPorId(valorPersonal);
	if (!existente) {
		const e = new Error('No se encontró el perfil de personal enlazado al usuario');
		e.statusCode = 404;
		throw e;
	}
	const payload = { ...existente, ...data };
	return personalService.actualizar(valorPersonal, payload);
}

async function obtenerFotoPerfil(valorPersonal) {
	return personalService.obtenerFirmaPersonal(valorPersonal);
}

async function actualizarFotoPerfil(valorPersonal, buffer) {
	return personalService.actualizarFirmaPersonal(valorPersonal, buffer);
}

async function eliminarFotoPerfil(valorPersonal) {
	return personalService.eliminarFirmaPersonal(valorPersonal);
}

/**
 * Obras / convenios distintos en el rango, alineados al merge practicas + detalle (misma lógica que la tabla).
 */
async function listarConveniosProduccion(valorPersonal, desdeStr, hastaStr) {
	const cred = await obtenerCredencialesResumen(valorPersonal);
	const codOperador = cred?.CodOperador != null ? Number(cred.CodOperador) : null;
	const rango = resolverRangoCalendario(desdeStr, hastaStr);
	const tipoFechaPractica = await resolverTipoFechaPractica();
	const filtroFecha = tipoEsNumericoSql(tipoFechaPractica)
		? 'fp.FechaPractica BETWEEN @p1 AND @p2'
		: 'CAST(fp.FechaPractica AS DATE) BETWEEN @p1 AND @p2';
	const pFechaDesde = tipoEsNumericoSql(tipoFechaPractica)
		? rango.fechaClarionDesde
		: rango.desdeCalendario;
	const pFechaHasta = tipoEsNumericoSql(tipoFechaPractica)
		? rango.fechaClarionHasta
		: rango.hastaCalendario;

	if (codOperador == null || !Number.isFinite(codOperador)) {
		return { convenios: [], periodo: rango };
	}

	const practicasRows = await executeQuery(
		`
    SELECT
      CAST(fp.Valor AS VARCHAR(64)) AS idMatch,
      COALESCE(NULLIF(fp.IDCONVENIO, 0), -1) AS idConvenioPractica,
      CASE
        WHEN fp.IDCONVENIO IS NULL OR fp.IDCONVENIO = 0 THEN '(Sin convenio)'
        ELSE COALESCE(
          NULLIF(LTRIM(RTRIM(cli.RazonSocial)), ''),
          NULLIF(LTRIM(RTRIM(cc.Descripcion)), ''),
          CONCAT('Convenio ', fp.IDCONVENIO)
        )
      END AS coberturaPractica
    FROM dbo.imFacpracticas fp
    LEFT JOIN dbo.imClientesConvenios cc ON cc.Codigo = fp.IDCONVENIO
    LEFT JOIN dbo.imClientes cli ON cli.Valor = cc.Valor
    WHERE fp.CodOperador = @p0
      AND ${filtroFecha}
    `,
		[{ value: codOperador }, { value: pFechaDesde }, { value: pFechaHasta }],
	);

	// Misma base que obtenerProduccionConFiltros / detalleAgg: NO filtrar por MATRICULA,
	// para que el texto de cobertura del selector coincida con el merge fp + detalle por IdPrestacion.
	let detalleRows = await executeQuery(
		`
      SELECT
        CAST(d.IdPrestacion AS VARCHAR(64)) AS idMatch,
        COALESCE(NULLIF(d.IDCONVENIO, 0), -1) AS idConvenioDetalle,
        CASE
          WHEN d.IDCONVENIO IS NULL OR d.IDCONVENIO = 0 THEN '(Sin convenio)'
          ELSE COALESCE(
            NULLIF(LTRIM(RTRIM(cli.RazonSocial)), ''),
            NULLIF(LTRIM(RTRIM(cc.Descripcion)), ''),
            CONCAT('Convenio ', d.IDCONVENIO)
          )
        END AS coberturaDetalle
      FROM dbo.imFacDetalle d
      LEFT JOIN dbo.imClientesConvenios cc ON cc.Codigo = d.IDCONVENIO
      LEFT JOIN dbo.imClientes cli ON cli.Valor = cc.Valor
      WHERE d.FECHA IS NOT NULL
        AND d.FECHA <> 0
        AND d.FECHA BETWEEN @p0 AND @p1
        AND d.IdPrestacion IS NOT NULL
      `,
		[{ value: rango.fechaClarionDesde }, { value: rango.fechaClarionHasta }],
	);

	const detalleMap = new Map();
	for (const d of detalleRows || []) {
		const k = normalizarMatchKey(d.idMatch);
		if (!k) continue;
		// Si hay más de un detalle por práctica, alcanza con uno para cobertura del selector
		if (!detalleMap.has(k)) detalleMap.set(k, d);
	}

	const optionsMap = new Map();
	for (const p of practicasRows || []) {
		const k = normalizarMatchKey(p.idMatch);
		const d = k ? detalleMap.get(k) : null;
		const idConvenio = Number(d?.idConvenioDetalle ?? p.idConvenioPractica ?? -1);
		const obraSocial = String(d?.coberturaDetalle || p.coberturaPractica || '(Sin convenio)');
		const key = `${idConvenio}::${obraSocial}`;
		if (!optionsMap.has(key)) optionsMap.set(key, { idConvenio, obraSocial });
	}
	const rows = Array.from(optionsMap.values()).sort((a, b) =>
		String(a.obraSocial).localeCompare(String(b.obraSocial), 'es'),
	);

	return {
		periodo: rango,
		convenios: rows,
	};
}

/**
 * Producción valorizada con filtros opcionales de fecha (calendario YYYY-MM-DD) y obra social (IDs; -1 = sin convenio).
 */
async function obtenerProduccionConFiltros(valorPersonal, { desde, hasta, idConvenio } = {}) {
	const cred = await obtenerCredencialesResumen(valorPersonal);
	const matricula = cred?.Matricula != null ? Number(cred.Matricula) : null;
	const codOperador = cred?.CodOperador != null ? Number(cred.CodOperador) : null;
	const rango = resolverRangoCalendario(desde, hasta);
	const idConvenios = normalizeIdConvenios(idConvenio);
	const tipoFechaPractica = await resolverTipoFechaPractica();
	const nomenclador = await getPracticasNomencladorResolver();
	// OUTER APPLY para evitar duplicar prácticas si el nomenclador tiene varias filas con mismo código.
	const applyNomenclador = nomenclador
		? `OUTER APPLY (
            SELECT TOP 1 LTRIM(RTRIM(CONVERT(VARCHAR(300), n.[${nomenclador.descCol}]))) AS Descripcion
            FROM dbo.VUnionModuladasNomenclador n
            WHERE LTRIM(RTRIM(CONVERT(VARCHAR(50), n.[${nomenclador.codeCol}])))
                  = LTRIM(RTRIM(CONVERT(VARCHAR(50), fp.Practica)))
               OR n.[${nomenclador.codeCol}] = fp.Practica
            ORDER BY 1
          ) nom`
		: '';
	const descripcionPracticaSql = nomenclador
		? `COALESCE(
          NULLIF(nom.Descripcion, ''),
          NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(300), fp.DescPractica))), ''),
          CONVERT(VARCHAR(50), fp.Practica)
        ) AS descripcionPractica`
		: `COALESCE(
          NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(300), fp.DescPractica))), ''),
          CONVERT(VARCHAR(50), fp.Practica)
        ) AS descripcionPractica`;
	const filtroFechaPractica = tipoEsNumericoSql(tipoFechaPractica)
		? 'fp.FechaPractica BETWEEN @p1 AND @p2'
		: 'CAST(fp.FechaPractica AS DATE) BETWEEN @p1 AND @p2';
	const pFechaPracticaDesde = tipoEsNumericoSql(tipoFechaPractica)
		? rango.fechaClarionDesde
		: rango.desdeCalendario;
	const pFechaPracticaHasta = tipoEsNumericoSql(tipoFechaPractica)
		? rango.fechaClarionHasta
		: rango.hastaCalendario;

	if (
		(matricula == null || !Number.isFinite(matricula)) &&
		(codOperador == null || !Number.isFinite(codOperador))
	) {
		return {
			periodo: rango,
			filtros: { idConvenios },
			matricula: null,
			mensaje: 'No hay datos de identificación para listar producción del usuario.',
			registros: [],
			totales: {
				lineas: 0,
				total: 0,
				cantidad: 0,
			},
		};
	}

	const cols = await executeQuery(
		`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME IN ('imFacpracticas', 'imFacDetalle')
    `,
	);
	const setCols = new Set(
		(cols || []).map((r) => `${String(r.TABLE_NAME || '').toLowerCase()}.${String(r.COLUMN_NAME || '').toLowerCase()}`),
	);
	const hasFpValor = setCols.has('imfacpracticas.valor');
	const hasDIdPrestacion = setCols.has('imfacdetalle.idprestacion');

	if (!hasFpValor || !hasDIdPrestacion) {
		const e = new Error(
			'No se encontraron las columnas requeridas para valorización: imFacpracticas.Valor / imFacDetalle.IdPrestacion',
		);
		e.statusCode = 500;
		throw e;
	}
	const fpMatchExpr = 'fp.Valor';
	const dMatchExpr = 'd.IdPrestacion';

	const { fragment: fragmentDetalle, extraParams: extraParamsDetalle } = buildConvenioFilterSql(
		idConvenios,
		2,
		'd',
	);
	const paramsDetalle = [{ value: rango.fechaClarionDesde }, { value: rango.fechaClarionHasta }, ...extraParamsDetalle];

	const detalleAggRows =
		matricula != null && Number.isFinite(matricula)
			? await executeQuery(
		`
    SELECT
      agg.idMatch,
      agg.cantidad,
      agg.porcentajeFacturado,
      agg.total,
      CASE
        WHEN agg.IDCONVENIO IS NULL OR agg.IDCONVENIO = 0 THEN '(Sin convenio)'
        ELSE COALESCE(
          NULLIF(conv.RazonSocial, ''),
          NULLIF(conv.Descripcion, ''),
          CONCAT('Convenio ', agg.IDCONVENIO)
        )
      END AS cobertura
    FROM (
      SELECT
        CAST(${dMatchExpr} AS VARCHAR(64)) AS idMatch,
        SUM(CAST(d.CANTIDAD AS DECIMAL(19, 4))) AS cantidad,
        MAX(CAST(d.PORCENTAJE AS DECIMAL(19, 4))) AS porcentajeFacturado,
        SUM(CAST(d.IMPORTE_FINAL AS DECIMAL(19, 4))) AS total,
        MAX(d.IDCONVENIO) AS IDCONVENIO
      FROM dbo.imFacDetalle d
      WHERE d.FECHA IS NOT NULL
        AND d.FECHA <> 0
        AND d.FECHA BETWEEN @p0 AND @p1
        ${fragmentDetalle}
        AND ${dMatchExpr} IS NOT NULL
      GROUP BY ${dMatchExpr}
    ) agg
    OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(cli.RazonSocial)) AS RazonSocial,
        LTRIM(RTRIM(cc.Descripcion)) AS Descripcion
      FROM dbo.imClientesConvenios cc
      LEFT JOIN dbo.imClientes cli ON cli.Valor = cc.Valor
      WHERE cc.Codigo = agg.IDCONVENIO
      ORDER BY cli.RazonSocial, cc.Descripcion
    ) conv
    `,
		paramsDetalle,
	  )
			: [];

	const { fragment: fragmentPracticas, extraParams: extraParamsPracticas } = buildConvenioFilterSql(
		idConvenios,
		3,
		'fp',
	);
	const paramsPracticas = [
		{ value: codOperador },
		{ value: pFechaPracticaDesde },
		{ value: pFechaPracticaHasta },
		...extraParamsPracticas,
	];

	const practicas = await executeQuery(
		`
    SELECT
      fp.Valor AS id,
      CONVERT(varchar(10), fp.FechaPractica, 23) AS fecha,
      CONVERT(varchar(8), fp.HoraPracticaInicio, 108) AS hora,
      CAST(${fpMatchExpr} AS VARCHAR(64)) AS idMatch,
      CAST(fp.Practica AS VARCHAR(50)) AS codigoPractica,
      ${descripcionPracticaSql},
      CAST(fp.CantidadPractica AS DECIMAL(19, 4)) AS cantidad,
      LTRIM(RTRIM(ISNULL(pac.NumeroDocumento, ''))) AS dniPaciente,
      LTRIM(RTRIM(ISNULL(pac.ApellidoyNombre, ''))) AS nombrePaciente,
      CASE
        WHEN fp.IDCONVENIO IS NULL OR fp.IDCONVENIO = 0 THEN '(Sin convenio)'
        ELSE COALESCE(
          NULLIF(conv.RazonSocial, ''),
          NULLIF(conv.Descripcion, ''),
          CONCAT('Convenio ', fp.IDCONVENIO)
        )
      END AS cobertura
    FROM dbo.imFacpracticas fp
    OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(cli.RazonSocial)) AS RazonSocial,
        LTRIM(RTRIM(cc.Descripcion)) AS Descripcion
      FROM dbo.imClientesConvenios cc
      LEFT JOIN dbo.imClientes cli ON cli.Valor = cc.Valor
      WHERE cc.Codigo = fp.IDCONVENIO
      ORDER BY cli.RazonSocial, cc.Descripcion
    ) conv
    OUTER APPLY (
      SELECT TOP 1 v.IdPaciente
      FROM dbo.imVisita v
      WHERE v.NumeroVisita = fp.NumeroVisita
    ) vis
    OUTER APPLY (
      SELECT TOP 1 p.NumeroDocumento, p.ApellidoyNombre
      FROM dbo.imPacientes p
      WHERE p.IdPaciente = vis.IdPaciente
    ) pac
    ${applyNomenclador}
    WHERE fp.CodOperador = @p0
      AND ${filtroFechaPractica}
      ${fragmentPracticas}
    ORDER BY fp.FechaPractica DESC, fp.HoraPracticaInicio DESC, fp.Valor DESC
    `,
		paramsPracticas,
	);

	const detalleAgg = new Map();
	for (const r of detalleAggRows || []) {
		const key = normalizarMatchKey(r.idMatch);
		if (!key) continue;
		detalleAgg.set(key, r);
	}

	const registros = (practicas || []).map((p) => {
		const key = normalizarMatchKey(p.idMatch);
		const d = key ? detalleAgg.get(key) : null;
		const cantidad = Number(p.cantidad || 0);
		const total = Number(d?.total || 0);
		const porcentajeFacturado = Number(d?.porcentajeFacturado || 0);
		const cantidadDetalle = Number(d?.cantidad || 0);

		// "Valorizada" sólo si el detalle aporta valores económicos reales (no sólo match).
		const valorizada =
			!!d && (Math.abs(total) > 0 || Math.abs(porcentajeFacturado) > 0 || Math.abs(cantidadDetalle) > 0);

		const detalleCob = String(d?.cobertura || '').trim();
		const practicaCob = String(p.cobertura || '').trim();
		// Preferimos un nombre real de cobertura sobre "(Sin convenio)".
		const cobertura =
			(detalleCob && detalleCob !== '(Sin convenio)' && detalleCob) ||
			(practicaCob && practicaCob !== '(Sin convenio)' && practicaCob) ||
			detalleCob ||
			practicaCob ||
			'(Sin convenio)';

		return {
			id: Number(p.id ?? 0),
			fecha: p.fecha,
			hora: p.hora,
			idMatch: key || null,
			valorizada,
			codigoPractica: String(p.codigoPractica || ''),
			descripcionPractica: String(p.descripcionPractica || ''),
			cantidad,
			dniPaciente: String(p.dniPaciente || ''),
			nombrePaciente: String(p.nombrePaciente || ''),
			cobertura,
			porcentajeFacturado,
			importeUnitario: cantidad ? total / cantidad : 0,
			total,
		};
	});

	const totales = { lineas: 0, total: 0, cantidad: 0 };
	for (const row of registros) {
		totales.lineas += 1;
		totales.total += Number(row.total) || 0;
		totales.cantidad += Number(row.cantidad) || 0;
	}

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
		codOperador,
		registros,
		totales: {
			lineas: totales.lineas,
			total: Math.round(totales.total * 100) / 100,
			cantidad: Math.round(totales.cantidad * 10000) / 10000,
		},
	};
}

/** @deprecated usar obtenerProduccionConFiltros sin query */
async function obtenerProduccionMesCorriente(valorPersonal) {
	return obtenerProduccionConFiltros(valorPersonal, {});
}

module.exports = {
	obtenerPerfilCompleto,
	actualizarPerfilPersonal,
	obtenerFotoPerfil,
	actualizarFotoPerfil,
	eliminarFotoPerfil,
	obtenerProduccionMesCorriente,
	obtenerProduccionConFiltros,
	listarConveniosProduccion,
	rangoMesCorrienteHastaHoy,
	resolverRangoCalendario,
};
