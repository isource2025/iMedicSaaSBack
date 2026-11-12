/**
 * Remitos legacy: Remitos + RemitosItems + Tipos_Remitos + Depositos + Remitos_Observa.
 */
const { executeQuery, getRequestPool, sql } = require('../models/db');
const {
	convertirFechaAClarion,
	partesFechaHoraArgentina,
	ahoraWallArgentinaParaSql,
} = require('../utils/dateUtils');
const grab = require('./almacen.remitos.grabacion');
const { resolverAudUser } = require('./almacen.comun');

function httpError(mensaje, statusCode = 400) {
	const e = new Error(mensaje);
	e.statusCode = statusCode;
	return e;
}

function trim(v) {
	if (v == null) return null;
	const s = String(v).replace(/\u0000/g, '').trim();
	return s || null;
}

function mapRemito(row) {
	if (!row) return null;
	return {
		IdTransaccion: row.IdTransaccion,
		IdEmpresa: row.IdEmpresa,
		IdSucursal: row.IdSucursal,
		TipoCbte: trim(row.Tipo_Cbte),
		TipoNombre: trim(row.TipoNombre),
		GrupoCbte: row.Grupo_Cbte,
		LetraCbte: trim(row.Letra_Cbte),
		NroCbte: row.NroCbte,
		IdDeposito: row.IdDeposito,
		DepositoNombre: trim(row.DepositoNombre),
		IdDepositoDest: row.IdDepositoDest,
		DepositoDestNombre: trim(row.DepositoDestNombre),
		Fecha: row.Fecha,
		Hora: trim(row.Hora),
		Sentido: trim(row.Sentido),
		IdTransaccionOrig: row.IdTransaccionOrig || null,
		Bultos: row.Bultos,
		IdStatus: row.IdStatus,
		StatusNombre: trim(row.StatusNombre),
		ImportePPP: row.ImportePPP != null ? Number(row.ImportePPP) : null,
		ImporteCosto: row.ImporteCosto != null ? Number(row.ImporteCosto) : null,
		IdCliente: row.IdCliente,
		ClienteNombre: trim(row.ClienteNombre),
		IdProveedor: row.IdProveedor,
		ProveedorNombre: trim(row.ProveedorNombre),
		Observaciones: trim(row.Observaciones),
		NroRemitoFmt: formatNro(row.Grupo_Cbte, row.Letra_Cbte, row.NroCbte),
	};
}

function formatNro(grupo, letra, nro) {
	const g = String(grupo ?? 0).padStart(4, '0');
	const l = trim(letra) || 'X';
	const n = String(nro ?? 0).padStart(8, '0');
	return `${g}-${l}-${n}`;
}

function mapItem(row) {
	return {
		IdTransaccion: row.IdTransaccion,
		Renglon: row.Renglon,
		IdProducto: row.IdProducto,
		DescripcionProducto: trim(row.DescripcionProducto) || trim(row.ProductoDesc),
		Cantidad: row.Cantidad != null ? Number(row.Cantidad) : 0,
		IdUnidad: trim(row.IdUnidad),
		ImporteUnitario: row.ImporteUnitario != null ? Number(row.ImporteUnitario) : 0,
		ImporteTotal: row.ImporteTotal != null ? Number(row.ImporteTotal) : 0,
		IdPaciente: row.IdPaciente,
		PacienteNombre: trim(row.PacienteNombre) || null,
		Cama: trim(row.Cama) || null,
		ValorSector: trim(row.ValorSector) || null,
		ObraSocial: trim(row.ObraSocial) || null,
		IdTipo: trim(row.IdTipo),
		Sentido: trim(row.Sentido),
		IdDeposito: row.IdDeposito,
		NroIndicacion: row.NroIndicacion != null ? Number(row.NroIndicacion) : null,
	};
}

/** HH:mm del remito: Transacciones.Hora_D (grabado web); si no, la auditoría del mismo día. Requiere alias r y tx. */
const SQL_HORA = `CONVERT(char(5), COALESCE(tx.Hora_D,
  CASE WHEN CAST(r.Aud_Fecha_Date AS date) = CAST(r.Fecha AS date) THEN r.Aud_Fecha_Date END), 108)`;

/** Tipos operativos del modal (entrada / salida servicio / salida paciente). */
const TIPOS_OPERATIVOS = new Set(['REM', 'RSM', 'RSP']);

function camposSegunTipo(t) {
	if (!t) return { usaProveedor: false, usaDepDestino: false, usaCliente: false };
	const sentido = String(t.Sentido || '').toUpperCase();
	const usaProv = Number(t.UsaProveedor) === 1;
	const usaCli = Number(t.UsaCliente) === 1;
	const usaDep = Number(t.UsaDepOrigDest) === 1;
	// Entrada (REM / RIM): Clarion muestra Proveedor
	if (sentido === 'E' || usaProv) {
		return { usaProveedor: true, usaDepDestino: false, usaCliente: false };
	}
	// Salida a paciente
	if (usaCli) {
		return { usaProveedor: false, usaDepDestino: false, usaCliente: true };
	}
	// Salida a servicio / depósito destino
	if (usaDep || sentido === 'S') {
		return { usaProveedor: false, usaDepDestino: true, usaCliente: false };
	}
	return { usaProveedor: false, usaDepDestino: false, usaCliente: false };
}

async function listarTipos({ soloOperativos = false } = {}) {
	const rows = await executeQuery(
		`
    SELECT RTRIM(IdTipo) AS IdTipo, RTRIM(Descripcion) AS Descripcion, RTRIM(Sentido) AS Sentido,
           Usa_Proveedor, Usa_Cliente, Usa_Dep_Orig_Dest, IdStatus, stk_Fisico,
           RTRIM(IdTipo_Generar) AS IdTipo_Generar
    FROM dbo.Tipos_Remitos
    ORDER BY Descripcion
    `,
	);
	return rows
		.map((r) => {
			const base = {
				IdTipo: trim(r.IdTipo),
				Descripcion: trim(r.Descripcion),
				Sentido: trim(r.Sentido),
				UsaProveedor: r.Usa_Proveedor,
				UsaCliente: r.Usa_Cliente,
				UsaDepOrigDest: r.Usa_Dep_Orig_Dest,
				IdStatus: r.IdStatus,
				StkFisico: r.stk_Fisico,
				IdTipoGenerar: trim(r.IdTipo_Generar),
			};
			return { ...base, ...camposSegunTipo(base) };
		})
		.filter((t) => !soloOperativos || TIPOS_OPERATIVOS.has(t.IdTipo));
}

async function listarDepositos() {
	const rows = await executeQuery(
		`
    SELECT
      d.IdDeposito,
      RTRIM(d.Descripcion) AS Descripcion,
      d.IdEmpresa,
      d.IdSucursal,
      RTRIM(d.IdSector) AS IdSector,
      RTRIM(s.Descripcion) AS SectorNombre
    FROM dbo.Depositos d WITH (NOLOCK)
    LEFT JOIN dbo.imSectores s WITH (NOLOCK)
      ON RTRIM(s.Valor) = RTRIM(d.IdSector)
    ORDER BY RTRIM(d.Descripcion), d.IdDeposito
    `,
	);
	return rows.map((r) => {
		const descripcion = trim(r.Descripcion);
		const sectorNombre = trim(r.SectorNombre);
		const idSector = trim(r.IdSector);
		return {
			IdDeposito: r.IdDeposito,
			Descripcion: descripcion,
			IdEmpresa: r.IdEmpresa,
			IdSucursal: r.IdSucursal,
			IdSector: idSector,
			SectorNombre: sectorNombre,
			/** Etiqueta Clarion: descripción + sector cuando hace falta distinguir duplicados. */
			Label:
				sectorNombre && sectorNombre.toUpperCase() !== (descripcion || '').toUpperCase()
					? `${descripcion} — ${sectorNombre}`
					: descripcion || String(r.IdDeposito),
		};
	});
}

