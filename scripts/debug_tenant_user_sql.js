/**
 * Debug SQL tenant Sanatorio Sarmiento (empresa 101) para usuario 26812159.
 * Usa conexión de Empresas en MySQL Railway + mssql.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');

const USER = String(process.argv[2] || '26812159').trim();
const EMP = Number(process.argv[3] || 101);

async function main() {
	const url = process.env.MYSQL_PUBLIC_URL;
	const mp = await mysql.createPool(url);
	const [rows] = await mp.query(
		`SELECT IDEMPRESA, DESCRIPCION, DbServer, DbPort, DbInstance, DbName, DbUser, DbPassword, DbPasswordEnc
     FROM Empresas WHERE IDEMPRESA = ?`,
		[EMP],
	);
	if (!rows.length) throw new Error('Empresa no encontrada: ' + EMP);
	const e = rows[0];
	console.log('Empresa:', e.IDEMPRESA, e.DESCRIPCION);
	console.log('SQL:', e.DbServer, e.DbPort, e.DbName, e.DbUser);

	const {
		resolvePasswordFromEmpresaRow,
		normalizeEmpresaRow,
	} = require('../src/utils/empresaDbConnection');
	const norm = normalizeEmpresaRow(e);
	let password = '';
	try {
		password = resolvePasswordFromEmpresaRow(norm);
	} catch (err) {
		console.warn('resolvePassword fail:', err.message);
		password = String(e.DbPassword || '').trim();
	}
	console.log(
		'Password source:',
		e.DbPassword && String(e.DbPassword).trim()
			? 'DbPassword(plain)'
			: e.DbPasswordEnc
				? 'DbPasswordEnc'
				: 'NONE',
		'len=',
		password.length,
	);

	const config = {
		server: String(e.DbServer).trim(),
		port: Number(e.DbPort) || 1433,
		database: String(e.DbName).trim(),
		user: String(e.DbUser).trim(),
		password: String(password),
		options: {
			encrypt: false,
			trustServerCertificate: true,
			enableArithAbort: true,
		},
		connectionTimeout: 20000,
		requestTimeout: 60000,
	};
	if (e.DbInstance) {
		config.options.instanceName = String(e.DbInstance).trim();
	}

	console.log('Conectando SQL Server…');
	const pool = await sql.connect(config);
	const q = async (text, params = {}) => {
		const req = pool.request();
		for (const [k, v] of Object.entries(params)) {
			req.input(k, v);
		}
		return (await req.query(text)).recordset;
	};

	const section = (t) => console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);

	section('MySQL cuenta (referencia)');
	const [pwCloud] = await mp.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed, NumeroDocumento, CodOperador, Apellido, Nombres
     FROM imPassword WHERE IdEmpresa=? AND LOWER(TRIM(NombreRed))=LOWER(?)`,
		[EMP, USER],
	);
	console.table(pwCloud);
	const cloudVp = pwCloud[0]?.ValorPersonal;

	section('SQL imPersonal por Numero / Valor');
	const personal = await q(`
    SELECT TOP 20 Valor, ApellidoNombre, Numero, TipoDocumento, Rol, Estado, Matricula, MatriculaNacional
    FROM dbo.imPersonal
    WHERE CAST(Numero AS VARCHAR(32)) = @u
       OR CAST(Valor AS VARCHAR(32)) = @u
       OR Valor = @vp
       OR Valor = 347
       OR Valor = 5536
    ORDER BY Valor
  `, { u: USER, vp: Number(cloudVp) || 0 });
	console.table(personal);

	section('SQL imPassword por NombreRed / ValorPersonal');
	const passwords = await q(`
    SELECT TOP 20 ValorPersonal, NombreRed, NumeroDocumento, CodOperador, Grupo, Apellido, Nombres,
           CASE WHEN Password IS NULL THEN 0 ELSE LEN(CAST(Password AS VARCHAR(200))) END AS pwLen
    FROM dbo.imPassword
    WHERE LTRIM(RTRIM(NombreRed)) = @u
       OR CAST(ValorPersonal AS VARCHAR(32)) = @u
       OR ValorPersonal = @vp
       OR ValorPersonal = 347
       OR ValorPersonal = 5536
       OR CAST(NumeroDocumento AS VARCHAR(32)) = @u
  `, { u: USER, vp: Number(cloudVp) || 0 });
	console.table(passwords);

	section('SQL imPersonalSectores 347 / 5536 / cloudVp');
	try {
		const sectores = await q(`
      SELECT ps.idPersonal, ps.idSector, s.Descripcion
      FROM dbo.imPersonalSectores ps
      LEFT JOIN dbo.Sectores s ON s.IdSector = ps.idSector
      WHERE ps.idPersonal IN (347, 5536, @vp)
    `, { vp: Number(cloudVp) || 0 });
		console.table(sectores);
	} catch (err) {
		console.log('sectores:', err.message);
		const sectores2 = await q(`
      SELECT * FROM dbo.imPersonalSectores WHERE idPersonal IN (347, 5536, @vp)
    `, { vp: Number(cloudVp) || 0 });
		console.table(sectores2);
	}

	section('Permisos / rol relevantes');
	try {
		const roles = await q(`
      SELECT * FROM dbo.imPersonalRoles WHERE Valor IN (347, 5536, @vp)
    `, { vp: Number(cloudVp) || 0 });
		console.table(roles);
	} catch (err) {
		console.log('imPersonalRoles:', err.message);
	}

	section('Sample indicaciones recientes (si hay tabla)');
	try {
		const ind = await q(`
      SELECT TOP 5 * FROM dbo.imIndicacionesMedicas ORDER BY 1 DESC
    `);
		console.log('cols', Object.keys(ind[0] || {}));
		console.log('rows', ind.length);
	} catch (err) {
		try {
			const ind2 = await q(`SELECT TOP 3 name FROM sys.tables WHERE name LIKE '%Indic%'`);
			console.table(ind2);
		} catch (e2) {
			console.log(err.message);
		}
	}

	section('Diagnóstico');
	const hasPw347 = passwords.some((r) => Number(r.ValorPersonal) === 347);
	const hasPw5536 = passwords.some((r) => Number(r.ValorPersonal) === 5536);
	const hasPer347 = personal.some((r) => Number(r.Valor) === 347);
	const hasPer5536 = personal.some((r) => Number(r.Valor) === 5536);
	console.log({ cloudVp, hasPer347, hasPer5536, hasPw347, hasPw5536 });
	if (cloudVp && Number(cloudVp) !== 347 && hasPer347) {
		console.log(
			'⚠ DESYNC: MySQL login usa ValorPersonal=' +
				cloudVp +
				' pero la ficha con DNI en SQL/MySQL apunta a Valor=347. Admin mira 347 → "sin cuenta". Sesión opera como ' +
				cloudVp +
				'.',
		);
	}
	if (!hasPw347 && hasPer347) {
		console.log('⚠ SQL hospital: personal 347 SIN imPassword → admin ve sin cuenta (consulta SQL).');
	}
	if (!hasPer5536 && Number(cloudVp) === 5536) {
		console.log('⚠ SQL hospital: NO existe personal 5536 → sesión nube sin ficha física (indicaciones/camas fallan).');
	}

	await pool.close();
	await mp.end();
}

main().catch((e) => {
	console.error('FAIL', e.message);
	process.exit(1);
});
