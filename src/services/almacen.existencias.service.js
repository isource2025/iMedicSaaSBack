/**
 * Existencias Clarion: dbo.Stock + Productos + Depositos.
 *
 * Las cantidades sólo cambian por movimientos: remitos (almacen.remitos.service)
 * o ajustes AJU de este servicio, que numeran en Cbtes_Numeracion, crean la
 * Transacción y registran Stock_Mov (StockCod 5/6 ajuste, 7 stock inicial).
 */
const { executeQuery } = require('../models/db');
const grab = require('./almacen.remitos.grabacion');
const { httpError, trim, num, pagina, audUserDe, ahoraCtx, enTransaccion, sql } = require('./almacen.comun');

const DEFAULT_EMPRESA = 1;
const DEFAULT_SUCURSAL = 1;
const TIPO_AJUSTE = 'AJU';
const LETRA_AJUSTE = 'X';
const STOCK_COD = { AJUSTE_MAS: 5, AJUSTE_MENOS: 6, INICIAL_MAS: 7, INICIAL_MENOS: 8 };

/** Estado de nivel de una fila de Stock, en el mismo orden de prioridad que FILTRO_ESTADO. */
function estadoNivel(fisico, min, max, punto) {
	if (fisico <= 0) return 'sin';
	if (min > 0 && fisico < min) return 'bajo';
	if (punto > 0 && fisico <= punto) return 'reponer';
	if (max > 0 && fisico > max) return 'exceso';
	return 'ok';
}

/** Porcentaje de llenado: contra el máximo, o contra 2×mínimo si no hay máximo. */
function nivelPct(fisico, min, max) {
	const techo = max > 0 ? max : min > 0 ? min * 2 : 0;
	if (!techo) return null;
	return Math.max(0, Math.round((fisico / techo) * 100));
}

const FIS = 'ISNULL(s.Cant_Fisico, 0)';
const FILTRO_ESTADO = {
	sin: `${FIS} <= 0`,
	con: `${FIS} > 0`,
	bajo: `ISNULL(s.Stock_Minimo, 0) > 0 AND ${FIS} > 0 AND ${FIS} < s.Stock_Minimo`,
	reponer: `ISNULL(s.Punto_Pedido, 0) > 0 AND ${FIS} > 0 AND ${FIS} <= s.Punto_Pedido`,
	exceso: `ISNULL(s.Stock_Maximo, 0) > 0 AND ${FIS} > s.Stock_Maximo`,
	sinParametros: `ISNULL(s.Stock_Minimo, 0) = 0 AND ISNULL(s.Stock_Maximo, 0) = 0 AND ISNULL(s.Punto_Pedido, 0) = 0`,
};

function mapFila(row) {
	if (!row) return null;
	const fisico = num(row.Cant_Fisico) ?? 0;
	const disp = num(row.Cant_Disp) ?? fisico;
	const min = num(row.Stock_Minimo) ?? 0;
	const max = num(row.Stock_Maximo) ?? 0;
	const punto = num(row.Punto_Pedido) ?? 0;
	const estado = estadoNivel(fisico, min, max, punto);
	const precio = num(row.PrecioCosto) || num(row.PrecioVenta) || 0;
	return {
		IdProducto: row.IdProducto,
		IdEmpresa: row.IdEmpresa,
		IdSucursal: row.IdSucursal,
		IdDeposito: row.IdDeposito,
		DepositoNombre: trim(row.DepositoNombre) || String(row.IdDeposito),
		Fecha: row.Fecha || null,
		Ubicacion: trim(row.Ubicacion),
		StockMinimo: min,
		StockMaximo: max,
		PuntoPedido: punto,
		CantPendIng: num(row.Cant_PendIng),
		CantEnRec: num(row.Cant_EnRec),
		CantFisico: fisico,
		CantDisp: disp,
		CantComp: num(row.Cant_Comp),
		CodAlternativo: trim(row.Cod_Alternativo),
		Descripcion: trim(row.Descripcion) || trim(row.DescripcionC) || `Producto ${row.IdProducto}`,
		DescripcionC: trim(row.DescripcionC),
		IdUnidad: trim(row.IdUnidad),
		UnidadNombre: trim(row.UnidadNombre) || trim(row.IdUnidad),
		IdRubro: row.IdRubro,
		RubroNombre: trim(row.RubroNombre),
		TieneFoto: !!trim(row.Foto),
		Precio: precio,
		Valorizado: fisico > 0 ? fisico * precio : 0,
		estado,
		nivelPct: nivelPct(fisico, min, max),
		bajoMinimo: estado === 'bajo' || (estado === 'sin' && min > 0),
		bajoPunto: punto > 0 && fisico <= punto,
	};
}

const FROM_STOCK = `
  FROM dbo.Stock s
  LEFT JOIN dbo.Productos p ON p.IdProducto = s.IdProducto
  LEFT JOIN dbo.Depositos d ON d.IdDeposito = s.IdDeposito
  LEFT JOIN dbo.Rubros r ON r.IdRubro = p.IdRubro
  LEFT JOIN dbo.Unidades u ON u.IdUnidad = p.IdUnidad
`;

const SELECT_STOCK = `
  s.IdProducto, s.IdEmpresa, s.IdSucursal, s.IdDeposito, s.Fecha, s.Ubicacion,
  s.Stock_Minimo, s.Stock_Maximo, s.Punto_Pedido,
  s.Cant_PendIng, s.Cant_EnRec, s.Cant_Fisico, s.Cant_Disp, s.Cant_Comp,
  p.Cod_Alternativo, p.Descripcion, p.DescripcionC, p.IdUnidad, p.IdRubro, p.Foto,
  p.PrecioCosto, p.PrecioVenta,
  RTRIM(d.Descripcion) AS DepositoNombre,
  RTRIM(r.Descripcion) AS RubroNombre,
  RTRIM(u.Descripcion) AS UnidadNombre
`;