/**
 * Medicación/descartables (imInterTipoIndicacion.Tipo = 'M') de internaciones
 * activas en el sector del depósito destino — para remito RSM.
 * Sin FechaExpiro, no ExcluidoDeEntrega; cantidad = iim.Cantidad (total del día).
 */
async function listarCandidatosSalidaServicio({
	idDepositoDest = null,
	valorSector = null,
	fecha = null,
} = {}) {
	let sector = trim(valorSector);
	const idDep = idDepositoDest != null && idDepositoDest !== '' ? Number(idDepositoDest) : null;

	if ((!sector || !sector.length) && Number.isFinite(idDep)) {
		const depRows = await executeQuery(
			`
      SELECT TOP 1 RTRIM(IdSector) AS IdSector, RTRIM(Descripcion) AS Descripcion
      FROM dbo.Depositos WHERE IdDeposito = @p0
      `,
			[{ value: idDep, type: 'SmallInt' }],
		);
		sector = trim(depRows?.[0]?.IdSector);
		if (!sector) {
			throw httpError(
				`El depósito destino ${idDep} no tiene IdSector; no se pueden armar candidatos de internación`,
			);
		}
	}
	if (!sector) {
		throw httpError('Indicá depósito destino (con IdSector) o valorSector');
	}

	const fechaIso = trim(fecha) || require('../utils/dateUtils').fechaCalendarioArgentina();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) {
		throw httpError('fecha debe ser YYYY-MM-DD');
	}
	const fechaClarion = convertirFechaAClarion(fechaIso);

	const rows = await executeQuery(
		`
    ;WITH VisitasSector AS (
      SELECT DISTINCT
        TRY_CAST(hc.NumeroVisita AS int) AS NumeroVisita,
        LTRIM(RTRIM(hc.ValorSector)) AS ValorSector,
        LTRIM(RTRIM(hc.ValorHabitacionCama)) AS Cama
      FROM dbo.imHabitacionCamas hc
      INNER JOIN dbo.imVisita v ON v.NumeroVisita = hc.NumeroVisita
      WHERE LTRIM(RTRIM(hc.ValorSector)) = @p0
        AND TRY_CAST(hc.NumeroVisita AS int) > 0
        AND UPPER(LTRIM(RTRIM(ISNULL(v.ClasePaciente, '')))) = 'I'
        AND (v.FECHAEGRESO IS NULL OR TRY_CAST(v.FECHAEGRESO AS int) = 0)
    )
    SELECT
      iim.NroIndicacion,
      iim.NumeroVisita,
      iim.Codigo,
      iim.Cantidad,
      iim.CantidadIndicada,
      iim.CantidadEntregada,
      iim.Frecuencia,
      iim.TipoUnidad,
      iim.AliasMedicamento,
      RTRIM(iim.Observaciones) AS Observaciones,
      iim.ParaFechaEntrega,
      RTRIM(iim.IdSector) AS IdSectorInd,
      vs.Cama,
      vs.ValorSector,
      v.IDPaciente AS IdPaciente,
      RTRIM(pac.ApellidoyNombre) AS PacienteNombre,
      RTRIM(cli.RazonSocial) AS ObraSocial,
      RTRIM(tit.Descripcion) AS TipoIndicacionDescripcion,
      COALESCE(vadem.Alias, vadem.Descripcion, iim.AliasMedicamento) AS DescripcionMedicacion,
      p.IdProducto,
      RTRIM(COALESCE(NULLIF(RTRIM(p.Descripcion), ''), NULLIF(RTRIM(p.DescripcionC), ''),
        COALESCE(vadem.Alias, vadem.Descripcion, iim.AliasMedicamento))) AS DescripcionProducto,
      RTRIM(p.IdUnidad) AS IdUnidadProducto,
      p.PrecioVenta
    FROM dbo.imInterIndMedicas iim WITH (NOLOCK)
    INNER JOIN VisitasSector vs ON vs.NumeroVisita = iim.NumeroVisita
    INNER JOIN dbo.imInterTipoIndicacion tit WITH (NOLOCK)
      ON tit.Valor = iim.TipoIndicacion AND UPPER(LTRIM(RTRIM(tit.Tipo))) = 'M'
    INNER JOIN dbo.imVisita v WITH (NOLOCK) ON v.NumeroVisita = iim.NumeroVisita
    LEFT JOIN dbo.imPacientes pac WITH (NOLOCK) ON pac.IDPaciente = v.IDPaciente
    LEFT JOIN dbo.imClientes cli WITH (NOLOCK) ON cli.Valor = v.CLIENTE
    LEFT JOIN dbo.imVademecum vadem WITH (NOLOCK)
      ON vadem.Troquel = iim.Codigo AND TRY_CAST(iim.Codigo AS int) > 0
    OUTER APPLY (
      -- Solo IdProducto=Codigo (como Clarion). NUNCA Cod_Alternativo:
      -- es troquel/proveedor y colisiona masivo (ej. Codigo=0 → cientos de productos
      -- con CodAlt='0' → TOP 1 IdProducto=4 MEROPENEM; o CodAlt=1057 TRIFAMOX→AGUJA).
      SELECT TOP 1 pr.IdProducto, pr.Descripcion, pr.DescripcionC, pr.IdUnidad, pr.PrecioVenta
      FROM dbo.Productos pr WITH (NOLOCK)
      WHERE iim.Codigo IS NOT NULL
        AND TRY_CAST(iim.Codigo AS int) > 0
        AND pr.IdProducto = iim.Codigo
    ) p
    WHERE ISNULL(iim.NroAdicional, 0) = 0
      AND ISNULL(TRY_CAST(iim.FechaExpiro AS int), 0) = 0
      AND ISNULL(iim.ExcluidoDeEntrega, 0) = 0
      AND TRY_CAST(iim.FechaCarga AS int) = @p1
      -- Solo lo que falta entregar (Clarion arma el remito con el pendiente, no el total del día).
      AND ISNULL(TRY_CAST(iim.Cantidad AS float), 0) > ISNULL(TRY_CAST(iim.CantidadEntregada AS float), 0)
    ORDER BY pac.ApellidoyNombre, iim.NroIndicacion
    `,
		[
			{ value: sector, type: 'NVarChar', length: 20 },
			{ value: fechaClarion, type: 'Int' },
		],
	);

	const lineas = (rows || [])
		.map((r) => {
			const cantidad = Number(r.Cantidad) || 0;
			const entregada = Number(r.CantidadEntregada) || 0;
			const pendiente = Math.max(0, cantidad - entregada);
			const unitario = Number(r.PrecioVenta);
			return {
				NroIndicacion: r.NroIndicacion,
				NumeroVisita: r.NumeroVisita,
				IdPaciente: r.IdPaciente,
				PacienteNombre: trim(r.PacienteNombre),
				Cama: trim(r.Cama),
				ValorSector: trim(r.ValorSector),
				ObraSocial: trim(r.ObraSocial),
				Codigo: r.Codigo,
				IdProducto: r.IdProducto != null ? Number(r.IdProducto) : null,
				DescripcionProducto:
					trim(r.DescripcionProducto) ||
					trim(r.DescripcionMedicacion) ||
					trim(r.AliasMedicamento) ||
					trim(r.Observaciones) ||
					(Number(r.Codigo) > 0 ? `Código ${r.Codigo}` : 'Sin medicamento'),
				Frecuencia: trim(r.Frecuencia),
				TipoIndicacionDescripcion: trim(r.TipoIndicacionDescripcion),
				Cantidad: cantidad,
				CantidadEntregada: entregada,
				CantidadPendiente: pendiente,
				CantidadSugerida: pendiente,
				ImporteUnitario: Number.isFinite(unitario) ? unitario : 0,
				IdUnidad: trim(r.IdUnidadProducto) || trim(r.TipoUnidad),
				ParaFechaEntrega: r.ParaFechaEntrega || null,
				sinProducto: r.IdProducto == null,
			};
		})
		.filter((l) => l.CantidadPendiente > 0);

	return {
		valorSector: sector,
		idDepositoDest: Number.isFinite(idDep) ? idDep : null,
		fecha: fechaIso,
		visitas: new Set(lineas.map((l) => l.NumeroVisita)).size,
		lineas,
	};
}

