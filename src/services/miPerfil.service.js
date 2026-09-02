const { executeQuery } = require('../models/db');
const personalService = require('./personal.service');
const { convertirFechaAClarion } = require('../utils/dateUtils');
const { getTenantId } = require('../context/tenantContext');
const { isAuthCentralEnabled } = require('../config/authCentralDb');
const { createTenantOnce } = require('../context/tenantCache');
const nubeTenant = require('./nubeTenant.service');

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

function pickFirst(...vals) {
	for (const v of vals) {
		if (v == null) continue;
		if (typeof v === 'string' && !v.trim()) continue;
		return v;
	}
	return null;
}

function personalDesdeNube(nube, sqlPersonal) {
	const base = sqlPersonal ? { ...sqlPersonal } : {};
	if (!nube && !sqlPersonal) return null;
	const apellidoNombre = pickFirst(
		base.ApellidoNombre,
		nube?.apellidoNombre,
		nube ? [nube.apellido, nube.nombres].filter(Boolean).join(', ') : null,
	);
	const numDoc = pickFirst(base.NumeroDocumento, nube?.numeroDocumento);
	return {
		Valor: base.Valor || nube?.valorPersonal || null,
		TipoDocumento: pickFirst(base.TipoDocumento, nube?.tipoDocumento, 'DNI'),
		NumeroDocumento: numDoc != null && numDoc !== '' ? Number(numDoc) || numDoc : null,
		ApellidoNombre: apellidoNombre || '',
		Domicilio: pickFirst(base.Domicilio, nube?.domicilio),
		ValorLocalidad: base.ValorLocalidad ?? null,
		Provincia: base.Provincia ?? null,
		Nacionalidad: base.Nacionalidad ?? null,
		FechaNacimiento: base.FechaNacimiento ?? null,
		Sexo: base.Sexo ?? null,
		EstadoCivil: base.EstadoCivil ?? null,
		Telefono: pickFirst(base.Telefono, nube?.telefono),
		MatriculaProvincial: pickFirst(base.MatriculaProvincial, nube?.matricula),
		MatriculaNacional: pickFirst(base.MatriculaNacional, nube?.matriculaNacional),
		ValorEspecialidad: pickFirst(base.ValorEspecialidad, nube?.valorEspecialidad),
		ValorFunciones: base.ValorFunciones ?? null,
		ValorServicio: pickFirst(base.ValorServicio, nube?.valorServicio),
		ValorServicioParaFacturar: pickFirst(base.ValorServicioParaFacturar, nube?.valorServicioParaFacturar),
		ValorCategoria: pickFirst(base.ValorCategoria, nube?.valorCategoria),
		ValorClase: base.ValorClase ?? null,
		LugarTrabajo: base.LugarTrabajo ?? null,
		LugarCobro: base.LugarCobro ?? null,
		NumeroSocio: base.NumeroSocio ?? null,
		ConvenioFacturacion: base.ConvenioFacturacion ?? null,
		IdEspecialidadME: base.IdEspecialidadME ?? null,
		Estado: pickFirst(base.Estado, nube?.estado),
		CUIT: pickFirst(base.CUIT, nube?.cuit),
	};
}

async function obtenerFichaNube(valorPersonal) {
	if (!isAuthCentralEnabled()) return null;
	const idEmpresa = getTenantId();
	if (idEmpresa == null) return null;
	try {
		return await nubeTenant.obtenerFichaUsuario(idEmpresa, valorPersonal);
	} catch (e) {
		console.warn('[miPerfil] ficha nube:', e.message);
		return null;
	}
}