function filtros(opts = {}, { ignoreEstado = false } = {}) {
	const { search, idDeposito, idRubro, idProducto, estado, soloBajoMinimo } = opts;
	const where = ['1=1'];
	const params = [];
	const dep = num(idDeposito);
	if (dep != null) {
		where.push(`s.IdDeposito = @p${params.length}`);
		params.push({ value: dep, type: 'SmallInt' });
	}
	const rub = num(idRubro);
	if (rub != null) {
		where.push(`p.IdRubro = @p${params.length}`);
		params.push({ value: rub, type: 'SmallInt' });
	}
	const prod = num(idProducto);
	if (prod != null) {
		where.push(`s.IdProducto = @p${params.length}`);
		params.push({ value: prod, type: 'Int' });
	}
	const q = trim(search);
	if (q) {
		const i = params.length;
		where.push(`(
      CAST(s.IdProducto AS varchar(20)) LIKE @p${i}
      OR p.Cod_Alternativo LIKE @p${i}
      OR p.Descripcion LIKE @p${i}
      OR p.DescripcionC LIKE @p${i}
      OR p.CBarra LIKE @p${i}
      OR s.Ubicacion LIKE @p${i}
    )`);
		params.push({ value: `%${q}%`, type: 'NVarChar', length: 160 });
	}
	if (!ignoreEstado) {
		const est = soloBajoMinimo ? 'bajo' : trim(estado);
		if (est && FILTRO_ESTADO[est]) where.push(`(${FILTRO_ESTADO[est]})`);
	}
	return { whereSql: where.join(' AND '), params };
}

const ORDENES = {
	producto: 'ISNULL(NULLIF(RTRIM(p.Descripcion), \'\'), p.DescripcionC), s.IdProducto, s.IdDeposito',
	deposito: 'RTRIM(ISNULL(d.Descripcion, \'\')), ISNULL(NULLIF(RTRIM(p.Descripcion), \'\'), p.DescripcionC), s.IdProducto',
	cantidad: 'ISNULL(s.Cant_Fisico, 0) DESC, s.IdProducto',
	critico: `CASE WHEN ${FIS} <= 0 THEN 0 WHEN ISNULL(s.Stock_Minimo,0) > 0 AND ${FIS} < s.Stock_Minimo THEN 1
              WHEN ISNULL(s.Punto_Pedido,0) > 0 AND ${FIS} <= s.Punto_Pedido THEN 2 ELSE 3 END,
            ISNULL(s.Cant_Fisico, 0), s.IdProducto`,
	reciente: 's.Fecha DESC, s.IdProducto',
};

const ORDENES_PRODUCTO = {
	producto: 'ISNULL(NULLIF(RTRIM(MAX(p.Descripcion)), \'\'), MAX(p.DescripcionC)), s.IdProducto',
	deposito: 'ISNULL(NULLIF(RTRIM(MAX(p.Descripcion)), \'\'), MAX(p.DescripcionC)), s.IdProducto',
	cantidad: 'SUM(ISNULL(s.Cant_Fisico, 0)) DESC, s.IdProducto',
	critico: `CASE WHEN SUM(ISNULL(s.Cant_Fisico,0)) <= 0 THEN 0
              WHEN SUM(ISNULL(s.Stock_Minimo,0)) > 0 AND SUM(ISNULL(s.Cant_Fisico,0)) < SUM(ISNULL(s.Stock_Minimo,0)) THEN 1
              WHEN SUM(ISNULL(s.Punto_Pedido,0)) > 0 AND SUM(ISNULL(s.Cant_Fisico,0)) <= SUM(ISNULL(s.Punto_Pedido,0)) THEN 2
              ELSE 3 END,
            SUM(ISNULL(s.Cant_Fisico, 0)), s.IdProducto`,
	reciente: 'MAX(s.Fecha) DESC, s.IdProducto',
};

/**
 * Sin depósito: un renglón por producto con totales sumados.
 * Con depósito: un renglón por producto en ese depósito.
 */