/**
 * Resumen por servicio/sector: medicación Tipo M pendiente de entregar hoy
 * (mismo criterio que listarCandidatosSalidaServicio).
 */
async function resumenMedicacionPendienteServicios({ fecha = null } = {}) {
	const fechaIso = trim(fecha) || require('../utils/dateUtils').fechaCalendarioArgentina();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) {
		throw httpError('fecha debe ser YYYY-MM-DD');
	}
	const fechaClarion = convertirFechaAClarion(fechaIso);

	const rows = await executeQuery(
		`
    ;WITH VisitasActivas AS (
      SELECT DISTINCT
        TRY_CAST(hc.NumeroVisita AS int) AS NumeroVisita,
        LTRIM(RTRIM(hc.ValorSector)) AS ValorSector
      FROM dbo.imHabitacionCamas hc WITH (NOLOCK)
      INNER JOIN dbo.imVisita v WITH (NOLOCK) ON v.NumeroVisita = hc.NumeroVisita
      WHERE TRY_CAST(hc.NumeroVisita AS int) > 0
        AND LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) <> ''
        AND UPPER(LTRIM(RTRIM(ISNULL(v.ClasePaciente, '')))) = 'I'
        AND (v.FECHAEGRESO IS NULL OR TRY_CAST(v.FECHAEGRESO AS int) = 0)
    ),
    Pendientes AS (
      SELECT
        vs.ValorSector,
        COUNT_BIG(*) AS Lineas,
        COUNT(DISTINCT iim.NumeroVisita) AS Visitas,
        COUNT(DISTINCT v.IDPaciente) AS Pacientes
      FROM dbo.imInterIndMedicas iim WITH (NOLOCK)
      INNER JOIN VisitasActivas vs ON vs.NumeroVisita = iim.NumeroVisita
      INNER JOIN dbo.imInterTipoIndicacion tit WITH (NOLOCK)
        ON tit.Valor = iim.TipoIndicacion AND UPPER(LTRIM(RTRIM(tit.Tipo))) = 'M'
      INNER JOIN dbo.imVisita v WITH (NOLOCK) ON v.NumeroVisita = iim.NumeroVisita
      WHERE ISNULL(iim.NroAdicional, 0) = 0
        AND ISNULL(TRY_CAST(iim.FechaExpiro AS int), 0) = 0
        AND ISNULL(iim.ExcluidoDeEntrega, 0) = 0
        AND TRY_CAST(iim.FechaCarga AS int) = @p0
        AND ISNULL(TRY_CAST(iim.Cantidad AS float), 0) > ISNULL(TRY_CAST(iim.CantidadEntregada AS float), 0)
      GROUP BY vs.ValorSector
    )
    SELECT
      p.ValorSector,
      RTRIM(s.Descripcion) AS SectorNombre,
      dep.IdDeposito,
      RTRIM(dep.Descripcion) AS DepositoNombre,
      CAST(p.Lineas AS int) AS Lineas,
      CAST(p.Visitas AS int) AS Visitas,
      CAST(p.Pacientes AS int) AS Pacientes
    FROM Pendientes p
    LEFT JOIN dbo.imSectores s WITH (NOLOCK)
      ON RTRIM(s.Valor) = p.ValorSector
    OUTER APPLY (
      SELECT TOP 1 d.IdDeposito, d.Descripcion
      FROM dbo.Depositos d WITH (NOLOCK)
      WHERE RTRIM(ISNULL(d.IdSector, '')) = p.ValorSector
      ORDER BY d.IdDeposito
    ) dep
    ORDER BY p.Lineas DESC, p.ValorSector
    `,
		[{ value: fechaClarion, type: 'Int' }],
	);

	const servicios = (rows || []).map((r) => ({
		ValorSector: trim(r.ValorSector),
		SectorNombre: trim(r.SectorNombre) || trim(r.ValorSector),
		IdDeposito: r.IdDeposito != null ? Number(r.IdDeposito) : null,
		DepositoNombre: trim(r.DepositoNombre),
		Lineas: Number(r.Lineas) || 0,
		Visitas: Number(r.Visitas) || 0,
		Pacientes: Number(r.Pacientes) || 0,
	}));

	return {
		fecha: fechaIso,
		totalServicios: servicios.length,
		totalLineas: servicios.reduce((acc, s) => acc + s.Lineas, 0),
		totalVisitas: servicios.reduce((acc, s) => acc + s.Visitas, 0),
		servicios,
	};
}

async function excluirIndicacionDeEntrega(nroIndicacion) {
	const nro = Number(nroIndicacion);
	if (!Number.isFinite(nro) || nro <= 0) throw httpError('NroIndicacion inválido');
	const rows = await executeQuery(
		`
    SELECT TOP 1 NroIndicacion, ExcluidoDeEntrega
    FROM dbo.imInterIndMedicas
    WHERE NroIndicacion = @p0 AND ISNULL(NroAdicional, 0) = 0
    `,
		[{ value: nro, type: 'Int' }],
	);
	if (!rows.length) throw httpError('Indicación no encontrada', 404);
	await executeQuery(
		`
    UPDATE dbo.imInterIndMedicas
    SET ExcluidoDeEntrega = 1
    WHERE NroIndicacion = @p0
    `,
		[{ value: nro, type: 'Int' }],
	);
	return { ok: true, NroIndicacion: nro, ExcluidoDeEntrega: 1 };
}

async function listarProveedores({ search = '', limit = 80 } = {}) {
	const params = [];
	let where = '1=1';
	const q = trim(search);
	if (q) {
		if (/^\d+$/.test(q)) {
			where += ` AND p.IDPROVEEDOR = @p${params.length}`;
			params.push({ value: Number(q), type: 'Int' });
		} else {
			where += ` AND RTRIM(ISNULL(p.DESCRIPCION,'')) LIKE @p${params.length}`;
			params.push({ value: `%${q}%`, type: 'NVarChar', length: 120 });
		}
	}
	params.push({ value: Math.min(1000, Math.max(1, Number(limit) || 80)), type: 'Int' });
	const rows = await executeQuery(
		`
    SELECT TOP (@p${params.length - 1})
      p.IDPROVEEDOR AS IdProveedor,
      RTRIM(p.DESCRIPCION) AS Descripcion
    FROM dbo.PROVEEDORES p
    WHERE ${where}
    ORDER BY p.DESCRIPCION
    `,
		params,
	);
	return rows.map((r) => ({
		IdProveedor: r.IdProveedor,
		Descripcion: trim(r.Descripcion),
	}));
}

