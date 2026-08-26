const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');

/**
 * Estado compartido: indicaciones médicas aún no revisadas por enfermería.
 * Nunca debe romper GET /beds: DDL y joins van aislados, por tenant.
 */

const ensuredByTenant = new Map();

function tenantKey() {
	const id = getTenantId();
	return id != null && Number.isFinite(Number(id)) ? String(id) : 'default';
}

async function tablaExiste() {
	try {
		const rows = await executeQuery(`
			SELECT OBJECT_ID(N'dbo.imIndicacionesVistoEnfermeria', N'U') AS Id
		`);
		const row = rows?.[0] || {};
		return row.Id != null || row.id != null || row.ID != null;
	} catch (e) {
		console.warn('[indicacionesVistoEnfermeria] No se pudo chequear la tabla:', e?.message || e);
		return false;
	}
}

async function ensureTable() {
	const key = tenantKey();
	if (ensuredByTenant.get(key)) return true;
	if (await tablaExiste()) {
		ensuredByTenant.set(key, true);
		return true;
	}

	try {
		await executeQuery(`
		IF OBJECT_ID(N'dbo.imIndicacionesVistoEnfermeria', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imIndicacionesVistoEnfermeria (
				NumeroVisita INT NOT NULL,
				NroIndicacion INT NOT NULL,
				FechaVista DATETIME NOT NULL CONSTRAINT DF_imIndicacionesVistoEnfermeria_Fecha DEFAULT (GETDATE()),
				OperadorVista INT NULL,
				CONSTRAINT PK_imIndicacionesVistoEnfermeria PRIMARY KEY (NumeroVisita, NroIndicacion)
			);
		END
		`);
	} catch (e) {
		console.warn('[indicacionesVistoEnfermeria] No se pudo crear la tabla:', e?.message || e);
		return false;
	}

	try {
		await executeQuery(`
		IF OBJECT_ID(N'dbo.imIndicacionesVistoEnfermeria', N'U') IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM sys.indexes
			WHERE name = N'IX_imIndVistoEnf_Visita'
			  AND object_id = OBJECT_ID(N'dbo.imIndicacionesVistoEnfermeria')
		)
		BEGIN
			CREATE INDEX IX_imIndVistoEnf_Visita ON dbo.imIndicacionesVistoEnfermeria (NumeroVisita);
		END
		`);
	} catch (e) {
		console.warn('[indicacionesVistoEnfermeria] Índice omitido:', e?.message || e);
	}

	const ok = await tablaExiste();
	if (ok) ensuredByTenant.set(key, true);
	return ok;
}

/** true solo si la tabla ya está; no hace DDL. */
async function tablaLista() {
	const key = tenantKey();
	if (ensuredByTenant.get(key)) return true;
	const ok = await tablaExiste();
	if (ok) ensuredByTenant.set(key, true);
	return ok;
}

const OUTER_APPLY_COUNT = `
    OUTER APPLY (
      SELECT COUNT(1) AS IndicacionesNuevasEnfermeria
      FROM dbo.imInterIndMedicas iim
      WHERE iim.NumeroVisita = hc.NumeroVisita
        AND ISNULL(hc.NumeroVisita, 0) <> 0
        AND ISNULL(iim.NroAdicional, 0) = 0
        AND iim.TipoIndicacion <> 9
        AND UPPER(LTRIM(RTRIM(ISNULL(iim.Estado, '')))) <> 'S'
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.imIndicacionesVistoEnfermeria v
          WHERE v.NumeroVisita = iim.NumeroVisita
            AND v.NroIndicacion = iim.NroIndicacion
        )
    ) indn
`;

const SELECT_COUNT = `ISNULL(indn.IndicacionesNuevasEnfermeria, 0) AS IndicacionesNuevasEnfermeria`;
const SELECT_COUNT_ZERO = `CAST(0 AS INT) AS IndicacionesNuevasEnfermeria`;

async function marcarVistoPorVisita(numeroVisita, operadorVista) {
	const ok = await ensureTable();
	if (!ok) return 0;

	const sql = `
	INSERT INTO dbo.imIndicacionesVistoEnfermeria (NumeroVisita, NroIndicacion, FechaVista, OperadorVista)
	OUTPUT inserted.NroIndicacion
	SELECT iim.NumeroVisita, iim.NroIndicacion, GETDATE(), @param1
	FROM dbo.imInterIndMedicas iim
	WHERE iim.NumeroVisita = @param0
	  AND ISNULL(iim.NroAdicional, 0) = 0
	  AND iim.TipoIndicacion <> 9
	  AND UPPER(LTRIM(RTRIM(ISNULL(iim.Estado, '')))) <> 'S'
	  AND NOT EXISTS (
	    SELECT 1
	    FROM dbo.imIndicacionesVistoEnfermeria v
	    WHERE v.NumeroVisita = iim.NumeroVisita
	      AND v.NroIndicacion = iim.NroIndicacion
	  );
	`;

	const rows = await executeQuery(sql, [
		{ value: Number(numeroVisita) },
		{ value: operadorVista == null ? null : Number(operadorVista) },
	]);
	return Array.isArray(rows) ? rows.length : 0;
}

async function listarNuevasResumen(numeroVisita, limit = 3) {
	const lim = Math.min(Math.max(parseInt(String(limit), 10) || 3, 1), 5);
	try {
		const listo = await tablaLista();
		if (!listo) return { total: 0, items: [] };

		const countRows = await executeQuery(
			`
			SELECT COUNT(1) AS TotalNuevas
			FROM dbo.imInterIndMedicas AS iim
			WHERE iim.NumeroVisita = @param0
			  AND ISNULL(iim.NroAdicional, 0) = 0
			  AND iim.TipoIndicacion <> 9
			  AND UPPER(LTRIM(RTRIM(ISNULL(iim.Estado, '')))) <> 'S'
			  AND NOT EXISTS (
			    SELECT 1
			    FROM dbo.imIndicacionesVistoEnfermeria visto
			    WHERE visto.NumeroVisita = iim.NumeroVisita
			      AND visto.NroIndicacion = iim.NroIndicacion
			  )
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
		  AND UPPER(LTRIM(RTRIM(ISNULL(iim.Estado, '')))) <> 'S'
		  AND NOT EXISTS (
		    SELECT 1
		    FROM dbo.imIndicacionesVistoEnfermeria visto
		    WHERE visto.NumeroVisita = iim.NumeroVisita
		      AND visto.NroIndicacion = iim.NroIndicacion
		  )
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

module.exports = {
	ensureTable,
	tablaLista,
	OUTER_APPLY_COUNT,
	SELECT_COUNT,
	SELECT_COUNT_ZERO,
	marcarVistoPorVisita,
	listarNuevasResumen,
};
