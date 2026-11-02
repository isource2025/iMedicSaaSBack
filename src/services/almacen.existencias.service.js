/**
 * Existencias Clarion: dbo.Stock + Productos + Depositos.
 * Consulta (primera slice); no escribe movimientos.
 */
const { executeQuery } = require('../models/db');

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

function mapFila(row) {
	if (!row) return null;
	const fisico = num(row.Cant_Fisico) ?? 0;
	const disp = num(row.Cant_Disp) ?? fisico;
	const min = num(row.Stock_Minimo);
	const max = num(row.Stock_Maximo);
	const punto = num(row.Punto_Pedido);
	const bajoMinimo = min != null && fisico < min;
	const bajoPunto = punto != null && fisico <= punto;
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
		CantConsg: num(row.Cant_Consg),
		CantRecha: num(row.Cant_Recha),
		CantTransi: num(row.Cant_Transi),
		CantEnRep: num(row.Cant_EnRep),
		CantDesuso: num(row.Cant_Desuso),
		CantFServ: num(row.Cant_FServ),
		CodAlternativo: trim(row.Cod_Alternativo),
		Descripcion: trim(row.Descripcion) || trim(row.DescripcionC) || `Producto ${row.IdProducto}`,
		DescripcionC: trim(row.DescripcionC),
		IdUnidad: trim(row.IdUnidad),
		UnidadNombre: trim(row.UnidadNombre) || trim(row.IdUnidad),
		IdRubro: row.IdRubro,
		RubroNombre: trim(row.RubroNombre),
		bajoMinimo,
		bajoPunto,
	};
}

async function listar({
	search = '',
	idDeposito = null,
	soloBajoMinimo = false,
	page = 1,
	pageSize = 40,
} = {}) {
	const p = Math.max(1, parseInt(page, 10) || 1);
	const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 40));
	const offset = (p - 1) * ps;
	const q = trim(search);
	const dep = idDeposito != null && idDeposito !== '' ? Number(idDeposito) : null;

	const where = ['1=1'];
	const params = [];

	if (dep != null && Number.isFinite(dep)) {
		where.push(`s.IdDeposito = @p${params.length}`);
		params.push({ value: dep, type: 'SmallInt' });
	}
	if (q) {
		const like = `%${q}%`;
		const i = params.length;
		where.push(`(
      CAST(s.IdProducto AS varchar(20)) LIKE @p${i}
      OR p.Cod_Alternativo LIKE @p${i}
      OR p.Descripcion LIKE @p${i}
      OR p.DescripcionC LIKE @p${i}
      OR p.CBarra LIKE @p${i}
    )`);
		params.push({ value: like });
	}
	if (soloBajoMinimo) {
		where.push(`s.Stock_Minimo IS NOT NULL AND s.Cant_Fisico < s.Stock_Minimo`);
	}

	const whereSql = where.join(' AND ');
	const from = `
    FROM dbo.Stock s
    LEFT JOIN dbo.Productos p ON p.IdProducto = s.IdProducto
    LEFT JOIN dbo.Depositos d ON d.IdDeposito = s.IdDeposito
    LEFT JOIN dbo.Rubros r ON r.IdRubro = p.IdRubro
    LEFT JOIN dbo.Unidades u ON u.IdUnidad = p.IdUnidad
    WHERE ${whereSql}
  `;

	const countRows = await executeQuery(`SELECT COUNT(*) AS Total ${from}`, params);
	const total = Number(countRows?.[0]?.Total || 0);

	const iOff = params.length;
	const iPs = params.length + 1;
	const rows = await executeQuery(
		`
    SELECT
      s.IdProducto, s.IdEmpresa, s.IdSucursal, s.IdDeposito, s.Fecha, s.Ubicacion,
      s.Stock_Minimo, s.Stock_Maximo, s.Punto_Pedido,
      s.Cant_PendIng, s.Cant_EnRec, s.Cant_Fisico, s.Cant_Disp,
      s.Cant_Comp, s.Cant_Consg, s.Cant_Recha, s.Cant_Transi,
      s.Cant_EnRep, s.Cant_Desuso, s.Cant_FServ,
      p.Cod_Alternativo, p.Descripcion, p.DescripcionC, p.IdUnidad, p.IdRubro,
      RTRIM(d.Descripcion) AS DepositoNombre,
      RTRIM(r.Descripcion) AS RubroNombre,
      RTRIM(u.Descripcion) AS UnidadNombre
    ${from}
    ORDER BY RTRIM(ISNULL(d.Descripcion, '')), ISNULL(p.Descripcion, p.DescripcionC), s.IdProducto
    OFFSET @p${iOff} ROWS FETCH NEXT @p${iPs} ROWS ONLY
    `,
		[...params, { value: offset, type: 'Int' }, { value: ps, type: 'Int' }],
	);

	return {
		items: (rows || []).map(mapFila),
		total,
		page: p,
		pageSize: ps,
		totalPages: Math.max(1, Math.ceil(total / ps)),
	};
}