async function listarClientes({ search = '', limit = 40 } = {}) {
	const q = trim(search);
	if (!q || q.length < 2) return [];
	const params = [];
	let where;
	if (/^\d+$/.test(q)) {
		where = `c.IdCliente = @p0`;
		params.push({ value: Number(q), type: 'Int' });
	} else {
		where = `(RTRIM(ISNULL(c.Razon_Social,'')) LIKE @p0 OR RTRIM(ISNULL(c.Apellidos,'')) LIKE @p0 OR RTRIM(ISNULL(c.Nombres,'')) LIKE @p0)`;
		params.push({ value: `%${q}%`, type: 'NVarChar', length: 120 });
	}
	params.push({ value: Math.min(80, Math.max(1, Number(limit) || 40)), type: 'Int' });
	const rows = await executeQuery(
		`
    SELECT TOP (@p${params.length - 1})
      c.IdCliente,
      RTRIM(COALESCE(NULLIF(RTRIM(c.Razon_Social),''), LTRIM(RTRIM(ISNULL(c.Apellidos,'')) + ' ' + RTRIM(ISNULL(c.Nombres,''))))) AS Descripcion
    FROM dbo.Clientes c
    WHERE ${where}
    ORDER BY 2
    `,
		params,
	);
	return rows.map((r) => ({
		IdCliente: r.IdCliente,
		Descripcion: trim(r.Descripcion),
	}));
}

/** RemitosItems.IdPaciente → dbo.imPacientes */
async function listarPacientes({ search = '', limit = 40 } = {}) {
	const q = trim(search);
	if (!q) return [];
	const params = [];
	let where;
	if (/^\d+$/.test(q)) {
		where = `p.IdPaciente = @p0 OR RTRIM(ISNULL(p.NumeroDocumento,'')) LIKE @p1`;
		params.push({ value: Number(q), type: 'Int' });
		params.push({ value: `%${q}%`, type: 'NVarChar', length: 40 });
	} else {
		where = `RTRIM(ISNULL(p.ApellidoyNombre,'')) LIKE @p0 OR RTRIM(ISNULL(p.NumeroDocumento,'')) LIKE @p0`;
		params.push({ value: `%${q}%`, type: 'NVarChar', length: 120 });
	}
	params.push({ value: Math.min(80, Math.max(1, Number(limit) || 40)), type: 'Int' });
	const rows = await executeQuery(
		`
    SELECT TOP (@p${params.length - 1})
      p.IdPaciente,
      RTRIM(p.ApellidoyNombre) AS Descripcion,
      RTRIM(p.NumeroDocumento) AS Documento
    FROM dbo.imPacientes p
    WHERE ${where}
    ORDER BY p.ApellidoyNombre
    `,
		params,
	);
	return rows.map((r) => ({
		IdPaciente: r.IdPaciente,
		Descripcion: trim(r.Descripcion),
		Documento: trim(r.Documento),
	}));
}

async function listar({
	search = '',
	tipo = '',
	idDeposito = null,
	desde = null,
	hasta = null,
	sentido = '',
	estado = '',
	page = 1,
	pageSize = 30,
} = {}) {
	const p = Math.max(1, Number(page) || 1);
	const size = Math.min(100, Math.max(1, Number(pageSize) || 30));
	const offset = (p - 1) * size;
	const params = [];
	const where = ['1=1'];

	const estadoNum = estado !== '' && estado != null ? Number(estado) : NaN;
	if (Number.isFinite(estadoNum)) {
		where.push(`r.IdStatus = @p${params.length}`);
		params.push({ value: estadoNum, type: 'SmallInt' });
	}
	if (trim(tipo)) {
		where.push(`r.Tipo_Cbte = @p${params.length}`);
		params.push({ value: trim(tipo).slice(0, 3), type: 'Char', length: 3 });
	}
	if (idDeposito != null && idDeposito !== '') {
		where.push(`r.IdDeposito = @p${params.length}`);
		params.push({ value: Number(idDeposito), type: 'SmallInt' });
	}
	if (desde) {
		where.push(`r.Fecha >= @p${params.length}`);
		params.push({ value: new Date(desde), type: 'DateTime' });
	}
	if (hasta) {
		where.push(`r.Fecha < DATEADD(day, 1, @p${params.length})`);
		params.push({ value: new Date(hasta), type: 'DateTime' });
	}
	const q = trim(search);
	if (q) {
		if (/^\d+$/.test(q)) {
			where.push(`(r.IdTransaccion = @p${params.length} OR r.NroCbte = @p${params.length})`);
			params.push({ value: Number(q), type: 'Int' });
		} else {
			where.push(`(
        RTRIM(ISNULL(t.Descripcion,'')) LIKE @p${params.length}
        OR RTRIM(ISNULL(d.Descripcion,'')) LIKE @p${params.length}
        OR RTRIM(ISNULL(r.Tipo_Cbte,'')) LIKE @p${params.length}
      )`);
			params.push({ value: `%${q}%`, type: 'NVarChar', length: 120 });
		}
	}

	// Los totales ignoran el filtro de sentido para mostrar entradas y salidas a la vez.
	const whereTotales = [...where];
	if (!Number.isFinite(estadoNum)) whereTotales.push(`r.IdStatus <> ${grab.STATUS_ANULADO}`);
	const paramsTotales = [...params];

	const sent = (trim(sentido) || '').toUpperCase().slice(0, 1);
	if (sent === 'E' || sent === 'S') {
		where.push(`t.Sentido = @p${params.length}`);
		params.push({ value: sent, type: 'Char', length: 1 });
	}

	const whereSql = where.join(' AND ');
	const hasFilters =
		!!trim(tipo) ||
		(idDeposito != null && idDeposito !== '') ||
		!!desde ||
		!!hasta ||
		!!q ||
		!!sent ||
		Number.isFinite(estadoNum);
	const needsCatalogJoin = !!(q && !/^\d+$/.test(q)) || !!sent;

	// Totales, COUNT y página no se necesitan entre sí: van en paralelo.
	let countSql;
	let countParams = [];
	if (!hasFilters) {
		// ~instantáneo; evita COUNT bloqueado sobre 100k+ filas en Clarion/Vidal.
		countSql = `
      SELECT SUM(p.rows) AS n
      FROM sys.partitions p
      INNER JOIN sys.tables t ON t.object_id = p.object_id
      WHERE t.name = 'Remitos' AND p.index_id IN (0, 1)
      `;
	} else if (needsCatalogJoin) {
		countSql = `
      SELECT COUNT(1) AS n
      FROM dbo.Remitos r WITH (NOLOCK)
      LEFT JOIN dbo.Tipos_Remitos t WITH (NOLOCK) ON t.IdTipo = r.Tipo_Cbte
      LEFT JOIN dbo.Depositos d WITH (NOLOCK) ON d.IdDeposito = r.IdDeposito
      WHERE ${whereSql}
      `;
		countParams = params;
	} else {
		countSql = `SELECT COUNT(1) AS n FROM dbo.Remitos r WITH (NOLOCK) WHERE ${whereSql}`;
		countParams = params;
	}

	const pageParams = [...params, { value: offset, type: 'Int' }, { value: size, type: 'Int' }];
	const [totalesRows, countRows, rows] = await Promise.all([
		executeQuery(
			`
    SELECT RTRIM(t.Sentido) AS Sentido, COUNT(1) AS Cantidad,
           SUM(ISNULL(r.ImportePPP, 0)) AS Importe, SUM(ISNULL(r.Bultos, 0)) AS Bultos
    FROM dbo.Remitos r WITH (NOLOCK)
    LEFT JOIN dbo.Tipos_Remitos t WITH (NOLOCK) ON t.IdTipo = r.Tipo_Cbte
    LEFT JOIN dbo.Depositos d WITH (NOLOCK) ON d.IdDeposito = r.IdDeposito
    WHERE ${whereTotales.join(' AND ')}
    GROUP BY RTRIM(t.Sentido)
    `,
			paramsTotales,
		),
		executeQuery(countSql, countParams),
		executeQuery(
			`
    SELECT
      r.IdTransaccion, r.IdEmpresa, r.IdSucursal, r.Tipo_Cbte, r.Grupo_Cbte, r.Letra_Cbte, r.NroCbte,
      r.IdDeposito, r.IdDepositoDest, r.Fecha, r.Bultos, r.IdStatus, r.ImportePPP, r.ImporteCosto,
      r.IdCliente, r.IdProveedor, r.IdTransaccionOrig,
      ${SQL_HORA} AS Hora,
      RTRIM(t.Sentido) AS Sentido,
      RTRIM(t.Descripcion) AS TipoNombre,
      RTRIM(d.Descripcion) AS DepositoNombre,
      RTRIM(dd.Descripcion) AS DepositoDestNombre,
      RTRIM(pv.DESCRIPCION) AS ProveedorNombre,
      RTRIM(COALESCE(NULLIF(RTRIM(cl.Razon_Social),''), LTRIM(RTRIM(ISNULL(cl.Apellidos,'')) + ' ' + RTRIM(ISNULL(cl.Nombres,''))))) AS ClienteNombre,
      RTRIM(st.Descripcion) AS StatusNombre,
      RTRIM(obs.Comentarios) AS Observaciones
    FROM dbo.Remitos r WITH (NOLOCK)
    LEFT JOIN dbo.Transacciones tx WITH (NOLOCK) ON tx.IdTransaccion = r.IdTransaccion
    LEFT JOIN dbo.Tipos_Remitos t WITH (NOLOCK) ON t.IdTipo = r.Tipo_Cbte
    LEFT JOIN dbo.Depositos d WITH (NOLOCK) ON d.IdDeposito = r.IdDeposito
    LEFT JOIN dbo.Depositos dd WITH (NOLOCK) ON dd.IdDeposito = r.IdDepositoDest
    LEFT JOIN dbo.PROVEEDORES pv WITH (NOLOCK) ON pv.IDPROVEEDOR = r.IdProveedor
    LEFT JOIN dbo.Clientes cl WITH (NOLOCK) ON cl.IdCliente = r.IdCliente
    LEFT JOIN dbo.Status_Remitos st WITH (NOLOCK) ON st.IdStatus = r.IdStatus
    OUTER APPLY (
      SELECT TOP 1 o.Comentarios
      FROM dbo.Remitos_Observa o WITH (NOLOCK)
      WHERE o.IdTransaccion = r.IdTransaccion
        AND NULLIF(RTRIM(o.Comentarios), '') IS NOT NULL
      ORDER BY o.Item
    ) obs
    WHERE ${whereSql}
    ORDER BY r.IdTransaccion DESC
    OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
    `,
			pageParams,
		),
	]);

	const totalSentido = (s) => {
		const row = totalesRows.find((x) => trim(x.Sentido) === s);
		return {
			cantidad: Number(row?.Cantidad || 0),
			importe: Number(row?.Importe || 0),
			bultos: Number(row?.Bultos || 0),
		};
	};
	const entradas = totalSentido('E');
	const salidas = totalSentido('S');
	const total = Number(countRows[0]?.n || 0);

	return {
		items: rows.map(mapRemito),
		total,
		page: p,
		pageSize: size,
		totalPages: Math.max(1, Math.ceil(total / size)),
		totales: {
			entradas,
			salidas,
			neto: { importe: entradas.importe - salidas.importe, cantidad: entradas.cantidad + salidas.cantidad },
		},
	};
}