async function obtenerPerfilCompleto(valorPersonal) {
	let cred = null;
	let personalSql = null;
	try {
		cred = await obtenerCredencialesResumen(valorPersonal);
	} catch (e) {
		console.warn('[miPerfil] credenciales SQL:', e.message);
	}
	try {
		personalSql = await personalService.obtenerPorId(valorPersonal);
	} catch (e) {
		console.warn('[miPerfil] personal SQL:', e.message);
	}
	const nube = await obtenerFichaNube(valorPersonal);
	const personal = personalDesdeNube(nube, personalSql);

	let foto = { hasFirma: false };
	try {
		foto = await personalService.obtenerFirmaPersonal(valorPersonal);
	} catch {
		foto = { hasFirma: false };
	}

	const apellidoNombre =
		personal?.ApellidoNombre ||
		nube?.apellidoNombre ||
		(cred?.ApellidoNombrePersonal || '').trim() ||
		[cred?.Apellido, cred?.Nombres].filter(Boolean).join(', ') ||
		[nube?.apellido, nube?.nombres].filter(Boolean).join(', ');

	return {
		valorPersonal,
		resumenOperador: {
			ValorPersonal: valorPersonal,
			CodOperador: pickFirst(cred?.CodOperador, nube?.codOperador),
			NombreRed: pickFirst(cred?.NombreRed, nube?.nombreRed, ''),
			Nombres: pickFirst(cred?.Nombres, nube?.nombres, ''),
			Apellido: pickFirst(cred?.Apellido, nube?.apellido, ''),
			Matricula: pickFirst(
				cred?.Matricula != null ? Number(cred.Matricula) : null,
				nube?.matricula,
				personal?.MatriculaProvincial,
			),
			MatriculaNacional: pickFirst(
				cred?.MatriculaNacional != null ? Number(cred.MatriculaNacional) : null,
				nube?.matriculaNacional,
				personal?.MatriculaNacional,
			),
			ApellidoNombrePersonal: apellidoNombre || '',
		},
		personal: personal || null,
		fotoPerfil: foto || { hasFirma: false },
	};
}