async function listar(opts = {}) {
	const { page, pageSize, offset } = pagina(opts.page, opts.pageSize);
	const porProducto = num(opts.idDeposito) == null;

	if (porProducto) {
		const { whereSql, params } = filtros(opts, { ignoreEstado: true });
		const having = [];
		if (opts.soloBajoMinimo) {
			having.push(`SUM(ISNULL(s.Stock_Minimo, 0)) > 0`);
			having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) > 0`);
			having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) < SUM(ISNULL(s.Stock_Minimo, 0))`);
		} else {
			const est = trim(opts.estado);
			if (est === 'sin') having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) <= 0`);
			else if (est === 'con') having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) > 0`);
			else if (est === 'bajo') {
				having.push(`SUM(ISNULL(s.Stock_Minimo, 0)) > 0`);
				having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) > 0`);
				having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) < SUM(ISNULL(s.Stock_Minimo, 0))`);
			} else if (est === 'reponer') {
				having.push(`SUM(ISNULL(s.Punto_Pedido, 0)) > 0`);
				having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) > 0`);
				having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) <= SUM(ISNULL(s.Punto_Pedido, 0))`);
			} else if (est === 'exceso') {
				having.push(`SUM(ISNULL(s.Stock_Maximo, 0)) > 0`);
				having.push(`SUM(ISNULL(s.Cant_Fisico, 0)) > SUM(ISNULL(s.Stock_Maximo, 0))`);
			} else if (est === 'sinParametros') {
				having.push(`SUM(ISNULL(s.Stock_Minimo, 0)) = 0`);
				having.push(`SUM(ISNULL(s.Stock_Maximo, 0)) = 0`);
				having.push(`SUM(ISNULL(s.Punto_Pedido, 0)) = 0`);
			}
		}
		const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';
		const orden = ORDENES_PRODUCTO[opts.orden] || ORDENES_PRODUCTO.producto;

		const countRows = await executeQuery(
			`
      SELECT COUNT(*) AS Total FROM (
        SELECT s.IdProducto
        ${FROM_STOCK}
        WHERE ${whereSql}
        GROUP BY s.IdProducto
        ${havingSql}
      ) t
      `,
			params,
		);
		const total = Number(countRows?.[0]?.Total || 0);

		const rows = await executeQuery(
			`
      SELECT
        s.IdProducto,
        MAX(s.IdEmpresa) AS IdEmpresa,
        MAX(s.IdSucursal) AS IdSucursal,
        CAST(NULL AS smallint) AS IdDeposito,
        MAX(s.Fecha) AS Fecha,
        CAST(NULL AS varchar(30)) AS Ubicacion,
        SUM(ISNULL(s.Stock_Minimo, 0)) AS Stock_Minimo,
        SUM(ISNULL(s.Stock_Maximo, 0)) AS Stock_Maximo,
        SUM(ISNULL(s.Punto_Pedido, 0)) AS Punto_Pedido,
        SUM(ISNULL(s.Cant_PendIng, 0)) AS Cant_PendIng,
        SUM(ISNULL(s.Cant_EnRec, 0)) AS Cant_EnRec,
        SUM(ISNULL(s.Cant_Fisico, 0)) AS Cant_Fisico,
        SUM(ISNULL(s.Cant_Disp, 0)) AS Cant_Disp,
        SUM(ISNULL(s.Cant_Comp, 0)) AS Cant_Comp,
        MAX(p.Cod_Alternativo) AS Cod_Alternativo,
        MAX(p.Descripcion) AS Descripcion,
        MAX(p.DescripcionC) AS DescripcionC,
        MAX(p.IdUnidad) AS IdUnidad,
        MAX(p.IdRubro) AS IdRubro,
        MAX(p.Foto) AS Foto,
        MAX(p.PrecioCosto) AS PrecioCosto,
        MAX(p.PrecioVenta) AS PrecioVenta,
        CAST(NULL AS varchar(80)) AS DepositoNombre,
        MAX(RTRIM(r.Descripcion)) AS RubroNombre,
        MAX(RTRIM(u.Descripcion)) AS UnidadNombre,
        COUNT(DISTINCT s.IdDeposito) AS DepositosCount
      ${FROM_STOCK}
      WHERE ${whereSql}
      GROUP BY s.IdProducto
      ${havingSql}
      ORDER BY ${orden}
      OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
      `,
			[...params, { value: offset, type: 'Int' }, { value: pageSize, type: 'Int' }],
		);

		return {
			items: (rows || []).map((row) => {
				const item = mapFila(row);
				const n = Number(row.DepositosCount) || 0;
				item.IdDeposito = null;
				item.agrupado = true;
				item.DepositosCount = n;
				item.DepositoNombre = n <= 1 ? 'Total' : `Total · ${n} dep.`;
				return item;
			}),
			agrupadoPorProducto: true,
			total,
			page,
			pageSize,
			totalPages: Math.max(1, Math.ceil(total / pageSize)),
		};
	}

	const { whereSql, params } = filtros(opts);
	const orden = ORDENES[opts.orden] || ORDENES.deposito;

	const countRows = await executeQuery(`SELECT COUNT(*) AS Total ${FROM_STOCK} WHERE ${whereSql}`, params);
	const total = Number(countRows?.[0]?.Total || 0);

	const rows = await executeQuery(
		`
    SELECT ${SELECT_STOCK}
    ${FROM_STOCK}
    WHERE ${whereSql}
    ORDER BY ${orden}
    OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
    `,
		[...params, { value: offset, type: 'Int' }, { value: pageSize, type: 'Int' }],
	);

	return {
		items: (rows || []).map(mapFila),
		agrupadoPorProducto: false,
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize)),
	};
}