async function obtener(id) {
	const rows = await executeQuery(
		`
    SELECT TOP 1
      r.IdTransaccion, r.IdEmpresa, r.IdSucursal, r.Tipo_Cbte, r.Grupo_Cbte, r.Letra_Cbte, r.NroCbte,
      r.IdDeposito, r.IdDepositoDest, r.Fecha, r.Bultos, r.IdStatus, r.ImportePPP, r.ImporteCosto,
      r.IdCliente, r.IdProveedor, r.IdTransaccionOrig,
      ${SQL_HORA} AS Hora,
      RTRIM(t.Sentido) AS Sentido,
      RTRIM(t.Descripcion) AS TipoNombre,
      RTRIM(d.Descripcion) AS DepositoNombre,
      RTRIM(dd.Descripcion) AS DepositoDestNombre,
      RTRIM(pv.DESCRIPCION) AS ProveedorNombre,
      RTRIM(COALESCE(NULLIF(RTRIM(cl.Razon_Social),''), LTRIM(RTRIM(ISNULL(cl.Apellidos,'')) + ' ' + RTRIM(ISNULL(cl.Nombres,''))))) AS ClienteNombre,
      RTRIM(st.Descripcion) AS StatusNombre
    FROM dbo.Remitos r
    LEFT JOIN dbo.Transacciones tx ON tx.IdTransaccion = r.IdTransaccion
    LEFT JOIN dbo.Tipos_Remitos t ON t.IdTipo = r.Tipo_Cbte
    LEFT JOIN dbo.Depositos d ON d.IdDeposito = r.IdDeposito
    LEFT JOIN dbo.Depositos dd ON dd.IdDeposito = r.IdDepositoDest
    LEFT JOIN dbo.PROVEEDORES pv ON pv.IDPROVEEDOR = r.IdProveedor
    LEFT JOIN dbo.Clientes cl ON cl.IdCliente = r.IdCliente
    LEFT JOIN dbo.Status_Remitos st ON st.IdStatus = r.IdStatus
    WHERE r.IdTransaccion = @p0
    `,
		[{ value: Number(id), type: 'Int' }],
	);
	if (!rows.length) throw httpError('Remito no encontrado', 404);

	const items = await executeQuery(
		`
    SELECT
      i.IdTransaccion, i.Renglon, i.IdProducto, i.DescripcionProducto, i.Cantidad,
      i.ImporteUnitario, i.ImporteTotal, i.IdPaciente, i.IdTipo, i.Sentido, i.IdDeposito,
      i.NroIndicacion,
      RTRIM(COALESCE(NULLIF(RTRIM(p.Descripcion),''), NULLIF(RTRIM(p.DescripcionC),''))) AS ProductoDesc,
      RTRIM(p.IdUnidad) AS IdUnidad,
      RTRIM(pac.ApellidoyNombre) AS PacienteNombre,
      ubi.Cama,
      ubi.ValorSector,
      ubi.ObraSocial
    FROM dbo.RemitosItems i
    LEFT JOIN dbo.Productos p ON p.IdProducto = i.IdProducto
    LEFT JOIN dbo.imPacientes pac WITH (NOLOCK) ON pac.IDPaciente = i.IdPaciente
    OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(hc.ValorHabitacionCama)) AS Cama,
        LTRIM(RTRIM(hc.ValorSector)) AS ValorSector,
        RTRIM(cli.RazonSocial) AS ObraSocial
      FROM dbo.imInterIndMedicas iim WITH (NOLOCK)
      INNER JOIN dbo.imVisita v WITH (NOLOCK) ON v.NumeroVisita = iim.NumeroVisita
      LEFT JOIN dbo.imHabitacionCamas hc WITH (NOLOCK) ON hc.NumeroVisita = iim.NumeroVisita
      LEFT JOIN dbo.imClientes cli WITH (NOLOCK) ON cli.Valor = v.CLIENTE
      WHERE i.NroIndicacion IS NOT NULL
        AND i.NroIndicacion > 0
        AND iim.NroIndicacion = i.NroIndicacion
    ) ubi
    WHERE i.IdTransaccion = @p0
    ORDER BY i.Renglon
    `,
		[{ value: Number(id), type: 'Int' }],
	);

	const obs = await executeQuery(
		`
    SELECT Item, Fecha, Comentarios
    FROM dbo.Remitos_Observa
    WHERE IdTransaccion = @p0
    ORDER BY Item
    `,
		[{ value: Number(id), type: 'Int' }],
	).catch(() => []);

	const vinculados = await executeQuery(
		`
    SELECT r.IdTransaccion, r.Tipo_Cbte, r.Grupo_Cbte, r.Letra_Cbte, r.NroCbte, r.IdStatus
    FROM dbo.Remitos r WITH (NOLOCK)
    WHERE (r.IdTransaccionOrig = @p0 AND r.IdTransaccion <> @p0)
       OR (r.IdTransaccion = @p1 AND @p1 > 0)
    `,
		[
			{ value: Number(id), type: 'Int' },
			{ value: Number(rows[0].IdTransaccionOrig) || 0, type: 'Int' },
		],
	).catch(() => []);
	const vinculo = (row) =>
		row
			? {
					IdTransaccion: row.IdTransaccion,
					TipoCbte: trim(row.Tipo_Cbte),
					NroRemitoFmt: formatNro(row.Grupo_Cbte, row.Letra_Cbte, row.NroCbte),
					IdStatus: row.IdStatus,
				}
			: null;
	const origen = Number(rows[0].IdTransaccionOrig) || 0;

	const cabecera = mapRemito(rows[0]);
	const mappedItems = items.map(mapItem);
	const totalRemito = mappedItems.reduce((acc, it) => acc + (Number(it.ImporteTotal) || 0), 0);

	return {
		...cabecera,
		RemitoOrigen: vinculo(vinculados.find((v) => v.IdTransaccion === origen)),
		RemitosGenerados: vinculados.filter((v) => v.IdTransaccion !== origen).map(vinculo),
		items: mappedItems,
		observaciones: obs.map((o) => ({
			Item: o.Item,
			Fecha: o.Fecha,
			Comentarios: trim(o.Comentarios),
		})),
		TotalRemito: totalRemito,
	};
}

