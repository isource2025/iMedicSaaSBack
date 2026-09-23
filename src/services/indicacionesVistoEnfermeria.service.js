const { executeQuery } = require('../models/db');

/**
 * "Nueva" para enfermería = Estado = 'N' en imInterIndMedicas (sistema Clarion).
 * Al entrar al detalle de cama, enfermería limpia Estado N → NULL.
 * No usa tabla auxiliar: unifica con el sistema anterior.
 */

const SQL_ES_NUEVA =
	"UPPER(LTRIM(RTRIM(ISNULL(iim.Estado, '')))) = 'N'";

const OUTER_APPLY_COUNT = `
    OUTER APPLY (
      SELECT COUNT(1) AS IndicacionesNuevasEnfermeria
      FROM dbo.imInterIndMedicas iim
      WHERE iim.NumeroVisita = hc.NumeroVisita
        AND ISNULL(hc.NumeroVisita, 0) <> 0
        AND ISNULL(iim.NroAdicional, 0) = 0
        AND iim.TipoIndicacion <> 9
        AND ${SQL_ES_NUEVA}
    ) indn
`;

const SELECT_COUNT = `ISNULL(indn.IndicacionesNuevasEnfermeria, 0) AS IndicacionesNuevasEnfermeria`;
const SELECT_COUNT_ZERO = `CAST(0 AS INT) AS IndicacionesNuevasEnfermeria`;

/** CASE para listados de indicaciones (padre con Estado N). */
const CASE_NUEVA_ENFERMERIA = `
  CASE
    WHEN ${SQL_ES_NUEVA} AND ISNULL(iim.NroAdicional, 0) = 0 THEN 1
    ELSE 0
  END AS NuevaEnfermeria
`;

/**
 * Limpia el estado "nueva": Estado 'N' → NULL (padres de la visita).
 * @returns {{ actualizadas: number, nros: number[] }}
 */
async function marcarVistoPorVisita(numeroVisita, _operadorVista) {
	const sql = `
	UPDATE dbo.imInterIndMedicas
	SET Estado = NULL
	OUTPUT inserted.NroIndicacion
	WHERE NumeroVisita = @param0
	  AND ISNULL(NroAdicional, 0) = 0
	  AND TipoIndicacion <> 9
	  AND UPPER(LTRIM(RTRIM(ISNULL(Estado, '')))) = 'N';
	`;

	const rows = await executeQuery(sql, [{ value: Number(numeroVisita) }]);
	const list = Array.isArray(rows) ? rows : [];
	const nros = list
		.map((r) => Number(r.NroIndicacion ?? r.nroIndicacion))
		.filter((n) => Number.isFinite(n) && n > 0);
	return { actualizadas: nros.length, nros };
}

async function listarNuevasResumen(numeroVisita, limit = 3) {
	const lim = Math.min(Math.max(parseInt(String(limit), 10) || 3, 1), 5);
	try {
		const countRows = await executeQuery(
			`
			SELECT COUNT(1) AS TotalNuevas
			FROM dbo.imInterIndMedicas AS iim
			WHERE iim.NumeroVisita = @param0
			  AND ISNULL(iim.NroAdicional, 0) = 0
			  AND iim.TipoIndicacion <> 9
			  AND ${SQL_ES_NUEVA}
			`,
			[{ value: Number(numeroVisita) }],
		);
		const total = Number(countRows?.[0]?.TotalNuevas ?? countRows?.[0]?.totalNuevas ?? 0);
		if (total <= 0) return { total: 0, items: [] };

		const sql = `
		SELECT TOP (${lim})
		  iim.NroIndicacion,
		  iim.CantidadIndicada AS Cantidad,
		  iim.TipoUnidad,
		  iim.Frecuencia,
		  iim.AliasMedicamento,
		  tit.Tipo AS TipoIndicacion,
		  tit.PromptCodigo,
		  CASE
		    WHEN tit.Tipo = 'M' THEN COALESCE(v.Alias, v.Descripcion, iim.AliasMedicamento)
		    WHEN tit.Tipo = 'C' THEN tc.Descripcion
		    WHEN tit.Tipo = 'D' THEN td.Descripcion
		    WHEN tit.Tipo = 'A' THEN ca.Descripcion
		    ELSE iim.AliasMedicamento
		  END AS Descripcion
		FROM dbo.imInterIndMedicas AS iim
		INNER JOIN dbo.imInterTipoIndicacion AS tit ON iim.TipoIndicacion = tit.Valor
		LEFT JOIN dbo.imVademecum AS v ON tit.Tipo = 'M' AND iim.Codigo = v.Troquel
		LEFT JOIN dbo.imInterTipoControles AS tc ON tit.Tipo = 'C' AND iim.Codigo = tc.Valor
		LEFT JOIN dbo.imTipoDieta AS td ON tit.Tipo = 'D' AND iim.Codigo = td.Valor
		LEFT JOIN dbo.imInterCtrlAsistenciales AS ca ON tit.Tipo = 'A' AND iim.Codigo = ca.Valor
		WHERE iim.NumeroVisita = @param0
		  AND ISNULL(iim.NroAdicional, 0) = 0
		  AND iim.TipoIndicacion <> 9
		  AND ${SQL_ES_NUEVA}
		ORDER BY iim.NroIndicacion DESC;
		`;

		const rows = await executeQuery(sql, [{ value: Number(numeroVisita) }]);
		const list = Array.isArray(rows) ? rows : [];
		return {
			total,
			items: list.map((r) => ({
				nroIndicacion: r.NroIndicacion,
				descripcion: r.Descripcion || r.AliasMedicamento || '',
				tipo: r.TipoIndicacion || r.PromptCodigo || '',
				frecuencia: r.Frecuencia || '',
				cantidad: r.Cantidad,
				tipoUnidad: r.TipoUnidad || '',
			})),
		};
	} catch (e) {
		console.warn('[indicacionesVistoEnfermeria] Resumen de nuevas omitido:', e?.message || e);
		return { total: 0, items: [] };
	}
}

/** Compat: ya no hay tabla auxiliar; siempre disponible. */
async function ensureTable() {
	return true;
}

async function tablaLista() {
	return true;
}

module.exports = {
	ensureTable,
	tablaLista,
	OUTER_APPLY_COUNT,
	SELECT_COUNT,
	SELECT_COUNT_ZERO,
	CASE_NUEVA_ENFERMERIA,
	SQL_ES_NUEVA,
	marcarVistoPorVisita,
	listarNuevasResumen,
};
