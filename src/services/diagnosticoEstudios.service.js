const { executeQuery } = require('../models/db');

/**
 * Diagnóstico de SOLO LECTURA sobre estudios / laboratorio de la empresa (tenant) actual.
 * Consultas fijas y agregadas: no devuelve pacientes, notas ni textos de informes.
 * Cada bloque se ejecuta aislado: si uno falla (p. ej. falta una tabla) se informa y sigue.
 */
async function _bloque(fn) {
	try {
		return await fn();
	} catch (err) {
		return { error: String(err?.message || err).slice(0, 300) };
	}
}

const _num = (v) => (v == null ? 0 : Number(v));

async function diagnosticoLaboratorio({ codigo } = {}) {
	// Código a rastrear (el del ticket). Solo dígitos para poder usarlo en LIKE sin riesgo.
	const cod = String(codigo || '').replace(/\D/g, '').slice(0, 10);
	const like = cod ? `%${cod}%` : null;
	const p = like ? [{ value: like, type: 'VarChar' }] : [];

	const out = { codigoBuscado: cod || null };

	out.catalogos = await _bloque(async () => {
		const rows = await executeQuery(`
			SELECT 'imNomenclador' AS tabla, COUNT(*) AS total,
			       SUM(CASE WHEN CAST(IDPractica AS VARCHAR(20)) LIKE '66%' THEN 1 ELSE 0 END) AS prefijo66,
			       SUM(CASE WHEN CAST(IDPractica AS VARCHAR(20)) LIKE '42%' THEN 1 ELSE 0 END) AS prefijo42
			FROM dbo.imNomenclador
			UNION ALL
			SELECT 'imModuladas', COUNT(*),
			       SUM(CASE WHEN CAST(IDPractica AS VARCHAR(20)) LIKE '66%' THEN 1 ELSE 0 END),
			       SUM(CASE WHEN CAST(IDPractica AS VARCHAR(20)) LIKE '42%' THEN 1 ELSE 0 END)
			FROM dbo.imModuladas
			UNION ALL
			SELECT 'imTiposPedidosEstudios', COUNT(*),
			       SUM(CASE WHEN CAST(IdPractica AS VARCHAR(20)) LIKE '66%' THEN 1 ELSE 0 END),
			       SUM(CASE WHEN CAST(IdPractica AS VARCHAR(20)) LIKE '42%' THEN 1 ELSE 0 END)
			FROM dbo.imTiposPedidosEstudios`);
		return (rows || []).map((r) => ({
			tabla: r.tabla,
			total: _num(r.total),
			prefijo66: _num(r.prefijo66),
			prefijo42: _num(r.prefijo42),
		}));
	});

	if (cod) {
		out.codigoEnCatalogos = await _bloque(async () => {
			const rows = await executeQuery(
				`SELECT 'imNomenclador' AS tabla, COUNT(*) AS n FROM dbo.imNomenclador
				   WHERE CAST(IDPractica AS VARCHAR(20)) LIKE @p0 OR Descripcion LIKE @p0
				 UNION ALL
				 SELECT 'imModuladas', COUNT(*) FROM dbo.imModuladas
				   WHERE CAST(IDPractica AS VARCHAR(20)) LIKE @p0 OR Descripcion LIKE @p0
				 UNION ALL
				 SELECT 'imTiposPedidosEstudios', COUNT(*) FROM dbo.imTiposPedidosEstudios
				   WHERE CAST(IdPractica AS VARCHAR(20)) LIKE @p0 OR DescPractica LIKE @p0
				 UNION ALL
				 SELECT 'imPedidosEstudios.IdPractica', COUNT(*) FROM dbo.imPedidosEstudios
				   WHERE CAST(IdPractica AS VARCHAR(20)) LIKE @p0
				 UNION ALL
				 SELECT 'imFacPracticas.Practica', COUNT(*) FROM dbo.imFacPracticas
				   WHERE CAST(Practica AS VARCHAR(20)) LIKE @p0`,
				p,
			);
			return (rows || []).map((r) => ({ donde: r.tabla, coincidencias: _num(r.n) }));
		});
	}

	out.serviciosLab = await _bloque(async () => {
		const rows = await executeQuery(`
			SELECT LTRIM(RTRIM(Valor)) AS valor, LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(120)))) AS descripcion,
			       LTRIM(RTRIM(CAST(PrefijosPractica AS VARCHAR(200)))) AS prefijos
			FROM dbo.imServicios
			WHERE Valor LIKE '%LAB%' OR CAST(Descripcion AS VARCHAR(200)) LIKE '%LABOR%'`);
		return rows || [];
	});

	out.sectoresLab = await _bloque(async () => {
		const rows = await executeQuery(`
			SELECT LTRIM(RTRIM(Valor)) AS valor, LTRIM(RTRIM(ValorServicio)) AS valorServicio,
			       LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(120)))) AS descripcion
			FROM dbo.imSectores
			WHERE ValorServicio LIKE '%LAB%' OR Valor LIKE '%LAB%' OR CAST(Descripcion AS VARCHAR(200)) LIKE '%LABOR%'`);
		return rows || [];
	});

	out.pedidos = await _bloque(async () => {
		const [tot] = await executeQuery(`
			SELECT COUNT(*) AS total,
			       SUM(CASE WHEN IdProtocolo IS NULL OR IdProtocolo = 0 THEN 1 ELSE 0 END) AS pendientes,
			       MIN(FechaPedido) AS desde, MAX(FechaPedido) AS hasta
			FROM dbo.imPedidosEstudios`);
		const porReceptor = await executeQuery(`
			SELECT TOP 25 LTRIM(RTRIM(ISNULL(IdSectorReceptor, ''))) AS receptor, COUNT(*) AS total,
			       SUM(CASE WHEN IdProtocolo IS NULL OR IdProtocolo = 0 THEN 1 ELSE 0 END) AS pendientes
			FROM dbo.imPedidosEstudios
			GROUP BY LTRIM(RTRIM(ISNULL(IdSectorReceptor, '')))
			ORDER BY COUNT(*) DESC`);
		return {
			total: _num(tot?.total),
			pendientes: _num(tot?.pendientes),
			desde: tot?.desde || null,
			hasta: tot?.hasta || null,
			porReceptorTop25: (porReceptor || []).map((r) => ({
				receptor: r.receptor,
				total: _num(r.total),
				pendientes: _num(r.pendientes),
			})),
		};
	});

	out.pedidosLab = await _bloque(async () => {
		const [tot] = await executeQuery(`
			SELECT COUNT(*) AS total,
			       SUM(CASE WHEN IdProtocolo IS NULL OR IdProtocolo = 0 THEN 1 ELSE 0 END) AS pendientes,
			       MIN(FechaPedido) AS desde, MAX(FechaPedido) AS hasta
			FROM dbo.imPedidosEstudios
			WHERE LTRIM(RTRIM(IdSectorReceptor)) LIKE 'LAB%'`);
		const prefijos = await executeQuery(`
			SELECT TOP 15 LEFT(CAST(IdPractica AS VARCHAR(20)), 2) AS prefijo, COUNT(*) AS n
			FROM dbo.imPedidosEstudios
			WHERE LTRIM(RTRIM(IdSectorReceptor)) LIKE 'LAB%'
			GROUP BY LEFT(CAST(IdPractica AS VARCHAR(20)), 2)
			ORDER BY COUNT(*) DESC`);
		const topPracticas = await executeQuery(`
			SELECT TOP 15 pe.IdPractica AS practica, pe.IdTipoPedido AS tipoPedido,
			       LTRIM(RTRIM(ISNULL(t.DescPractica, ''))) AS descTipo, COUNT(*) AS n
			FROM dbo.imPedidosEstudios pe
			LEFT JOIN dbo.imTiposPedidosEstudios t ON t.IdTipoPedido = pe.IdTipoPedido
			WHERE LTRIM(RTRIM(pe.IdSectorReceptor)) LIKE 'LAB%'
			GROUP BY pe.IdPractica, pe.IdTipoPedido, LTRIM(RTRIM(ISNULL(t.DescPractica, '')))
			ORDER BY COUNT(*) DESC`);
		const sinCatalogo = await executeQuery(`
			SELECT COUNT(*) AS n, COUNT(DISTINCT pe.IdPractica) AS distintas
			FROM dbo.imPedidosEstudios pe
			WHERE LTRIM(RTRIM(pe.IdSectorReceptor)) LIKE 'LAB%'
			  AND NOT EXISTS (SELECT 1 FROM dbo.imNomenclador n WHERE n.IDPractica = pe.IdPractica)
			  AND NOT EXISTS (SELECT 1 FROM dbo.imModuladas m WHERE m.IDPractica = pe.IdPractica)`);
		return {
			total: _num(tot?.total),
			pendientes: _num(tot?.pendientes),
			desde: tot?.desde || null,
			hasta: tot?.hasta || null,
			porPrefijoPractica: (prefijos || []).map((r) => ({ prefijo: r.prefijo, n: _num(r.n) })),
			topPracticas: (topPracticas || []).map((r) => ({
				practica: r.practica,
				tipoPedido: r.tipoPedido,
				descripcion: r.descTipo,
				n: _num(r.n),
			})),
			pedidosConPracticaFueraDeNomencladorYModuladas: {
				pedidos: _num(sinCatalogo?.[0]?.n),
				practicasDistintas: _num(sinCatalogo?.[0]?.distintas),
			},
		};
	});

	// Efecto de nuestra migración: las tablas/columna nuevas deben estar vacías hasta que se use la vista beta.
	out.solicitudesMulti = await _bloque(async () => {
		const [r] = await executeQuery(`
			SELECT
			  CASE WHEN OBJECT_ID(N'dbo.imSolicitudesEstudios', N'U') IS NULL THEN -1
			       ELSE (SELECT COUNT(*) FROM dbo.imSolicitudesEstudios) END AS solicitudes,
			  CASE WHEN COL_LENGTH(N'dbo.imPedidosEstudios', N'IdSolicitud') IS NULL THEN -1
			       ELSE (SELECT COUNT(*) FROM dbo.imPedidosEstudios WHERE IdSolicitud IS NOT NULL) END AS pedidosConSolicitud`);
		return { filasCabecera: _num(r?.solicitudes), pedidosConIdSolicitud: _num(r?.pedidosConSolicitud) };
	});

	return out;
}

module.exports = { diagnosticoLaboratorio };