/** KPIs, distribución por depósito / rubro y actividad de los últimos 30 días. */
async function resumen({ idDeposito = null } = {}) {
	const { whereSql, params } = filtros({ idDeposito });
	const precio = 'ISNULL(NULLIF(p.PrecioCosto, 0), ISNULL(p.PrecioVenta, 0))';

	const [tot, porDeposito, porRubro, actividad] = await Promise.all([
		executeQuery(
			`
      SELECT
        COUNT(*) AS filas,
        COUNT(DISTINCT s.IdProducto) AS productos,
        COUNT(DISTINCT s.IdDeposito) AS depositos,
        SUM(CASE WHEN ${FILTRO_ESTADO.con} THEN 1 ELSE 0 END) AS conStock,
        SUM(CASE WHEN ${FILTRO_ESTADO.sin} THEN 1 ELSE 0 END) AS sinStock,
        SUM(CASE WHEN ${FILTRO_ESTADO.bajo} THEN 1 ELSE 0 END) AS bajoMinimo,
        SUM(CASE WHEN ${FILTRO_ESTADO.reponer} THEN 1 ELSE 0 END) AS aReponer,
        SUM(CASE WHEN ${FILTRO_ESTADO.exceso} THEN 1 ELSE 0 END) AS exceso,
        SUM(CASE WHEN ${FILTRO_ESTADO.sinParametros} THEN 0 ELSE 1 END) AS conParametros,
        SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico ELSE 0 END) AS unidades,
        SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico * ${precio} ELSE 0 END) AS valorizado
      ${FROM_STOCK}
      WHERE ${whereSql}
      `,
			params,
		),
		executeQuery(
			`
      SELECT TOP 10 s.IdDeposito, RTRIM(MAX(d.Descripcion)) AS Descripcion,
        COUNT(*) AS filas,
        SUM(CASE WHEN ${FILTRO_ESTADO.con} THEN 1 ELSE 0 END) AS conStock,
        SUM(CASE WHEN ${FILTRO_ESTADO.bajo} THEN 1 ELSE 0 END) AS bajoMinimo,
        SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico ELSE 0 END) AS unidades,
        SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico * ${precio} ELSE 0 END) AS valorizado
      ${FROM_STOCK}
      WHERE ${whereSql}
      GROUP BY s.IdDeposito
      ORDER BY SUM(CASE WHEN ${FILTRO_ESTADO.con} THEN 1 ELSE 0 END) DESC, COUNT(*) DESC
      `,
			params,
		),
		executeQuery(
			`
      SELECT p.IdRubro, RTRIM(MAX(r.Descripcion)) AS Descripcion,
        COUNT(*) AS filas,
        SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico ELSE 0 END) AS unidades,
        SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico * ${precio} ELSE 0 END) AS valorizado
      ${FROM_STOCK}
      WHERE ${whereSql}
      GROUP BY p.IdRubro
      ORDER BY SUM(CASE WHEN ${FIS} > 0 THEN s.Cant_Fisico ELSE 0 END) DESC
      `,
			params,
		),
		actividadDiaria({ idDeposito, dias: 30 }),
	]);

	const t = tot[0] || {};
	const filas = Number(t.filas || 0);
	const n = (v) => Number(v || 0);
	return {
		filas,
		productos: n(t.productos),
		depositos: n(t.depositos),
		conStock: n(t.conStock),
		sinStock: n(t.sinStock),
		bajoMinimo: n(t.bajoMinimo),
		aReponer: n(t.aReponer),
		exceso: n(t.exceso),
		conParametros: n(t.conParametros),
		unidades: n(t.unidades),
		valorizado: n(t.valorizado),
		pctConStock: filas ? Math.round((n(t.conStock) / filas) * 100) : 0,
		pctConParametros: filas ? Math.round((n(t.conParametros) / filas) * 100) : 0,
		porDeposito: porDeposito.map((d) => ({
			IdDeposito: d.IdDeposito,
			Descripcion: trim(d.Descripcion) || `Depósito ${d.IdDeposito}`,
			filas: n(d.filas),
			conStock: n(d.conStock),
			bajoMinimo: n(d.bajoMinimo),
			unidades: n(d.unidades),
			valorizado: n(d.valorizado),
		})),
		porRubro: porRubro.map((r) => ({
			IdRubro: r.IdRubro,
			Descripcion: trim(r.Descripcion) || 'Sin rubro',
			filas: n(r.filas),
			unidades: n(r.unidades),
			valorizado: n(r.valorizado),
		})),
		actividad,
	};
}

/**
 * Entradas / salidas por día: remitos confirmados que mueven stock + ajustes AJU.
 * (Los remitos web también tienen Stock_Mov; se toman de RemitosItems para no duplicar.)
 */
async function actividadDiaria({ idDeposito = null, idProducto = null, dias = 30 } = {}) {
	const params = [{ value: Math.min(365, Math.max(1, Number(dias) || 30)), type: 'Int' }];
	let fRem = '';
	let fMov = '';
	if (num(idDeposito) != null) {
		fRem += ` AND ri.IdDeposito = @p${params.length}`;
		fMov += ` AND m.IdDeposito = @p${params.length}`;
		params.push({ value: num(idDeposito), type: 'SmallInt' });
	}
	if (num(idProducto) != null) {
		fRem += ` AND ri.IdProducto = @p${params.length}`;
		fMov += ` AND m.IdProducto = @p${params.length}`;
		params.push({ value: num(idProducto), type: 'Int' });
	}
	const rows = await executeQuery(
		`
    DECLARE @desde datetime = DATEADD(day, -@p0 + 1, CAST(GETDATE() AS date));
    SELECT CONVERT(char(10), x.Dia, 23) AS Dia,
      SUM(CASE WHEN x.Cant > 0 THEN x.Cant ELSE 0 END) AS entradas,
      SUM(CASE WHEN x.Cant < 0 THEN -x.Cant ELSE 0 END) AS salidas
    FROM (
      SELECT CAST(r.Fecha AS date) AS Dia,
        CASE WHEN RTRIM(ri.Sentido) = 'S' THEN -ABS(ri.Cantidad) ELSE ABS(ri.Cantidad) END AS Cant
      FROM dbo.RemitosItems ri
      JOIN dbo.Remitos r ON r.IdTransaccion = ri.IdTransaccion
      LEFT JOIN dbo.Tipos_Remitos tr ON tr.IdTipo = r.Tipo_Cbte
      WHERE ri.IdStatus = ${grab.STATUS_CONFIRMADO} AND ISNULL(tr.stk_Fisico, 1) = 1
        AND r.Fecha >= @desde ${fRem}
      UNION ALL
      SELECT CAST(m.Fecha AS date), m.Cant_Fisico
      FROM dbo.Stock_Mov m
      WHERE m.TipoCbte = '${TIPO_AJUSTE}' AND m.IdStatus <> ${grab.STATUS_ANULADO}
        AND m.Fecha >= @desde ${fMov}
    ) x
    GROUP BY x.Dia
    ORDER BY x.Dia
    OPTION (RECOMPILE)
    `,
		params,
	);
	return rows.map((r) => ({ dia: r.Dia, entradas: Number(r.entradas || 0), salidas: Number(r.salidas || 0) }));
}

