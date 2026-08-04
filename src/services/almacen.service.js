/**
 * Servicio del módulo Almacén / Abastecimiento.
 *
 * Modelo:
 *  - Almacén (AG): depósito principal — atiende y repone. Compra al proveedor queda en el flujo actual
 *    (órdenes/actas) hasta que Compras sea un módulo aparte.
 *  - Sectores del hospital (imSectores + config): origen del pedido = sector del usuario.
 *  - Depositos intermedios (p.ej. Farmacia) se vinculan por configuración, no hardcode.
 */
const { executeQuery, getRequestPool, sql } = require('../models/db');
const { ensureAlmacenSchema } = require('./almacen.schema');
const cfg = require('./almacen.config.service');

function httpError(message, statusCode = 400) {
	const err = new Error(message);
	err.statusCode = statusCode;
	return err;
}

function num(v, def = 0) {
	const n = Number(v);
	return Number.isFinite(n) ? n : def;
}

function str(v, max) {
	const s = v == null ? '' : String(v).trim();
	return max ? s.slice(0, max) : s;
}

function dateOrNull(v) {
	if (!v) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

function opFromAuth(auth) {
	if (!auth) return null;
	const u = auth.usuario || auth;
	return (
		str(
			u.nombreRed ||
				u.user ||
				u.usuario ||
				u.codOperador ||
				u.matricula ||
				auth.nombreRed ||
				auth.user ||
				auth.usuario ||
				auth.matricula ||
				auth.idCodOperador,
			50,
		) || null
	);
}

async function ensure() {
	await ensureAlmacenSchema();
}

async function nextNumber(table, col, prefix = '') {
	const rows = await executeQuery(
		`SELECT ISNULL(MAX(TRY_CAST(REPLACE(${col}, '.', '') AS INT)), 0) AS maxN FROM ${table}`,
	);
	const next = (rows[0]?.maxN || 0) + 1;
	// Formato visual tipo hospital: 1.076
	const formatted = next.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return prefix ? `${prefix}${formatted}` : formatted;
}

async function proximoNroPedido() {
	await ensure();
	return { nroPedido: await nextNumber('dbo.imAlmacenSolicitud', 'NroPedido') };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard / Stock
// ─────────────────────────────────────────────────────────────────────────────

async function getResumen() {
	await ensure();
	void maybeAutoSyncVademecum();
	const [art, sol, ord, actas, stockMinTotal, porDep] = await Promise.all([
		executeQuery(`SELECT COUNT(*) AS n FROM dbo.imAlmacenArticulo WHERE Activo = 1`),
		executeQuery(
			`SELECT COUNT(*) AS n FROM dbo.imAlmacenSolicitud WHERE Estado IN (N'SOLICITADA', N'APROBADA', N'EN_COMPRA')`,
		),
		executeQuery(
			`SELECT COUNT(*) AS n FROM dbo.imAlmacenOrden WHERE Estado IN (N'EMITIDA', N'PARCIAL')`,
		),
		executeQuery(
			`SELECT COUNT(*) AS n FROM dbo.imAlmacenActa WHERE Fecha >= DATEADD(day, -30, CAST(GETDATE() AS DATE))`,
		),
		executeQuery(`
      SELECT COUNT(*) AS n
      FROM (
        SELECT a.IdArticulo, a.StockMinimo, ISNULL(SUM(s.Cantidad), 0) AS Stock
        FROM dbo.imAlmacenArticulo a
        LEFT JOIN dbo.imAlmacenStock s ON s.IdArticulo = a.IdArticulo
        WHERE a.Activo = 1 AND a.StockMinimo > 0
        GROUP BY a.IdArticulo, a.StockMinimo
        HAVING ISNULL(SUM(s.Cantidad), 0) < a.StockMinimo
      ) x
    `),
		executeQuery(`
      SELECT
        d.IdDeposito,
        d.Codigo,
        d.Nombre,
        d.EsPrincipal,
        (
          SELECT COUNT(*) FROM (
            SELECT a.IdArticulo, a.StockMinimo,
              ISNULL(SUM(s.Cantidad), 0) AS Stock
            FROM dbo.imAlmacenArticulo a
            LEFT JOIN dbo.imAlmacenStock s
              ON s.IdArticulo = a.IdArticulo AND s.IdDeposito = d.IdDeposito
            WHERE a.Activo = 1 AND a.StockMinimo > 0
            GROUP BY a.IdArticulo, a.StockMinimo
            HAVING ISNULL(SUM(s.Cantidad), 0) < a.StockMinimo
          ) x
        ) AS BajoMinimo
      FROM dbo.imAlmacenDeposito d
      WHERE d.Activo = 1
      ORDER BY d.EsPrincipal DESC, d.Nombre
    `),
	]);

	const bajoMinimoPorDeposito = (porDep || []).map((row) => ({
		idDeposito: row.IdDeposito,
		codigo: row.Codigo,
		nombre: row.Nombre,
		esPrincipal: !!(row.EsPrincipal === true || row.EsPrincipal === 1),
		bajoMinimo: Number(row.BajoMinimo) || 0,
	}));

	return {
		articulosActivos: art[0]?.n || 0,
		solicitudesPendientes: sol[0]?.n || 0,
		ordenesAbiertas: ord[0]?.n || 0,
		actasUltimos30Dias: actas[0]?.n || 0,
		articulosBajoMinimo: stockMinTotal[0]?.n || 0,
		bajoMinimoPorDeposito,
	};
}

async function getIdDepositoByCodigo(codigo) {
	const rows = await executeQuery(
		`SELECT TOP 1 IdDeposito FROM dbo.imAlmacenDeposito WHERE Codigo = @p0 AND Activo = 1`,
		[{ value: str(codigo, 20) }],
	);
	return rows?.[0]?.IdDeposito || null;
}

async function getIdDepositoPrincipal() {
	const rows = await executeQuery(`
    SELECT TOP 1 IdDeposito
    FROM dbo.imAlmacenDeposito
    WHERE Activo = 1
    ORDER BY EsPrincipal DESC, Nombre
  `);
	return rows?.[0]?.IdDeposito || null;
}

async function idDepositoParaOrigen(origenOrIdSector) {
	const byId = await cfg.idDepositoPorIdSector(origenOrIdSector);
	if (byId) return byId;
	return getIdDepositoPrincipal();
}

/**
 * Stock por depósito. Por defecto se espera id o código de depósito
 * (el front elige el principal). Sin depósito: solo renglones con cantidad ≠ 0.
 */
async function listarStock({
	search = '',
	idDeposito = null,
	codigoDeposito = null,
	soloBajoMinimo = false,
	incluirCero = false,
} = {}) {
	await ensure();
	let idDep = idDeposito ? Number(idDeposito) : null;
	if (!idDep && codigoDeposito) {
		idDep = await getIdDepositoByCodigo(codigoDeposito);
	}

	const useAgg = soloBajoMinimo || incluirCero || idDep || codigoDeposito;
	if (useAgg) {
		const params = [];
		const where = ['a.Activo = 1', 'd.Activo = 1'];
		let i = 0;
		if (search && search.trim()) {
			where.push(`(a.Codigo LIKE @p${i} OR a.Descripcion LIKE @p${i} OR ISNULL(a.TipoNombre,'') LIKE @p${i})`);
			params.push({ value: `%${search.trim()}%` });
			i += 1;
		}
		if (idDep) {
			where.push(`d.IdDeposito = @p${i}`);
			params.push({ value: Number(idDep) });
			i += 1;
		}

		let having = 'ISNULL(SUM(s.Cantidad), 0) <> 0';
		if (soloBajoMinimo) {
			having = 'a.StockMinimo > 0 AND ISNULL(SUM(s.Cantidad), 0) < a.StockMinimo';
		} else if (search && search.trim()) {
			// con búsqueda: incluir ceros para poder ajustar stock de un ítem del catálogo
			having = '1=1';
		} else if (idDep || incluirCero) {
			// Depósito: ítems con existencia o con mínimo configurado (alertas)
			having = 'ISNULL(SUM(s.Cantidad), 0) <> 0 OR a.StockMinimo > 0';
		}

		return (
			(await executeQuery(
				`
      SELECT
        a.IdArticulo, a.Codigo, a.Descripcion, a.UnidadMedida, a.StockMinimo,
        a.TipoCodigo, a.TipoNombre, a.Origen,
        d.IdDeposito, d.Codigo AS DepositoCodigo, d.Nombre AS Deposito,
        N'' AS Lote,
        ISNULL(SUM(s.Cantidad), 0) AS Cantidad,
        CAST(NULL AS DATE) AS FechaVencimiento,
        CASE WHEN a.StockMinimo > 0 AND ISNULL(SUM(s.Cantidad), 0) < a.StockMinimo THEN 1 ELSE 0 END AS BajoMinimo
      FROM dbo.imAlmacenArticulo a
      CROSS JOIN dbo.imAlmacenDeposito d
      LEFT JOIN dbo.imAlmacenStock s
        ON s.IdArticulo = a.IdArticulo AND s.IdDeposito = d.IdDeposito
      WHERE ${where.join(' AND ')}
      GROUP BY a.IdArticulo, a.Codigo, a.Descripcion, a.UnidadMedida, a.StockMinimo,
               a.TipoCodigo, a.TipoNombre, a.Origen,
               d.IdDeposito, d.Codigo, d.Nombre
      HAVING ${having}
      ORDER BY
        CASE WHEN a.StockMinimo > 0 AND ISNULL(SUM(s.Cantidad), 0) < a.StockMinimo THEN 0 ELSE 1 END,
        a.Descripcion, d.Nombre
      `,
				params,
			)) || []
		);
	}

	const params = [];
	const where = ['s.Cantidad <> 0'];
	if (search && search.trim()) {
		where.push(`(a.Codigo LIKE @p0 OR a.Descripcion LIKE @p0)`);
		params.push({ value: `%${search.trim()}%` });
	}

	return (
		(await executeQuery(
			`
    SELECT
      a.IdArticulo, a.Codigo, a.Descripcion, a.UnidadMedida, a.StockMinimo,
      a.TipoCodigo, a.TipoNombre, a.Origen,
      s.IdDeposito, d.Codigo AS DepositoCodigo, d.Nombre AS Deposito,
      s.Lote, s.Cantidad, s.FechaVencimiento,
      CASE WHEN a.StockMinimo > 0 AND s.Cantidad < a.StockMinimo THEN 1 ELSE 0 END AS BajoMinimo
    FROM dbo.imAlmacenStock s
    INNER JOIN dbo.imAlmacenArticulo a ON a.IdArticulo = s.IdArticulo
    INNER JOIN dbo.imAlmacenDeposito d ON d.IdDeposito = s.IdDeposito
    WHERE ${where.join(' AND ')}
    ORDER BY a.Descripcion, d.Nombre, s.Lote
    `,
			params,
		)) || []
	);
}

/** Pantalla Depósitos: un snapshot por depósito con barras por tipo de artículo. */
async function resumenDepositos() {
	await ensure();
	const depositos =
		(await executeQuery(`
      SELECT IdDeposito, Codigo, Nombre, EsPrincipal, Activo
      FROM dbo.imAlmacenDeposito
      WHERE Activo = 1
      ORDER BY EsPrincipal DESC, Nombre
    `)) || [];

	const porTipo =
		(await executeQuery(`
      SELECT
        d.IdDeposito,
        ISNULL(NULLIF(LTRIM(RTRIM(a.TipoCodigo)), N''), N'OTRO') AS TipoCodigo,
        ISNULL(NULLIF(LTRIM(RTRIM(a.TipoNombre)), N''), N'Sin tipo') AS TipoNombre,
        COUNT(DISTINCT a.IdArticulo) AS Items,
        SUM(CASE WHEN ISNULL(st.Cantidad, 0) > 0 THEN 1 ELSE 0 END) AS ItemsConStock,
        SUM(CASE WHEN a.StockMinimo > 0 AND ISNULL(st.Cantidad, 0) < a.StockMinimo THEN 1 ELSE 0 END) AS BajoMinimo,
        ISNULL(SUM(ISNULL(st.Cantidad, 0)), 0) AS StockTotal,
        ISNULL(SUM(a.StockMinimo), 0) AS StockMinimoTotal
      FROM dbo.imAlmacenDeposito d
      CROSS JOIN dbo.imAlmacenArticulo a
      LEFT JOIN (
        SELECT IdArticulo, IdDeposito, SUM(Cantidad) AS Cantidad
        FROM dbo.imAlmacenStock
        GROUP BY IdArticulo, IdDeposito
      ) st ON st.IdArticulo = a.IdArticulo AND st.IdDeposito = d.IdDeposito
      WHERE d.Activo = 1 AND a.Activo = 1
      GROUP BY d.IdDeposito,
        ISNULL(NULLIF(LTRIM(RTRIM(a.TipoCodigo)), N''), N'OTRO'),
        ISNULL(NULLIF(LTRIM(RTRIM(a.TipoNombre)), N''), N'Sin tipo')
      ORDER BY d.IdDeposito,
        ISNULL(NULLIF(LTRIM(RTRIM(a.TipoNombre)), N''), N'Sin tipo')
    `)) || [];

	const totales =
		(await executeQuery(`
      SELECT
        d.IdDeposito,
        COUNT(DISTINCT a.IdArticulo) AS ItemsCatalogo,
        ISNULL(SUM(ISNULL(st.Cantidad, 0)), 0) AS StockTotal,
        SUM(CASE WHEN a.StockMinimo > 0 AND ISNULL(st.Cantidad, 0) < a.StockMinimo THEN 1 ELSE 0 END) AS BajoMinimo
      FROM dbo.imAlmacenDeposito d
      CROSS JOIN dbo.imAlmacenArticulo a
      LEFT JOIN (
        SELECT IdArticulo, IdDeposito, SUM(Cantidad) AS Cantidad
        FROM dbo.imAlmacenStock
        GROUP BY IdArticulo, IdDeposito
      ) st ON st.IdArticulo = a.IdArticulo AND st.IdDeposito = d.IdDeposito
      WHERE d.Activo = 1 AND a.Activo = 1
      GROUP BY d.IdDeposito
    `)) || [];

	const tipoMap = new Map();
	for (const row of porTipo) {
		const list = tipoMap.get(row.IdDeposito) || [];
		const minTarget = Number(row.StockMinimoTotal) || 0;
		const stock = Number(row.StockTotal) || 0;
		const items = Number(row.Items) || 0;
		const conStock = Number(row.ItemsConStock) || 0;
		let porcentaje = 0;
		if (minTarget > 0) {
			porcentaje = Math.min(100, Math.round((stock / minTarget) * 1000) / 10);
		} else if (items > 0) {
			porcentaje = Math.round((conStock / items) * 1000) / 10;
		}
		list.push({
			tipoCodigo: row.TipoCodigo,
			tipoNombre: row.TipoNombre,
			items,
			itemsConStock: conStock,
			bajoMinimo: Number(row.BajoMinimo) || 0,
			stockTotal: stock,
			stockMinimoTotal: minTarget,
			porcentaje,
		});
		tipoMap.set(row.IdDeposito, list);
	}

	const totMap = new Map(totales.map((t) => [t.IdDeposito, t]));

	const limpiarTipos = (list = []) => {
		const isOtros = (t) => {
			const code = String(t.tipoCodigo || '').toUpperCase();
			const name = String(t.tipoNombre || '').toLowerCase();
			return (
				code === 'OTRO' ||
				code === '' ||
				name === 'sin tipo' ||
				name === 'otros' ||
				name === 'sin categoría'
			);
		};
		const main = list
			.filter((t) => !isOtros(t))
			.sort((a, b) => (b.items || 0) - (a.items || 0) || (b.stockTotal || 0) - (a.stockTotal || 0));
		// Top 2 tipados nombrados + resto (otros tipos + sin tipar) en "Otros"
		const top = main.slice(0, 2);
		const otrosSource = [...main.slice(2), ...list.filter(isOtros)];
		if (otrosSource.length) {
			const agg = otrosSource.reduce(
				(acc, t) => {
					acc.items += t.items || 0;
					acc.itemsConStock += t.itemsConStock || 0;
					acc.bajoMinimo += t.bajoMinimo || 0;
					acc.stockTotal += t.stockTotal || 0;
					acc.stockMinimoTotal += t.stockMinimoTotal || 0;
					return acc;
				},
				{
					tipoCodigo: 'OTRO',
					tipoNombre: 'Otros',
					items: 0,
					itemsConStock: 0,
					bajoMinimo: 0,
					stockTotal: 0,
					stockMinimoTotal: 0,
					porcentaje: 0,
				},
			);
			if (agg.stockMinimoTotal > 0) {
				agg.porcentaje = Math.min(100, Math.round((agg.stockTotal / agg.stockMinimoTotal) * 1000) / 10);
			} else if (agg.items > 0) {
				agg.porcentaje = Math.round((agg.itemsConStock / agg.items) * 1000) / 10;
			}
			if (agg.items > 0 || agg.stockTotal > 0) top.push(agg);
		}
		return top.slice(0, 3);
	};

	return depositos.map((d) => {
		const t = totMap.get(d.IdDeposito) || {};
		return {
			...d,
			itemsCatalogo: Number(t.ItemsCatalogo) || 0,
			stockTotal: Number(t.StockTotal) || 0,
			bajoMinimo: Number(t.BajoMinimo) || 0,
			porTipo: limpiarTipos(tipoMap.get(d.IdDeposito) || []),
		};
	});
}

function mapTipoVademecum(tipoMedicamento) {
	const t = str(tipoMedicamento, 20).toUpperCase();
	if (t === 'DESC') return { codigo: 'DESC', nombre: 'Descartables' };
	if (t === 'MED' || t === 'MEDI') return { codigo: 'MEDI', nombre: 'Medicamentos' };
	if (!t) return { codigo: 'OTRO', nombre: 'Otros' };
	return { codigo: t.slice(0, 20), nombre: t };
}

async function importarDesdeVademecum({ soloActivos = true, reactivar = true } = {}) {
	await ensure();
	const hasTable = await executeQuery(`
    SELECT CASE WHEN OBJECT_ID('dbo.imVademecum', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok
  `);
	if (!hasTable?.[0]?.ok) {
		throw httpError('No existe la tabla imVademecum en la base del hospital', 404);
	}

	const bajaFilter = soloActivos
		? `AND (v.Baja IS NULL OR LTRIM(RTRIM(v.Baja)) NOT IN ('S', '1', 'B'))`
		: '';

	const baseWhere = `
    v.Troquel > 0
    AND LTRIM(RTRIM(ISNULL(v.Alias, ISNULL(v.Descripcion, '')))) <> ''
    ${bajaFilter}
  `;

	const [prevUpdate, prevInsert] = await Promise.all([
		executeQuery(`
      SELECT COUNT(*) AS n
      FROM dbo.imAlmacenArticulo a
      INNER JOIN dbo.imVademecum v ON a.Codigo = CAST(v.Troquel AS NVARCHAR(50))
      WHERE ${baseWhere}
    `),
		executeQuery(`
      SELECT COUNT(*) AS n
      FROM dbo.imVademecum v
      WHERE ${baseWhere}
        AND NOT EXISTS (
          SELECT 1 FROM dbo.imAlmacenArticulo a
          WHERE a.Codigo = CAST(v.Troquel AS NVARCHAR(50))
        )
    `),
	]);

	// Actualizar existentes (por código = Troquel)
	await executeQuery(`
    UPDATE a SET
      a.Descripcion = LEFT(LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(v.Alias)), ''), v.Descripcion))), 300),
      a.UnidadMedida = COALESCE(NULLIF(LTRIM(RTRIM(v.UNIDAD)), ''), a.UnidadMedida, N'UNIDAD'),
      a.TipoCodigo = CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) = 'DESC' THEN N'DESC'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) IN ('MED', 'MEDI') THEN N'MEDI'
        WHEN LTRIM(RTRIM(ISNULL(v.TipoMedicamento, ''))) = '' THEN N'OTRO'
        ELSE LEFT(UPPER(LTRIM(RTRIM(v.TipoMedicamento))), 20)
      END,
      a.TipoNombre = CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) = 'DESC' THEN N'Descartables'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) IN ('MED', 'MEDI') THEN N'Medicamentos'
        WHEN LTRIM(RTRIM(ISNULL(v.TipoMedicamento, ''))) = '' THEN N'Otros'
        ELSE LEFT(LTRIM(RTRIM(v.TipoMedicamento)), 80)
      END,
      a.Origen = N'VADE'
      ${reactivar ? ', a.Activo = 1' : ''}
    FROM dbo.imAlmacenArticulo a
    INNER JOIN dbo.imVademecum v ON a.Codigo = CAST(v.Troquel AS NVARCHAR(50))
    WHERE ${baseWhere}
  `);

	await executeQuery(`
    INSERT INTO dbo.imAlmacenArticulo
      (Codigo, Descripcion, UnidadMedida, StockMinimo, Activo, Observaciones, TipoCodigo, TipoNombre, Origen, OperAlta)
    SELECT
      CAST(v.Troquel AS NVARCHAR(50)),
      LEFT(LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(v.Alias)), ''), v.Descripcion))), 300),
      COALESCE(NULLIF(LTRIM(RTRIM(v.UNIDAD)), ''), N'UNIDAD'),
      0,
      1,
      N'Importado desde vademécum',
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) = 'DESC' THEN N'DESC'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) IN ('MED', 'MEDI') THEN N'MEDI'
        WHEN LTRIM(RTRIM(ISNULL(v.TipoMedicamento, ''))) = '' THEN N'OTRO'
        ELSE LEFT(UPPER(LTRIM(RTRIM(v.TipoMedicamento))), 20)
      END,
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) = 'DESC' THEN N'Descartables'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(v.TipoMedicamento, '')))) IN ('MED', 'MEDI') THEN N'Medicamentos'
        WHEN LTRIM(RTRIM(ISNULL(v.TipoMedicamento, ''))) = '' THEN N'Otros'
        ELSE LEFT(LTRIM(RTRIM(v.TipoMedicamento)), 80)
      END,
      N'VADE',
      N'vademecum'
    FROM dbo.imVademecum v
    WHERE ${baseWhere}
      AND NOT EXISTS (
        SELECT 1 FROM dbo.imAlmacenArticulo a
        WHERE a.Codigo = CAST(v.Troquel AS NVARCHAR(50))
      )
  `);

	await setMeta('vademecum.ultimaSync', new Date().toISOString());
	const ultimaSync = await getMeta('vademecum.ultimaSync');
	const [vad, imp, arts] = await Promise.all([
		executeQuery(`
      SELECT COUNT(*) AS n FROM dbo.imVademecum
      WHERE Troquel > 0
        AND LTRIM(RTRIM(ISNULL(Alias, ISNULL(Descripcion, '')))) <> ''
        AND (Baja IS NULL OR LTRIM(RTRIM(Baja)) NOT IN ('S', '1', 'B'))
    `),
		executeQuery(`
      SELECT COUNT(*) AS n FROM dbo.imAlmacenArticulo WHERE Origen = N'VADE' AND Activo = 1
    `),
		executeQuery(`SELECT COUNT(*) AS n FROM dbo.imAlmacenArticulo WHERE Activo = 1`),
	]);
	return {
		actualizados: Number(prevUpdate?.[0]?.n) || 0,
		insertados: Number(prevInsert?.[0]?.n) || 0,
		disponible: true,
		enVademecum: vad?.[0]?.n || 0,
		importados: imp?.[0]?.n || 0,
		articulosActivos: arts?.[0]?.n || 0,
		ultimaSync,
		autoSync: true,
		nota: 'Catálogo sincronizado desde imVademecum. Las cantidades se cargan con actas de recepción o ajustes de stock.',
	};
}

async function getMeta(clave) {
	const rows = await executeQuery(
		`SELECT Valor, FechaActualizacion FROM dbo.imAlmacenMeta WHERE Clave = @p0`,
		[{ value: str(clave, 80) }],
	);
	return rows?.[0]?.Valor || null;
}

async function setMeta(clave, valor) {
	await executeQuery(
		`
    MERGE dbo.imAlmacenMeta AS t
    USING (SELECT @p0 AS Clave, @p1 AS Valor) AS s
    ON t.Clave = s.Clave
    WHEN MATCHED THEN UPDATE SET Valor = s.Valor, FechaActualizacion = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (Clave, Valor) VALUES (s.Clave, s.Valor);
    `,
		[{ value: str(clave, 80) }, { value: str(valor, 400) }],
	);
}

/** Sync vademécum máximo 1 vez cada 24h (y a lo sumo un check cada 2 min por proceso). */
let lastVadCheckMs = 0;
let vadSyncRunning = null;

async function maybeAutoSyncVademecum() {
	const now = Date.now();
	if (now - lastVadCheckMs < 2 * 60 * 1000) return null;
	lastVadCheckMs = now;
	if (vadSyncRunning) return vadSyncRunning;

	vadSyncRunning = (async () => {
		try {
			await ensure();
			const last = await getMeta('vademecum.ultimaSync');
			const lastMs = last ? Date.parse(last) : 0;
			const age = lastMs ? now - lastMs : Infinity;
			if (age < 24 * 60 * 60 * 1000) {
				return { skipped: true, ultimaSync: last };
			}
			const r = await importarDesdeVademecum({});
			return { skipped: false, ...r };
		} catch (e) {
			console.warn('[almacen] auto-sync vademécum:', e.message);
			return { skipped: true, error: e.message };
		} finally {
			vadSyncRunning = null;
		}
	})();
	return vadSyncRunning;
}

/** Estado del catálogo hospitalario imVademecum vs artículos de almacén. */
async function estadoVademecum() {
	await ensure();
	void maybeAutoSyncVademecum();
	const hasTable = await executeQuery(`
    SELECT CASE WHEN OBJECT_ID('dbo.imVademecum', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok
  `);
	if (!hasTable?.[0]?.ok) {
		return {
			disponible: false,
			enVademecum: 0,
			importados: 0,
			mensaje: 'No hay tabla imVademecum en esta base',
			ultimaSync: null,
			autoSync: true,
		};
	}
	const [vad, imp, arts] = await Promise.all([
		executeQuery(`
      SELECT COUNT(*) AS n FROM dbo.imVademecum
      WHERE Troquel > 0
        AND LTRIM(RTRIM(ISNULL(Alias, ISNULL(Descripcion, '')))) <> ''
        AND (Baja IS NULL OR LTRIM(RTRIM(Baja)) NOT IN ('S', '1', 'B'))
    `),
		executeQuery(`
      SELECT COUNT(*) AS n FROM dbo.imAlmacenArticulo WHERE Origen = N'VADE' AND Activo = 1
    `),
		executeQuery(`SELECT COUNT(*) AS n FROM dbo.imAlmacenArticulo WHERE Activo = 1`),
	]);
	return {
		disponible: true,
		enVademecum: vad?.[0]?.n || 0,
		importados: imp?.[0]?.n || 0,
		articulosActivos: arts?.[0]?.n || 0,
		mensaje: null,
		ultimaSync: await getMeta('vademecum.ultimaSync'),
		autoSync: true,
	};
}

async function listarMovimientos({ limit = 100, idArticulo = null } = {}) {
	await ensure();
	const params = [];
	const where = ['1=1'];
	if (idArticulo) {
		where.push('m.IdArticulo = @p0');
		params.push({ value: Number(idArticulo) });
	}
	const top = Math.min(Math.max(Number(limit) || 100, 1), 500);
	return (
		(await executeQuery(
			`
    SELECT TOP (${top})
      m.IdMovimiento, m.Tipo, m.IdArticulo, a.Codigo, a.Descripcion,
      m.IdDeposito, d.Nombre AS Deposito, m.Lote, m.Cantidad, m.SaldoResultante,
      m.IdDocumento, m.TipoDocumento, m.Observaciones, m.Fecha, m.Operador
    FROM dbo.imAlmacenMovimiento m
    INNER JOIN dbo.imAlmacenArticulo a ON a.IdArticulo = m.IdArticulo
    INNER JOIN dbo.imAlmacenDeposito d ON d.IdDeposito = m.IdDeposito
    WHERE ${where.join(' AND ')}
    ORDER BY m.Fecha DESC, m.IdMovimiento DESC
    `,
			params,
		)) || []
	);
}

/**
 * Ajusta stock y registra movimiento. cantidad > 0 entrada, < 0 salida.
 * Si se pasa externalTx (sql.Transaction), reutiliza la misma transacción.
 */
async function _aplicarStockInternal(opts) {
	const {
		idArticulo,
		idDeposito,
		lote = '',
		cantidad,
		tipo,
		idDocumento = null,
		tipoDocumento = null,
		observaciones = null,
		operador = null,
		fechaVencimiento = null,
		externalTx = null,
	} = opts;

	const lot = str(lote, 50);
	const cant = num(cantidad);
	if (!idArticulo || !idDeposito || cant === 0) {
		throw httpError('Artículo, depósito y cantidad son obligatorios');
	}

	const makeRequest = (txOrPool) => new sql.Request(txOrPool);

	const runWith = async (txOrPool) => {
		const checkReq = makeRequest(txOrPool);
		const check = await checkReq
			.input('art', sql.Int, Number(idArticulo))
			.input('dep', sql.Int, Number(idDeposito))
			.input('lote', sql.NVarChar(50), lot)
			.query(
				`SELECT IdStock, Cantidad FROM dbo.imAlmacenStock
         WHERE IdArticulo = @art AND IdDeposito = @dep AND Lote = @lote`,
			);

		let saldo;
		if (!check.recordset.length) {
			if (cant < 0) throw httpError('No hay stock suficiente para la salida');
			saldo = cant;
			const fv = dateOrNull(fechaVencimiento);
			const insReq = makeRequest(txOrPool);
			await insReq
				.input('art2', sql.Int, Number(idArticulo))
				.input('dep2', sql.Int, Number(idDeposito))
				.input('lote2', sql.NVarChar(50), lot)
				.input('cant2', sql.Decimal(18, 4), cant)
				.input('fv', sql.Date, fv)
				.query(
					`INSERT INTO dbo.imAlmacenStock (IdArticulo, IdDeposito, Lote, Cantidad, FechaVencimiento)
           VALUES (@art2, @dep2, @lote2, @cant2, @fv)`,
				);
		} else {
			const row = check.recordset[0];
			saldo = num(row.Cantidad) + cant;
			if (saldo < 0) throw httpError('No hay stock suficiente para la salida');
			const updReq = makeRequest(txOrPool);
			await updReq
				.input('idSt', sql.Int, row.IdStock)
				.input('saldo', sql.Decimal(18, 4), saldo)
				.query(`UPDATE dbo.imAlmacenStock SET Cantidad = @saldo WHERE IdStock = @idSt`);
		}

		const movReq = makeRequest(txOrPool);
		await movReq
			.input('tipo', sql.NVarChar(20), str(tipo, 20) || (cant >= 0 ? 'ENTRADA' : 'SALIDA'))
			.input('artM', sql.Int, Number(idArticulo))
			.input('depM', sql.Int, Number(idDeposito))
			.input('loteM', sql.NVarChar(50), lot)
			.input('cantM', sql.Decimal(18, 4), cant)
			.input('saldoM', sql.Decimal(18, 4), saldo)
			.input('idDoc', sql.Int, idDocumento)
			.input('tipoDoc', sql.NVarChar(30), tipoDocumento)
			.input('obs', sql.NVarChar(500), observaciones)
			.input('oper', sql.NVarChar(50), operador)
			.query(
				`INSERT INTO dbo.imAlmacenMovimiento
         (Tipo, IdArticulo, IdDeposito, Lote, Cantidad, SaldoResultante, IdDocumento, TipoDocumento, Observaciones, Operador)
         VALUES (@tipo, @artM, @depM, @loteM, @cantM, @saldoM, @idDoc, @tipoDoc, @obs, @oper)`,
			);

		return saldo;
	};

	if (externalTx) {
		return runWith(externalTx);
	}

	const pool = await getRequestPool();
	const transaction = new sql.Transaction(pool);
	await transaction.begin();
	try {
		const saldo = await runWith(transaction);
		await transaction.commit();
		return saldo;
	} catch (e) {
		try {
			await transaction.rollback();
		} catch (_) {
			/* ignore */
		}
		throw e;
	}
}

async function registrarAjuste(data, auth) {
	await ensure();
	const cant = num(data.cantidad);
	if (!cant) throw httpError('Cantidad debe ser distinta de cero');
	return _aplicarStockInternal({
		idArticulo: data.idArticulo,
		idDeposito: data.idDeposito,
		lote: data.lote || '',
		cantidad: cant,
		tipo: 'AJUSTE',
		observaciones: data.observaciones || 'Ajuste manual de stock',
		operador: opFromAuth(auth),
		fechaVencimiento: data.fechaVencimiento,
	});
}

async function registrarSalida(data, auth) {
	await ensure();
	const cant = Math.abs(num(data.cantidad));
	if (!cant) throw httpError('Cantidad obligatoria');
	return _aplicarStockInternal({
		idArticulo: data.idArticulo,
		idDeposito: data.idDeposito,
		lote: data.lote || '',
		cantidad: -cant,
		tipo: 'SALIDA',
		observaciones: data.observaciones || data.destino || 'Salida de almacén',
		operador: opFromAuth(auth),
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Depósitos
// ─────────────────────────────────────────────────────────────────────────────

async function listarDepositos() {
	await ensure();
	return (
		(await executeQuery(
			`SELECT IdDeposito, Codigo, Nombre, EsPrincipal, Activo FROM dbo.imAlmacenDeposito WHERE Activo = 1 ORDER BY EsPrincipal DESC, Nombre`,
		)) || []
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Artículos
// ─────────────────────────────────────────────────────────────────────────────

async function listarArticulos({ search = '', activos = true, page = 1, pageSize = 50 } = {}) {
	await ensure();
	void maybeAutoSyncVademecum();
	const params = [];
	const where = ['1=1'];
	let i = 0;
	if (activos) where.push('a.Activo = 1');
	if (search && search.trim()) {
		where.push(`(a.Codigo LIKE @p${i} OR a.Descripcion LIKE @p${i} OR ISNULL(a.TipoNombre,'') LIKE @p${i})`);
		params.push({ value: `%${search.trim()}%` });
		i += 1;
	}
	const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
	const pg = Math.max(Number(page) || 1, 1);
	const offset = (pg - 1) * size;

	const countRows = await executeQuery(
		`SELECT COUNT(*) AS n FROM dbo.imAlmacenArticulo a WHERE ${where.join(' AND ')}`,
		params,
	);
	const total = Number(countRows?.[0]?.n) || 0;

	const items =
		(await executeQuery(
			`
    SELECT a.IdArticulo, a.Codigo, a.Descripcion, a.UnidadMedida, a.StockMinimo, a.Activo, a.Observaciones,
      a.TipoCodigo, a.TipoNombre, a.Origen,
      ISNULL((SELECT SUM(s.Cantidad) FROM dbo.imAlmacenStock s WHERE s.IdArticulo = a.IdArticulo), 0) AS StockTotal
    FROM dbo.imAlmacenArticulo a
    WHERE ${where.join(' AND ')}
    ORDER BY a.Descripcion
    OFFSET @p${i} ROWS FETCH NEXT @p${i + 1} ROWS ONLY
    `,
			[...params, { value: offset }, { value: size }],
		)) || [];

	return { items, total, page: pg, pageSize: size };
}

async function listarTrazabilidad({ search = '', limit = 150, idArticulo = null } = {}) {
	await ensure();
	const params = [];
	const where = ['1=1'];
	let i = 0;
	if (idArticulo) {
		where.push(`m.IdArticulo = @p${i}`);
		params.push({ value: Number(idArticulo) });
		i += 1;
	}
	if (search && search.trim()) {
		where.push(
			`(a.Codigo LIKE @p${i} OR a.Descripcion LIKE @p${i} OR m.TipoDocumento LIKE @p${i} OR m.Observaciones LIKE @p${i} OR m.Tipo LIKE @p${i})`,
		);
		params.push({ value: `%${search.trim()}%` });
		i += 1;
	}
	const top = Math.min(Math.max(Number(limit) || 150, 1), 400);
	return (
		(await executeQuery(
			`
    SELECT TOP (${top})
      m.IdMovimiento, m.Tipo, m.IdArticulo, a.Codigo, a.Descripcion, a.UnidadMedida,
      m.IdDeposito, d.Codigo AS DepositoCodigo, d.Nombre AS Deposito,
      m.Lote, m.Cantidad, m.SaldoResultante,
      m.IdDocumento, m.TipoDocumento, m.Observaciones, m.Fecha, m.Operador,
      CASE
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ACTA', N'ACTA_RECEPCION') THEN acta.NroActa
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ORDEN', N'OP') THEN ord.NroOrden
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'SOLICITUD', N'SOL') THEN sol.NroPedido
        ELSE NULL
      END AS NroDocumento,
      CASE
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ACTA', N'ACTA_RECEPCION') THEN acta.IdOrden
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ORDEN', N'OP') THEN ord.IdSolicitud
        ELSE NULL
      END AS IdDocumentoPadre,
      CASE
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ACTA', N'ACTA_RECEPCION') THEN ord2.NroOrden
        WHEN UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ORDEN', N'OP') THEN sol2.NroPedido
        ELSE NULL
      END AS NroDocumentoPadre
    FROM dbo.imAlmacenMovimiento m
    INNER JOIN dbo.imAlmacenArticulo a ON a.IdArticulo = m.IdArticulo
    INNER JOIN dbo.imAlmacenDeposito d ON d.IdDeposito = m.IdDeposito
    LEFT JOIN dbo.imAlmacenActa acta
      ON UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ACTA', N'ACTA_RECEPCION') AND acta.IdActa = m.IdDocumento
    LEFT JOIN dbo.imAlmacenOrden ord2 ON ord2.IdOrden = acta.IdOrden
    LEFT JOIN dbo.imAlmacenOrden ord
      ON UPPER(ISNULL(m.TipoDocumento,'')) IN (N'ORDEN', N'OP') AND ord.IdOrden = m.IdDocumento
    LEFT JOIN dbo.imAlmacenSolicitud sol2 ON sol2.IdSolicitud = ord.IdSolicitud
    LEFT JOIN dbo.imAlmacenSolicitud sol
      ON UPPER(ISNULL(m.TipoDocumento,'')) IN (N'SOLICITUD', N'SOL') AND sol.IdSolicitud = m.IdDocumento
    WHERE ${where.join(' AND ')}
    ORDER BY m.Fecha DESC, m.IdMovimiento DESC
    `,
			params,
		)) || []
	);
}

async function obtenerArticulo(id) {
	await ensure();
	const rows = await executeQuery(
		`SELECT IdArticulo, Codigo, Descripcion, UnidadMedida, StockMinimo, Activo, Observaciones,
            TipoCodigo, TipoNombre, Origen
     FROM dbo.imAlmacenArticulo WHERE IdArticulo = @p0`,
		[{ value: Number(id) }],
	);
	return rows?.[0] || null;
}

async function crearArticulo(data, auth) {
	await ensure();
	const codigo = str(data.codigo, 50);
	const descripcion = str(data.descripcion, 300);
	if (!codigo || !descripcion) throw httpError('Código y descripción son obligatorios');

	const exists = await executeQuery(
		`SELECT IdArticulo FROM dbo.imAlmacenArticulo WHERE Codigo = @p0`,
		[{ value: codigo }],
	);
	if (exists?.length) throw httpError(`Ya existe un artículo con código ${codigo}`);

	const rows = await executeQuery(
		`
    INSERT INTO dbo.imAlmacenArticulo (Codigo, Descripcion, UnidadMedida, StockMinimo, Activo, Observaciones, TipoCodigo, TipoNombre, Origen, OperAlta)
    OUTPUT INSERTED.IdArticulo, INSERTED.Codigo, INSERTED.Descripcion, INSERTED.UnidadMedida, INSERTED.StockMinimo, INSERTED.Activo, INSERTED.Observaciones,
           INSERTED.TipoCodigo, INSERTED.TipoNombre, INSERTED.Origen
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9)
    `,
		[
			{ value: codigo },
			{ value: descripcion },
			{ value: str(data.unidadMedida, 50) || 'UNIDAD' },
			{ value: num(data.stockMinimo) },
			{ value: data.activo === false ? 0 : 1 },
			{ value: str(data.observaciones, 500) || null },
			{ value: str(data.tipoCodigo ?? data.TipoCodigo, 20) || null },
			{
				value:
					str(data.tipoNombre ?? data.TipoNombre, 80) ||
					(str(data.tipoCodigo ?? data.TipoCodigo, 20)
						? mapTipoVademecum(data.tipoCodigo ?? data.TipoCodigo).nombre
						: null),
			},
			{ value: str(data.origen ?? data.Origen, 20) || 'MANUAL' },
			{ value: opFromAuth(auth) },
		],
	);
	return rows[0];
}

async function actualizarArticulo(id, data) {
	await ensure();
	const art = await obtenerArticulo(id);
	if (!art) throw httpError('Artículo no encontrado', 404);

	// Código es inmutable (ID de catálogo / troquel); no se edita tras el alta.
	await executeQuery(
		`
    UPDATE dbo.imAlmacenArticulo SET
      Descripcion = @p0, UnidadMedida = @p1,
      StockMinimo = @p2, Activo = @p3, Observaciones = @p4,
      TipoCodigo = @p5, TipoNombre = @p6
    WHERE IdArticulo = @p7
    `,
		[
			{ value: str(data.descripcion, 300) || art.Descripcion },
			{ value: str(data.unidadMedida, 50) || art.UnidadMedida },
			{ value: data.stockMinimo != null ? num(data.stockMinimo) : art.StockMinimo },
			{ value: data.activo === false || data.activo === 0 ? 0 : 1 },
			{ value: data.observaciones != null ? str(data.observaciones, 500) : art.Observaciones },
			{
				value:
					data.tipoCodigo != null || data.TipoCodigo != null
						? str(data.tipoCodigo ?? data.TipoCodigo, 20) || null
						: art.TipoCodigo,
			},
			{
				value:
					data.tipoNombre != null || data.TipoNombre != null
						? str(data.tipoNombre ?? data.TipoNombre, 80) || null
						: art.TipoNombre,
			},
			{ value: Number(id) },
		],
	);
	return obtenerArticulo(id);
}

async function eliminarArticulo(id) {
	await ensure();
	const art = await obtenerArticulo(id);
	if (!art) throw httpError('Artículo no encontrado', 404);
	// Soft-delete: desactivar
	await executeQuery(`UPDATE dbo.imAlmacenArticulo SET Activo = 0 WHERE IdArticulo = @p0`, [
		{ value: Number(id) },
	]);
	return { ...art, Activo: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proveedores
// ─────────────────────────────────────────────────────────────────────────────

async function listarProveedores({ search = '', activos = true } = {}) {
	await ensure();
	const params = [];
	const where = [];
	if (activos) where.push('Activo = 1');
	else where.push('1=1');
	if (search && search.trim()) {
		where.push('(RazonSocial LIKE @p0 OR CUIT LIKE @p0)');
		params.push({ value: `%${search.trim()}%` });
	}
	return (
		(await executeQuery(
			`SELECT IdProveedor, RazonSocial, CUIT, Direccion, Telefono, Email, Observaciones, Activo
       FROM dbo.imAlmacenProveedor WHERE ${where.join(' AND ')} ORDER BY RazonSocial`,
			params,
		)) || []
	);
}

async function crearProveedor(data) {
	await ensure();
	const razon = str(data.razonSocial, 200);
	if (!razon) throw httpError('Razón social obligatoria');
	const observaciones = str(data.observaciones ?? data.Observaciones, 500) || null;
	const rows = await executeQuery(
		`
    INSERT INTO dbo.imAlmacenProveedor (RazonSocial, CUIT, Direccion, Telefono, Email, Observaciones, Activo)
    OUTPUT INSERTED.IdProveedor, INSERTED.RazonSocial, INSERTED.CUIT, INSERTED.Direccion, INSERTED.Telefono, INSERTED.Email, INSERTED.Observaciones, INSERTED.Activo
    VALUES (@p0, @p1, @p2, @p3, @p4, @p5, 1)
    `,
		[
			{ value: razon },
			{ value: str(data.cuit, 20) || null },
			{ value: str(data.direccion, 200) || null },
			{ value: str(data.telefono, 50) || null },
			{ value: str(data.email, 100) || null },
			{ value: observaciones },
		],
	);
	return rows[0];
}

async function actualizarProveedor(id, data) {
	await ensure();
	const observaciones =
		data.observaciones != null || data.Observaciones != null
			? str(data.observaciones ?? data.Observaciones, 500) || null
			: null;
	await executeQuery(
		`
    UPDATE dbo.imAlmacenProveedor SET
      RazonSocial = @p0, CUIT = @p1, Direccion = @p2, Telefono = @p3, Email = @p4,
      Observaciones = @p5, Activo = @p6
    WHERE IdProveedor = @p7
    `,
		[
			{ value: str(data.razonSocial, 200) },
			{ value: str(data.cuit, 20) || null },
			{ value: str(data.direccion, 200) || null },
			{ value: str(data.telefono, 50) || null },
			{ value: str(data.email, 100) || null },
			{ value: observaciones },
			{ value: data.activo === false || data.activo === 0 ? 0 : 1 },
			{ value: Number(id) },
		],
	);
	const rows = await executeQuery(
		`SELECT IdProveedor, RazonSocial, CUIT, Direccion, Telefono, Email, Observaciones, Activo FROM dbo.imAlmacenProveedor WHERE IdProveedor = @p0`,
		[{ value: Number(id) }],
	);
	return rows?.[0] || null;
}

async function eliminarProveedor(id) {
	await ensure();
	await executeQuery(`UPDATE dbo.imAlmacenProveedor SET Activo = 0 WHERE IdProveedor = @p0`, [
		{ value: Number(id) },
	]);
	const rows = await executeQuery(
		`SELECT IdProveedor, RazonSocial, CUIT, Direccion, Telefono, Email, Observaciones, Activo FROM dbo.imAlmacenProveedor WHERE IdProveedor = @p0`,
		[{ value: Number(id) }],
	);
	return rows?.[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Solicitudes de Provisión
// ─────────────────────────────────────────────────────────────────────────────

async function listarSolicitudes({
	estado = null,
	search = '',
	destino = null,
	origen = null,
	idSector = null,
} = {}) {
	await ensure();
	const params = [];
	const where = ['1=1'];
	let i = 0;
	if (estado) {
		where.push(`s.Estado = @p${i}`);
		params.push({ value: str(estado, 30) });
		i += 1;
	}
	const idSec = idSector || origen || destino;
	if (idSec && String(idSec).trim()) {
		// match IdSector o texto legado en Destino
		where.push(`(CAST(s.IdSector AS NVARCHAR(50)) = @p${i} OR s.Destino = @p${i})`);
		params.push({ value: str(idSec, 100) });
		i += 1;
	}
	if (search && search.trim()) {
		where.push(
			`(s.NroPedido LIKE @p${i} OR s.Destino LIKE @p${i} OR s.Solicitante LIKE @p${i} OR CAST(s.IdSector AS NVARCHAR(50)) LIKE @p${i})`,
		);
		params.push({ value: `%${search.trim()}%` });
		i += 1;
	}
	const rows =
		(await executeQuery(
			`
    SELECT s.IdSolicitud, s.NroPedido, s.FechaPedido, s.FechaEmision,
      s.IdSector, s.Destino, s.Destino AS Origen, s.Justificacion,
      s.Estado, s.Solicitante, s.Aprobador, s.FechaAprobacion, s.CostoEstimado, s.Fondo, s.Observaciones,
      s.PedidoParaDias, s.FrecuenciaMuestreoMeses, s.RetrasoEstimadoDias,
      s.IncluirSinMovimientos, s.IncluirStockSuficiente, s.Rubro, s.FechaUltimaMod, s.FechaAlta,
      s.TipoSolicitud, s.IdDepositoOrigen, s.IdDepositoDestino,
      do.Nombre AS DepositoOrigenNombre, do.Codigo AS DepositoOrigenCodigo,
      dd.Nombre AS DepositoDestinoNombre, dd.Codigo AS DepositoDestinoCodigo,
      (SELECT COUNT(*) FROM dbo.imAlmacenSolicitudItem i WHERE i.IdSolicitud = s.IdSolicitud) AS CantItems,
      CASE WHEN s.Estado NOT IN (N'BORRADOR', N'ANULADA') THEN 1 ELSE 0 END AS Emitido,
      CASE WHEN s.Estado = N'COMPLETADA' THEN 1 ELSE 0 END AS Satisfecho
    FROM dbo.imAlmacenSolicitud s
    LEFT JOIN dbo.imAlmacenDeposito do ON do.IdDeposito = s.IdDepositoOrigen
    LEFT JOIN dbo.imAlmacenDeposito dd ON dd.IdDeposito = s.IdDepositoDestino
    WHERE ${where.join(' AND ')}
    ORDER BY s.IdSolicitud DESC
    `,
			params,
		)) || [];
	return rows;
}

async function itemsConStock(idSolicitud, idDepositoOrigen = null) {
	const depFilter = idDepositoOrigen
		? `AND st.IdDeposito = ${Number(idDepositoOrigen)}`
		: '';
	return (
		(await executeQuery(
			`
    SELECT
      i.IdItem, i.IdSolicitud, i.Renglon, i.IdArticulo, i.Codigo, i.Descripcion, i.Observaciones, i.Cantidad,
      a.UnidadMedida,
      ISNULL(a.StockMinimo, 0) AS StockMinimo,
      ISNULL((
        SELECT SUM(st.Cantidad) FROM dbo.imAlmacenStock st
        WHERE st.IdArticulo = COALESCE(i.IdArticulo, a.IdArticulo)
        ${depFilter}
      ), 0) AS Existencia
    FROM dbo.imAlmacenSolicitudItem i
    LEFT JOIN dbo.imAlmacenArticulo a
      ON a.IdArticulo = i.IdArticulo
      OR (i.IdArticulo IS NULL AND a.Codigo = i.Codigo)
    WHERE i.IdSolicitud = @p0
    ORDER BY i.Renglon
    `,
			[{ value: Number(idSolicitud) }],
		)) || []
	);
}

async function obtenerSolicitud(id) {
	await ensure();
	const rows = await executeQuery(
		`
    SELECT IdSolicitud, NroPedido, FechaPedido, FechaEmision,
      IdSector, Destino, Destino AS Origen, Justificacion,
      Estado, Solicitante, Aprobador, FechaAprobacion, CostoEstimado, Fondo, Observaciones,
      PedidoParaDias, FrecuenciaMuestreoMeses, RetrasoEstimadoDias,
      IncluirSinMovimientos, IncluirStockSuficiente, Rubro, FechaUltimaMod, FechaAlta, OperAlta,
      TipoSolicitud, IdDepositoOrigen, IdDepositoDestino,
      CASE WHEN Estado NOT IN (N'BORRADOR', N'ANULADA') THEN 1 ELSE 0 END AS Emitido,
      CASE WHEN Estado = N'COMPLETADA' THEN 1 ELSE 0 END AS Satisfecho
    FROM dbo.imAlmacenSolicitud WHERE IdSolicitud = @p0
    `,
		[{ value: Number(id) }],
	);
	if (!rows?.length) return null;
	const sol = rows[0];
	const idDep = await idDepositoParaOrigen(sol.IdSector || sol.Origen || sol.Destino);
	const items = await itemsConStock(id, idDep);
	const nombre =
		(sol.IdSector ? await cfg.nombreSector(sol.IdSector) : null) || sol.Destino || sol.Origen;
	let depOrigen = null;
	let depDestino = null;
	if (sol.IdDepositoOrigen) {
		const d = await executeQuery(
			`SELECT IdDeposito, Codigo, Nombre FROM dbo.imAlmacenDeposito WHERE IdDeposito = @p0`,
			[{ value: Number(sol.IdDepositoOrigen) }],
		);
		depOrigen = d?.[0] || null;
	}
	if (sol.IdDepositoDestino) {
		const d = await executeQuery(
			`SELECT IdDeposito, Codigo, Nombre FROM dbo.imAlmacenDeposito WHERE IdDeposito = @p0`,
			[{ value: Number(sol.IdDepositoDestino) }],
		);
		depDestino = d?.[0] || null;
	}
	return {
		...sol,
		Origen: nombre,
		IdSector: sol.IdSector ? String(sol.IdSector) : null,
		TipoSolicitud: sol.TipoSolicitud || 'COMPRA',
		DepositoOrigenNombre: depOrigen?.Nombre || null,
		DepositoOrigenCodigo: depOrigen?.Codigo || null,
		DepositoDestinoNombre: depDestino?.Nombre || null,
		DepositoDestinoCodigo: depDestino?.Codigo || null,
		items,
	};
}

async function solHeaderParams(data, auth, defaults = {}) {
	const idSector =
		data.idSector != null
			? str(data.idSector, 50)
			: data.IdSector != null
				? str(data.IdSector, 50)
				: defaults.IdSector
					? str(defaults.IdSector, 50)
					: null;

	let destinoNombre =
		data.origen != null
			? str(data.origen, 100)
			: data.destino != null
				? str(data.destino, 100)
				: defaults.Destino || defaults.Origen || null;

	if (idSector) {
		const n = await cfg.nombreSector(idSector);
		if (n) destinoNombre = n;
	}

	return {
		fechaPedido: dateOrNull(data.fechaPedido) || defaults.FechaPedido || today(),
		fechaEmision: dateOrNull(data.fechaEmision) || defaults.FechaEmision || today(),
		idSector: idSector || defaults.IdSector || null,
		destino: destinoNombre || null,
		justificacion:
			data.justificacion != null ? str(data.justificacion, 500) : defaults.Justificacion || null,
		estado: data.estado ? str(data.estado, 30) : defaults.Estado || 'BORRADOR',
		solicitante:
			data.solicitante != null
				? str(data.solicitante, 100)
				: defaults.Solicitante || opFromAuth(auth),
		costoEstimado:
			data.costoEstimado != null ? num(data.costoEstimado) : defaults.CostoEstimado ?? null,
		fondo: null, // fondos presupuestarios eliminados del flujo
		observaciones:
			data.observaciones != null ? str(data.observaciones, 500) : defaults.Observaciones || null,
		pedidoParaDias:
			data.pedidoParaDias != null ? num(data.pedidoParaDias, 30) : defaults.PedidoParaDias ?? 30,
		frecuenciaMuestreoMeses:
			data.frecuenciaMuestreoMeses != null
				? num(data.frecuenciaMuestreoMeses, 6)
				: defaults.FrecuenciaMuestreoMeses ?? 6,
		retrasoEstimadoDias:
			data.retrasoEstimadoDias != null
				? num(data.retrasoEstimadoDias, 10)
				: defaults.RetrasoEstimadoDias ?? 10,
		incluirSinMovimientos:
			data.incluirSinMovimientos === true || data.incluirSinMovimientos === 1 ? 1 : 0,
		incluirStockSuficiente:
			data.incluirStockSuficiente === true || data.incluirStockSuficiente === 1 ? 1 : 0,
		rubro: data.rubro != null ? str(data.rubro, 100) : defaults.Rubro || null,
		tipoSolicitud: (() => {
			const t = str(data.tipoSolicitud ?? data.TipoSolicitud ?? defaults.TipoSolicitud, 20).toUpperCase();
			return t === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'COMPRA';
		})(),
		idDepositoOrigen: (() => {
			const raw =
				data.idDepositoOrigen != null
					? data.idDepositoOrigen
					: defaults.IdDepositoOrigen != null
						? defaults.IdDepositoOrigen
						: null;
			if (raw == null || raw === '') return null;
			const n = Number(raw);
			return Number.isFinite(n) && n > 0 ? n : null;
		})(),
		idDepositoDestino: (() => {
			const raw =
				data.idDepositoDestino != null
					? data.idDepositoDestino
					: defaults.IdDepositoDestino != null
						? defaults.IdDepositoDestino
						: null;
			if (raw == null || raw === '') return null;
			const n = Number(raw);
			return Number.isFinite(n) && n > 0 ? n : null;
		})(),
	};
}

async function insertSolicitudItems(idSolicitud, items) {
	let r = 1;
	for (const it of items || []) {
		const desc = str(it.descripcion ?? it.Descripcion, 300);
		const cant = num(it.cantidad ?? it.Cantidad);
		if (!desc || cant <= 0) continue;
		let idArticulo = it.idArticulo ?? it.IdArticulo ?? null;
		const codigo = str(it.codigo ?? it.Codigo, 50) || null;
		if (!idArticulo && codigo) {
			const art = await executeQuery(
				`SELECT TOP 1 IdArticulo FROM dbo.imAlmacenArticulo WHERE Codigo = @p0`,
				[{ value: codigo }],
			);
			if (art?.[0]) idArticulo = art[0].IdArticulo;
		}
		await executeQuery(
			`
      INSERT INTO dbo.imAlmacenSolicitudItem
        (IdSolicitud, Renglon, IdArticulo, Codigo, Descripcion, Observaciones, Cantidad)
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6)
      `,
			[
				{ value: idSolicitud },
				{ value: r++ },
				{ value: idArticulo ? Number(idArticulo) : null },
				{ value: codigo },
				{ value: desc },
				{ value: str(it.observaciones ?? it.Observaciones, 200) || null },
				{ value: cant },
			],
		);
	}
}

async function crearSolicitud(data, auth) {
	await ensure();
	const items = Array.isArray(data.items) ? data.items : [];
	const estado = str(data.estado, 30) || 'BORRADOR';
	if (!items.length && estado !== 'BORRADOR') {
		throw httpError('La solicitud debe incluir al menos un renglón');
	}

	const nroPedido = str(data.nroPedido, 50) || (await nextNumber('dbo.imAlmacenSolicitud', 'NroPedido'));
	const h = await solHeaderParams(data, auth);
	if (!h.idSector && !h.destino) {
		throw httpError('Indicá el sector origen de la solicitud (asignado al usuario)');
	}
	if (h.tipoSolicitud === 'TRANSFERENCIA') {
		if (!h.idDepositoOrigen || !h.idDepositoDestino) {
			throw httpError('En transferencia entre depósitos, indicá origen y destino');
		}
		if (Number(h.idDepositoOrigen) === Number(h.idDepositoDestino)) {
			throw httpError('Origen y destino deben ser distintos');
		}
	} else {
		h.idDepositoOrigen = null;
		h.idDepositoDestino = null;
	}

	const header = await executeQuery(
		`
    INSERT INTO dbo.imAlmacenSolicitud
      (NroPedido, FechaPedido, FechaEmision, Destino, Justificacion, Estado, Solicitante,
       CostoEstimado, Fondo, Observaciones, OperAlta,
       PedidoParaDias, FrecuenciaMuestreoMeses, RetrasoEstimadoDias,
       IncluirSinMovimientos, IncluirStockSuficiente, Rubro, FechaUltimaMod, IdSector,
       TipoSolicitud, IdDepositoOrigen, IdDepositoDestino)
    OUTPUT INSERTED.IdSolicitud
    VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,@p12,@p13,@p14,@p15,@p16,SYSUTCDATETIME(),@p17,@p18,@p19,@p20)
    `,
		[
			{ value: nroPedido },
			{ value: h.fechaPedido },
			{ value: h.fechaEmision },
			{ value: h.destino },
			{ value: h.justificacion },
			{ value: h.estado },
			{ value: h.solicitante },
			{ value: h.costoEstimado },
			{ value: h.fondo },
			{ value: h.observaciones },
			{ value: opFromAuth(auth) },
			{ value: h.pedidoParaDias },
			{ value: h.frecuenciaMuestreoMeses },
			{ value: h.retrasoEstimadoDias },
			{ value: h.incluirSinMovimientos },
			{ value: h.incluirStockSuficiente },
			{ value: h.rubro },
			{ value: h.idSector },
			{ value: h.tipoSolicitud },
			{ value: h.idDepositoOrigen },
			{ value: h.idDepositoDestino },
		],
	);
	const idSolicitud = header[0].IdSolicitud;
	await insertSolicitudItems(idSolicitud, items);
	return obtenerSolicitud(idSolicitud);
}

async function actualizarSolicitud(id, data, auth) {
	await ensure();
	const sol = await obtenerSolicitud(id);
	if (!sol) throw httpError('Solicitud no encontrada', 404);
	if (!['BORRADOR', 'SOLICITADA', 'RECHAZADA'].includes(sol.Estado)) {
		throw httpError(`No se puede editar una solicitud en estado ${sol.Estado}`);
	}

	const h = await solHeaderParams(data, auth, sol);
	if (data.estado == null) h.estado = sol.Estado;
	if (h.tipoSolicitud === 'TRANSFERENCIA') {
		if (!h.idDepositoOrigen || !h.idDepositoDestino) {
			throw httpError('En transferencia entre depósitos, indicá origen y destino');
		}
		if (Number(h.idDepositoOrigen) === Number(h.idDepositoDestino)) {
			throw httpError('Origen y destino deben ser distintos');
		}
	} else {
		h.idDepositoOrigen = null;
		h.idDepositoDestino = null;
	}

	await executeQuery(
		`
    UPDATE dbo.imAlmacenSolicitud SET
      FechaPedido = @p0, FechaEmision = @p1, Destino = @p2, Justificacion = @p3,
      Solicitante = @p4, CostoEstimado = @p5, Fondo = @p6, Observaciones = @p7,
      Estado = @p8,
      PedidoParaDias = @p9, FrecuenciaMuestreoMeses = @p10, RetrasoEstimadoDias = @p11,
      IncluirSinMovimientos = @p12, IncluirStockSuficiente = @p13, Rubro = @p14,
      FechaUltimaMod = SYSUTCDATETIME(), IdSector = @p15,
      TipoSolicitud = @p16, IdDepositoOrigen = @p17, IdDepositoDestino = @p18
    WHERE IdSolicitud = @p19
    `,
		[
			{ value: h.fechaPedido },
			{ value: h.fechaEmision },
			{ value: h.destino },
			{ value: h.justificacion },
			{ value: h.solicitante },
			{ value: h.costoEstimado },
			{ value: h.fondo },
			{ value: h.observaciones },
			{ value: h.estado },
			{ value: h.pedidoParaDias },
			{ value: h.frecuenciaMuestreoMeses },
			{ value: h.retrasoEstimadoDias },
			{ value: h.incluirSinMovimientos },
			{ value: h.incluirStockSuficiente },
			{ value: h.rubro },
			{ value: h.idSector },
			{ value: h.tipoSolicitud },
			{ value: h.idDepositoOrigen },
			{ value: h.idDepositoDestino },
			{ value: Number(id) },
		],
	);

	if (Array.isArray(data.items)) {
		await executeQuery(`DELETE FROM dbo.imAlmacenSolicitudItem WHERE IdSolicitud = @p0`, [
			{ value: Number(id) },
		]);
		await insertSolicitudItems(Number(id), data.items);
	}

	void auth;
	return obtenerSolicitud(id);
}

async function buscarArticuloPorCodigo(codigo, { idDeposito = null, origen = null, idSector = null } = {}) {
	await ensure();
	const cod = str(codigo, 50);
	if (!cod) return null;
	let idDep = idDeposito ? Number(idDeposito) : null;
	if (!idDep && (idSector || origen)) {
		idDep = await idDepositoParaOrigen(idSector || origen);
	}
	const depClause = idDep
		? `ISNULL((SELECT SUM(s.Cantidad) FROM dbo.imAlmacenStock s WHERE s.IdArticulo = a.IdArticulo AND s.IdDeposito = ${Number(idDep)}), 0)`
		: `ISNULL((SELECT SUM(s.Cantidad) FROM dbo.imAlmacenStock s WHERE s.IdArticulo = a.IdArticulo), 0)`;
	const rows = await executeQuery(
		`
    SELECT TOP 1
      a.IdArticulo, a.Codigo, a.Descripcion, a.UnidadMedida, a.StockMinimo,
      ${depClause} AS StockTotal
    FROM dbo.imAlmacenArticulo a
    WHERE a.Codigo = @p0 AND a.Activo = 1
    `,
		[{ value: cod }],
	);
	return rows?.[0] || null;
}

/** Orígenes: sectores del usuario / config (sin catálogo hardcode). */
async function listarOrigenesSolicitud(authCtx = {}, opts = {}) {
	return cfg.listarOrigenesParaUsuario(authCtx, opts);
}

const listarDestinatariosSolicitud = listarOrigenesSolicitud;


async function cambiarEstadoSolicitud(id, estado, auth, extra = {}) {
	await ensure();
	const sol = await obtenerSolicitud(id);
	if (!sol) throw httpError('Solicitud no encontrada', 404);

	const destino = str(estado, 30).toUpperCase();
	const valid = {
		BORRADOR: ['SOLICITADA', 'ANULADA'],
		SOLICITADA: ['APROBADA', 'RECHAZADA', 'ANULADA'],
		APROBADA: ['EN_COMPRA', 'ANULADA'],
		RECHAZADA: ['BORRADOR', 'ANULADA'],
		EN_COMPRA: ['COMPLETADA', 'ANULADA'],
	};
	const allowed = valid[sol.Estado] || [];
	if (!allowed.includes(destino)) {
		throw httpError(`Transición inválida: ${sol.Estado} → ${destino}`);
	}

	const params = [
		{ value: destino },
		{ value: Number(id) },
	];

	if (destino === 'APROBADA') {
		await executeQuery(
			`
      UPDATE dbo.imAlmacenSolicitud SET
        Estado = @p0,
        Aprobador = @p2,
        FechaAprobacion = SYSUTCDATETIME(),
        FechaUltimaMod = SYSUTCDATETIME(),
        CostoEstimado = COALESCE(@p3, CostoEstimado),
        Fondo = COALESCE(@p4, Fondo)
      WHERE IdSolicitud = @p1
      `,
			[
				{ value: destino },
				{ value: Number(id) },
				{ value: str(extra.aprobador, 100) || opFromAuth(auth) },
				{ value: extra.costoEstimado != null ? num(extra.costoEstimado) : null },
				{ value: extra.fondo ? str(extra.fondo, 50) : null },
			],
		);
	} else if (destino === 'SOLICITADA') {
		await executeQuery(
			`
      UPDATE dbo.imAlmacenSolicitud SET
        Estado = @p0,
        FechaEmision = COALESCE(FechaEmision, CAST(GETDATE() AS DATE)),
        FechaUltimaMod = SYSUTCDATETIME()
      WHERE IdSolicitud = @p1
      `,
			params,
		);
	} else {
		await executeQuery(
			`UPDATE dbo.imAlmacenSolicitud SET Estado = @p0, FechaUltimaMod = SYSUTCDATETIME() WHERE IdSolicitud = @p1`,
			params,
		);
	}

	return obtenerSolicitud(id);
}

/** Ejecuta movimiento entre depósitos a partir de una solicitud de tipo TRANSFERENCIA. */
async function ejecutarTransferenciaSolicitud(idSolicitud, auth) {
	await ensure();
	const sol = await obtenerSolicitud(idSolicitud);
	if (!sol) throw httpError('Solicitud no encontrada', 404);
	const tipo = String(sol.TipoSolicitud || 'COMPRA').toUpperCase();
	if (tipo !== 'TRANSFERENCIA') {
		throw httpError('Esta solicitud no es de transferencia entre depósitos');
	}
	const estado = String(sol.Estado || '').toUpperCase();
	if (!['SOLICITADA', 'APROBADA', 'EN_COMPRA'].includes(estado)) {
		throw httpError(`No se puede transferir en estado ${sol.Estado}`);
	}
	const idOrigen = Number(sol.IdDepositoOrigen);
	const idDestino = Number(sol.IdDepositoDestino);
	if (!idOrigen || !idDestino) throw httpError('Indicá depósito origen y destino');
	if (idOrigen === idDestino) throw httpError('Origen y destino deben ser distintos');
	const items = sol.items || [];
	if (!items.length) throw httpError('La solicitud no tiene renglones');

	const operador = opFromAuth(auth);
	for (const it of items) {
		const idArt = it.IdArticulo ? Number(it.IdArticulo) : null;
		const cant = Math.abs(num(it.Cantidad));
		if (!idArt || cant <= 0) continue;
		await _aplicarStockInternal({
			idArticulo: idArt,
			idDeposito: idOrigen,
			lote: '',
			cantidad: -cant,
			tipo: 'TRANSF_SAL',
			idDocumento: Number(idSolicitud),
			tipoDocumento: 'SOLICITUD',
			observaciones: `Transferencia ${sol.NroPedido} → dep ${idDestino}`,
			operador,
		});
		await _aplicarStockInternal({
			idArticulo: idArt,
			idDeposito: idDestino,
			lote: '',
			cantidad: cant,
			tipo: 'TRANSF_ENT',
			idDocumento: Number(idSolicitud),
			tipoDocumento: 'SOLICITUD',
			observaciones: `Transferencia ${sol.NroPedido} desde dep ${idOrigen}`,
			operador,
		});
	}

	await executeQuery(
		`UPDATE dbo.imAlmacenSolicitud SET Estado = N'COMPLETADA', FechaUltimaMod = SYSUTCDATETIME() WHERE IdSolicitud = @p0`,
		[{ value: Number(idSolicitud) }],
	);
	return obtenerSolicitud(idSolicitud);
}

/** Timeline de un artículo: movimientos + ubicaciones. */
async function detalleTrazabilidadArticulo(idArticulo) {
	await ensure();
	const art = await obtenerArticulo(idArticulo);
	if (!art) throw httpError('Artículo no encontrado', 404);
	const moves = await listarTrazabilidad({ idArticulo, limit: 200 });
	const stockRows =
		(await executeQuery(
			`
    SELECT d.IdDeposito, d.Codigo, d.Nombre, ISNULL(SUM(s.Cantidad), 0) AS Cantidad
    FROM dbo.imAlmacenDeposito d
    LEFT JOIN dbo.imAlmacenStock s ON s.IdDeposito = d.IdDeposito AND s.IdArticulo = @p0
    WHERE d.Activo = 1
    GROUP BY d.IdDeposito, d.Codigo, d.Nombre
    HAVING ISNULL(SUM(s.Cantidad), 0) <> 0
       OR EXISTS (
         SELECT 1 FROM dbo.imAlmacenMovimiento m
         WHERE m.IdArticulo = @p0 AND m.IdDeposito = d.IdDeposito
       )
    ORDER BY d.Nombre
    `,
			[{ value: Number(idArticulo) }],
		)) || [];

	const timeline = (moves || []).map((m) => ({
		fecha: m.Fecha,
		tipo: m.Tipo,
		cantidad: m.Cantidad,
		saldo: m.SaldoResultante,
		ubicacion: m.Deposito,
		ubicacionCodigo: m.DepositoCodigo,
		lote: m.Lote,
		documentoTipo: m.TipoDocumento,
		documentoId: m.IdDocumento,
		documentoNro: m.NroDocumento,
		documentoPadreNro: m.NroDocumentoPadre,
		operador: m.Operador,
		observaciones: m.Observaciones,
		idMovimiento: m.IdMovimiento,
	}));

	return {
		articulo: art,
		ubicaciones: stockRows,
		timeline,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Órdenes de Provisión
// ─────────────────────────────────────────────────────────────────────────────

async function listarOrdenes({ estado = null, search = '' } = {}) {
	await ensure();
	const params = [];
	const where = ['1=1'];
	let i = 0;
	if (estado) {
		where.push(`o.Estado = @p${i}`);
		params.push({ value: str(estado, 30) });
		i += 1;
	}
	if (search && search.trim()) {
		where.push(
			`(o.NroOrden LIKE @p${i} OR o.NroExpediente LIKE @p${i} OR p.RazonSocial LIKE @p${i})`,
		);
		params.push({ value: `%${search.trim()}%` });
		i += 1;
	}
	return (
		(await executeQuery(
			`
    SELECT o.IdOrden, o.NroOrden, o.IdSolicitud, o.NroExpediente, o.NroConcurso, o.NroAdjudicacion,
      o.TipoOperacion, o.CondPago, o.FechaInvitacion, o.LugarEntrega, o.IdProveedor, o.IdDeposito,
      o.Estado, o.Total, o.Observaciones, o.FechaAlta,
      p.RazonSocial AS Proveedor, p.CUIT AS ProveedorCUIT,
      s.NroPedido
    FROM dbo.imAlmacenOrden o
    LEFT JOIN dbo.imAlmacenProveedor p ON p.IdProveedor = o.IdProveedor
    LEFT JOIN dbo.imAlmacenSolicitud s ON s.IdSolicitud = o.IdSolicitud
    WHERE ${where.join(' AND ')}
    ORDER BY o.IdOrden DESC
    `,
			params,
		)) || []
	);
}

async function obtenerOrden(id) {
	await ensure();
	const rows = await executeQuery(
		`
    SELECT o.*, p.RazonSocial AS Proveedor, p.CUIT AS ProveedorCUIT, p.Direccion AS ProveedorDireccion,
      s.NroPedido, d.Nombre AS DepositoNombre
    FROM dbo.imAlmacenOrden o
    LEFT JOIN dbo.imAlmacenProveedor p ON p.IdProveedor = o.IdProveedor
    LEFT JOIN dbo.imAlmacenSolicitud s ON s.IdSolicitud = o.IdSolicitud
    LEFT JOIN dbo.imAlmacenDeposito d ON d.IdDeposito = o.IdDeposito
    WHERE o.IdOrden = @p0
    `,
		[{ value: Number(id) }],
	);
	if (!rows?.length) return null;
	const items =
		(await executeQuery(
			`
    SELECT IdItem, IdOrden, Renglon, IdArticulo, Descripcion, Observaciones,
      Cantidad, PrecioUnitario, Subtotal, CantidadRecibida
    FROM dbo.imAlmacenOrdenItem WHERE IdOrden = @p0 ORDER BY Renglon
    `,
			[{ value: Number(id) }],
		)) || [];
	return { ...rows[0], items };
}

async function anularOrden(id, auth) {
	await ensure();
	const orden = await obtenerOrden(id);
	if (!orden) throw httpError('Orden no encontrada', 404);
	if (orden.Estado === 'ANULADA') return orden;
	if (orden.Estado === 'RECIBIDA') throw httpError('No se puede anular una orden ya recibida');
	await executeQuery(
		`UPDATE dbo.imAlmacenOrden SET Estado = N'ANULADA' WHERE IdOrden = @p0`,
		[{ value: Number(id) }],
	);
	void auth;
	return obtenerOrden(id);
}

async function actualizarOrden(id, data, auth) {
	await ensure();
	const orden = await obtenerOrden(id);
	if (!orden) throw httpError('Orden no encontrada', 404);
	if (!['EMITIDA', 'PARCIAL'].includes(String(orden.Estado))) {
		throw httpError(`No se puede editar una orden en estado ${orden.Estado}`);
	}
	await executeQuery(
		`
    UPDATE dbo.imAlmacenOrden SET
      IdProveedor = COALESCE(@p0, IdProveedor),
      NroConcurso = COALESCE(@p1, NroConcurso),
      NroAdjudicacion = COALESCE(@p2, NroAdjudicacion),
      TipoOperacion = COALESCE(@p3, TipoOperacion),
      CondPago = COALESCE(@p4, CondPago),
      LugarEntrega = COALESCE(@p5, LugarEntrega),
      Observaciones = COALESCE(@p6, Observaciones)
    WHERE IdOrden = @p7
    `,
		[
			{ value: data.idProveedor != null ? Number(data.idProveedor) : null },
			{ value: data.nroConcurso != null ? str(data.nroConcurso, 50) : null },
			{ value: data.nroAdjudicacion != null ? str(data.nroAdjudicacion, 50) : null },
			{ value: data.tipoOperacion != null ? str(data.tipoOperacion, 50) : null },
			{ value: data.condPago != null ? str(data.condPago, 50) : null },
			{ value: data.lugarEntrega != null ? str(data.lugarEntrega, 200) : null },
			{ value: data.observaciones != null ? str(data.observaciones, 500) : null },
			{ value: Number(id) },
		],
	);
	void auth;
	return obtenerOrden(id);
}

async function crearOrden(data, auth) {
	await ensure();
	const items = Array.isArray(data.items) ? data.items : [];
	if (!items.length) throw httpError('La orden debe incluir al menos un renglón');
	if (!data.idProveedor) throw httpError('Proveedor obligatorio');

	const nroOrden = str(data.nroOrden, 50) || (await nextNumber('dbo.imAlmacenOrden', 'NroOrden'));

	// Deposito por defecto
	let idDeposito = data.idDeposito ? Number(data.idDeposito) : null;
	if (!idDeposito) {
		const deps = await listarDepositos();
		idDeposito = deps[0]?.IdDeposito || null;
	}

	let total = 0;
	const normalized = items
		.map((it, idx) => {
			const cant = num(it.cantidad);
			const pu = num(it.precioUnitario);
			const sub = Math.round(cant * pu * 100) / 100;
			total += sub;
			return {
				renglon: idx + 1,
				idArticulo: it.idArticulo ? Number(it.idArticulo) : null,
				descripcion: str(it.descripcion, 300),
				observaciones: str(it.observaciones, 200) || null,
				cantidad: cant,
				precioUnitario: pu,
				subtotal: sub,
			};
		})
		.filter((it) => it.descripcion && it.cantidad > 0);

	if (!normalized.length) throw httpError('No hay renglones válidos');

	// Expediente desde solicitud si no viene
	let nroExpediente = str(data.nroExpediente, 50) || null;
	if (!nroExpediente && data.idSolicitud) {
		const sol = await obtenerSolicitud(data.idSolicitud);
		if (sol) {
			const f = dateOrNull(sol.FechaPedido) || today();
			const [y, m, d] = f.split('-');
			nroExpediente = `${sol.NroPedido}-${d}/${m}/${y}`;
		}
	}

	const header = await executeQuery(
		`
    INSERT INTO dbo.imAlmacenOrden
      (NroOrden, IdSolicitud, NroExpediente, NroConcurso, NroAdjudicacion, NroAutorizacion,
       TipoOperacion, CondPago, FechaInvitacion, LugarEntrega, IdProveedor, IdDeposito,
       Estado, Total, Observaciones, OperAlta)
    OUTPUT INSERTED.IdOrden
    VALUES (@p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,N'EMITIDA',@p12,@p13,@p14)
    `,
		[
			{ value: nroOrden },
			{ value: data.idSolicitud ? Number(data.idSolicitud) : null },
			{ value: nroExpediente },
			{ value: str(data.nroConcurso, 50) || null },
			{ value: str(data.nroAdjudicacion, 50) || null },
			{ value: str(data.nroAutorizacion, 50) || null },
			{ value: str(data.tipoOperacion, 50) || 'DIRECTA' },
			{ value: str(data.condPago, 50) || 'CONTADO' },
			{ value: dateOrNull(data.fechaInvitacion) || today() },
			{ value: str(data.lugarEntrega, 200) || 'ALMACEN GENERAL DEL HOSPITAL' },
			{ value: Number(data.idProveedor) },
			{ value: idDeposito },
			{ value: total },
			{ value: str(data.observaciones, 500) || null },
			{ value: opFromAuth(auth) },
		],
	);
	const idOrden = header[0].IdOrden;

	for (const it of normalized) {
		await executeQuery(
			`
      INSERT INTO dbo.imAlmacenOrdenItem
        (IdOrden, Renglon, IdArticulo, Descripcion, Observaciones, Cantidad, PrecioUnitario, Subtotal)
      VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7)
      `,
			[
				{ value: idOrden },
				{ value: it.renglon },
				{ value: it.idArticulo },
				{ value: it.descripcion },
				{ value: it.observaciones },
				{ value: it.cantidad },
				{ value: it.precioUnitario },
				{ value: it.subtotal },
			],
		);
	}

	if (data.idSolicitud) {
		const sol = await obtenerSolicitud(data.idSolicitud);
		if (sol && ['APROBADA', 'SOLICITADA', 'EN_COMPRA'].includes(String(sol.Estado || '').toUpperCase())) {
			await executeQuery(
				`UPDATE dbo.imAlmacenSolicitud SET Estado = N'EN_COMPRA' WHERE IdSolicitud = @p0`,
				[{ value: Number(data.idSolicitud) }],
			);
		}
	}

	return obtenerOrden(idOrden);
}

async function crearOrdenDesdeSolicitud(idSolicitud, data, auth) {
	await ensure();
	const sol = await obtenerSolicitud(idSolicitud);
	if (!sol) throw httpError('Solicitud no encontrada', 404);
	if (String(sol.TipoSolicitud || 'COMPRA').toUpperCase() === 'TRANSFERENCIA') {
		throw httpError('Las transferencias se ejecutan como movimiento entre depósitos, no como orden de compra');
	}
	// Flujo: desde solicitada/aprobada se emite orden → EN_COMPRA
	if (!['APROBADA', 'EN_COMPRA', 'SOLICITADA'].includes(String(sol.Estado || '').toUpperCase())) {
		throw httpError(
			`No se puede emitir orden con la solicitud en estado ${sol.Estado || 'desconocido'}. Debe estar Solicitada o Aprobada.`,
		);
	}
	if (!data.idProveedor) throw httpError('Seleccioná un proveedor');

	// Preferir renglones del cliente (con precios); si no, tomar ítems de la solicitud
	const bodyItems = Array.isArray(data.items) ? data.items : [];
	let items;
	if (bodyItems.length) {
		items = bodyItems.map((it) => ({
			idArticulo: it.idArticulo ? Number(it.idArticulo) : null,
			descripcion: str(it.descripcion, 300),
			observaciones: str(it.observaciones, 200) || null,
			cantidad: num(it.cantidad),
			precioUnitario: num(it.precioUnitario),
		}));
	} else {
		items = (sol.items || []).map((it) => ({
			idArticulo: it.IdArticulo,
			descripcion: it.Descripcion,
			observaciones: it.Observaciones,
			cantidad: it.Cantidad,
			precioUnitario: 0,
		}));
	}

	return crearOrden(
		{
			idSolicitud: sol.IdSolicitud,
			idProveedor: data.idProveedor,
			idDeposito: data.idDeposito,
			nroConcurso: data.nroConcurso,
			nroAdjudicacion: data.nroAdjudicacion,
			nroAutorizacion: data.nroAutorizacion || sol.NroPedido,
			tipoOperacion: data.tipoOperacion,
			condPago: data.condPago,
			fechaInvitacion: data.fechaInvitacion,
			lugarEntrega: data.lugarEntrega,
			observaciones: data.observaciones,
			items,
		},
		auth,
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actas de Recepción → actualiza stock
// ─────────────────────────────────────────────────────────────────────────────

async function listarActas({ search = '' } = {}) {
	await ensure();
	const params = [];
	let where = '1=1';
	if (search && search.trim()) {
		where += ' AND (a.NroActa LIKE @p0 OR o.NroOrden LIKE @p0 OR p.RazonSocial LIKE @p0)';
		params.push({ value: `%${search.trim()}%` });
	}
	return (
		(await executeQuery(
			`
    SELECT a.IdActa, a.NroActa, a.Fecha, a.IdOrden, a.NroExpediente, a.IdProveedor, a.IdDeposito,
      a.Descuento, a.Total, a.NroFactura, a.Estado, a.Observaciones, a.FechaAlta,
      o.NroOrden, p.RazonSocial AS Proveedor
    FROM dbo.imAlmacenActa a
    INNER JOIN dbo.imAlmacenOrden o ON o.IdOrden = a.IdOrden
    LEFT JOIN dbo.imAlmacenProveedor p ON p.IdProveedor = a.IdProveedor
    WHERE ${where}
    ORDER BY a.IdActa DESC
    `,
			params,
		)) || []
	);
}

async function obtenerActa(id) {
	await ensure();
	const rows = await executeQuery(
		`
    SELECT a.*, o.NroOrden, p.RazonSocial AS Proveedor, p.CUIT AS ProveedorCUIT, d.Nombre AS DepositoNombre
    FROM dbo.imAlmacenActa a
    INNER JOIN dbo.imAlmacenOrden o ON o.IdOrden = a.IdOrden
    LEFT JOIN dbo.imAlmacenProveedor p ON p.IdProveedor = a.IdProveedor
    LEFT JOIN dbo.imAlmacenDeposito d ON d.IdDeposito = a.IdDeposito
    WHERE a.IdActa = @p0
    `,
		[{ value: Number(id) }],
	);
	if (!rows?.length) return null;
	const items =
		(await executeQuery(
			`
    SELECT IdItem, IdActa, Renglon, IdArticulo, IdOrdenItem, Descripcion, Marca, Lote,
      Cantidad, PrecioUnitario, PrecioTotal
    FROM dbo.imAlmacenActaItem WHERE IdActa = @p0 ORDER BY Renglon
    `,
			[{ value: Number(id) }],
		)) || [];
	return { ...rows[0], items };
}

async function crearActa(data, auth) {
	await ensure();
	const orden = await obtenerOrden(data.idOrden);
	if (!orden) throw httpError('Orden de provisión no encontrada', 404);
	if (['ANULADA', 'RECIBIDA'].includes(orden.Estado)) {
		throw httpError(`La orden está en estado ${orden.Estado} y no admite recepción`);
	}

	const itemsInput = Array.isArray(data.items) ? data.items : [];
	if (!itemsInput.length) throw httpError('El acta debe incluir al menos un renglón');

	const idDeposito = Number(data.idDeposito || orden.IdDeposito);
	if (!idDeposito) throw httpError('Depósito de ingreso obligatorio');

	const nroActa = str(data.nroActa, 50) || (await nextNumber('dbo.imAlmacenActa', 'NroActa'));
	const operador = opFromAuth(auth);

	const pool = await getRequestPool();
	const transaction = new sql.Transaction(pool);
	await transaction.begin();

	try {
		let total = 0;
		const lines = [];

		for (let idx = 0; idx < itemsInput.length; idx++) {
			const it = itemsInput[idx];
			const cant = num(it.cantidad);
			if (cant <= 0) continue;

			const ordenItem = orden.items.find(
				(oi) =>
					(it.idOrdenItem && oi.IdItem === Number(it.idOrdenItem)) ||
					oi.Renglon === Number(it.renglon) ||
					oi.Renglon === idx + 1,
			);

			const desc = str(it.descripcion, 300) || ordenItem?.Descripcion || 'Sin descripción';
			const pu = num(it.precioUnitario, ordenItem ? num(ordenItem.PrecioUnitario) : 0);
			const pt = Math.round(cant * pu * 100) / 100;
			total += pt;

			const idArticulo = it.idArticulo
				? Number(it.idArticulo)
				: ordenItem?.IdArticulo || null;

			// Verificar pendiente de recepción
			if (ordenItem) {
				const pendiente = num(ordenItem.Cantidad) - num(ordenItem.CantidadRecibida);
				if (cant > pendiente + 0.0001) {
					throw httpError(
						`Renglón ${ordenItem.Renglon}: cantidad ${cant} supera pendiente ${pendiente}`,
					);
				}
			}

			lines.push({
				renglon: idx + 1,
				idArticulo,
				idOrdenItem: ordenItem?.IdItem || null,
				descripcion: desc,
				marca: str(it.marca, 100) || null,
				lote: str(it.lote || 'SL', 50) || '',
				cantidad: cant,
				precioUnitario: pu,
				precioTotal: pt,
			});
		}

		if (!lines.length) throw httpError('No hay renglones válidos');

		const descuento = num(data.descuento);
		const totalFinal = Math.max(0, total - descuento);

		const reqHeader = new sql.Request(transaction);
		const headerRes = await reqHeader
			.input('nro', sql.NVarChar(50), nroActa)
			.input('fecha', sql.Date, dateOrNull(data.fecha) || today())
			.input('idOrden', sql.Int, Number(orden.IdOrden))
			.input('exp', sql.NVarChar(50), str(data.nroExpediente, 50) || orden.NroExpediente)
			.input('prov', sql.Int, Number(data.idProveedor || orden.IdProveedor))
			.input('dep', sql.Int, idDeposito)
			.input('desc', sql.Decimal(18, 2), descuento)
			.input('tot', sql.Decimal(18, 2), totalFinal)
			.input('fac', sql.NVarChar(50), str(data.nroFactura, 50) || null)
			.input('obs', sql.NVarChar(500), str(data.observaciones, 500) || null)
			.input('oper', sql.NVarChar(50), operador)
			.query(
				`INSERT INTO dbo.imAlmacenActa
         (NroActa, Fecha, IdOrden, NroExpediente, IdProveedor, IdDeposito, Descuento, Total, NroFactura, Estado, Observaciones, OperAlta)
         OUTPUT INSERTED.IdActa
         VALUES (@nro, @fecha, @idOrden, @exp, @prov, @dep, @desc, @tot, @fac, N'CONFIRMADA', @obs, @oper)`,
			);

		const idActa = headerRes.recordset[0].IdActa;

		for (const line of lines) {
			const reqItem = new sql.Request(transaction);
			await reqItem
				.input('idActa', sql.Int, idActa)
				.input('ren', sql.Int, line.renglon)
				.input('art', sql.Int, line.idArticulo)
				.input('oi', sql.Int, line.idOrdenItem)
				.input('desc', sql.NVarChar(300), line.descripcion)
				.input('marca', sql.NVarChar(100), line.marca)
				.input('lote', sql.NVarChar(50), line.lote)
				.input('cant', sql.Decimal(18, 4), line.cantidad)
				.input('pu', sql.Decimal(18, 4), line.precioUnitario)
				.input('pt', sql.Decimal(18, 2), line.precioTotal)
				.query(
					`INSERT INTO dbo.imAlmacenActaItem
           (IdActa, Renglon, IdArticulo, IdOrdenItem, Descripcion, Marca, Lote, Cantidad, PrecioUnitario, PrecioTotal)
           VALUES (@idActa, @ren, @art, @oi, @desc, @marca, @lote, @cant, @pu, @pt)`,
				);

			// Stock
			if (line.idArticulo) {
				await _aplicarStockInternal({
					idArticulo: line.idArticulo,
					idDeposito,
					lote: line.lote,
					cantidad: line.cantidad,
					tipo: 'ENTRADA',
					idDocumento: idActa,
					tipoDocumento: 'ACTA',
					observaciones: `Acta ${nroActa} / Orden ${orden.NroOrden}`,
					operador,
					externalTx: transaction,
				});
			}

			// Actualizar cantidad recibida en orden
			if (line.idOrdenItem) {
				const reqUpd = new sql.Request(transaction);
				await reqUpd
					.input('oi', sql.Int, line.idOrdenItem)
					.input('cant', sql.Decimal(18, 4), line.cantidad)
					.query(
						`UPDATE dbo.imAlmacenOrdenItem
             SET CantidadRecibida = CantidadRecibida + @cant
             WHERE IdItem = @oi`,
					);
			}
		}

		// Estado de la orden
		const reqCheck = new sql.Request(transaction);
		const checkRes = await reqCheck.input('id', sql.Int, Number(orden.IdOrden)).query(
			`SELECT
         SUM(Cantidad) AS TotalPed,
         SUM(CantidadRecibida) AS TotalRec
       FROM dbo.imAlmacenOrdenItem WHERE IdOrden = @id`,
		);
		const totalPed = num(checkRes.recordset[0]?.TotalPed);
		const totalRec = num(checkRes.recordset[0]?.TotalRec);
		const nuevoEstado = totalRec + 0.0001 >= totalPed ? 'RECIBIDA' : 'PARCIAL';

		const reqOrd = new sql.Request(transaction);
		await reqOrd
			.input('est', sql.NVarChar(30), nuevoEstado)
			.input('id', sql.Int, Number(orden.IdOrden))
			.query(`UPDATE dbo.imAlmacenOrden SET Estado = @est WHERE IdOrden = @id`);

		// Si orden completa y viene de solicitud → completar solicitud
		if (nuevoEstado === 'RECIBIDA' && orden.IdSolicitud) {
			const reqSol = new sql.Request(transaction);
			await reqSol
				.input('id', sql.Int, Number(orden.IdSolicitud))
				.query(
					`UPDATE dbo.imAlmacenSolicitud SET Estado = N'COMPLETADA' WHERE IdSolicitud = @id AND Estado IN (N'EN_COMPRA', N'APROBADA')`,
				);
		}

		await transaction.commit();
		return obtenerActa(idActa);
	} catch (e) {
		try {
			await transaction.rollback();
		} catch (_) {
			/* ignore */
		}
		throw e;
	}
}

module.exports = {
	ensureAlmacenSchema: ensure,
	getResumen,
	listarStock,
	resumenDepositos,
	listarMovimientos,
	registrarAjuste,
	registrarSalida,
	listarDepositos,
	listarArticulos,
	listarTrazabilidad,
	obtenerArticulo,
	crearArticulo,
	actualizarArticulo,
	eliminarArticulo,
	estadoVademecum,
	importarDesdeVademecum,
	maybeAutoSyncVademecum,
	listarProveedores,
	crearProveedor,
	actualizarProveedor,
	eliminarProveedor,
	listarSolicitudes,
	obtenerSolicitud,
	crearSolicitud,
	actualizarSolicitud,
	cambiarEstadoSolicitud,
	ejecutarTransferenciaSolicitud,
	detalleTrazabilidadArticulo,
	buscarArticuloPorCodigo,
	proximoNroPedido,
	listarDestinatariosSolicitud,
	listarOrigenesSolicitud,
	listarOrdenes,
	obtenerOrden,
	crearOrden,
	crearOrdenDesdeSolicitud,
	actualizarOrden,
	anularOrden,
	listarActas,
	obtenerActa,
	crearActa,
};