const DEFAULT_EMPRESA = 1;
const DEFAULT_SUCURSAL = 1;
const LOTE_IN = 500;

function estadoDeTipo(tipoRow) {
	const n = Number(tipoRow?.IdStatus);
	return Number.isFinite(n) && n > 0 ? n : grab.STATUS_CONFIRMADO;
}

async function proximoNro(tipoCbte, grupo, { idEmpresa = DEFAULT_EMPRESA, idSucursal = DEFAULT_SUCURSAL } = {}) {
	const tipo = (trim(tipoCbte) || 'REM').slice(0, 3);
	const year =
		grupo != null && grupo !== '' ? Number(grupo) : Number(partesFechaHoraArgentina().fecha.slice(0, 4));
	const letra = 'X';
	const rows = await executeQuery(
		`
    SELECT
      (SELECT TOP 1 NroCbte FROM dbo.Cbtes_Numeracion
        WHERE IdEmpresa = @p2 AND IdSucursal = @p3 AND Tipo_Cbte = @p0 AND Grupo_Cbte = @p1 AND Letra_Cbte = @p4) AS Numeracion,
      (SELECT MAX(NroCbte) FROM dbo.Remitos
        WHERE Tipo_Cbte = @p0 AND IdEmpresa = @p2 AND IdSucursal = @p3 AND Grupo_Cbte = @p1 AND Letra_Cbte = @p4) AS MaxRemitos
    `,
		[
			{ value: tipo, type: 'Char', length: 3 },
			{ value: year, type: 'SmallInt' },
			{ value: idEmpresa, type: 'SmallInt' },
			{ value: idSucursal, type: 'SmallInt' },
			{ value: letra, type: 'Char', length: 1 },
		],
	);
	const actual = Math.max(Number(rows[0]?.Numeracion) || 0, Number(rows[0]?.MaxRemitos) || 0);
	return { tipo, grupo: year, letra, nro: actual + 1 };
}

/** Mensaje seguro para el usuario (nunca SQL crudo). */
function errorGuardado(err) {
	if (err && err.statusCode) return err;
	const raw = String(err?.message || '');
	console.error('[remitos.guardar]', raw);
	return httpError('No se pudo guardar el remito. Revisá los datos e intentá de nuevo.', 500);
}

/**
 * Remitos.Fecha va a las 00:00 como en Clarion; la hora viaja en Transacciones.Hora_D.
 * Ambos como hora de pared argentina (tedious serializa los campos UTC).
 */
