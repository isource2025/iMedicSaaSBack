/**
 * Remitos legacy: Remitos + RemitosItems + Tipos_Remitos + Depositos + Remitos_Observa.
 */
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { convertirFechaAClarion } = require('../utils/dateUtils');

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
		Bultos: row.Bultos,
		IdStatus: row.IdStatus,
		StatusNombre: trim(row.StatusNombre),
		ImportePPP: row.ImportePPP != null ? Number(row.ImportePPP) : null,
		ImporteCosto: row.ImporteCosto != null ? Number(row.ImporteCosto) : null,
		IdCliente: row.IdCliente,
		ClienteNombre: trim(row.ClienteNombre),
		IdProveedor: row.IdProveedor,
		ProveedorNombre: trim(row.ProveedorNombre),
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
           Usa_Proveedor, Usa_Cliente, Usa_Dep_Orig_Dest, IdStatus
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

/** Tras confirmar remito RSM: marca entrega en imInterIndMedicas. */
async function marcarEntregaIndicaciones(items, fechaIso) {
	const fecha =
		trim(fechaIso) && /^\d{4}-\d{2}-\d{2}$/.test(trim(fechaIso))
			? trim(fechaIso)
			: require('../utils/dateUtils').fechaCalendarioArgentina();
	for (const it of items || []) {
		const nro = Number(it.NroIndicacion);
		if (!Number.isFinite(nro) || nro <= 0) continue;
		const cant = Number(it.Cantidad);
		const entregada = Number.isFinite(cant) ? cant : 0;
		await executeQuery(
			`
      UPDATE dbo.imInterIndMedicas
      SET CantidadEntregada = @p1,
          ParaFechaEntrega = @p2
      WHERE NroIndicacion = @p0
        AND ISNULL(NroAdicional, 0) = 0
      `,
			[
				{ value: nro, type: 'Int' },
				{ value: entregada, type: 'Float' },
				{ value: fecha },
			],
		);
	}
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
	page = 1,
	pageSize = 30,
} = {}) {
	const p = Math.max(1, Number(page) || 1);
	const size = Math.min(100, Math.max(1, Number(pageSize) || 30));
	const offset = (p - 1) * size;
	const params = [];
	const where = ['1=1'];

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

	const whereSql = where.join(' AND ');
	const hasFilters =
		!!trim(tipo) ||
		(idDeposito != null && idDeposito !== '') ||
		!!desde ||
		!!hasta ||
		!!q;
	const needsCatalogJoin = !!(q && !/^\d+$/.test(q));

	let total = 0;
	if (!hasFilters) {
		// ~instantáneo; evita COUNT bloqueado sobre 100k+ filas en Clarion/Vidal.
		const approx = await executeQuery(
			`
      SELECT SUM(p.rows) AS n
      FROM sys.partitions p
      INNER JOIN sys.tables t ON t.object_id = p.object_id
      WHERE t.name = 'Remitos' AND p.index_id IN (0, 1)
      `,
		);
		total = Number(approx[0]?.n || 0);
	} else if (needsCatalogJoin) {
		const countRows = await executeQuery(
			`
      SELECT COUNT(1) AS n
      FROM dbo.Remitos r WITH (NOLOCK)
      LEFT JOIN dbo.Tipos_Remitos t WITH (NOLOCK) ON t.IdTipo = r.Tipo_Cbte
      LEFT JOIN dbo.Depositos d WITH (NOLOCK) ON d.IdDeposito = r.IdDeposito
      WHERE ${whereSql}
      `,
			params,
		);
		total = Number(countRows[0]?.n || 0);
	} else {
		const countRows = await executeQuery(
			`SELECT COUNT(1) AS n FROM dbo.Remitos r WITH (NOLOCK) WHERE ${whereSql}`,
			params,
		);
		total = Number(countRows[0]?.n || 0);
	}

	const pageParams = [...params, { value: offset, type: 'Int' }, { value: size, type: 'Int' }];
	const rows = await executeQuery(
		`
    SELECT
      r.IdTransaccion, r.IdEmpresa, r.IdSucursal, r.Tipo_Cbte, r.Grupo_Cbte, r.Letra_Cbte, r.NroCbte,
      r.IdDeposito, r.IdDepositoDest, r.Fecha, r.Bultos, r.IdStatus, r.ImportePPP, r.ImporteCosto,
      r.IdCliente, r.IdProveedor,
      RTRIM(t.Descripcion) AS TipoNombre,
      RTRIM(d.Descripcion) AS DepositoNombre,
      RTRIM(dd.Descripcion) AS DepositoDestNombre,
      RTRIM(pv.DESCRIPCION) AS ProveedorNombre,
      RTRIM(COALESCE(NULLIF(RTRIM(cl.Razon_Social),''), LTRIM(RTRIM(ISNULL(cl.Apellidos,'')) + ' ' + RTRIM(ISNULL(cl.Nombres,''))))) AS ClienteNombre,
      RTRIM(st.Descripcion) AS StatusNombre
    FROM dbo.Remitos r WITH (NOLOCK)
    LEFT JOIN dbo.Tipos_Remitos t WITH (NOLOCK) ON t.IdTipo = r.Tipo_Cbte
    LEFT JOIN dbo.Depositos d WITH (NOLOCK) ON d.IdDeposito = r.IdDeposito
    LEFT JOIN dbo.Depositos dd WITH (NOLOCK) ON dd.IdDeposito = r.IdDepositoDest
    LEFT JOIN dbo.PROVEEDORES pv WITH (NOLOCK) ON pv.IDPROVEEDOR = r.IdProveedor
    LEFT JOIN dbo.Clientes cl WITH (NOLOCK) ON cl.IdCliente = r.IdCliente
    LEFT JOIN dbo.Status_Remitos st WITH (NOLOCK) ON st.IdStatus = r.IdStatus
    WHERE ${whereSql}
    ORDER BY r.IdTransaccion DESC
    OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
    `,
		pageParams,
	);

	return {
		items: rows.map(mapRemito),
		total,
		page: p,
		pageSize: size,
		totalPages: Math.max(1, Math.ceil(total / size)),
	};
}