/**
 * Kardex: remitos confirmados que mueven stock + ajustes AJU, del más reciente al más viejo.
 * RemitosItems tiene millones de filas: sin producto se acota a `dias` y no se cuenta el total
 * (se devuelve `hasMore`).
 */
async function movimientos({ idProducto = null, idDeposito = null, dias = null, page = 1, pageSize = 30 } = {}) {
	const pg = pagina(page, pageSize, 100, 30);
	const params = [];
	let fRem = '';
	let fMov = '';
	if (num(idProducto) != null) {
		fRem += ` AND ri.IdProducto = @p${params.length}`;
		fMov += ` AND m.IdProducto = @p${params.length}`;
		params.push({ value: num(idProducto), type: 'Int' });
	}
	if (num(idDeposito) != null) {
		fRem += ` AND ri.IdDeposito = @p${params.length}`;
		fMov += ` AND m.IdDeposito = @p${params.length}`;
		params.push({ value: num(idDeposito), type: 'SmallInt' });
	}
	const ventana = num(dias) ?? (num(idProducto) != null ? null : 90);
	if (ventana != null) {
		const desde = `DATEADD(day, -@p${params.length}, CAST(GETDATE() AS date))`;
		fRem += ` AND r.Fecha >= ${desde}`;
		fMov += ` AND m.Fecha >= ${desde}`;
		params.push({ value: Math.min(3650, Math.max(1, ventana)), type: 'Int' });
	}
	const union = `
    SELECT 'REM' AS Origen, r.IdTransaccion, RTRIM(r.Tipo_Cbte) AS Tipo, r.Grupo_Cbte AS Grupo,
      RTRIM(r.Letra_Cbte) AS Letra, r.NroCbte AS Nro, r.Fecha, tx.Hora_D,
      ri.IdDeposito, ri.IdProducto,
      CASE WHEN RTRIM(ri.Sentido) = 'S' THEN -ABS(ri.Cantidad) ELSE ABS(ri.Cantidad) END AS Cantidad,
      RTRIM(tr.Descripcion) AS Concepto, ri.Aud_Usuario
    FROM dbo.RemitosItems ri
    JOIN dbo.Remitos r ON r.IdTransaccion = ri.IdTransaccion
    LEFT JOIN dbo.Transacciones tx ON tx.IdTransaccion = r.IdTransaccion
    LEFT JOIN dbo.Tipos_Remitos tr ON tr.IdTipo = r.Tipo_Cbte
    WHERE ri.IdStatus = ${grab.STATUS_CONFIRMADO} AND ISNULL(tr.stk_Fisico, 1) = 1 ${fRem}
    UNION ALL
    SELECT 'AJU', tx.IdTransaccion, RTRIM(m.TipoCbte), m.GrupoCbte, RTRIM(m.LetraCbte), m.NroCbte,
      m.Fecha, tx.Hora_D, m.IdDeposito, m.IdProducto, m.Cant_Fisico,
      COALESCE(NULLIF(RTRIM(tx.Descripcion), ''), RTRIM(sc.Descripcion)), m.Aud_Usuario
    FROM dbo.Stock_Mov m
    LEFT JOIN dbo.StockCod sc ON CAST(sc.Codigo AS varchar(3)) = RTRIM(m.Tipo_Mov)
    LEFT JOIN dbo.Transacciones tx ON tx.IdEmpresa = m.IdEmpresa AND tx.IdSucursal = m.IdSucursal
      AND tx.TipoCbte = m.TipoCbte AND tx.GrupoCbte = m.GrupoCbte AND tx.LetraCbte = m.LetraCbte AND tx.NroCbte = m.NroCbte
    WHERE m.TipoCbte = '${TIPO_AJUSTE}' AND m.IdStatus <> ${grab.STATUS_ANULADO} ${fMov}
  `;
	const rows = await executeQuery(
		`
    SELECT x.*, RTRIM(d.Descripcion) AS DepositoNombre,
      COALESCE(NULLIF(RTRIM(p.Descripcion), ''), RTRIM(p.DescripcionC)) AS ProductoNombre
    FROM (${union}) x
    LEFT JOIN dbo.Depositos d ON d.IdDeposito = x.IdDeposito
    LEFT JOIN dbo.Productos p ON p.IdProducto = x.IdProducto
    ORDER BY x.Fecha DESC, x.Hora_D DESC, x.IdTransaccion DESC
    OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY
    `,
		[...params, { value: pg.offset, type: 'Int' }, { value: pg.pageSize + 1, type: 'Int' }],
	);
	const hasMore = rows.length > pg.pageSize;
	return {
		items: rows.slice(0, pg.pageSize).map((r) => ({
			Origen: r.Origen,
			IdTransaccion: r.IdTransaccion,
			Comprobante: `${r.Tipo} ${r.Grupo}-${String(r.Nro).padStart(6, '0')}`,
			Fecha: r.Fecha,
			Hora: r.Hora_D ? new Date(r.Hora_D).toISOString().slice(11, 16) : null,
			IdDeposito: r.IdDeposito,
			DepositoNombre: trim(r.DepositoNombre) || String(r.IdDeposito),
			IdProducto: r.IdProducto,
			ProductoNombre: trim(r.ProductoNombre),
			Cantidad: Number(r.Cantidad || 0),
			Concepto: trim(r.Concepto),
		})),
		page: pg.page,
		pageSize: pg.pageSize,
		hasMore,
		dias: ventana,
	};
}

