/**
 * Catálogo Productos (tablas legacy Clarion: Productos, Rubros, SUBRUBRO, Unidades).
 */
const { executeQuery } = require('../models/db');

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

function num(v) {
	if (v == null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function flag01(v, def = 0) {
	if (v === undefined || v === null || v === '') return def;
	return Number(v) ? 1 : 0;
}

function mapProducto(row) {
	if (!row) return null;
	const rubro = trim(row.RubroNombre);
	const sub = trim(row.SubRubroNombre);
	const partes = [rubro, sub].filter(Boolean);
	// Legacy: muchos ítems tienen el nombre útil solo en DescripcionC.
	const desc = trim(row.Descripcion) || trim(row.DescripcionC);
	return {
		IdProducto: row.IdProducto,
		CodAlternativo: trim(row.Cod_Alternativo),
		Descripcion: desc,
		DescripcionC: trim(row.DescripcionC),
		IdRubro: row.IdRubro,
		IdSubRubro: row.IdSubRubro,
		IdLinea: row.IdLinea,
		IdStatus: row.IdStatus,
		IdTipoMateria: trim(row.idtipo_materia),
		IdUnidad: trim(row.IdUnidad),
		UnidadNombre: trim(row.UnidadNombre) || trim(row.IdUnidad),
		IdTipoPrd: row.IdTipo_Prd,
		TipoPrdNombre: trim(row.TipoPrdNombre),
		IdMarca: row.IdMarca,
		MarcaNombre: trim(row.MarcaNombre),
		IdColor: row.IdColor,
		ColorNombre: trim(row.ColorNombre),
		IdMoneda: row.idmoneda,
		MonedaNombre: trim(row.MonedaNombre),
		IdTipoIva: row.idtipoiva,
		TipoIvaNombre: trim(row.TipoIvaNombre),
		PrecioBase: row.Precio_Base != null ? Number(row.Precio_Base) : null,
		PrecioVenta: row.PrecioVenta != null ? Number(row.PrecioVenta) : null,
		PrecioCosto: row.PrecioCosto != null ? Number(row.PrecioCosto) : null,
		PuntoPedido: row.Punto_Pedido != null ? Number(row.Punto_Pedido) : null,
		Cotizacion: row.Costo_Reposicion != null ? Number(row.Costo_Reposicion) : null,
		StockMinimo: row.Stock_Minimo != null ? Number(row.Stock_Minimo) : null,
		StockMaximo: row.Stock_Maximo != null ? Number(row.Stock_Maximo) : null,
		ControlarStock: row.Controlar_Stock,
		EnLista: row.En_Lista,
		ConFabricacion: row.Con_Fabricacion,
		EsKit: row.EsKit,
		EsPartida: row.Es_Partida,
		IdCtaVta: row.IdCta_Vta,
		CtaVtaNombre: trim(row.CtaVtaNombre),
		IdCtaCmpra: row.IdCta_Cmpra,
		CtaCmpraNombre: trim(row.CtaCmpraNombre),
		RubroNombre: rubro,
		SubRubroNombre: sub,
		RubSubLin: partes.length ? partes.join(' - ') : '—',
		CBarra: trim(row.CBarra),
		Texto: trim(row.Texto),
	};
}

const SELECT_PRODUCTO = `
  p.IdProducto, p.Cod_Alternativo, p.Descripcion, p.DescripcionC,
  p.IdRubro, p.IdSubRubro, p.IdLinea, p.IdStatus, p.idtipo_materia,
  p.IdUnidad, p.CBarra, p.IdTipo_Prd, p.IdMarca, p.IdColor,
  p.idmoneda, p.idtipoiva,
  p.Precio_Base, p.PrecioVenta, p.PrecioCosto, p.Punto_Pedido, p.Costo_Reposicion,
  p.Stock_Minimo, p.Stock_Maximo,
  p.Controlar_Stock, p.En_Lista, p.Con_Fabricacion, p.EsKit, p.Es_Partida,
  p.IdCta_Vta, p.IdCta_Cmpra, p.Texto,
  RTRIM(r.Descripcion) AS RubroNombre,
  RTRIM(s.DESCRIPCION) AS SubRubroNombre,
  RTRIM(u.Descripcion) AS UnidadNombre,
  RTRIM(tp.Descripcion) AS TipoPrdNombre,
  RTRIM(tm.Descripcion) AS MarcaNombre,
  RTRIM(tc.Descripcion) AS ColorNombre,
  RTRIM(mo.Descripcion) AS MonedaNombre,
  RTRIM(ti.Descripcion) AS TipoIvaNombre,
  RTRIM(cv.Descripcion) AS CtaVtaNombre,
  RTRIM(cc.Descripcion) AS CtaCmpraNombre
`;

const FROM_PRODUCTO = `
  FROM dbo.Productos p
  LEFT JOIN dbo.Rubros r ON r.IdRubro = p.IdRubro
  LEFT JOIN dbo.SUBRUBRO s ON s.CODIGO = p.IdSubRubro AND s.RUBRO = p.IdRubro
  LEFT JOIN dbo.Unidades u ON u.IdUnidad = p.IdUnidad
  LEFT JOIN dbo.Tipos_Prd tp ON tp.IdTipo_Prd = p.IdTipo_Prd
  LEFT JOIN dbo.Tipos_Marcas tm ON tm.IdMarca = p.IdMarca
  LEFT JOIN dbo.Tipos_Colores tc ON tc.IdColor = p.IdColor
  LEFT JOIN dbo.Monedas mo ON mo.IdMoneda = p.idmoneda
  LEFT JOIN dbo.Tipos_Iva ti ON ti.IdTipoIva = p.idtipoiva
  LEFT JOIN dbo.Plan_Cuentas cv ON cv.IdCuenta = p.IdCta_Vta
  LEFT JOIN dbo.Plan_Cuentas cc ON cc.IdCuenta = p.IdCta_Cmpra
`;

async function listar({
	search = '',
	campo = 'descripcion',
	idRubro = null,
	idSubRubro = null,
	page = 1,
	pageSize = 40,
} = {}) {
	const p = Math.max(1, Number(page) || 1);
	const size = Math.min(100, Math.max(1, Number(pageSize) || 40));
	const offset = (p - 1) * size;
	const q = trim(search) || '';
	const params = [];
	const where = ['1=1'];

	if (idRubro != null && idRubro !== '') {
		where.push(`p.IdRubro = @p${params.length}`);
		params.push({ value: Number(idRubro), type: 'SmallInt' });
	}
	if (idSubRubro != null && idSubRubro !== '') {
		where.push(`p.IdSubRubro = @p${params.length}`);
		params.push({ value: Number(idSubRubro), type: 'SmallInt' });
	}

	if (q) {
		const like = `%${q}%`;
		const c = String(campo || 'descripcion').toLowerCase();
		if (c === 'codigo' || c === 'id') {
			if (/^\d+$/.test(q)) {
				where.push(`p.IdProducto = @p${params.length}`);
				params.push({ value: Number(q), type: 'Int' });
			} else {
				where.push(`RTRIM(ISNULL(p.Cod_Alternativo,'')) LIKE @p${params.length}`);
				params.push({ value: like, type: 'NVarChar', length: 80 });
			}
		} else if (c === 'secundario' || c === 'cod_secundario') {
			where.push(`RTRIM(ISNULL(p.Cod_Alternativo,'')) LIKE @p${params.length}`);
			params.push({ value: like, type: 'NVarChar', length: 80 });
		} else if (c === 'barra' || c === 'cbarra') {
			where.push(`RTRIM(ISNULL(p.CBarra,'')) LIKE @p${params.length}`);
			params.push({ value: like, type: 'NVarChar', length: 80 });
		} else if (c === 'rubro') {
			where.push(`RTRIM(ISNULL(r.Descripcion,'')) LIKE @p${params.length}`);
			params.push({ value: like, type: 'NVarChar', length: 120 });
		} else if (c === 'subrubro') {
			where.push(`RTRIM(ISNULL(s.DESCRIPCION,'')) LIKE @p${params.length}`);
			params.push({ value: like, type: 'NVarChar', length: 120 });
		} else if (c === 'toda' || c === 'alias') {
			where.push(`(
        RTRIM(ISNULL(p.Descripcion,'')) LIKE @p${params.length}
        OR RTRIM(ISNULL(p.DescripcionC,'')) LIKE @p${params.length}
        OR RTRIM(ISNULL(p.Cod_Alternativo,'')) LIKE @p${params.length}
        OR CAST(p.IdProducto AS VARCHAR(20)) LIKE @p${params.length}
      )`);
			params.push({ value: like, type: 'NVarChar', length: 160 });
		} else {
			where.push(`(
        RTRIM(ISNULL(p.Descripcion,'')) LIKE @p${params.length}
        OR RTRIM(ISNULL(p.DescripcionC,'')) LIKE @p${params.length}
      )`);
			params.push({ value: like, type: 'NVarChar', length: 160 });
		}
	}

	const whereSql = where.join(' AND ');
	const fromSql = `${FROM_PRODUCTO} WHERE ${whereSql}`;

	const countRows = await executeQuery(`SELECT COUNT(1) AS n ${fromSql}`, params);
	const total = countRows[0]?.n || 0;

	const pageParams = [
		...params,
		{ value: offset, type: 'Int' },
		{ value: size, type: 'Int' },
	];
	const rows = await executeQuery(
		`
    SELECT ${SELECT_PRODUCTO}
    ${fromSql}
    ORDER BY p.Descripcion, p.IdProducto
    OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
    `,
		pageParams,
	);

	return {
		items: rows.map(mapProducto),
		total,
		page: p,
		pageSize: size,
		totalPages: Math.max(1, Math.ceil(total / size)),
	};
}

async function obtener(id) {
	const rows = await executeQuery(
		`
    SELECT TOP 1 ${SELECT_PRODUCTO}
    ${FROM_PRODUCTO}
    WHERE p.IdProducto = @p0
    `,
		[{ value: Number(id), type: 'Int' }],
	);
	if (!rows.length) throw httpError('Producto no encontrado', 404);
	return mapProducto(rows[0]);
}

async function catalogos() {
	const [rubros, subrubros, unidades, marcas, colores, tiposPrd, monedas, tiposIva] =
		await Promise.all([
			executeQuery(
				`SELECT IdRubro, RTRIM(Descripcion) AS Descripcion FROM dbo.Rubros ORDER BY Descripcion`,
			),
			executeQuery(
				`SELECT CODIGO AS IdSubRubro, RUBRO AS IdRubro, RTRIM(DESCRIPCION) AS Descripcion
         FROM dbo.SUBRUBRO ORDER BY DESCRIPCION`,
			),
			executeQuery(
				`SELECT RTRIM(IdUnidad) AS IdUnidad, RTRIM(Descripcion) AS Descripcion
         FROM dbo.Unidades ORDER BY Descripcion`,
			),
			executeQuery(
				`SELECT IdMarca, RTRIM(Descripcion) AS Descripcion FROM dbo.Tipos_Marcas ORDER BY Descripcion`,
			).catch(() => []),
			executeQuery(
				`SELECT IdColor, RTRIM(Descripcion) AS Descripcion FROM dbo.Tipos_Colores ORDER BY Descripcion`,
			).catch(() => []),
			executeQuery(
				`SELECT IdTipo_Prd AS IdTipoPrd, RTRIM(Descripcion) AS Descripcion FROM dbo.Tipos_Prd ORDER BY Descripcion`,
			).catch(() => []),
			executeQuery(
				`SELECT IdMoneda, RTRIM(Descripcion) AS Descripcion FROM dbo.Monedas ORDER BY IdMoneda`,
			).catch(() => []),
			executeQuery(
				`SELECT IdTipoIva, RTRIM(Descripcion) AS Descripcion, RTRIM(TipoIva) AS TipoIva
         FROM dbo.Tipos_Iva ORDER BY IdTipoIva`,
			).catch(() => []),
		]);
	const next = await nextId().catch(() => 1);
	return { rubros, subrubros, unidades, marcas, colores, tiposPrd, monedas, tiposIva, nextId: next };
}

async function listarCuentas({ search = '', limit = 40 } = {}) {
	const q = trim(search);
	const params = [];
	let where = '1=1';
	if (q) {
		where = `(
      CAST(IdCuenta AS VARCHAR(20)) LIKE @p0
      OR RTRIM(ISNULL(CodCuenta,'')) LIKE @p0
      OR RTRIM(ISNULL(Descripcion,'')) LIKE @p0
    )`;
		params.push({ value: `%${q}%`, type: 'NVarChar', length: 120 });
	}
	const lim = Math.min(80, Math.max(1, Number(limit) || 40));
	params.push({ value: lim, type: 'Int' });
	const rows = await executeQuery(
		`
    SELECT TOP (@p${params.length - 1})
      IdCuenta,
      RTRIM(CodCuenta) AS CodCuenta,
      RTRIM(Descripcion) AS Descripcion
    FROM dbo.Plan_Cuentas
    WHERE ${where}
    ORDER BY IdCuenta
    `,
		params,
	);
	return rows.map((r) => ({
		IdCuenta: r.IdCuenta,
		CodCuenta: trim(r.CodCuenta),
		Descripcion: trim(r.Descripcion),
		label: [trim(r.CodCuenta) || r.IdCuenta, trim(r.Descripcion)].filter(Boolean).join(' — '),
	}));
}

async function nextId() {
	const rows = await executeQuery(
		`SELECT ISNULL(MAX(IdProducto), 0) + 1 AS NextId FROM dbo.Productos WHERE IdProducto < 200000000`,
	);
	return rows[0]?.NextId || 1;
}

function pickPayload(body, current = null) {
	const desc = trim(body.Descripcion || body.descripcion) || current?.Descripcion;
	if (!desc) throw httpError('La descripción es obligatoria');
	const alias = trim(body.DescripcionC ?? body.Alias) || desc;
	const unidad = (trim(body.IdUnidad || body.unidad) || current?.IdUnidad || 'UN').slice(0, 3);
	const precioVenta = num(body.PrecioVenta) ?? current?.PrecioVenta ?? 0;
	const precioBase = num(body.PrecioBase) ?? current?.PrecioBase ?? precioVenta;
	return {
		CodAlternativo: (trim(body.CodAlternativo ?? body.codAlternativo) ?? current?.CodAlternativo ?? '').slice(
			0,
			20,
		),
		Descripcion: desc.slice(0, 150),
		DescripcionC: alias.slice(0, 150),
		IdRubro: body.IdRubro !== undefined ? num(body.IdRubro) : current?.IdRubro ?? null,
		IdSubRubro: body.IdSubRubro !== undefined ? num(body.IdSubRubro) : current?.IdSubRubro ?? null,
		IdLinea: body.IdLinea !== undefined ? num(body.IdLinea) : current?.IdLinea ?? null,
		IdStatus: body.IdStatus !== undefined ? num(body.IdStatus) : current?.IdStatus ?? 1,
		IdTipoMateria: (
			trim(body.IdTipoMateria ?? body.idtipo_materia) ??
			current?.IdTipoMateria ??
			''
		).slice(0, 5),
		IdUnidad: unidad,
		CBarra: (trim(body.CBarra) ?? current?.CBarra ?? '').slice(0, 20),
		IdTipoPrd: body.IdTipoPrd !== undefined ? num(body.IdTipoPrd) : current?.IdTipoPrd ?? null,
		IdMarca: body.IdMarca !== undefined ? num(body.IdMarca) : current?.IdMarca ?? null,
		IdColor: body.IdColor !== undefined ? num(body.IdColor) : current?.IdColor ?? null,
		IdMoneda: body.IdMoneda !== undefined ? num(body.IdMoneda) : current?.IdMoneda ?? 1,
		IdTipoIva: body.IdTipoIva !== undefined ? num(body.IdTipoIva) : current?.IdTipoIva ?? null,
		PrecioBase: precioBase,
		PrecioVenta: precioVenta,
		PrecioCosto: num(body.PrecioCosto) ?? current?.PrecioCosto ?? 0,
		PuntoPedido: num(body.PuntoPedido) ?? current?.PuntoPedido ?? 0,
		Cotizacion: num(body.Cotizacion) ?? current?.Cotizacion ?? 0,
		StockMinimo: num(body.StockMinimo) ?? current?.StockMinimo ?? 0,
		StockMaximo: num(body.StockMaximo) ?? current?.StockMaximo ?? 0,
		ControlarStock: flag01(
			body.ControlarStock !== undefined ? body.ControlarStock : current?.ControlarStock,
			1,
		),
		EnLista: flag01(body.EnLista !== undefined ? body.EnLista : current?.EnLista, 1),
		ConFabricacion: flag01(
			body.ConFabricacion !== undefined ? body.ConFabricacion : current?.ConFabricacion,
			0,
		),
		EsKit: flag01(body.EsKit !== undefined ? body.EsKit : current?.EsKit, 0),
		EsPartida: flag01(body.EsPartida !== undefined ? body.EsPartida : current?.EsPartida, 0),
		IdCtaVta: body.IdCtaVta !== undefined ? num(body.IdCtaVta) : current?.IdCtaVta ?? null,
		IdCtaCmpra: body.IdCtaCmpra !== undefined ? num(body.IdCtaCmpra) : current?.IdCtaCmpra ?? null,
		Texto: trim(body.Texto) ?? current?.Texto ?? null,
	};
}

async function crear(body, auth) {
	const id = body.IdProducto != null ? Number(body.IdProducto) : await nextId();
	if (!Number.isFinite(id) || id <= 0) throw httpError('Código de producto inválido');
	const exists = await executeQuery(`SELECT TOP 1 IdProducto FROM dbo.Productos WHERE IdProducto = @p0`, [
		{ value: id, type: 'Int' },
	]);
	if (exists.length) throw httpError(`Ya existe el producto ${id}`);

	const p = pickPayload(body);
	await executeQuery(
		`
    INSERT INTO dbo.Productos (
      IdProducto, Cod_Alternativo, Descripcion, DescripcionC,
      IdRubro, IdSubRubro, IdLinea, IdStatus, idtipo_materia,
      IdUnidad, CBarra, IdTipo_Prd, IdMarca, IdColor, idmoneda, idtipoiva,
      Precio_Base, PrecioVenta, PrecioCosto, Punto_Pedido, Costo_Reposicion,
      Stock_Minimo, Stock_Maximo,
      Controlar_Stock, En_Lista, Con_Fabricacion, EsKit, Es_Partida,
      IdCta_Vta, IdCta_Cmpra, Texto,
      EsVentas, EsCompras, aud_fecha, Aud_Usuario, Aud_Accion
    ) VALUES (
      @p0, @p1, @p2, @p3,
      @p4, @p5, @p6, @p7, @p8,
      @p9, @p10, @p11, @p12, @p13, @p14, @p15,
      @p16, @p17, @p18, @p19, @p20,
      @p21, @p22,
      @p23, @p24, @p25, @p26, @p27,
      @p28, @p29, @p30,
      1, 1, GETDATE(), @p31, 1
    )
    `,
		[
			{ value: id, type: 'Int' },
			{ value: p.CodAlternativo, type: 'Char', length: 20 },
			{ value: p.Descripcion, type: 'Char', length: 150 },
			{ value: p.DescripcionC, type: 'Char', length: 150 },
			{ value: p.IdRubro, type: 'SmallInt' },
			{ value: p.IdSubRubro, type: 'SmallInt' },
			{ value: p.IdLinea, type: 'SmallInt' },
			{ value: p.IdStatus, type: 'SmallInt' },
			{ value: p.IdTipoMateria || null, type: 'VarChar', length: 5 },
			{ value: p.IdUnidad, type: 'Char', length: 3 },
			{ value: p.CBarra, type: 'Char', length: 20 },
			{ value: p.IdTipoPrd, type: 'SmallInt' },
			{ value: p.IdMarca, type: 'SmallInt' },
			{ value: p.IdColor, type: 'SmallInt' },
			{ value: p.IdMoneda, type: 'SmallInt' },
			{ value: p.IdTipoIva, type: 'SmallInt' },
			{ value: p.PrecioBase, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.PrecioVenta, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.PrecioCosto, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.PuntoPedido, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.Cotizacion, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.StockMinimo, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.StockMaximo, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.ControlarStock, type: 'SmallInt' },
			{ value: p.EnLista, type: 'SmallInt' },
			{ value: p.ConFabricacion, type: 'SmallInt' },
			{ value: p.EsKit, type: 'SmallInt' },
			{ value: p.EsPartida, type: 'SmallInt' },
			{ value: p.IdCtaVta, type: 'Int' },
			{ value: p.IdCtaCmpra, type: 'Int' },
			{ value: p.Texto, type: 'VarChar', length: 4000 },
			{ value: auth?.idCodOperador != null ? Number(auth.idCodOperador) : null, type: 'SmallInt' },
		],
	);
	return obtener(id);
}

async function actualizar(id, body) {
	const current = await obtener(id);
	const p = pickPayload(body, current);

	await executeQuery(
		`
    UPDATE dbo.Productos SET
      Cod_Alternativo = @p1,
      Descripcion = @p2,
      DescripcionC = @p3,
      IdRubro = @p4,
      IdSubRubro = @p5,
      IdLinea = @p6,
      IdStatus = @p7,
      idtipo_materia = @p8,
      IdUnidad = @p9,
      CBarra = @p10,
      IdTipo_Prd = @p11,
      IdMarca = @p12,
      IdColor = @p13,
      idmoneda = @p14,
      idtipoiva = @p15,
      Precio_Base = @p16,
      PrecioVenta = @p17,
      PrecioCosto = @p18,
      Punto_Pedido = @p19,
      Costo_Reposicion = @p20,
      Stock_Minimo = @p21,
      Stock_Maximo = @p22,
      Controlar_Stock = @p23,
      En_Lista = @p24,
      Con_Fabricacion = @p25,
      EsKit = @p26,
      Es_Partida = @p27,
      IdCta_Vta = @p28,
      IdCta_Cmpra = @p29,
      Texto = @p30,
      aud_fecha = GETDATE(),
      Aud_Accion = 2
    WHERE IdProducto = @p0
    `,
		[
			{ value: Number(id), type: 'Int' },
			{ value: p.CodAlternativo, type: 'Char', length: 20 },
			{ value: p.Descripcion, type: 'Char', length: 150 },
			{ value: p.DescripcionC, type: 'Char', length: 150 },
			{ value: p.IdRubro, type: 'SmallInt' },
			{ value: p.IdSubRubro, type: 'SmallInt' },
			{ value: p.IdLinea, type: 'SmallInt' },
			{ value: p.IdStatus, type: 'SmallInt' },
			{ value: p.IdTipoMateria || null, type: 'VarChar', length: 5 },
			{ value: p.IdUnidad, type: 'Char', length: 3 },
			{ value: p.CBarra, type: 'Char', length: 20 },
			{ value: p.IdTipoPrd, type: 'SmallInt' },
			{ value: p.IdMarca, type: 'SmallInt' },
			{ value: p.IdColor, type: 'SmallInt' },
			{ value: p.IdMoneda, type: 'SmallInt' },
			{ value: p.IdTipoIva, type: 'SmallInt' },
			{ value: p.PrecioBase, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.PrecioVenta, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.PrecioCosto, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.PuntoPedido, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.Cotizacion, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.StockMinimo, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.StockMaximo, type: 'Numeric', precision: 18, scale: 4 },
			{ value: p.ControlarStock, type: 'SmallInt' },
			{ value: p.EnLista, type: 'SmallInt' },
			{ value: p.ConFabricacion, type: 'SmallInt' },
			{ value: p.EsKit, type: 'SmallInt' },
			{ value: p.EsPartida, type: 'SmallInt' },
			{ value: p.IdCtaVta, type: 'Int' },
			{ value: p.IdCtaCmpra, type: 'Int' },
			{ value: p.Texto, type: 'VarChar', length: 4000 },
		],
	);
	return obtener(id);
}

async function eliminar(id) {
	const used = await executeQuery(
		`SELECT TOP 1 IdTransaccion FROM dbo.RemitosItems WHERE IdProducto = @p0`,
		[{ value: Number(id), type: 'Int' }],
	);
	if (used.length) {
		throw httpError('No se puede borrar: el producto está usado en remitos', 409);
	}
	await executeQuery(`DELETE FROM dbo.Productos WHERE IdProducto = @p0`, [
		{ value: Number(id), type: 'Int' },
	]);
	return { ok: true };
}

module.exports = {
	listar,
	obtener,
	catalogos,
	listarCuentas,
	crear,
	actualizar,
	eliminar,
};
