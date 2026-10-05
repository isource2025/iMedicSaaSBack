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
	});
	const q = async (t) => (await pool.request().query(t)).recordset;

	console.log('=== personal 5570 / 5718 / 347 / 1 ===');
	console.table(
		await q(`SELECT Valor, ApellidoNombre, Matricula, Numero
      FROM dbo.imPersonal
      WHERE Valor IN (5570,5718,347,1) OR Matricula IN (5570,5718,347)`),
	);
	console.log('=== password ===');
	console.table(
		await q(`SELECT ValorPersonal, NombreRed, CodOperador, Apellido, Nombres
      FROM dbo.imPassword
      WHERE ValorPersonal IN (5570,5718,347,1)`),
	);
	console.log('=== raw ProfesionalAsiste en visita 392 ===');
	console.table(
		await q(`SELECT NroIndicacion, ProfesionalAsiste, OperadorCarga
      FROM dbo.imInterIndMedicas WHERE NumeroVisita=392 ORDER BY NroIndicacion`),
	);

	await pool.close();
	await mp.end();
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
