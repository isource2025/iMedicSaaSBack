/**
 * Solo lectura: cuentas de imPassword con CodOperador <> ValorPersonal por empresa.
 * Con CO <> VP el mismo número nombra a dos personas (OperadorCarga guarda CodOperador,
 * Profesional guarda ValorPersonal/matrícula). Ver colman_alinear_codoperador.js.
 *
 *   node scripts/audit_codoperador_valorpersonal.js [--empresas=1,102]
 */
const { cargarEntorno, obtenerEmpresas, conectar, parsearEmpresas } = require('./lib/tenantSql');

(async () => {
	cargarEntorno();
	const empresas = await obtenerEmpresas(parsearEmpresas(process.argv) ?? []);
	const filas = [];
	for (const e of empresas) {
		const id = e.IdEmpresa ?? e.IDEMPRESA;
		let pool;
		try {
			pool = await conectar(e);
			const [r] = (
				await pool.request().query(`
				SELECT COUNT(*) cuentas,
				  SUM(CASE WHEN ValorPersonal IS NOT NULL AND TRY_CAST(CodOperador AS int) <> ValorPersonal THEN 1 ELSE 0 END) desalineadas,
				  SUM(CASE WHEN ValorPersonal IS NULL THEN 1 ELSE 0 END) sinFicha,
				  CAST(COLUMNPROPERTY(OBJECT_ID('dbo.imPassword'), 'CodOperador', 'IsIdentity') AS int) coIdentity
				FROM dbo.imPassword`)
			).recordset;
			filas.push({ id, db: `${e.DbServer}/${e.DbName}`, ...r });
		} catch (err) {
			filas.push({ id, db: `${e.DbServer}/${e.DbName}`, error: err.message.slice(0, 60) });
		} finally {
			await pool?.close().catch(() => {});
		}
	}
	console.table(filas);
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