async function obtener(id) {
	const rows = await executeQuery(
		`
    SELECT TOP 1
      r.IdTransaccion, r.IdEmpresa, r.IdSucursal, r.Tipo_Cbte, r.Grupo_Cbte, r.Letra_Cbte, r.NroCbte,
      r.IdDeposito, r.IdDepositoDest, r.Fecha, r.Bultos, r.IdStatus, r.ImportePPP, r.ImporteCosto,
      r.IdCliente, r.IdProveedor,
      RTRIM(t.Descripcion) AS TipoNombre,
      RTRIM(d.Descripcion) AS DepositoNombre,
      RTRIM(dd.Descripcion) AS DepositoDestNombre,
      RTRIM(pv.DESCRIPCION) AS ProveedorNombre,
      RTRIM(COALESCE(NULLIF(RTRIM(cl.Razon_Social),''), LTRIM(RTRIM(ISNULL(cl.Apellidos,'')) + ' ' + RTRIM(ISNULL(cl.Nombres,''))))) AS ClienteNombre,
      RTRIM(st.Descripcion) AS StatusNombre
    FROM dbo.Remitos r
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

	const cabecera = mapRemito(rows[0]);
	const mappedItems = items.map(mapItem);
	const totalRemito = mappedItems.reduce((acc, it) => acc + (Number(it.ImporteTotal) || 0), 0);

	return {
		...cabecera,
		items: mappedItems,
		observaciones: obs.map((o) => ({
			Item: o.Item,
			Fecha: o.Fecha,
			Comentarios: trim(o.Comentarios),
		})),
		TotalRemito: totalRemito,
	};
}

async function proximoNro(tipoCbte, grupo) {
	const tipo = (trim(tipoCbte) || 'REM').slice(0, 3);
	const year = grupo != null ? Number(grupo) : new Date().getFullYear();
	const rows = await executeQuery(
		`
    SELECT ISNULL(MAX(NroCbte), 0) + 1 AS NextNro
    FROM dbo.Remitos
    WHERE Tipo_Cbte = @p0 AND Grupo_Cbte = @p1
    `,
		[
			{ value: tipo, type: 'Char', length: 3 },
			{ value: year, type: 'SmallInt' },
		],
	);
	return { tipo, grupo: year, letra: 'X', nro: rows[0]?.NextNro || 1 };
}

async function nextIdTransaccion(tx) {
	const req = new sql.Request(tx);
	const r = await req.query(`
    SELECT ISNULL((
      SELECT MAX(m) FROM (
        SELECT MAX(IdTransaccion) AS m FROM dbo.Transacciones
        UNION ALL
        SELECT MAX(IdTransaccion) FROM dbo.Remitos
      ) x
    ), 0) + 1 AS NextId
  `);
	return r.recordset[0].NextId;
}

/** Mensaje seguro para el usuario (nunca SQL crudo). */
function errorGuardado(err) {
	if (err && err.statusCode) return err;
	const raw = String(err?.message || '');
	console.error('[remitos.guardar]', raw);
	return httpError('No se pudo guardar el remito. Revisá los datos e intentá de nuevo.', 500);
}

/** Valida body y resuelve ítems / campos según tipo. */
async function prepararDatos(body, { autoNro = true } = {}) {
	const tipo = (trim(body.TipoCbte || body.tipoCbte) || '').slice(0, 3);
	if (!tipo) throw httpError('Seleccioná el tipo de remito');
	const idDeposito = Number(body.IdDeposito ?? body.idDeposito);
	if (!Number.isFinite(idDeposito)) throw httpError('Seleccioná el depósito');

	const tipos = await listarTipos();
	const tipoRow = tipos.find((t) => t.IdTipo === tipo);
	if (!tipoRow) throw httpError('Tipo de remito inválido');

	const itemsIn = Array.isArray(body.items) ? body.items : [];
	if (!itemsIn.length) throw httpError('Agregá al menos un ítem');

	const fecha = body.Fecha || body.fecha ? new Date(body.Fecha || body.fecha) : new Date();
	if (Number.isNaN(fecha.getTime())) throw httpError('Fecha inválida');

	const grupo = body.GrupoCbte != null ? Number(body.GrupoCbte) : fecha.getFullYear();
	const letra = (trim(body.LetraCbte) || 'X').slice(0, 1);
	let nro = body.NroCbte != null ? Number(body.NroCbte) : null;
	if (!nro || !Number.isFinite(nro)) {
		if (!autoNro) throw httpError('Número de remito inválido');
		const prox = await proximoNro(tipo, grupo);
		nro = prox.nro;
	}

	const items = [];
	let total = 0;
	let bultos = 0;
	for (let i = 0; i < itemsIn.length; i++) {
		const it = itemsIn[i];
		const idProd = Number(it.IdProducto ?? it.idProducto);
		if (!Number.isFinite(idProd)) throw httpError(`Ítem ${i + 1}: producto inválido`);
		const cant = Number(it.Cantidad ?? it.cantidad);
		if (!Number.isFinite(cant) || cant === 0) throw httpError(`Ítem ${i + 1}: cantidad inválida`);

		const prod = await executeQuery(
			`
      SELECT TOP 1
        RTRIM(COALESCE(NULLIF(RTRIM(p.Descripcion),''), NULLIF(RTRIM(p.DescripcionC),''))) AS Descripcion,
        RTRIM(p.IdUnidad) AS IdUnidad,
        p.PrecioVenta
      FROM dbo.Productos p
      WHERE p.IdProducto = @p0
      `,
			[{ value: idProd, type: 'Int' }],
		);
		if (!prod.length) throw httpError(`Producto ${idProd} no existe en tabla Productos`);
		const desc = trim(prod[0].Descripcion) || `Producto ${idProd}`;
		const unit =
			it.ImporteUnitario != null && it.ImporteUnitario !== ''
				? Number(it.ImporteUnitario)
				: Number(prod[0].PrecioVenta) || 0;
		const importeTotal = Number(it.ImporteTotal ?? cant * unit);
		const idPac =
			it.IdPaciente != null && it.IdPaciente !== '' ? Number(it.IdPaciente) : null;
		if (idPac != null && Number.isFinite(idPac)) {
			const pacOk = await executeQuery(
				`SELECT TOP 1 IdPaciente FROM dbo.imPacientes WHERE IdPaciente = @p0`,
				[{ value: idPac, type: 'Int' }],
			);
			if (!pacOk.length) throw httpError(`Ítem ${i + 1}: paciente ${idPac} no existe`);
		}
		const nroIndRaw = it.NroIndicacion ?? it.nroIndicacion;
		const nroInd =
			nroIndRaw != null && nroIndRaw !== '' ? Number(nroIndRaw) : null;
		total += importeTotal;
		bultos += Math.abs(cant);
		items.push({
			IdProducto: idProd,
			DescripcionProducto: desc.slice(0, 8000),
			IdUnidad: trim(prod[0].IdUnidad),
			Cantidad: cant,
			ImporteUnitario: unit,
			ImporteTotal: importeTotal,
			IdPaciente: Number.isFinite(idPac) ? idPac : null,
			NroIndicacion: Number.isFinite(nroInd) && nroInd > 0 ? nroInd : null,
		});
	}

	const sentido = (tipoRow.Sentido || 'E').slice(0, 1);
	const observacion = trim(body.Observaciones || body.observaciones);
	const campos = camposSegunTipo(tipoRow);

	const idDepDestRaw = body.IdDepositoDest ?? body.idDepositoDest;
	const idProvRaw = body.IdProveedor ?? body.idProveedor;
	const idCliRaw = body.IdCliente ?? body.idCliente;
	const idDepositoDest =
		campos.usaDepDestino && idDepDestRaw != null && idDepDestRaw !== ''
			? Number(idDepDestRaw)
			: null;
	const idProveedor =
		campos.usaProveedor && idProvRaw != null && idProvRaw !== '' ? Number(idProvRaw) : null;
	const idCliente =
		campos.usaCliente && idCliRaw != null && idCliRaw !== '' ? Number(idCliRaw) : null;

	if (campos.usaDepDestino && !Number.isFinite(idDepositoDest)) {
		throw httpError('Seleccioná el depósito destino');
	}
	if (campos.usaProveedor && !Number.isFinite(idProveedor)) {
		throw httpError('Seleccioná el proveedor');
	}
	if (campos.usaCliente && !Number.isFinite(idCliente)) {
		throw httpError('Seleccioná el cliente / paciente');
	}

	return {
		tipo,
		tipoRow,
		idDeposito,
		fecha,
		grupo,
		letra,
		nro,
		items,
		total,
		bultos: Math.min(
			32767,
			Math.round(body.Bultos != null ? Number(body.Bultos) : bultos),
		),
		sentido,
		observacion,
		idDepositoDest: Number.isFinite(idDepositoDest) ? idDepositoDest : null,
		idProveedor: Number.isFinite(idProveedor) ? idProveedor : null,
		idCliente: Number.isFinite(idCliente) ? idCliente : null,
	};
}

async function insertarItems(transaction, { idTx, items, sentido, idDeposito, tipo, fecha, audUser }) {
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		const reqI = new sql.Request(transaction);
		await reqI
			.input('id', sql.Int, idTx)
			.input('ren', sql.SmallInt, i + 1)
			.input('sent', sql.Char(1), sentido)
			.input('dep', sql.SmallInt, idDeposito)
			.input('prod', sql.Int, it.IdProducto)
			.input('tipo', sql.Char(3), tipo)
			.input('cant', sql.Decimal(18, 4), it.Cantidad)
			.input('fecha', sql.DateTime, fecha)
			.input('unit', sql.Decimal(18, 4), it.ImporteUnitario)
			.input('tot', sql.Decimal(18, 4), it.ImporteTotal)
			.input('pac', sql.Int, it.IdPaciente)
			.input('nroInd', sql.Int, it.NroIndicacion)
			.input('desc', sql.VarChar(sql.MAX), it.DescripcionProducto)
			.input('audUser', sql.SmallInt, Number.isFinite(audUser) ? audUser : null)
			.query(`
        INSERT INTO dbo.RemitosItems (
          IdTransaccion, Renglon, Sentido, IdDeposito, IdStatus, IdProducto, IdTipo,
          Cantidad, Cantidad_Origen, Cantidad_Fisico, Cantidad_Disp,
          Fecha, ImporteUnitario, ImporteTotal, DescripcionProducto, IdPaciente, NroIndicacion,
          Aud_Fecha_Date, Aud_Usuario, Aud_Accion
        ) VALUES (
          @id, @ren, @sent, @dep, 0, @prod, @tipo,
          @cant, @cant, @cant, @cant,
          @fecha, @unit, @tot, @desc, @pac, @nroInd,
          GETDATE(), @audUser, 1
        )
      `);
	}
}

async function upsertObservacion(transaction, { idTx, observacion, fecha }) {
	const reqDel = new sql.Request(transaction);
	await reqDel.input('id', sql.Int, idTx).query(`
    DELETE FROM dbo.Remitos_Observa WHERE IdTransaccion = @id
  `);
	if (!observacion) return;
	const reqO = new sql.Request(transaction);
	await reqO
		.input('id', sql.Int, idTx)
		.input('item', sql.SmallInt, 1)
		.input('fecha', sql.DateTime, fecha)
		.input('com', sql.VarChar(2000), observacion.slice(0, 2000))
		.query(`
      INSERT INTO dbo.Remitos_Observa (IdTransaccion, Item, Fecha, Comentarios, Aud_Fecha_Date, Aud_Accion)
      VALUES (@id, @item, @fecha, @com, GETDATE(), 1)
    `);
}

async function crear(body, auth) {
	const datos = await prepararDatos(body, { autoNro: true });
	const idEmpresa = body.IdEmpresa != null ? Number(body.IdEmpresa) : 1;
	const idSucursal = body.IdSucursal != null ? Number(body.IdSucursal) : 1;
	const audUser = auth?.idCodOperador != null ? Number(auth.idCodOperador) : null;
	const pool = await getRequestPool();
	const transaction = new sql.Transaction(pool);
	await transaction.begin();
	try {
		const idTx = await nextIdTransaccion(transaction);

		const reqTx = new sql.Request(transaction);
		await reqTx
			.input('id', sql.Int, idTx)
			.input('emp', sql.SmallInt, idEmpresa)
			.input('suc', sql.SmallInt, idSucursal)
			.input('tipo', sql.Char(3), datos.tipo)
			.input('grupo', sql.SmallInt, datos.grupo)
			.input('letra', sql.Char(1), datos.letra)
			.input('nro', sql.Int, datos.nro)
			.input('empId', sql.Int, Number.isFinite(audUser) ? audUser : null)
			.input('desc', sql.Char(50), 'Emision de Remitos')
			.input('fecha', sql.DateTime, datos.fecha)
			.input('audUser', sql.SmallInt, Number.isFinite(audUser) ? audUser : null)
			.query(`
        INSERT INTO dbo.Transacciones (
          IdTransaccion, IdEmpresa, IdSucursal, TipoCbte, GrupoCbte, LetraCbte, NroCbte,
          IdEmpleado, Descripcion, NroEvento, IdStatus, Fecha,
          Aud_Fecha_Date, Aud_Usuario, Aud_Accion
        ) VALUES (
          @id, @emp, @suc, @tipo, @grupo, @letra, @nro,
          @empId, @desc, 0, 1, @fecha,
          GETDATE(), @audUser, 1
        )
      `);

		const reqH = new sql.Request(transaction);
		await reqH
			.input('id', sql.Int, idTx)
			.input('emp', sql.SmallInt, idEmpresa)
			.input('suc', sql.SmallInt, idSucursal)
			.input('tipo', sql.Char(3), datos.tipo)
			.input('grupo', sql.SmallInt, datos.grupo)
			.input('letra', sql.Char(1), datos.letra)
			.input('nro', sql.Int, datos.nro)
			.input('dep', sql.SmallInt, datos.idDeposito)
			.input('depDest', sql.SmallInt, datos.idDepositoDest)
			.input('prov', sql.Int, datos.idProveedor)
			.input('cli', sql.Int, datos.idCliente)
			.input('fecha', sql.DateTime, datos.fecha)
			.input('bultos', sql.SmallInt, datos.bultos)
			.input('status', sql.SmallInt, datos.tipoRow.IdStatus != null ? Number(datos.tipoRow.IdStatus) : 0)
			.input('imp', sql.Decimal(18, 4), datos.total)
			.input('audUser', sql.SmallInt, Number.isFinite(audUser) ? audUser : null)
			.query(`
        INSERT INTO dbo.Remitos (
          IdTransaccion, IdEmpresa, IdSucursal, Tipo_Cbte, Grupo_Cbte, Letra_Cbte, NroCbte,
          IdDeposito, IdDepositoDest, IdProveedor, IdCliente,
          Fecha, Bultos, IdStatus, ImportePPP, ImporteCosto,
          Aud_Fecha_Date, Aud_Usuario, Aud_Accion
        ) VALUES (
          @id, @emp, @suc, @tipo, @grupo, @letra, @nro,
          @dep, @depDest, @prov, @cli,
          @fecha, @bultos, @status, @imp, @imp,
          GETDATE(), @audUser, 1
        )
      `);

		await insertarItems(transaction, {
			idTx,
			items: datos.items,
			sentido: datos.sentido,
			idDeposito: datos.idDeposito,
			tipo: datos.tipo,
			fecha: datos.fecha,
			audUser,
		});
		await upsertObservacion(transaction, {
			idTx,
			observacion: datos.observacion,
			fecha: datos.fecha,
		});

		await transaction.commit();

		if (String(datos.tipo).toUpperCase() === 'RSM') {
			const fechaIso =
				datos.fecha instanceof Date
					? datos.fecha.toISOString().slice(0, 10)
					: String(body.Fecha || body.fecha || '').slice(0, 10);
			try {
				await marcarEntregaIndicaciones(datos.items, fechaIso);
			} catch (e) {
				console.warn('[remitos] marcarEntregaIndicaciones:', e.message);
			}
		}

		return obtener(idTx);
	} catch (e) {
		try {
			await transaction.rollback();
		} catch (_) {
			/* ignore */
		}
		throw errorGuardado(e);
	}
}

async function actualizar(id, body, auth) {
	const idTx = Number(id);
	if (!Number.isFinite(idTx)) throw httpError('Remito inválido');

	const actual = await executeQuery(
		`
    SELECT TOP 1 IdTransaccion, IdEmpresa, IdSucursal
    FROM dbo.Remitos WHERE IdTransaccion = @p0
    `,
		[{ value: idTx, type: 'Int' }],
	);
	if (!actual.length) throw httpError('Remito no encontrado', 404);

	const datos = await prepararDatos(body, { autoNro: false });
	const idEmpresa = body.IdEmpresa != null ? Number(body.IdEmpresa) : Number(actual[0].IdEmpresa) || 1;
	const idSucursal =
		body.IdSucursal != null ? Number(body.IdSucursal) : Number(actual[0].IdSucursal) || 1;
	const audUser = auth?.idCodOperador != null ? Number(auth.idCodOperador) : null;

	const pool = await getRequestPool();
	const transaction = new sql.Transaction(pool);
	await transaction.begin();
	try {
		const reqTx = new sql.Request(transaction);
		await reqTx
			.input('id', sql.Int, idTx)
			.input('emp', sql.SmallInt, idEmpresa)
			.input('suc', sql.SmallInt, idSucursal)
			.input('tipo', sql.Char(3), datos.tipo)
			.input('grupo', sql.SmallInt, datos.grupo)
			.input('letra', sql.Char(1), datos.letra)
			.input('nro', sql.Int, datos.nro)
			.input('fecha', sql.DateTime, datos.fecha)
			.input('audUser', sql.SmallInt, Number.isFinite(audUser) ? audUser : null)
			.query(`
        UPDATE dbo.Transacciones SET
          IdEmpresa = @emp, IdSucursal = @suc,
          TipoCbte = @tipo, GrupoCbte = @grupo, LetraCbte = @letra, NroCbte = @nro,
          Fecha = @fecha, Aud_Fecha_Date = GETDATE(), Aud_Usuario = @audUser, Aud_Accion = 2
        WHERE IdTransaccion = @id
      `);

		const reqH = new sql.Request(transaction);
		await reqH
			.input('id', sql.Int, idTx)
			.input('emp', sql.SmallInt, idEmpresa)
			.input('suc', sql.SmallInt, idSucursal)
			.input('tipo', sql.Char(3), datos.tipo)
			.input('grupo', sql.SmallInt, datos.grupo)
			.input('letra', sql.Char(1), datos.letra)
			.input('nro', sql.Int, datos.nro)
			.input('dep', sql.SmallInt, datos.idDeposito)
			.input('depDest', sql.SmallInt, datos.idDepositoDest)
			.input('prov', sql.Int, datos.idProveedor)
			.input('cli', sql.Int, datos.idCliente)
			.input('fecha', sql.DateTime, datos.fecha)
			.input('bultos', sql.SmallInt, datos.bultos)
			.input('status', sql.SmallInt, datos.tipoRow.IdStatus != null ? Number(datos.tipoRow.IdStatus) : 0)
			.input('imp', sql.Decimal(18, 4), datos.total)
			.input('audUser', sql.SmallInt, Number.isFinite(audUser) ? audUser : null)
			.query(`
        UPDATE dbo.Remitos SET
          IdEmpresa = @emp, IdSucursal = @suc,
          Tipo_Cbte = @tipo, Grupo_Cbte = @grupo, Letra_Cbte = @letra, NroCbte = @nro,
          IdDeposito = @dep, IdDepositoDest = @depDest, IdProveedor = @prov, IdCliente = @cli,
          Fecha = @fecha, Bultos = @bultos, IdStatus = @status,
          ImportePPP = @imp, ImporteCosto = @imp,
          Aud_Fecha_Date = GETDATE(), Aud_Usuario = @audUser, Aud_Accion = 2
        WHERE IdTransaccion = @id
      `);

		const reqDel = new sql.Request(transaction);
		await reqDel.input('id', sql.Int, idTx).query(`
      DELETE FROM dbo.RemitosItems WHERE IdTransaccion = @id
    `);

		await insertarItems(transaction, {
			idTx,
			items: datos.items,
			sentido: datos.sentido,
			idDeposito: datos.idDeposito,
			tipo: datos.tipo,
			fecha: datos.fecha,
			audUser,
		});
		await upsertObservacion(transaction, {
			idTx,
			observacion: datos.observacion,
			fecha: datos.fecha,
		});

		await transaction.commit();

		if (String(datos.tipo).toUpperCase() === 'RSM') {
			const fechaIso =
				datos.fecha instanceof Date
					? datos.fecha.toISOString().slice(0, 10)
					: String(body.Fecha || body.fecha || '').slice(0, 10);
			try {
				await marcarEntregaIndicaciones(datos.items, fechaIso);
			} catch (e) {
				console.warn('[remitos] marcarEntregaIndicaciones (upd):', e.message);
			}
		}

		return obtener(idTx);
	} catch (e) {
		try {
			await transaction.rollback();
		} catch (_) {
			/* ignore */
		}
		throw errorGuardado(e);
	}
}

async function eliminar(id) {
	const idTx = Number(id);
	if (!Number.isFinite(idTx)) throw httpError('Remito inválido');

	const exists = await executeQuery(
		`SELECT TOP 1 IdTransaccion FROM dbo.Remitos WHERE IdTransaccion = @p0`,
		[{ value: idTx, type: 'Int' }],
	);
	if (!exists.length) throw httpError('Remito no encontrado', 404);

	const pool = await getRequestPool();
	const transaction = new sql.Transaction(pool);
	await transaction.begin();
	try {
		const delItems = new sql.Request(transaction);
		await delItems.input('id', sql.Int, idTx).query(`
      DELETE FROM dbo.RemitosItems WHERE IdTransaccion = @id
    `);

		const delObs = new sql.Request(transaction);
		await delObs.input('id', sql.Int, idTx).query(`
      DELETE FROM dbo.Remitos_Observa WHERE IdTransaccion = @id
    `);

		const delRem = new sql.Request(transaction);
		await delRem.input('id', sql.Int, idTx).query(`
      DELETE FROM dbo.Remitos WHERE IdTransaccion = @id
    `);

		const delTx = new sql.Request(transaction);
		await delTx.input('id', sql.Int, idTx).query(`
      DELETE FROM dbo.Transacciones WHERE IdTransaccion = @id
    `);

		await transaction.commit();
		return { ok: true, IdTransaccion: idTx };
	} catch (e) {
		try {
			await transaction.rollback();
		} catch (_) {
			/* ignore */
		}
		throw errorGuardado(e);
	}
}

module.exports = {
	listar,
	obtener,
	crear,
	actualizar,
	eliminar,
	listarTipos,
	listarDepositos,
	listarProveedores,
	listarClientes,
	listarPacientes,
	proximoNro,
	camposSegunTipo,
	listarCandidatosSalidaServicio,
	excluirIndicacionDeEntrega,
};
