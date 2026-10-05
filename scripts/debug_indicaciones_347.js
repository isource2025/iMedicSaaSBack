require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

(async () => {
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const [er] = await mp.query('SELECT * FROM Empresas WHERE IDEMPRESA=101');
	const pw = resolvePasswordFromEmpresaRow(normalizeEmpresaRow(er[0]));
	const pool = await sql.connect({
		server: '190.183.130.26',
		port: 51433,
		database: 'isource',
		user: 'sa',
		password: pw,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 60000,
	});
	const q = async (t) => (await pool.request().query(t)).recordset;

	console.log('=== ultimas indicaciones ===');
	console.table(
		await q(`SELECT TOP 15 NroIndicacion, NumeroVisita, ProfesionalAsiste, OperadorCarga,
      TipoIndicacion, Codigo, Estado, IdSector, FechaCarga, FechaProximo, NroAdicional
    FROM dbo.imInterIndMedicas ORDER BY NroIndicacion DESC`),
	);

	console.log('=== imPassword 347/5536/otros recent profesionales ===');
	console.table(
		await q(
			`SELECT ValorPersonal, NombreRed, CodOperador FROM dbo.imPassword WHERE ValorPersonal IN (347,5536,6)`,
		),
	);

	console.log('=== indicaciones de 347 o 5536 ===');
	console.table(
		await q(`SELECT TOP 20 NroIndicacion, NumeroVisita, ProfesionalAsiste, OperadorCarga, Estado, IdSector, AliasMedicamento
    FROM dbo.imInterIndMedicas WHERE ProfesionalAsiste IN (347,5536) OR OperadorCarga IN (347,5536,6)
    ORDER BY NroIndicacion DESC`),
	);

	console.log('=== recientes SIN match imPassword (INNER JOIN las oculta) ===');
	console.table(
		await q(`SELECT TOP 15 iim.NroIndicacion, iim.NumeroVisita, iim.ProfesionalAsiste, iim.Estado
    FROM dbo.imInterIndMedicas iim
    LEFT JOIN dbo.imPassword p ON iim.ProfesionalAsiste = p.ValorPersonal
    WHERE p.ValorPersonal IS NULL
    ORDER BY iim.NroIndicacion DESC`),
	);

	console.log('=== test list join para visita reciente de 347 ===');
	const visitas = await q(`SELECT TOP 5 NumeroVisita, COUNT(*) c FROM dbo.imInterIndMedicas
    WHERE ProfesionalAsiste=347 GROUP BY NumeroVisita ORDER BY MAX(NroIndicacion) DESC`);
	console.table(visitas);
	if (visitas[0]) {
		const nv = visitas[0].NumeroVisita;
		console.log('list would return for visita', nv);
		console.table(
			await q(`SELECT iim.NroIndicacion, iim.ProfesionalAsiste, p.NombreRed, iim.Estado, iim.FechaProximo
      FROM dbo.imInterIndMedicas iim
      INNER JOIN dbo.imPassword p ON iim.ProfesionalAsiste = p.ValorPersonal
      WHERE iim.NumeroVisita=${nv} AND iim.TipoIndicacion<>9
      ORDER BY iim.NroIndicacion DESC`),
		);
	}

	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
