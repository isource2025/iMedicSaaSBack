/**
 * Catálogo Productos (tablas legacy Clarion: Productos, Rubros, SUBRUBRO, Unidades,
 * Tipos_Marcas). IdStatus NULL o 1 = activo; 0 = baja (Clarion deja NULL en la mayoría).
 * Productos.Foto guarda la ruta relativa de la imagen dentro de uploads/.
 */
const { executeQuery } = require('../models/db');
const { httpError, trim, num, audUserDe, esErrorSql } = require('./almacen.comun');

const STATUS_BAJA = 0;
const STATUS_ACTIVO = 1;

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
		Foto: trim(row.Foto),
		TieneFoto: !!trim(row.Foto),
		Activo: row.IdStatus == null || Number(row.IdStatus) !== STATUS_BAJA,
		StockTotal: row.StockTotal != null ? Number(row.StockTotal) : null,
		DepositosConStock: row.DepositosConStock != null ? Number(row.DepositosConStock) : null,
		DepositosBajoMinimo: row.DepositosBajoMinimo != null ? Number(row.DepositosBajoMinimo) : null,
	};
}

const STOCK_APPLY = `
  OUTER APPLY (
    SELECT SUM(CASE WHEN st.Cant_Fisico > 0 THEN st.Cant_Fisico ELSE 0 END) AS StockTotal,
           SUM(CASE WHEN st.Cant_Fisico > 0 THEN 1 ELSE 0 END) AS DepositosConStock,
           SUM(CASE WHEN st.Stock_Minimo > 0 AND ISNULL(st.Cant_Fisico, 0) < st.Stock_Minimo THEN 1 ELSE 0 END) AS DepositosBajoMinimo
    FROM dbo.Stock st WHERE st.IdProducto = p.IdProducto
  ) stk
`;

const SELECT_PRODUCTO = `
  p.IdProducto, p.Cod_Alternativo, p.Descripcion, p.DescripcionC,
  p.IdRubro, p.IdSubRubro, p.IdLinea, p.IdStatus, p.idtipo_materia,
  p.IdUnidad, p.CBarra, p.IdTipo_Prd, p.IdMarca, p.IdColor,
  p.idmoneda, p.idtipoiva,
  p.Precio_Base, p.PrecioVenta, p.PrecioCosto, p.Punto_Pedido, p.Costo_Reposicion,
  p.Stock_Minimo, p.Stock_Maximo,
  p.Controlar_Stock, p.En_Lista, p.Con_Fabricacion, p.EsKit, p.Es_Partida,
  p.IdCta_Vta, p.IdCta_Cmpra, p.Texto, p.Foto,
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

const FILTRO_STOCK = {
	con: `EXISTS (SELECT 1 FROM dbo.Stock st WHERE st.IdProducto = p.IdProducto AND st.Cant_Fisico > 0)`,
	sin: `NOT EXISTS (SELECT 1 FROM dbo.Stock st WHERE st.IdProducto = p.IdProducto AND st.Cant_Fisico > 0)`,
	bajo: `EXISTS (SELECT 1 FROM dbo.Stock st WHERE st.IdProducto = p.IdProducto
           AND st.Stock_Minimo > 0 AND ISNULL(st.Cant_Fisico, 0) < st.Stock_Minimo)`,
};

const ORDENES = {
	descripcion: `COALESCE(NULLIF(RTRIM(p.Descripcion), ''), RTRIM(p.DescripcionC)), p.IdProducto`,
	codigo: 'p.IdProducto',
	precio: 'ISNULL(p.PrecioVenta, 0) DESC, p.IdProducto',
	stock: 'ISNULL(stk.StockTotal, 0) DESC, p.IdProducto',
};

async function listar({
	search = '',
	campo = 'descripcion',
	idRubro = null,
	idSubRubro = null,
	estado = '',
	stock = '',
	conFoto = false,
	orden = 'descripcion',
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
	if (estado === 'activos') where.push(`ISNULL(p.IdStatus, ${STATUS_ACTIVO}) <> ${STATUS_BAJA}`);
	else if (estado === 'baja') where.push(`p.IdStatus = ${STATUS_BAJA}`);
	if (FILTRO_STOCK[stock]) where.push(FILTRO_STOCK[stock]);
	if (conFoto) where.push(`LEN(RTRIM(ISNULL(p.Foto, ''))) > 0`);

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
    SELECT ${SELECT_PRODUCTO}, stk.StockTotal, stk.DepositosConStock, stk.DepositosBajoMinimo
    ${FROM_PRODUCTO}
    ${STOCK_APPLY}
    WHERE ${whereSql}
    ORDER BY ${ORDENES[orden] || ORDENES.descripcion}
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
    SELECT TOP 1 ${SELECT_PRODUCTO}, stk.StockTotal, stk.DepositosConStock, stk.DepositosBajoMinimo
    ${FROM_PRODUCTO}
    ${STOCK_APPLY}
    WHERE p.IdProducto = @p0
    `,
		[{ value: Number(id), type: 'Int' }],
	);
	if (!rows.length) throw httpError('Producto no encontrado', 404);
	return mapProducto(rows[0]);
}

