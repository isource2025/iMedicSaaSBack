require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

(async () => {
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [pers] = await mp.query(
		'SELECT Valor, Matricula, ApellidoNombre FROM imPersonal WHERE IdEmpresa=101 AND Valor=347',
	);
	console.log('mysql personal 347', pers);
	if (!pers[0]?.Matricula) {
		await mp.query('UPDATE imPersonal SET Matricula=5718 WHERE IdEmpresa=101 AND Valor=347');
		console.log('synced Matricula=5718 to MySQL');
	}

	const [er] = await mp.query('SELECT * FROM Empresas WHERE IDEMPRESA=101');
	const pw = resolvePasswordFromEmpresaRow(normalizeEmpresaRow(er[0]));
	const pool = await sql.connect({
		server: '190.183.130.26',
		port: 51433,
		database: 'isource',
		user: 'sa',
		password: pw,
		options: { encrypt: false, trustServerCertificate: true },
	});

	const q = await pool.request().query(`
SELECT TOP 10
  iim.NroIndicacion, iim.ProfesionalAsiste,
  COALESCE(
    NULLIF(LTRIM(RTRIM(ISNULL(p.Nombres, '') + ' ' + ISNULL(p.Apellido, ''))), ''),
    per.ApellidoNombre,
    CAST(iim.ProfesionalAsiste AS varchar(20))
  ) AS FullName,
  per.Matricula AS MatriculaProfesional
FROM dbo.imInterIndMedicas AS iim
OUTER APPLY (
  SELECT TOP 1 per0.Valor, per0.Matricula, per0.ApellidoNombre
  FROM dbo.imPersonal AS per0
  WHERE per0.Valor = iim.ProfesionalAsiste OR per0.Matricula = iim.ProfesionalAsiste
  ORDER BY CASE WHEN per0.Valor = iim.ProfesionalAsiste THEN 0 ELSE 1 END
) per
LEFT JOIN dbo.imPassword AS p
  ON p.ValorPersonal = iim.ProfesionalAsiste
  OR (per.Valor IS NOT NULL AND p.ValorPersonal = per.Valor)
INNER JOIN dbo.imInterTipoIndicacion AS tit ON iim.TipoIndicacion = tit.Valor
WHERE iim.NumeroVisita = 392 AND iim.TipoIndicacion <> 9
ORDER BY iim.NroIndicacion DESC
  `);
	console.table(q.recordset);
	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