async function catalogos() {
	const [depositos, rubros] = await Promise.all([
		executeQuery(`
      SELECT IdDeposito, RTRIM(Descripcion) AS Descripcion, IdSector
      FROM dbo.Depositos
      ORDER BY RTRIM(Descripcion), IdDeposito
    `),
		executeQuery(`SELECT IdRubro, RTRIM(Descripcion) AS Descripcion FROM dbo.Rubros ORDER BY Descripcion`),
	]);
	return {
		depositos: (depositos || []).map((d) => ({
			IdDeposito: d.IdDeposito,
			Descripcion: trim(d.Descripcion) || String(d.IdDeposito),
			IdSector: trim(d.IdSector),
		})),
		rubros: (rubros || [])
			.map((r) => ({ IdRubro: r.IdRubro, Descripcion: trim(r.Descripcion) }))
			.filter((r) => r.Descripcion),
	};
}

// ── Escritura ────────────────────────────────────────────────────────────

function claveDe(src) {
	const idProducto = num(src.IdProducto);
	const idDeposito = num(src.IdDeposito);
	if (!idProducto) throw httpError('Falta el producto');
	if (idDeposito == null) throw httpError('Falta el depósito');
	return {
		idProducto,
		idDeposito,
		idEmpresa: num(src.IdEmpresa) || DEFAULT_EMPRESA,
		idSucursal: num(src.IdSucursal) || DEFAULT_SUCURSAL,
	};
}

function inputsClave(r, k) {
	return r
		.input('prod', sql.Int, k.idProducto)
		.input('dep', sql.SmallInt, k.idDeposito)
		.input('emp', sql.SmallInt, k.idEmpresa)
		.input('suc', sql.SmallInt, k.idSucursal);
}

const WHERE_CLAVE = 'IdEmpresa = @emp AND IdSucursal = @suc AND IdDeposito = @dep AND IdProducto = @prod';

function parametros(body, actual = {}) {
	const pick = (k, cur) => (body[k] !== undefined ? num(body[k]) ?? 0 : cur ?? 0);
	const out = {
		ubicacion: (body.Ubicacion !== undefined ? trim(body.Ubicacion) || '' : actual.Ubicacion || '').slice(0, 30),
		min: pick('StockMinimo', actual.StockMinimo),
		max: pick('StockMaximo', actual.StockMaximo),
		punto: pick('PuntoPedido', actual.PuntoPedido),
	};
	if (out.min < 0 || out.max < 0 || out.punto < 0) throw httpError('Los parámetros no pueden ser negativos');
	if (out.max > 0 && out.min > out.max) throw httpError('El stock mínimo no puede superar al máximo');
	if (out.max > 0 && out.punto > out.max) throw httpError('El punto de pedido no puede superar al máximo');
	return out;
}

async function leerFila(tx, k) {
	const r = await inputsClave(new sql.Request(tx), k).query(`
    SELECT IdProducto, IdDeposito, Cant_Fisico, Cant_Disp, Ubicacion,
           Stock_Minimo AS StockMinimo, Stock_Maximo AS StockMaximo, Punto_Pedido AS PuntoPedido
    FROM dbo.Stock WITH (UPDLOCK, HOLDLOCK) WHERE ${WHERE_CLAVE}
  `);
	return r.recordset[0] || null;
}

async function obtenerFila(k) {
	const rows = await executeQuery(
		`SELECT ${SELECT_STOCK} ${FROM_STOCK}
     WHERE s.IdEmpresa = @p0 AND s.IdSucursal = @p1 AND s.IdDeposito = @p2 AND s.IdProducto = @p3`,
		[
			{ value: k.idEmpresa, type: 'SmallInt' },
			{ value: k.idSucursal, type: 'SmallInt' },
			{ value: k.idDeposito, type: 'SmallInt' },
			{ value: k.idProducto, type: 'Int' },
		],
	);
	if (!rows.length) throw httpError('No existe stock de ese producto en el depósito', 404);
	return mapFila(rows[0]);
}

/** Cbtes_Numeracion AJU, contrastado con MAX(Stock_Mov.NroCbte) por si quedó atrasada. */
async function reservarNumeroAjuste(tx, { idEmpresa, idSucursal, grupo }) {
	const r = await new sql.Request(tx)
		.input('emp', sql.SmallInt, idEmpresa)
		.input('suc', sql.SmallInt, idSucursal)
		.input('tipo', sql.Char(3), TIPO_AJUSTE)
		.input('grupo', sql.SmallInt, grupo)
		.input('letra', sql.Char(1), LETRA_AJUSTE).query(`
      DECLARE @actual int, @existe bit = 0, @maxMov int, @nuevo int;
      SELECT @actual = NroCbte, @existe = 1
      FROM dbo.Cbtes_Numeracion WITH (UPDLOCK, HOLDLOCK)
      WHERE IdEmpresa = @emp AND IdSucursal = @suc AND Tipo_Cbte = @tipo AND Grupo_Cbte = @grupo AND Letra_Cbte = @letra;
      SELECT @maxMov = MAX(NroCbte) FROM dbo.Stock_Mov WITH (UPDLOCK, HOLDLOCK)
      WHERE IdEmpresa = @emp AND IdSucursal = @suc AND TipoCbte = @tipo AND GrupoCbte = @grupo AND LetraCbte = @letra;
      SET @nuevo = (CASE WHEN ISNULL(@actual, 0) > ISNULL(@maxMov, 0) THEN ISNULL(@actual, 0) ELSE ISNULL(@maxMov, 0) END) + 1;
      IF @existe = 1
        UPDATE dbo.Cbtes_Numeracion SET NroCbte = @nuevo
        WHERE IdEmpresa = @emp AND IdSucursal = @suc AND Tipo_Cbte = @tipo AND Grupo_Cbte = @grupo AND Letra_Cbte = @letra;
      ELSE
        INSERT INTO dbo.Cbtes_Numeracion (IdEmpresa, IdSucursal, Tipo_Cbte, Grupo_Cbte, Letra_Cbte, NroCbte)
        VALUES (@emp, @suc, @tipo, @grupo, @letra, @nuevo);
      SELECT @nuevo AS Nro;
    `);
	return r.recordset[0].Nro;
}

