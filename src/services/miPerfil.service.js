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
 * Producción del profesional para un rango de fechas.
 *
 * Toda la información (paciente, cobertura, descripción, valorización, importes,
 * porcentaje, etc.) se obtiene de la vista `dbo.VProduccionProfesionales`, que
 * resuelve por sí misma los joins con imFacpracticas + imFacDetalle +
 * imFacProfesionales + imVisita + imPacientes + imClientes + imPersonal +
 * imFunciones + VUnionModuladasNomenclador.
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

	const filas = await executeQuery(
		`
    SELECT
      v.Valor AS id,
      CONVERT(varchar(10), v.FechaPractica, 23) AS fecha,
      CAST(v.Valor AS VARCHAR(64)) AS idMatch,
      CAST(MIN(v.Practica) AS VARCHAR(50)) AS codigoPractica,
      MIN(v.PracticaDescripcion) AS descripcionPractica,
      CAST(MAX(v.CantidadPractica) AS DECIMAL(19, 4)) AS cantidad,
      LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), MAX(v.NumeroDocumento)), ''))) AS dniPaciente,
      LTRIM(RTRIM(ISNULL(MIN(v.ApellidoyNombre), ''))) AS nombrePaciente,
      COALESCE(NULLIF(LTRIM(RTRIM(MIN(v.RazonSocial))), ''), '(Sin convenio)') AS cobertura,
      CAST(ISNULL(MAX(v.Porcentaje), 0) AS DECIMAL(19, 4)) AS porcentajeFacturado,
      CAST(ISNULL(SUM(v.CantidadDetalle), 0) AS DECIMAL(19, 4)) AS cantidadDetalle,
      CAST(ISNULL(MAX(v.Importe_Unitario), 0) AS DECIMAL(19, 4)) AS importeUnitario,
      CAST(ISNULL(SUM(v.Importe_Final), 0) AS DECIMAL(19, 4)) AS total,
      CASE WHEN ISNULL(SUM(v.Importe_Final), 0) > 0 THEN 1 ELSE 0 END AS valorizada,
      MAX(v.NroRendicion) AS nroRendicion
    FROM dbo.VProduccionProfesionales v
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
		return {
			id: Number(r.id ?? 0),
			fecha: r.fecha || null,
			idMatch: String(r.idMatch || ''),
			valorizada: !!r.valorizada,
			codigoPractica: String(r.codigoPractica || ''),
			descripcionPractica: String(r.descripcionPractica || '').trim(),
			cantidad,
			dniPaciente: String(r.dniPaciente || ''),
			nombrePaciente: String(r.nombrePaciente || '').trim(),
			cobertura: String(r.cobertura || '(Sin convenio)'),
			porcentajeFacturado: Number(r.porcentajeFacturado || 0),
			importeUnitario,
			total,
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