async function catalogos() {
	const depositos = await executeQuery(`
    SELECT IdDeposito, RTRIM(Descripcion) AS Descripcion, IdSector
    FROM dbo.Depositos
    ORDER BY RTRIM(Descripcion), IdDeposito
  `);
	return {
		depositos: (depositos || []).map((d) => ({
			IdDeposito: d.IdDeposito,
			Descripcion: trim(d.Descripcion) || String(d.IdDeposito),
			IdSector: trim(d.IdSector),
		})),
	};
}

/**
 * Catálogo dbo.PROVEEDORES (Clarion), para Stock / Remitos.
 */
async function listarProveedores({ search = '', page = 1, pageSize = 40 } = {}) {
	const p = Math.max(1, parseInt(page, 10) || 1);
	const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 40));
	const offset = (p - 1) * ps;
	const q = trim(search);

	const where = ['1=1'];
	const params = [];
	if (q) {
		const like = `%${q}%`;
		const i = params.length;
		where.push(`(
      CAST(pr.IDPROVEEDOR AS varchar(20)) LIKE @p${i}
      OR pr.DESCRIPCION LIKE @p${i}
      OR pr.NOMBRE_FANTASIA LIKE @p${i}
      OR CAST(pr.NRO_CUIT AS varchar(30)) LIKE @p${i}
    )`);
		params.push({ value: like });
	}
	const whereSql = where.join(' AND ');
	const from = `FROM dbo.PROVEEDORES pr WHERE ${whereSql}`;

	const countRows = await executeQuery(`SELECT COUNT(*) AS Total ${from}`, params);
	const total = Number(countRows?.[0]?.Total || 0);

	const iOff = params.length;
	const iPs = params.length + 1;
	const rows = await executeQuery(
		`
    SELECT
      pr.IDPROVEEDOR AS IdProveedor,
      RTRIM(pr.DESCRIPCION) AS Descripcion,
      RTRIM(pr.NOMBRE_FANTASIA) AS NombreFantasia,
      pr.NRO_CUIT AS Cuit,
      pr.IDSTATUS AS IdStatus,
      RTRIM(pr.EMAIL) AS Email,
      RTRIM(pr.CALLE) AS Calle,
      pr.CALLE_NRO AS CalleNro,
      RTRIM(pr.IDCODPOSTAL) AS CodPostal
    ${from}
    ORDER BY RTRIM(pr.DESCRIPCION), pr.IDPROVEEDOR
    OFFSET @p${iOff} ROWS FETCH NEXT @p${iPs} ROWS ONLY
    `,
		[...params, { value: offset, type: 'Int' }, { value: ps, type: 'Int' }],
	);

	return {
		items: (rows || []).map((r) => ({
			IdProveedor: r.IdProveedor,
			Descripcion: trim(r.Descripcion) || `Proveedor ${r.IdProveedor}`,
			NombreFantasia: trim(r.NombreFantasia),
			Cuit: r.Cuit != null ? String(r.Cuit) : null,
			IdStatus: r.IdStatus,
			Email: trim(r.Email),
			Domicilio: [trim(r.Calle), r.CalleNro, trim(r.CodPostal)].filter(Boolean).join(' ') || null,
		})),
		total,
		page: p,
		pageSize: ps,
		totalPages: Math.max(1, Math.ceil(total / ps)),
	};
}

module.exports = {
	listar,
	catalogos,
	listarProveedores,
};