function parseFechaHora(body) {
	const ahoraAr = partesFechaHoraArgentina();
	const rawFecha = trim(body.Fecha || body.fecha);
	const fechaIso = rawFecha ? rawFecha.slice(0, 10) : ahoraAr.fecha;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIso)) throw httpError('Fecha inválida');
	const rawHora = trim(body.Hora || body.hora) || ahoraAr.horaCorta;
	const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(rawHora);
	if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw httpError('Hora inválida');
	const hms = `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
	const fecha = new Date(`${fechaIso}T00:00:00Z`);
	const fechaHora = new Date(`${fechaIso}T${hms}Z`);
	if (Number.isNaN(fecha.getTime()) || Number.isNaN(fechaHora.getTime())) throw httpError('Fecha inválida');
	return { fechaIso, fecha, fechaHora };
}

async function buscarPorIds(sqlBase, ids, type) {
	const out = [];
	for (let i = 0; i < ids.length; i += LOTE_IN) {
		const lote = ids.slice(i, i + LOTE_IN);
		const marcas = lote.map((_, j) => `@p${j}`).join(',');
		const rows = await executeQuery(
			sqlBase.replace('{ids}', marcas),
			lote.map((value) => ({ value, type })),
		);
		out.push(...rows);
	}
	return out;
}

/** Valida body y resuelve ítems / campos según tipo. */
async function prepararDatos(body) {
	const tipo = (trim(body.TipoCbte || body.tipoCbte) || '').slice(0, 3);
	if (!tipo) throw httpError('Seleccioná el tipo de remito');
	const idDeposito = Number(body.IdDeposito ?? body.idDeposito);
	if (!Number.isFinite(idDeposito)) throw httpError('Seleccioná el depósito');

	const tipos = await listarTipos();
	const tipoRow = tipos.find((t) => t.IdTipo === tipo);
	if (!tipoRow) throw httpError('Tipo de remito inválido');

	const itemsIn = Array.isArray(body.items) ? body.items : [];
	if (!itemsIn.length) throw httpError('Agregá al menos un ítem');

	const { fechaIso, fecha, fechaHora } = parseFechaHora(body);
	const grupo = body.GrupoCbte != null && body.GrupoCbte !== '' ? Number(body.GrupoCbte) : Number(fechaIso.slice(0, 4));
	if (!Number.isFinite(grupo)) throw httpError('Grupo de comprobante inválido');
	const letra = (trim(body.LetraCbte) || 'X').slice(0, 1);

	const base = itemsIn.map((it, i) => {
		const idProd = Number(it.IdProducto ?? it.idProducto);
		if (!Number.isFinite(idProd)) throw httpError(`Ítem ${i + 1}: producto inválido`);
		const cant = Number(it.Cantidad ?? it.cantidad);
		if (!Number.isFinite(cant) || cant <= 0) throw httpError(`Ítem ${i + 1}: la cantidad debe ser mayor a 0`);
		if (!Number.isInteger(cant)) throw httpError(`Ítem ${i + 1}: la cantidad debe ser un número entero (sin decimales)`);
		const idPac = it.IdPaciente != null && it.IdPaciente !== '' ? Number(it.IdPaciente) : null;
		const nroIndRaw = it.NroIndicacion ?? it.nroIndicacion;
		const nroInd = nroIndRaw != null && nroIndRaw !== '' ? Number(nroIndRaw) : null;
		return { it, idProd, cant, idPac: Number.isFinite(idPac) ? idPac : null, nroInd };
	});

	const prods = await buscarPorIds(
		`
    SELECT p.IdProducto,
      RTRIM(COALESCE(NULLIF(RTRIM(p.Descripcion),''), NULLIF(RTRIM(p.DescripcionC),''))) AS Descripcion,
      RTRIM(p.IdUnidad) AS IdUnidad, p.PrecioVenta, COALESCE(p.Costo, p.PrecioCosto, 0) AS Costo
    FROM dbo.Productos p WHERE p.IdProducto IN ({ids})
    `,
		[...new Set(base.map((b) => b.idProd))],
		'Int',
	);
	const prodPorId = new Map(prods.map((p) => [Number(p.IdProducto), p]));

	const idsPac = [...new Set(base.map((b) => b.idPac).filter((x) => x != null))];
	if (idsPac.length) {
		const pacs = await buscarPorIds(
			`SELECT IdPaciente FROM dbo.imPacientes WHERE IdPaciente IN ({ids})`,
			idsPac,
			'Int',
		);
		const existentes = new Set(pacs.map((p) => Number(p.IdPaciente)));
		const falta = base.findIndex((b) => b.idPac != null && !existentes.has(b.idPac));
		if (falta >= 0) throw httpError(`Ítem ${falta + 1}: paciente ${base[falta].idPac} no existe`);
	}

	const items = [];
	let total = 0;
	let costo = 0;
	let bultos = 0;
	base.forEach(({ it, idProd, cant, idPac, nroInd }, i) => {
		const prod = prodPorId.get(idProd);
		if (!prod) throw httpError(`Ítem ${i + 1}: producto ${idProd} no existe en tabla Productos`);
		const unit =
			it.ImporteUnitario != null && it.ImporteUnitario !== ''
				? Number(it.ImporteUnitario)
				: Number(prod.PrecioVenta) || 0;
		if (!Number.isFinite(unit)) throw httpError(`Ítem ${i + 1}: importe unitario inválido`);
		const importeTotal = Number(it.ImporteTotal ?? cant * unit);
		total += importeTotal;
		costo += cant * (Number(prod.Costo) || 0);
		bultos += cant;
		items.push({
			IdProducto: idProd,
			DescripcionProducto: (trim(prod.Descripcion) || `Producto ${idProd}`).slice(0, 8000),
			IdUnidad: trim(prod.IdUnidad),
			Cantidad: cant,
			ImporteUnitario: unit,
			ImporteTotal: importeTotal,
			IdPaciente: idPac,
			NroIndicacion: Number.isFinite(nroInd) && nroInd > 0 ? nroInd : null,
		});
	});

	const sentido = (tipoRow.Sentido || 'E').slice(0, 1).toUpperCase();
	const observacion = trim(body.Observaciones || body.observaciones);
	const campos = camposSegunTipo(tipoRow);

	const idDepDestRaw = body.IdDepositoDest ?? body.idDepositoDest;
	const idProvRaw = body.IdProveedor ?? body.idProveedor;
	const idCliRaw = body.IdCliente ?? body.idCliente;
	const idDepositoDest =
		campos.usaDepDestino && idDepDestRaw != null && idDepDestRaw !== '' ? Number(idDepDestRaw) : null;
	const idProveedor =
		campos.usaProveedor && idProvRaw != null && idProvRaw !== '' ? Number(idProvRaw) : null;
	const idCliente = campos.usaCliente && idCliRaw != null && idCliRaw !== '' ? Number(idCliRaw) : null;

	if (campos.usaDepDestino && !Number.isFinite(idDepositoDest)) {
		throw httpError('Seleccioná el depósito destino');
	}
	if (campos.usaDepDestino && idDepositoDest === idDeposito) {
		throw httpError('El depósito destino tiene que ser distinto del depósito de origen');
	}
	if (campos.usaProveedor && !Number.isFinite(idProveedor)) {
		throw httpError('Seleccioná el proveedor');
	}
	if (campos.usaCliente && !Number.isFinite(idCliente)) {
		throw httpError('Seleccioná el cliente / paciente');
	}

	const idsDep = [idDeposito, ...(Number.isFinite(idDepositoDest) ? [idDepositoDest] : [])];
	const deps = await buscarPorIds(`SELECT IdDeposito FROM dbo.Depositos WHERE IdDeposito IN ({ids})`, idsDep, 'SmallInt');
	const depsOk = new Set(deps.map((d) => Number(d.IdDeposito)));
	const depFalta = idsDep.find((d) => !depsOk.has(d));
	if (depFalta != null) throw httpError(`El depósito ${depFalta} no existe`);

	const tipoGenId = trim(tipoRow.IdTipoGenerar);
	const tipoGenRow = tipoGenId ? tipos.find((t) => t.IdTipo === tipoGenId) || null : null;
	if (tipoGenId && !tipoGenRow) {
		throw httpError(`El tipo ${tipoGenId} que genera ${tipo} no existe en Tipos_Remitos`);
	}

	return {
		tipo,
		tipoRow,
		tipoGenRow,
		idDeposito,
		fecha,
		fechaHora,
		fechaIso,
		grupo,
		letra,
		items,
		total,
		costo,
		bultos: Math.min(32767, Math.round(body.Bultos != null && body.Bultos !== '' ? Number(body.Bultos) : bultos)),
		sentido,
		observacion,
		idDepositoDest: Number.isFinite(idDepositoDest) ? idDepositoDest : null,
		idProveedor: Number.isFinite(idProveedor) ? idProveedor : null,
		idCliente: Number.isFinite(idCliente) ? idCliente : null,
	};
}

function comprobante(datos, ctx, extra) {
	return {
		idEmpresa: ctx.idEmpresa,
		idSucursal: ctx.idSucursal,
		audUser: ctx.audUser,
		ahora: ctx.ahora,
		tipo: datos.tipo,
		tipoRow: datos.tipoRow,
		grupo: datos.grupo,
		letra: datos.letra,
		idDeposito: datos.idDeposito,
		idDepositoDest: datos.idDepositoDest,
		idProveedor: datos.idProveedor,
		idCliente: datos.idCliente,
		fecha: datos.fecha,
		fechaHora: datos.fechaHora,
		bultos: datos.bultos,
		idStatus: estadoDeTipo(datos.tipoRow),
		total: datos.total,
		costo: datos.costo,
		items: datos.items,
		sentido: datos.sentido,
		observacion: datos.observacion,
		idTxOrig: null,
		...extra,
	};
}

async function borrarItems(tx, idTx) {
	await new sql.Request(tx).input('id', sql.Int, idTx).query(`DELETE FROM dbo.RemitosItems WHERE IdTransaccion = @id`);
}

async function anularComprobante(tx, idTx, ctx) {
	const cab = await grab.leerCabecera(tx, idTx);
	if (!cab || Number(cab.IdStatus) === grab.STATUS_ANULADO) return;
	await grab.revertirStock(tx, cab, { anular: true, ahora: ctx.ahora, audUser: ctx.audUser });
	await grab.marcarAnulado(tx, idTx, ctx);
}

/**
 * Clarion generaba un REM espejo (IdTipo_Generar) al grabar RSM.
 * En iMedic web no se crea: el RSM mueve stock solo en el depósito origen.
 * Si quedó un espejo viejo (datos Clarion / builds anteriores), se anula.
 */
async function sincronizarEspejo(tx, _datos, ctx, { espejoId }) {
	if (espejoId) await anularComprobante(tx, espejoId, ctx);
	return null;
}

function usaIndicaciones(tipo) {
	return String(tipo).toUpperCase() === 'RSM';
}

/** Con `externa` el llamador controla commit/rollback (componer operaciones). */
async function enTransaccion(fn, externa = null) {
	if (externa) return fn(externa);
	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const out = await fn(tx);
		await tx.commit();
		return out;
	} catch (e) {
		try {
			await tx.rollback();
		} catch (_) {
			/* ignore */
		}
		throw errorGuardado(e);
	}
}

/**
 * Orden: Cbtes_Numeracion → Transacciones → Remitos → RemitosItems → Remitos_Observa
 * → Stock/Stock_Mov → entregas de indicaciones. Todo o nada.
 * (Ya no se genera REM espejo al grabar RSM.)
 */
async function crear(body, auth, { transaction = null } = {}) {
	const datos = await prepararDatos(body);
	const ctx = {
		idEmpresa: Number(body.IdEmpresa) || DEFAULT_EMPRESA,
		idSucursal: Number(body.IdSucursal) || DEFAULT_SUCURSAL,
		audUser: await resolverAudUser(auth),
		ahora: ahoraWallArgentinaParaSql(),
	};
	const idTx = await enTransaccion(async (tx) => {
		const nro = await grab.reservarNumero(tx, { ...ctx, tipo: datos.tipo, grupo: datos.grupo, letra: datos.letra });
		const id = await grab.reservarIdTransaccion(tx);
		await grab.escribirComprobante(tx, comprobante(datos, ctx, { idTx: id, isNew: true, nro }));
		await sincronizarEspejo(tx, datos, ctx, { idTx: id, espejoId: null });
		if (usaIndicaciones(datos.tipo)) {
			await grab.ajustarEntregaIndicaciones(tx, datos.items, { signo: 1, fechaIso: datos.fechaIso });
		}
		return id;
	}, transaction);
	return transaction ? { IdTransaccion: idTx } : obtener(idTx);
}

async function cabeceraEditable(tx, idTx) {
	const cab = await grab.leerCabecera(tx, idTx);
	if (!cab) throw httpError('Remito no encontrado', 404);
	if (Number(cab.IdStatus) === grab.STATUS_ANULADO) throw httpError('El remito está anulado');
	if (Number(cab.IdTransaccionOrig) > 0) {
		throw httpError(
			`Este remito se generó automáticamente desde la transacción ${cab.IdTransaccionOrig}; operá sobre el remito original`,
		);
	}
	return cab;
}

/** Revierte stock e indicaciones del remito y lo vuelve a grabar con el mismo número. */
async function actualizar(id, body, auth, { transaction = null } = {}) {
	const idTx = Number(id);
	if (!Number.isFinite(idTx)) throw httpError('Remito inválido');
	const datos = await prepararDatos(body);
	const audUser = await resolverAudUser(auth);
	await enTransaccion(async (tx) => {
		const cab = await cabeceraEditable(tx, idTx);
		if (trim(cab.Tipo_Cbte) !== datos.tipo) {
			throw httpError('No se puede cambiar el tipo de un remito grabado. Anulalo y creá uno nuevo.');
		}
		const ctx = {
			idEmpresa: cab.IdEmpresa ?? DEFAULT_EMPRESA,
			idSucursal: cab.IdSucursal ?? DEFAULT_SUCURSAL,
			audUser,
			ahora: ahoraWallArgentinaParaSql(),
		};
		if (usaIndicaciones(datos.tipo)) {
			const previos = await grab.leerItemsIndicaciones(tx, idTx);
			await grab.ajustarEntregaIndicaciones(tx, previos, { signo: -1 });
		}
		await grab.revertirStock(tx, cab, { anular: false, ahora: ctx.ahora, audUser: ctx.audUser });
		await borrarItems(tx, idTx);
		await grab.escribirComprobante(
			tx,
			comprobante(datos, ctx, {
				idTx,
				isNew: false,
				grupo: cab.Grupo_Cbte,
				letra: trim(cab.Letra_Cbte) || 'X',
				nro: cab.NroCbte,
			}),
		);
		const espejoId = await grab.buscarEspejo(tx, idTx);
		await sincronizarEspejo(tx, datos, ctx, { idTx, espejoId });
		if (usaIndicaciones(datos.tipo)) {
			await grab.ajustarEntregaIndicaciones(tx, datos.items, { signo: 1, fechaIso: datos.fechaIso });
		}
	}, transaction);
	return transaction ? { IdTransaccion: idTx } : obtener(idTx);
}

/**
 * Anula el remito (IdStatus 0), revierte stock y el espejo vinculado.
 * Si el usuario anula el remito generado automáticamente (IdTransaccionOrig),
 * se anula el original: eso también anula este espejo.
 */
async function anular(id, auth, { transaction = null } = {}) {
	const idTx = Number(id);
	if (!Number.isFinite(idTx)) throw httpError('Remito inválido');
	const audUser = await resolverAudUser(auth);
	await enTransaccion(async (tx) => {
		const cab = await grab.leerCabecera(tx, idTx);
		if (!cab) throw httpError('Remito no encontrado', 404);

		const orig = Number(cab.IdTransaccionOrig) || 0;
		const idPrincipal = orig > 0 && orig !== idTx ? orig : idTx;
		const cabPrincipal =
			idPrincipal === idTx ? cab : await grab.leerCabecera(tx, idPrincipal);
		if (!cabPrincipal) throw httpError('Remito no encontrado', 404);

		const ctx = { audUser, ahora: ahoraWallArgentinaParaSql() };

		if (Number(cabPrincipal.IdStatus) === grab.STATUS_ANULADO) {
			// Original ya anulado: si quedó un espejo vivo, anularlo solo.
			if (idPrincipal !== idTx && Number(cab.IdStatus) !== grab.STATUS_ANULADO) {
				await anularComprobante(tx, idTx, ctx);
				return;
			}
			throw httpError('El remito está anulado');
		}

		if (usaIndicaciones(cabPrincipal.Tipo_Cbte)) {
			const previos = await grab.leerItemsIndicaciones(tx, idPrincipal);
			await grab.ajustarEntregaIndicaciones(tx, previos, { signo: -1 });
		}
		await anularComprobante(tx, idPrincipal, ctx);
		const espejoId = await grab.buscarEspejo(tx, idPrincipal);
		if (espejoId) await anularComprobante(tx, espejoId, ctx);
	}, transaction);
	return transaction ? { IdTransaccion: idTx } : obtener(idTx);
}

module.exports = {
	listar,
	obtener,
	crear,
	actualizar,
	anular,
	listarTipos,
	listarDepositos,
	listarProveedores,
	listarClientes,
	listarPacientes,
	proximoNro,
	camposSegunTipo,
	listarCandidatosSalidaServicio,
	resumenMedicacionPendienteServicios,
	excluirIndicacionDeEntrega,
};