/**
 * Comprobante AJU de un renglón: Cbtes_Numeracion → Transacciones → Stock → Stock_Mov.
 * `tipoMov` es el código de dbo.StockCod.
 */
async function registrarAjuste(tx, k, { delta, tipoMov, motivo, audUser }) {
	const { ahora, fecha, anio } = ahoraCtx();
	const nro = await reservarNumeroAjuste(tx, { ...k, grupo: anio });
	const idTx = await grab.reservarIdTransaccion(tx);

	const prod = await new sql.Request(tx)
		.input('prod', sql.Int, k.idProducto)
		.query(`SELECT IdUnidad, PrecioCosto, PrecioVenta FROM dbo.Productos WHERE IdProducto = @prod`);
	const p = prod.recordset[0] || {};
	const precio = num(p.PrecioCosto) || num(p.PrecioVenta) || 0;
	const cant = Math.abs(delta);

	await new sql.Request(tx)
		.input('id', sql.Int, idTx)
		.input('emp', sql.SmallInt, k.idEmpresa)
		.input('suc', sql.SmallInt, k.idSucursal)
		.input('tipo', sql.Char(3), TIPO_AJUSTE)
		.input('grupo', sql.SmallInt, anio)
		.input('letra', sql.Char(1), LETRA_AJUSTE)
		.input('nro', sql.Int, nro)
		.input('empId', sql.Int, audUser)
		.input('desc', sql.Char(50), (trim(motivo) || 'Ajuste de stock').slice(0, 50))
		.input('fecha', sql.DateTime, fecha)
		.input('ahora', sql.DateTime, ahora)
		.input('audUser', sql.SmallInt, audUser).query(`
      INSERT INTO dbo.Transacciones (
        IdTransaccion, IdEmpresa, IdSucursal, TipoCbte, GrupoCbte, LetraCbte, NroCbte,
        IdEmpleado, Descripcion, NroEvento, IdStatus, Fecha, Hora_D,
        Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion
      ) VALUES (
        @id, @emp, @suc, @tipo, @grupo, @letra, @nro,
        @empId, @desc, 0, 1, @fecha, @ahora,
        @ahora, @ahora, @audUser, 1
      )
    `);

	await grab.moverStock(tx, { ...k, delta, ahora });

	await inputsClave(new sql.Request(tx), k)
		.input('tipo', sql.Char(3), TIPO_AJUSTE)
		.input('grupo', sql.SmallInt, anio)
		.input('letra', sql.Char(1), LETRA_AJUSTE)
		.input('nro', sql.Int, nro)
		.input('mov', sql.Char(3), String(tipoMov))
		.input('sent', sql.Char(1), delta > 0 ? 'E' : 'S')
		.input('status', sql.SmallInt, grab.STATUS_CONFIRMADO)
		.input('fecha', sql.DateTime, fecha)
		.input('uni', sql.Char(3), (trim(p.IdUnidad) || 'UN').slice(0, 3))
		.input('cant', sql.Decimal(18, 4), cant)
		.input('delta', sql.Decimal(18, 4), delta)
		.input('precio', sql.Decimal(18, 4), precio)
		.input('total', sql.Decimal(18, 4), precio * cant)
		.input('ahora', sql.DateTime, ahora)
		.input('audUser', sql.SmallInt, audUser).query(`
      INSERT INTO dbo.Stock_Mov (
        IdEmpresa, IdSucursal, TipoCbte, GrupoCbte, LetraCbte, NroCbte, NroRenglon,
        IdDeposito, Tipo_Mov, Sentido, IdStatus, Fecha, IdProducto, IdUnidad,
        Cantidad, Cant_PendIng, Cant_EnRec, Cant_Fisico, Cant_Disp, Cant_Comp, Cant_Consg,
        Cant_Recha, Cant_Transi, Cant_EnRep, Cant_Desuso, Cant_FServ,
        Precio, Importe_Total, Precio_PPP,
        Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion
      ) VALUES (
        @emp, @suc, @tipo, @grupo, @letra, @nro, 1,
        @dep, @mov, @sent, @status, @fecha, @prod, @uni,
        @cant, 0, 0, @delta, @delta, 0, 0,
        0, 0, 0, 0, 0,
        @precio, @total, @precio,
        @ahora, @ahora, @audUser, 1
      )
    `);

	return { IdTransaccion: idTx, Comprobante: `${TIPO_AJUSTE} ${anio}-${String(nro).padStart(6, '0')}`, NroCbte: nro };
}

async function validarReferencias(k) {
	const rows = await executeQuery(
		`SELECT
       (SELECT COUNT(*) FROM dbo.Productos WHERE IdProducto = @p0) AS prod,
       (SELECT COUNT(*) FROM dbo.Depositos WHERE IdDeposito = @p1) AS dep`,
		[
			{ value: k.idProducto, type: 'Int' },
			{ value: k.idDeposito, type: 'SmallInt' },
		],
	);
	if (!rows[0]?.prod) throw httpError('El producto no existe', 404);
	if (!rows[0]?.dep) throw httpError('El depósito no existe', 404);
}

