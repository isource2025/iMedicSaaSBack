const { executeQuery } = require('../models/db');

/**
 * Estado compartido: indicaciones médicas aún no revisadas por enfermería.
 * Cualquier enfermero que las vea las marca para todos (no es por usuario).
 */

let ensured = false;

async function ensureTable() {
	if (ensured) return true;
	let created = false;
	try {
		const rows = await executeQuery(`
		IF OBJECT_ID(N'dbo.imIndicacionesVistoEnfermeria', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imIndicacionesVistoEnfermeria (
				NumeroVisita INT NOT NULL,
				NroIndicacion INT NOT NULL,
				FechaVista DATETIME NOT NULL CONSTRAINT DF_imIndicacionesVistoEnfermeria_Fecha DEFAULT (GETDATE()),
				OperadorVista INT NULL,
				CONSTRAINT PK_imIndicacionesVistoEnfermeria PRIMARY KEY (NumeroVisita, NroIndicacion)
			);
			CREATE INDEX IX_imIndVistoEnf_Visita ON dbo.imIndicacionesVistoEnfermeria (NumeroVisita);
			SELECT CAST(1 AS INT) AS Created;
		END
		ELSE
		BEGIN
			SELECT CAST(0 AS INT) AS Created;
		END
		`);
		created = Number(rows?.[0]?.Created) === 1;
	} catch (e) {
		console.warn('[indicacionesVistoEnfermeria] No se pudo asegurar la tabla:', e?.message || e);
		return false;
	}

	if (created) {
		try {
			await executeQuery(`
			INSERT INTO dbo.imIndicacionesVistoEnfermeria (NumeroVisita, NroIndicacion, FechaVista, OperadorVista)
			SELECT DISTINCT iim.NumeroVisita, iim.NroIndicacion, GETDATE(), NULL
			FROM dbo.imInterIndMedicas iim
			WHERE ISNULL(iim.NroAdicional, 0) = 0
			  AND iim.NumeroVisita IS NOT NULL
			  AND iim.NroIndicacion IS NOT NULL;
			`);
		} catch (e) {
			console.warn('[indicacionesVistoEnfermeria] Seed inicial omitido:', e?.message || e);
		}
	}

	ensured = true;
	return true;
}

/** OUTER APPLY + columna para listados de camas (alias hc). */
const OUTER_APPLY_COUNT = `
    OUTER APPLY (
      SELECT COUNT(1) AS IndicacionesNuevasEnfermeria
      FROM dbo.imInterIndMedicas iim
      WHERE iim.NumeroVisita = hc.NumeroVisita
        AND ISNULL(hc.NumeroVisita, 0) <> 0
        AND ISNULL(iim.NroAdicional, 0) = 0
        AND iim.TipoIndicacion <> 9
        AND (iim.Estado IS NULL OR iim.Estado <> 'S')
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.imIndicacionesVistoEnfermeria v
          WHERE v.NumeroVisita = iim.NumeroVisita
            AND v.NroIndicacion = iim.NroIndicacion
        )
    ) indn
`;

const SELECT_COUNT = `ISNULL(indn.IndicacionesNuevasEnfermeria, 0) AS IndicacionesNuevasEnfermeria`;

/**
 * Marca como vistas (compartido) todas las indicaciones padre vigentes de la visita.
 * @param {number} numeroVisita
 * @param {number|null} operadorVista
 * @returns {Promise<number>} filas insertadas
 */
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
	  AND (iim.Estado IS NULL OR iim.Estado <> 'S')
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

module.exports = {
	ensureTable,
	OUTER_APPLY_COUNT,
	SELECT_COUNT,
	marcarVistoPorVisita,
};