async function actualizarPerfilPersonal(valorPersonal, data = {}) {
	const existente = await personalService.obtenerPorId(valorPersonal).catch(() => null);
	if (existente) {
		const payload = { ...existente, ...data };
		await personalService.actualizar(valorPersonal, payload);
	}
	const idEmpresa = getTenantId();
	if (isAuthCentralEnabled() && idEmpresa != null) {
		try {
			await nubeTenant.actualizarFichaPerfil(idEmpresa, valorPersonal, { ...(existente || {}), ...data });
		} catch (e) {
			console.warn('[miPerfil] actualizar ficha nube:', e.message);
			if (!existente) {
				const err = new Error(e.message || 'No se pudo guardar el perfil');
				err.statusCode = e.statusCode || 500;
				throw err;
			}
		}
	} else if (!existente) {
		const e = new Error('No se encontró el perfil de personal enlazado al usuario');
		e.statusCode = 404;
		throw e;
	}
	return obtenerPerfilCompleto(valorPersonal);
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
 * Obras / coberturas distintas en el rango. Se obtienen de la misma vista que la tabla
 * para garantizar que las opciones coincidan exactamente con lo que se muestra.
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
      COALESCE(NULLIF(LTRIM(RTRIM(v.RazonSocial)), ''), '(Sin convenio)') AS obraSocial
    FROM dbo.VProduccionProfesionales v
    WHERE v.Matricula = @p0
      AND CAST(v.FechaPractica AS DATE) BETWEEN @p1 AND @p2
    `,
		[
			{ value: matricula },
			{ value: rango.desdeCalendario },
			{ value: rango.hastaCalendario },
		],
	);

	const convenios = (rows || [])
		.map((r) => ({ obraSocial: String(r.obraSocial || '(Sin convenio)') }))
		.sort((a, b) => a.obraSocial.localeCompare(b.obraSocial, 'es'));

	return { periodo: rango, convenios };
}

/**
 * Columnas del cruce con el importe liquidado al profesional.
 *
 * `imFacDetalle.ImporteLiquidado` la crea
 * scripts/sql/liquidacion_imfacdetalle.sql y no está en la vista
 * VProduccionProfesionales (que es de la base del cliente), así que la
 * producción la trae con un join propio: imFacProfesionales une la práctica de
 * la vista con la prestación de imFacDetalle. Los nombres se resuelven contra
 * INFORMATION_SCHEMA porque las bases legacy no los escriben todas igual.
 */
const CANDIDATOS_LIQUIDADO = Object.freeze({
	detPrestacion: ['imFacDetalle', ['IDPRESTACION', 'ID_PRESTACION']],
	detLiquidado: ['imFacDetalle', ['IMPORTELIQUIDADO']],
	profPractica: ['imFacProfesionales', ['VALOR']],
	profPrestacion: ['imFacProfesionales', ['IDFACPROFESIONAL']],
	profMatricula: ['imFacProfesionales', ['MATRICULA']],
});

const resolverLiquidado = createTenantOnce(async () => {
	const filas = await executeQuery(
		`SELECT TABLE_NAME, COLUMN_NAME
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_SCHEMA = 'dbo'
		   AND TABLE_NAME IN ('imFacDetalle', 'imFacProfesionales')`,
	);

	const porTabla = new Map();
	for (const f of filas || []) {
		const tabla = String(f.TABLE_NAME || '');
		const columna = String(f.COLUMN_NAME || '');
		if (!tabla || !columna || columna.includes(']')) continue;
		if (!porTabla.has(tabla)) porTabla.set(tabla, new Map());
		porTabla.get(tabla).set(columna.toUpperCase(), columna);
	}

	const cols = {};
	for (const [campo, [tabla, alternativas]] of Object.entries(CANDIDATOS_LIQUIDADO)) {
		const disponibles = porTabla.get(tabla);
		const real = disponibles && alternativas.map((a) => disponibles.get(a)).find(Boolean);
		if (!real) return null;
		cols[campo] = `[${real}]`;
	}

	// El tipo de prestación es opcional: sin él el join no puede descartar
	// gastos y medicamentos, pero esos no tienen importe liquidado cargado.
	const detalle = porTabla.get('imFacDetalle');
	const tipo = ['TIPOPRESTACION', 'TIPO_PRESTACION'].map((a) => detalle.get(a)).find(Boolean);
	cols.detTipo = tipo ? `[${tipo}]` : null;

	return cols;
});

/** null si el tenant todavía no tiene la columna (se reintenta en la próxima). */
async function columnasLiquidado() {
	const cols = await resolverLiquidado();
	if (!cols) resolverLiquidado.reset();
	return cols;
}

/**
 * Producción del profesional para un rango de fechas.
 *
 * Toda la información (paciente, cobertura, descripción, valorización, importes,
 * porcentaje, etc.) se obtiene de la vista `dbo.VProduccionProfesionales`, que
 * resuelve por sí misma los joins con imFacpracticas + imFacDetalle +
 * imFacProfesionales + imVisita + imPacientes + imClientes + imPersonal +
 * imFunciones + VUnionModuladasNomenclador. La única excepción es el importe
 * liquidado al profesional, que la vista no expone.
 *
 * El parámetro `idConvenio` se conserva por compatibilidad con clientes
 * antiguos pero no se aplica del lado del servidor: el filtrado por cobertura
 * se hace del lado del cliente.
 */
async function obtenerProduccionConFiltros(valorPersonal, { desde, hasta } = {}) {
	const cred = await obtenerCredencialesResumen(valorPersonal);
	const matricula = cred?.Matricula != null ? Number(cred.Matricula) : null;
	const codOperador = cred?.CodOperador != null ? Number(cred.CodOperador) : null;
	const rango = resolverRangoCalendario(desde, hasta);

	if (matricula == null || !Number.isFinite(matricula)) {
		return {
			periodo: rango,
			filtros: { idConvenios: [] },
			matricula: null,
			codOperador,
			mensaje: 'No hay matrícula asociada al usuario para listar producción.',
			registros: [],
			totales: { lineas: 0, total: 0, cantidad: 0 },
		};
	}

	const liq = await columnasLiquidado();
	// MAX y no SUM: el GROUP BY de abajo repite la fila del join por cada
	// profesional/detalle que la vista trae para esa misma práctica.
	const selectLiquidado = liq
		? `,
      CAST(MAX(liq.liquidado) AS DECIMAL(19, 4)) AS liquidado`
		: '';
	const joinLiquidado = liq
		? `
    LEFT JOIN (
      SELECT p.${liq.profPractica} AS practica, SUM(d.${liq.detLiquidado}) AS liquidado
      FROM dbo.imFacProfesionales p
      JOIN dbo.imFacDetalle d
        ON d.${liq.detPrestacion} = p.${liq.profPrestacion}
        ${liq.detTipo ? `AND d.${liq.detTipo} = 'H'` : ''}
      WHERE p.${liq.profMatricula} = @p0
        AND d.${liq.detLiquidado} IS NOT NULL
      GROUP BY p.${liq.profPractica}
    ) liq ON liq.practica = v.Valor`
		: '';

	const filas = await executeQuery(
		`
    SELECT
      v.Valor AS id,
      CONVERT(varchar(10), v.FechaPractica, 23) AS fecha,
      CAST(v.Valor AS VARCHAR(64)) AS idMatch,
      CAST(MIN(v.Practica) AS VARCHAR(50)) AS codigoPractica,
      MIN(v.PracticaDescripcion) AS descripcionPractica,
      MIN(v.FuncionDescripcion) AS funcionDescripcion,
      CAST(MAX(v.CantidadPractica) AS DECIMAL(19, 4)) AS cantidad,
      CAST(MAX(v.NumeroVisita) AS VARCHAR(50)) AS numeroVisita,
      LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), MAX(v.NumeroDocumento)), ''))) AS dniPaciente,
      LTRIM(RTRIM(ISNULL(MIN(v.ApellidoyNombre), ''))) AS nombrePaciente,
      COALESCE(NULLIF(LTRIM(RTRIM(MIN(v.RazonSocial))), ''), '(Sin convenio)') AS cobertura,
      CAST(ISNULL(MAX(v.Porcentaje), 0) AS DECIMAL(19, 4)) AS porcentajeFacturado,
      CAST(ISNULL(SUM(v.CantidadDetalle), 0) AS DECIMAL(19, 4)) AS cantidadDetalle,
      CAST(ISNULL(MAX(v.Importe_Unitario), 0) AS DECIMAL(19, 4)) AS importeUnitario,
      CAST(ISNULL(SUM(v.Importe_Final), 0) AS DECIMAL(19, 4)) AS total,
      CASE
        WHEN MAX(CASE WHEN ISNULL(v.NoFacturable, 0) = 1 THEN 1 ELSE 0 END) = 1 THEN 0
        WHEN ISNULL(SUM(v.Importe_Final), 0) > 0 THEN 1
        ELSE 0
      END AS valorizada,
      MAX(CASE WHEN ISNULL(v.NoFacturable, 0) = 1 THEN 1 ELSE 0 END) AS noFacturable,
      MAX(v.NroRendicion) AS nroRendicion${selectLiquidado}
    FROM dbo.VProduccionProfesionales v${joinLiquidado}
    WHERE v.Matricula = @p0
      AND CAST(v.FechaPractica AS DATE) BETWEEN @p1 AND @p2
    GROUP BY v.Valor, CONVERT(varchar(10), v.FechaPractica, 23)
    ORDER BY 2 DESC, v.Valor DESC
    `,
		[
			{ value: matricula },
			{ value: rango.desdeCalendario },
			{ value: rango.hastaCalendario },
		],
	);

	const registros = (filas || []).map((r) => {
		const cantidad = Number(r.cantidad || 0);
		const total = Number(r.total || 0);
		const importeUnitarioBase = Number(r.importeUnitario || 0);
		const importeUnitario =
			importeUnitarioBase > 0
				? importeUnitarioBase
				: cantidad > 0
				  ? total / cantidad
				  : 0;

		const nroRendicion = r.nroRendicion != null ? Number(r.nroRendicion) : null;
		// null = todavía no hay liquidación cargada para esa práctica; 0 sería
		// "la obra social liquidó cero", que no es lo mismo.
		const liquidado = r.liquidado != null ? Number(r.liquidado) : null;
		return {
			id: Number(r.id ?? 0),
			fecha: r.fecha || null,
			idMatch: String(r.idMatch || ''),
			valorizada: !!r.valorizada,
			codigoPractica: String(r.codigoPractica || ''),
			descripcionPractica: String(r.descripcionPractica || '').trim(),
			funcionDescripcion: String(r.funcionDescripcion || '').trim(),
			cantidad,
			numeroVisita: String(r.numeroVisita || '').trim(),
			dniPaciente: String(r.dniPaciente || ''),
			nombrePaciente: String(r.nombrePaciente || '').trim(),
			cobertura: String(r.cobertura || '(Sin convenio)'),
			porcentajeFacturado: Number(r.porcentajeFacturado || 0),
			importeUnitario,
			total,
			liquidado: Number.isFinite(liquidado) ? liquidado : null,
			noFacturable: Number(r.noFacturable || 0) === 1,
			nroRendicion: Number.isFinite(nroRendicion) ? nroRendicion : null,
		};
	});

	const totales = registros.reduce(
		(acc, row) => {
			acc.lineas += 1;
			acc.total += Number(row.total) || 0;
			acc.cantidad += Number(row.cantidad) || 0;
			return acc;
		},
		{ lineas: 0, total: 0, cantidad: 0 },
	);

	return {
		periodo: {
			desdeCalendario: rango.desdeCalendario,
			hastaCalendario: rango.hastaCalendario,
			fechaClarionDesde: rango.fechaClarionDesde,
			fechaClarionHasta: rango.fechaClarionHasta,
		},
		filtros: { idConvenios: [] },
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