/** Alta del producto en un depósito (parámetros + stock inicial opcional). */
async function crear(body, auth) {
	const k = claveDe(body);
	await validarReferencias(k);
	const par = parametros(body);
	const inicial = num(body.CantidadInicial) ?? 0;
	if (inicial < 0) throw httpError('El stock inicial no puede ser negativo');

	let ajuste = null;
	await enTransaccion(async (tx) => {
		if (await leerFila(tx, k)) throw httpError('El producto ya está dado de alta en ese depósito', 409);
		const { ahora } = ahoraCtx();
		await inputsClave(new sql.Request(tx), k)
			.input('ahora', sql.DateTime, ahora)
			.input('ubi', sql.VarChar(30), par.ubicacion)
			.input('min', sql.Decimal(18, 4), par.min)
			.input('max', sql.Decimal(18, 4), par.max)
			.input('punto', sql.Decimal(18, 4), par.punto).query(`
        INSERT INTO dbo.Stock (
          IdProducto, IdEmpresa, IdSucursal, IdDeposito, Fecha, Ubicacion,
          Stock_Minimo, Stock_Maximo, Punto_Pedido, Cant_PendIng, Cant_EnRec,
          Cant_Fisico, Cant_Disp, Cant_Comp, Cant_Consg, Cant_Recha, Cant_Transi,
          Cant_EnRep, Cant_Desuso, Cant_FServ
        ) VALUES (
          @prod, @emp, @suc, @dep, @ahora, @ubi,
          @min, @max, @punto, 0, 0,
          0, 0, 0, 0, 0, 0,
          0, 0, 0
        )
      `);
		if (inicial > 0) {
			ajuste = await registrarAjuste(tx, k, {
				delta: inicial,
				tipoMov: STOCK_COD.INICIAL_MAS,
				motivo: trim(body.Motivo) || 'Stock inicial',
				audUser: audUserDe(auth),
			});
		}
	});
	return { ...(await obtenerFila(k)), ajuste };
}

/** Parámetros de reposición y ubicación. Las cantidades no se editan acá (ver ajustar). */
async function actualizar(clave, body) {
	const k = claveDe(clave);
	await enTransaccion(async (tx) => {
		const actual = await leerFila(tx, k);
		if (!actual) throw httpError('No existe stock de ese producto en el depósito', 404);
		const par = parametros(body, { ...actual, Ubicacion: trim(actual.Ubicacion) });
		await inputsClave(new sql.Request(tx), k)
			.input('ubi', sql.VarChar(30), par.ubicacion)
			.input('min', sql.Decimal(18, 4), par.min)
			.input('max', sql.Decimal(18, 4), par.max)
			.input('punto', sql.Decimal(18, 4), par.punto).query(`
        UPDATE dbo.Stock SET Ubicacion = @ubi, Stock_Minimo = @min, Stock_Maximo = @max, Punto_Pedido = @punto
        WHERE ${WHERE_CLAVE}
      `);
	});
	return obtenerFila(k);
}

/**
 * Ajuste de cantidad. Modo `delta`: suma la cantidad (negativa resta).
 * Modo `conteo`: la cantidad es el físico contado y se ajusta la diferencia.
 */
async function ajustar(body, auth) {
	const k = claveDe(body);
	const modo = body.Modo === 'conteo' ? 'conteo' : 'delta';
	const cantidad = num(body.Cantidad);
	if (cantidad == null) throw httpError('Indicá la cantidad');
	if (modo === 'conteo' && cantidad < 0) throw httpError('El conteo no puede ser negativo');
	const motivo = trim(body.Motivo);
	if (!motivo) throw httpError('Indicá el motivo del ajuste');

	let ajuste = null;
	await enTransaccion(async (tx) => {
		const actual = await leerFila(tx, k);
		if (!actual) throw httpError('No existe stock de ese producto en el depósito', 404);
		const fisico = num(actual.Cant_Fisico) ?? 0;
		const delta = modo === 'conteo' ? cantidad - fisico : cantidad;
		if (Math.abs(delta) < 0.0001) throw httpError('La cantidad no cambia: no hay nada que ajustar');
		if (fisico + delta < 0) throw httpError(`El ajuste deja el stock en negativo (actual: ${fisico})`);
		ajuste = await registrarAjuste(tx, k, {
			delta,
			tipoMov: delta > 0 ? STOCK_COD.AJUSTE_MAS : STOCK_COD.AJUSTE_MENOS,
			motivo,
			audUser: audUserDe(auth),
		});
		ajuste.delta = delta;
	});
	return { ...(await obtenerFila(k)), ajuste };
}

/** Quita el producto del depósito; sólo si no tiene existencias (el historial queda en Stock_Mov). */
async function eliminar(clave) {
	const k = claveDe(clave);
	await enTransaccion(async (tx) => {
		const actual = await leerFila(tx, k);
		if (!actual) throw httpError('No existe stock de ese producto en el depósito', 404);
		if (Math.abs(num(actual.Cant_Fisico) ?? 0) > 0.0001 || Math.abs(num(actual.Cant_Disp) ?? 0) > 0.0001) {
			throw httpError('Tiene existencias: ajustá la cantidad a 0 antes de quitarlo del depósito', 409);
		}
		await inputsClave(new sql.Request(tx), k).query(`DELETE FROM dbo.Stock WHERE ${WHERE_CLAVE}`);
	});
	return { ok: true };
}

/** Stock de un producto en todos sus depósitos (ficha de producto). */
async function porProducto(idProducto) {
	const data = await listar({ idProducto, pageSize: 100, orden: 'cantidad' });
	return data.items;
}

module.exports = {
	listar,
	resumen,
	movimientos,
	actividadDiaria,
	catalogos,
	crear,
	actualizar,
	ajustar,
	eliminar,
	porProducto,
	estadoNivel,
	nivelPct,
};
