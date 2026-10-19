/**
 * Corrige ProfesionalAsiste (y columnas equivalentes) que guardaron CodOperador
 * por el fallback viejo de sesión, en bases donde CodOperador = ValorPersonal+1.
 *
 * Criterio seguro: ProfesionalAsiste = OperadorCarga = pw.CodOperador
 * y pw.ValorPersonal <> CodOperador → reescribir a Matrícula (o ValorPersonal).
 *
 * No modifica CodOperador (rompería historial de movimientos/operador).
 *
 * Uso:
 *   node scripts/fix_profesional_asiste_codoperador.js            → dry-run
 *   node scripts/fix_profesional_asiste_codoperador.js --aplicar   → escribe
 *   node scripts/fix_profesional_asiste_codoperador.js --empresas=102
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const { cargarEntorno, obtenerEmpresas, conectar, parsearEmpresas } = require('./lib/tenantSql');

const APLICAR = process.argv.includes('--aplicar');
const ids = parsearEmpresas(process.argv) ?? [];

/** Tablas clínicas: operador + profesional en la misma fila. */
const TARGETS = [
	{
		tabla: 'imInterIndMedicas',
		operador: 'OperadorCarga',
		profesional: 'ProfesionalAsiste',
		pk: 'NroIndicacion',
	},
	{
		tabla: 'imInterCtrlMedicacion',
		operador: 'OperadorCarga',
		profesional: 'Profesional',
		pk: null,
	},
	{
		tabla: 'imInterCtrlFrecuentes',
		operador: 'OperadorCarga',
		profesional: 'Profesional',
		pk: null,
	},
	{
		tabla: 'imInterCtrlDieta',
		operador: 'OperadorCarga',
		profesional: 'Profesional',
		pk: null,
	},
	{
		tabla: 'imInterEvolucionEnf',
		operador: 'OperadorCarga',
		profesional: 'Profesional',
		pk: null,
	},
	{
		tabla: 'imBalanceHidrico',
		operador: 'OperadorCarga',
		profesional: 'Profesional',
		pk: null,
	},
];

async function tablaExiste(pool, nombre) {
	const r = await pool
		.request()
		.input('t', nombre)
		.query(
			`SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=@t`,
		);
	return r.recordset.length > 0;
}

async function columnasExisten(pool, tabla, cols) {
	const r = await pool.request().input('t', tabla).query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME=@t
  `);
	const set = new Set(r.recordset.map((x) => String(x.COLUMN_NAME).toLowerCase()));
	return cols.every((c) => set.has(String(c).toLowerCase()));
}

async function fixTabla(pool, empLabel, target) {
	const { tabla, operador, profesional } = target;
	if (!(await tablaExiste(pool, tabla))) return { tabla, skip: 'no existe' };
	if (!(await columnasExisten(pool, tabla, [operador, profesional]))) {
		return { tabla, skip: 'sin columnas' };
	}

	// CodOperador a veces es comparable solo como texto en bases legacy.
	const joinOp = `
    INNER JOIN dbo.imPassword pw
      ON LTRIM(RTRIM(CAST(pw.CodOperador AS varchar(40)))) = LTRIM(RTRIM(CAST(t.${profesional} AS varchar(40))))
     AND LTRIM(RTRIM(CAST(t.${operador} AS varchar(40)))) = LTRIM(RTRIM(CAST(t.${profesional} AS varchar(40))))
    INNER JOIN dbo.imPersonal per ON per.Valor = pw.ValorPersonal
    WHERE pw.ValorPersonal IS NOT NULL
      AND CAST(pw.ValorPersonal AS int) <> TRY_CAST(LTRIM(RTRIM(CAST(t.${profesional} AS varchar(40)))) AS int)
      AND COALESCE(NULLIF(TRY_CAST(per.Matricula AS int), 0), pw.ValorPersonal)
          <> TRY_CAST(LTRIM(RTRIM(CAST(t.${profesional} AS varchar(40)))) AS int)
  `;

	const preview = await pool.request().query(`
    SELECT TOP 50
      t.${operador} AS Operador,
      t.${profesional} AS ProfesionalViejo,
      pw.ValorPersonal,
      pw.CodOperador,
      pw.NombreRed,
      per.Matricula,
      per.ApellidoNombre,
      COALESCE(NULLIF(TRY_CAST(per.Matricula AS int), 0), pw.ValorPersonal) AS ProfesionalNuevo
    FROM dbo.[${tabla}] t
    ${joinOp}
  `);

	const count = await pool.request().query(`
    SELECT COUNT(*) AS c
    FROM dbo.[${tabla}] t
    ${joinOp}
  `);

	const n = Number(count.recordset[0]?.c) || 0;
	let updated = 0;
	if (APLICAR && n > 0) {
		const upd = await pool.request().query(`
      UPDATE t
      SET ${profesional} = COALESCE(NULLIF(TRY_CAST(per.Matricula AS int), 0), pw.ValorPersonal)
      FROM dbo.[${tabla}] t
      ${joinOp}
    `);
		updated = Number(upd.rowsAffected?.[0]) || 0;
	}

	return {
		tabla,
		candidatos: n,
		updated,
		muestra: preview.recordset.slice(0, 5),
		empresa: empLabel,
	};
}

(async () => {
	cargarEntorno();
	const empresas = await obtenerEmpresas(ids);
	console.log(
		APLICAR ? 'MODO APLICAR' : 'MODO DRY-RUN (pass --aplicar para escribir)',
		`empresas=${empresas.length}`,
	);

	const resumen = [];
	for (const e of empresas) {
		const id = e.IdEmpresa || e.IDEMPRESA;
		const label = `${id} ${e.Nombre || e.Descripcion || e.DESCRIPCION || ''}`.trim();
		let pool;
		try {
			pool = await conectar(e);
		} catch (err) {
			console.warn(`[skip] ${label}: ${err.message}`);
			continue;
		}
		console.log(`\n=== ${label} (${e.DbServer}/${e.DbName}) ===`);
		for (const t of TARGETS) {
			try {
				const r = await fixTabla(pool, label, t);
				resumen.push(r);
				if (r.skip) {
					console.log(`  ${t.tabla}: skip (${r.skip})`);
				} else {
					console.log(
						`  ${t.tabla}: candidatos=${r.candidatos}` +
							(APLICAR ? ` updated=${r.updated}` : ''),
					);
					if (r.muestra?.length) console.table(r.muestra);
				}
			} catch (err) {
				console.warn(`  ${t.tabla}: ERROR ${err.message}`);
			}
		}
		await pool.close();
	}

	const totalCand = resumen.reduce((s, r) => s + (r.candidatos || 0), 0);
	const totalUpd = resumen.reduce((s, r) => s + (r.updated || 0), 0);
	console.log('\nTOTAL candidatos=', totalCand, APLICAR ? `updated=${totalUpd}` : '(dry-run)');
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