/** KPIs del catálogo para el tablero de productos. */
async function resumen() {
	const stockPorProducto = `
    LEFT JOIN (
      SELECT IdProducto,
        MAX(CASE WHEN Cant_Fisico > 0 THEN 1 ELSE 0 END) AS conStock,
        MAX(CASE WHEN Stock_Minimo > 0 AND ISNULL(Cant_Fisico, 0) < Stock_Minimo THEN 1 ELSE 0 END) AS bajo
      FROM dbo.Stock GROUP BY IdProducto
    ) sp ON sp.IdProducto = p.IdProducto
  `;
	const [tot, porRubro] = await Promise.all([
		executeQuery(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ISNULL(p.IdStatus, ${STATUS_ACTIVO}) <> ${STATUS_BAJA} THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN p.IdStatus = ${STATUS_BAJA} THEN 1 ELSE 0 END) AS bajas,
        SUM(CASE WHEN LEN(RTRIM(ISNULL(p.Foto, ''))) > 0 THEN 1 ELSE 0 END) AS conFoto,
        SUM(CASE WHEN ISNULL(p.PrecioVenta, 0) > 0 THEN 1 ELSE 0 END) AS conPrecio,
        SUM(CASE WHEN LEN(RTRIM(ISNULL(p.CBarra, ''))) > 0 THEN 1 ELSE 0 END) AS conBarra,
        SUM(ISNULL(sp.conStock, 0)) AS conStock,
        SUM(ISNULL(sp.bajo, 0)) AS bajoMinimo,
        (SELECT COUNT(DISTINCT IdProducto) FROM dbo.Proveedores_Prod) AS conProveedor
      FROM dbo.Productos p
      ${stockPorProducto}
    `),
		executeQuery(`
      SELECT p.IdRubro, RTRIM(MAX(r.Descripcion)) AS Descripcion, COUNT(*) AS cantidad,
        SUM(ISNULL(sp.conStock, 0)) AS conStock
      FROM dbo.Productos p
      LEFT JOIN dbo.Rubros r ON r.IdRubro = p.IdRubro
      ${stockPorProducto}
      WHERE ISNULL(p.IdStatus, ${STATUS_ACTIVO}) <> ${STATUS_BAJA}
      GROUP BY p.IdRubro
      ORDER BY COUNT(*) DESC
    `),
	]);
	const t = tot[0] || {};
	const n = (v) => Number(v || 0);
	const total = n(t.total);
	const pct = (v) => (total ? Math.round((n(v) / total) * 1000) / 10 : 0);
	return {
		total,
		activos: n(t.activos),
		bajas: n(t.bajas),
		conFoto: n(t.conFoto),
		conPrecio: n(t.conPrecio),
		conBarra: n(t.conBarra),
		conStock: n(t.conStock),
		bajoMinimo: n(t.bajoMinimo),
		conProveedor: n(t.conProveedor),
		pctActivos: pct(t.activos),
		pctConStock: pct(t.conStock),
		pctConPrecio: pct(t.conPrecio),
		pctConFoto: pct(t.conFoto),
		porRubro: porRubro.map((r) => ({
			IdRubro: r.IdRubro,
			Descripcion: trim(r.Descripcion) || 'Sin rubro',
			cantidad: n(r.cantidad),
			conStock: n(r.conStock),
		})),
	};
}

/** Ficha: producto + stock por depósito + proveedores + movimientos recientes. */
async function ficha(id) {
	const existencias = require('./almacen.existencias.service');
	const proveedores = require('./almacen.proveedores.service');
	const [producto, stock, provs, movs, actividad, uso] = await Promise.all([
		obtener(id),
		existencias.porProducto(id),
		proveedores.porProducto(id),
		existencias.movimientos({ idProducto: id, pageSize: 12 }),
		existencias.actividadDiaria({ idProducto: id, dias: 90 }),
		executeQuery(
			`SELECT COUNT(DISTINCT ri.IdTransaccion) AS remitos, MAX(r.Fecha) AS ultimo
       FROM dbo.RemitosItems ri JOIN dbo.Remitos r ON r.IdTransaccion = ri.IdTransaccion
       WHERE ri.IdProducto = @p0 AND ri.IdStatus <> 0`,
			[{ value: Number(id), type: 'Int' }],
		),
	]);
	return {
		producto,
		stock,
		proveedores: provs,
		movimientos: movs.items,
		actividad,
		remitos: Number(uso[0]?.remitos || 0),
		ultimoRemito: uso[0]?.ultimo || null,
	};
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
			{ value: audUserDe(auth), type: 'SmallInt' },
		],
	);
	return obtener(id);
}

async function actualizar(id, body, auth) {
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
      Aud_Usuario = @p31,
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
			{ value: audUserDe(auth), type: 'SmallInt' },
		],
	);
	return obtener(id);
}

async function cambiarEstado(id, activo, auth) {
	await obtener(id);
	await executeQuery(
		`UPDATE dbo.Productos SET IdStatus = @p1, aud_fecha = GETDATE(), Aud_Usuario = @p2, Aud_Accion = 2
     WHERE IdProducto = @p0`,
		[
			{ value: Number(id), type: 'Int' },
			{ value: activo ? STATUS_ACTIVO : STATUS_BAJA, type: 'SmallInt' },
			{ value: audUserDe(auth), type: 'SmallInt' },
		],
	);
	return obtener(id);
}

/**
 * Borra el producto si nunca se movió. Con remitos, movimientos, existencias o
 * proveedores asociados lo da de baja (IdStatus 0) para conservar la historia.
 */
async function eliminar(id, auth) {
	const idNum = Number(id);
	const uso = await executeQuery(
		`SELECT
       (SELECT COUNT(*) FROM dbo.RemitosItems WHERE IdProducto = @p0) AS remitos,
       (SELECT COUNT(*) FROM dbo.Stock_Mov WHERE IdProducto = @p0) AS movimientos,
       (SELECT COUNT(*) FROM dbo.Stock WHERE IdProducto = @p0 AND (ISNULL(Cant_Fisico, 0) <> 0 OR ISNULL(Cant_Disp, 0) <> 0)) AS existencias,
       (SELECT COUNT(*) FROM dbo.Proveedores_Prod WHERE IdProducto = @p0) AS proveedores`,
		[{ value: idNum, type: 'Int' }],
	);
	const u = uso[0] || {};
	if (Number(u.remitos) || Number(u.movimientos) || Number(u.existencias) || Number(u.proveedores)) {
		const producto = await cambiarEstado(idNum, false, auth);
		return { modo: 'baja', producto };
	}
	await obtener(idNum);
	const foto = await rutaFoto(idNum).catch(() => null);
	try {
		await executeQuery(
			`DELETE FROM dbo.Stock WHERE IdProducto = @p0;
       DELETE FROM dbo.Productos WHERE IdProducto = @p0;`,
			[{ value: idNum, type: 'Int' }],
		);
	} catch (e) {
		if (!esErrorSql(e, 547)) throw e;
		const producto = await cambiarEstado(idNum, false, auth);
		return { modo: 'baja', producto };
	}
	return { modo: 'eliminado', foto };
}

// ── Foto ────────────────────────────────────────────────────────────────

async function rutaFoto(id) {
	const rows = await executeQuery(`SELECT RTRIM(Foto) AS Foto FROM dbo.Productos WHERE IdProducto = @p0`, [
		{ value: Number(id), type: 'Int' },
	]);
	if (!rows.length) throw httpError('Producto no encontrado', 404);
	return trim(rows[0].Foto);
}

/** Guarda la ruta relativa (≤120) y devuelve la anterior para que el llamador la borre. */
async function guardarFoto(id, rutaRelativa, auth) {
	if (rutaRelativa && rutaRelativa.length > 120) throw httpError('Ruta de imagen demasiado larga');
	const anterior = await rutaFoto(id);
	await executeQuery(
		`UPDATE dbo.Productos SET Foto = @p1, aud_fecha = GETDATE(), Aud_Usuario = @p2, Aud_Accion = 2
     WHERE IdProducto = @p0`,
		[
			{ value: Number(id), type: 'Int' },
			{ value: rutaRelativa || null, type: 'Char', length: 120 },
			{ value: audUserDe(auth), type: 'SmallInt' },
		],
	);
	return anterior;
}

// ── Catálogos editables ─────────────────────────────────────────────────

/**
 * Tablas de clasificación con clave numérica MAX+1 (o char en Unidades).
 * `usoSql` cuenta productos que la referencian (bloquea el borrado).
 */
const CATALOGOS = {
	rubros: {
		tabla: 'dbo.Rubros',
		id: 'IdRubro',
		desc: 'Descripcion',
		largo: 60,
		usoSql: 'SELECT COUNT(*) AS n FROM dbo.Productos WHERE IdRubro = @id',
	},
	marcas: {
		tabla: 'dbo.Tipos_Marcas',
		id: 'IdMarca',
		desc: 'Descripcion',
		largo: 30,
		usoSql: 'SELECT COUNT(*) AS n FROM dbo.Productos WHERE IdMarca = @id',
	},
	unidades: {
		tabla: 'dbo.Unidades',
		id: 'IdUnidad',
		desc: 'Descripcion',
		largo: 40,
		idChar: 3,
		usoSql: 'SELECT COUNT(*) AS n FROM dbo.Productos WHERE IdUnidad = @id',
	},
	subrubros: {
		tabla: 'dbo.SUBRUBRO',
		id: 'CODIGO',
		desc: 'DESCRIPCION',
		largo: 40,
		padre: 'RUBRO',
		usoSql: 'SELECT COUNT(*) AS n FROM dbo.Productos WHERE IdSubRubro = @id AND IdRubro = @padre',
	},
};

function defCatalogo(nombre) {
	const def = CATALOGOS[nombre];
	if (!def) throw httpError('Catálogo inválido', 404);
	return def;
}

function idCatalogo(def, valor) {
	if (def.idChar) {
		const s = (trim(valor) || '').toUpperCase().slice(0, def.idChar);
		if (!s) throw httpError('Indicá el código');
		return { value: s, type: 'Char', length: def.idChar };
	}
	const n = num(valor);
	if (n == null || n <= 0) throw httpError('Código inválido');
	return { value: n, type: 'Int' };
}

async function guardarCatalogo(nombre, body, idExistente = null) {
	const def = defCatalogo(nombre);
	const desc = (trim(body.Descripcion) || '').toUpperCase().slice(0, def.largo);
	if (!desc) throw httpError('La descripción es obligatoria');
	const padre = def.padre ? num(body.IdRubro) : null;
	if (def.padre && padre == null) throw httpError('Indicá el rubro');

	const params = [{ value: desc, type: 'Char', length: def.largo }];
	const padreSql = def.padre ? ` AND ${def.padre} = @p2` : '';
	if (idExistente != null) {
		const idp = idCatalogo(def, idExistente);
		params.push(idp);
		if (def.padre) params.push({ value: padre, type: 'Int' });
		const r = await executeQuery(
			`UPDATE ${def.tabla} SET ${def.desc} = @p0 WHERE ${def.id} = @p1${padreSql}; SELECT @@ROWCOUNT AS n;`,
			params,
		);
		if (!r[0]?.n) throw httpError('Registro no encontrado', 404);
		return { id: idp.value, Descripcion: desc };
	}

	let idp;
	if (def.idChar) {
		idp = idCatalogo(def, body.Id);
	} else {
		const sig = await executeQuery(
			`SELECT ISNULL(MAX(${def.id}), 0) + 1 AS n FROM ${def.tabla}${
				def.padre ? ` WHERE ${def.padre} = @p0` : ''
			}`,
			def.padre ? [{ value: padre, type: 'Int' }] : [],
		);
		idp = { value: sig[0].n, type: 'Int' };
	}
	params.push(idp);
	if (def.padre) params.push({ value: padre, type: 'Int' });
	try {
		await executeQuery(
			`INSERT INTO ${def.tabla} (${def.desc}, ${def.id}${def.padre ? `, ${def.padre}` : ''})
       VALUES (@p0, @p1${def.padre ? ', @p2' : ''})`,
			params,
		);
	} catch (e) {
		if (esErrorSql(e, 2627, 2601)) throw httpError('Ya existe un registro con ese código o descripción', 409);
		throw e;
	}
	return { id: idp.value, Descripcion: desc };
}

async function eliminarCatalogo(nombre, id, query = {}) {
	const def = defCatalogo(nombre);
	const idp = idCatalogo(def, id);
	const padre = def.padre ? num(query.IdRubro) : null;
	if (def.padre && padre == null) throw httpError('Indicá el rubro');
	const params = [idp];
	if (def.padre) params.push({ value: padre, type: 'Int' });
	const usoSql = def.usoSql.replace('@id', '@p0').replace('@padre', '@p1');
	const uso = await executeQuery(usoSql, params);
	const n = Number(uso[0]?.n || 0);
	if (n) throw httpError(`No se puede borrar: lo usan ${n.toLocaleString('es-AR')} productos`, 409);
	const r = await executeQuery(
		`DELETE FROM ${def.tabla} WHERE ${def.id} = @p0${def.padre ? ` AND ${def.padre} = @p1` : ''}; SELECT @@ROWCOUNT AS n;`,
		params,
	);
	if (!r[0]?.n) throw httpError('Registro no encontrado', 404);
	return { ok: true };
}

module.exports = {
	listar,
	obtener,
	resumen,
	ficha,
	catalogos,
	listarCuentas,
	crear,
	actualizar,
	cambiarEstado,
	eliminar,
	rutaFoto,
	guardarFoto,
	guardarCatalogo,
	eliminarCatalogo,
	CATALOGOS,
};
