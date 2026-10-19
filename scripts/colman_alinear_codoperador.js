/**
 * Colman (IdEmpresa 102): CodOperador = ValorPersonal, como en el resto de las empresas.
 *
 * El ADMIN de Clarion (sin ficha) ocupó CodOperador=1 y el IDENTITY corrió a todas las
 * cuentas +1. El mismo número nombraba a dos personas según la columna.
 *
 * Hospital (SQL Server, una transacción):
 *  - Backup en dbo._bk20261019_* de imPassword y de cada fila que se corrige.
 *  - imPassword renumerado: CodOperador = ValorPersonal; ADMIN sin ficha -> 90001.
 *  - IDENTITY reseed al mayor ValorPersonal.
 *  - Filas clínicas corregidas una a una (autoría verificada contra AuthSessions):
 *      · aplicar (web) grababa el ValorPersonal de la enfermera en OperadorCarga: ya
 *        queda bien con CO=VP; Profesional pasa a la matrícula.
 *      · indicaciones 12 y 13: "aplicar" pisó ProfesionalAsiste; vuelve a COLMAN HORACIO.
 *      · columnas con semántica CodOperador (OperadorCarga de indicaciones, movimientos,
 *        log, normas) se remapean CO viejo -> CO nuevo.
 * Nube (MySQL): imPassword.CodOperador = ValorPersonal y revocación de sesiones.
 *
 * Uso:
 *   node scripts/colman_alinear_codoperador.js            -> dry-run (rollback)
 *   node scripts/colman_alinear_codoperador.js --aplicar  -> escribe
 */
const mysql = require('mysql2/promise');
const { sql, cargarEntorno, obtenerEmpresas, conectar } = require('./lib/tenantSql');
const { sqlInsertImPasswordConCodOperador } = require('../src/utils/imPasswordInsert');

const ID_EMPRESA = 102;
const CO_ADMIN_LEGACY = 90001;
const APLICAR = process.argv.includes('--aplicar');
const BK = '_bk20261019_';

/** Matrículas de quienes aplicaron (ValorPersonal -> Matrícula), verificadas en imPersonal. */
const MATRICULA = { 7: 6831, 11: 11506 };
const MATRICULA_HORACIO = 4562;

const PASSWORD_COLS = [
	'CodOperador', 'Apellido', 'Nombres', 'Password', 'NombreRed', 'FechaActual', 'CodOperHabil',
	'MarcadeBaja', 'CodLocalidad', 'DiasExpira', 'Legajo', 'TipoDocumento', 'NumeroDocumento',
	'Grupo', 'ValorPersonal',
];

async function backupFilas(tx, tabla, where) {
	const bk = `${BK}${tabla}`;
	await new sql.Request(tx).query(`
		IF OBJECT_ID('dbo.${bk}') IS NULL
			SELECT * INTO dbo.${bk} FROM dbo.${tabla} WHERE ${where};
	`);
}

async function upd(tx, desc, query) {
	const r = await new sql.Request(tx).query(query);
	const n = r.rowsAffected.reduce((a, b) => a + b, 0);
	console.log(`  ${desc}: ${n}`);
	return n;
}

async function hospital(empresa) {
	const pool = await conectar(empresa);
	// El valor de IDENTITY no vuelve atrás con ROLLBACK: se restaura a mano si no se aplica.
	const identOriginal = (await pool.request().query(`SELECT CAST(IDENT_CURRENT('dbo.imPassword') AS int) v`)).recordset[0].v;
	const restaurarIdentity = () =>
		pool.request().query(`DBCC CHECKIDENT ('dbo.imPassword', RESEED, ${identOriginal}) WITH NO_INFOMSGS;`);
	const tx = new sql.Transaction(pool);
	await tx.begin();
	const q = async (s) => (await new sql.Request(tx).query(s)).recordset;
	try {
		const pw = await q(`SELECT CodOperador, ValorPersonal, NombreRed FROM dbo.imPassword ORDER BY CodOperador`);
		const sinFicha = pw.filter((r) => r.ValorPersonal == null);
		if (pw.every((r) => r.ValorPersonal == null || r.CodOperador === r.ValorPersonal)) {
			console.log('  imPassword ya alineado (CodOperador = ValorPersonal); nada que hacer');
			await tx.rollback();
			return false;
		}
		if (sinFicha.length !== 1 || sinFicha[0].CodOperador !== 1) {
			throw new Error(`Se esperaba solo el ADMIN legacy (CO=1) sin ficha: ${JSON.stringify(sinFicha)}`);
		}
		const vps = pw.filter((r) => r.ValorPersonal != null).map((r) => r.ValorPersonal);
		if (new Set(vps).size !== vps.length) throw new Error('ValorPersonal duplicado en imPassword');

		const mapa = new Map(pw.map((r) => [r.CodOperador, r.ValorPersonal ?? CO_ADMIN_LEGACY]));
		const caseCo = (col) =>
			`CASE ${[...mapa].map(([viejo, nuevo]) => `WHEN ${col} = ${viejo} THEN ${nuevo}`).join(' ')} ELSE ${col} END`;
		const caseCoTexto = (col) =>
			`CASE ${[...mapa].map(([viejo, nuevo]) => `WHEN LTRIM(RTRIM(${col})) = '${viejo}' THEN '${nuevo}'`).join(' ')} ELSE ${col} END`;

		console.log('  backups');
		await backupFilas(tx, 'imPassword', '1=1');
		await backupFilas(tx, 'imInterIndMedicas', 'NroIndicacion IN (12,13,14)');
		await backupFilas(tx, 'imInterCtrlFrecuente', 'NumeroVisita = 51 AND Nroindicacion IN (12,13)');
		await backupFilas(tx, 'imInterCtrlMedicamento', 'IDCtrlMedica IN (1,2)');
		await backupFilas(tx, 'imInterCtrlDieta', 'Valor IN (1,2,3)');
		await backupFilas(tx, 'imVisitaMovimiento', "Operador IS NOT NULL AND LTRIM(RTRIM(Operador)) NOT IN ('', '0')");
		await backupFilas(tx, 'imLogCambios', 'CodOperador = 1');
		await backupFilas(tx, 'imFacPracticasNormas', 'CodOperador IN (1, 2)');

		console.log('  imPassword');
		const cols = PASSWORD_COLS.join(', ');
		const selectCols = PASSWORD_COLS.map((c) =>
			c === 'CodOperador' ? `ISNULL(ValorPersonal, ${CO_ADMIN_LEGACY})` : c,
		).join(', ');
		await new sql.Request(tx).query(`
			SELECT ${cols} INTO #pw FROM dbo.imPassword;
			DELETE FROM dbo.imPassword;
			SET IDENTITY_INSERT dbo.imPassword ON;
			INSERT INTO dbo.imPassword (${cols}) SELECT ${selectCols} FROM #pw;
			SET IDENTITY_INSERT dbo.imPassword OFF;
			DROP TABLE #pw;
		`);
		const maxVp = Math.max(...vps);
		await new sql.Request(tx).query(`DBCC CHECKIDENT ('dbo.imPassword', RESEED, ${maxVp}) WITH NO_INFOMSGS;`);

		console.log('  filas clínicas');
		await upd(tx, 'imInterIndMedicas.OperadorCarga (CO viejo -> nuevo)', `
			UPDATE dbo.imInterIndMedicas SET OperadorCarga = ${caseCo('OperadorCarga')}
			WHERE OperadorCarga IN (${[...mapa.keys()].join(',')})`);
		await upd(tx, 'imInterIndMedicas 12/13 ProfesionalAsiste -> COLMAN HORACIO', `
			UPDATE dbo.imInterIndMedicas SET ProfesionalAsiste = ${MATRICULA_HORACIO}
			WHERE NroIndicacion IN (12, 13) AND ProfesionalAsiste = 7`);
		for (const tabla of ['imInterCtrlFrecuente', 'imInterCtrlMedicamento']) {
			await upd(tx, `${tabla}.Profesional (VP -> matrícula)`, `
				UPDATE dbo.${tabla}
				SET Profesional = CASE Profesional ${Object.entries(MATRICULA).map(([vp, m]) => `WHEN ${vp} THEN ${m}`).join(' ')} END
				WHERE NumeroVisita = 51 AND Profesional IN (${Object.keys(MATRICULA).join(',')})
				  AND OperadorCarga = Profesional`);
		}
		await upd(tx, 'imInterCtrlDieta.Profesional 99999 -> HERMOSILLA', `
			UPDATE dbo.imInterCtrlDieta SET Profesional = ${MATRICULA[7]}
			WHERE Valor IN (1, 2, 3) AND OperadorCarga = 7 AND Profesional = 99999`);
		await upd(tx, 'imVisitaMovimiento.Operador (CO viejo -> nuevo)', `
			UPDATE dbo.imVisitaMovimiento SET Operador = ${caseCoTexto('Operador')}
			WHERE LTRIM(RTRIM(Operador)) IN (${[...mapa.keys()].map((k) => `'${k}'`).join(',')})`);
		await upd(tx, 'imLogCambios.CodOperador (CO viejo -> nuevo)', `
			UPDATE dbo.imLogCambios SET CodOperador = ${caseCo('CodOperador')}
			WHERE CodOperador IN (${[...mapa.keys()].join(',')})`);
		await upd(tx, 'imFacPracticasNormas.CodOperador (CO viejo -> nuevo)', `
			UPDATE dbo.imFacPracticasNormas SET CodOperador = ${caseCo('CodOperador')}
			WHERE CodOperador IN (${[...mapa.keys()].join(',')})`);

		// El alta nueva (mismo SQL que usa la app) debe grabar CO = VP; se prueba y se deshace.
		await new sql.Request(tx)
			.input('p0', sql.Int, maxVp + 1)
			.input('p1', sql.Int, maxVp + 1)
			.input('p2', sql.VarChar, 'PRUEBA')
			.input('p3', sql.VarChar, 'ALTA')
			.input('p4', sql.VarChar, 'zzprueba')
			.input('p5', sql.VarChar, 'zzpw9q')
			.query(
				sqlInsertImPasswordConCodOperador({
					insertConCod: `INSERT INTO dbo.imPassword (ValorPersonal, CodOperador, Apellido, Nombres, NombreRed, Password, Grupo) VALUES (@p0, @p1, @p2, @p3, @p4, @p5, 0);`,
					insertSinCod: `INSERT INTO dbo.imPassword (ValorPersonal, Apellido, Nombres, NombreRed, Password, Grupo) VALUES (@p0, @p2, @p3, @p4, @p5, 0);`,
					paramCod: '@p1',
				}),
			);
		const prueba = await q(`SELECT CodOperador, ValorPersonal FROM dbo.imPassword WHERE NombreRed = 'zzprueba'`);
		await new sql.Request(tx).query(`DELETE FROM dbo.imPassword WHERE NombreRed = 'zzprueba'`);
		await new sql.Request(tx).query(`DBCC CHECKIDENT ('dbo.imPassword', RESEED, ${maxVp}) WITH NO_INFOMSGS;`);
		console.log('  prueba de alta nueva:', prueba[0]);
		if (!prueba[0] || prueba[0].CodOperador !== prueba[0].ValorPersonal) {
			throw new Error('El alta de prueba no grabó CodOperador = ValorPersonal');
		}

		const desalineados = await q(`SELECT COUNT(*) n FROM dbo.imPassword WHERE ValorPersonal IS NOT NULL AND CodOperador <> ValorPersonal`);
		const ident = await q(`SELECT CAST(IDENT_CURRENT('dbo.imPassword') AS int) actual`);
		console.log('  desalineados:', desalineados[0].n, '| IDENTITY actual:', ident[0].actual);
		if (desalineados[0].n !== 0) throw new Error('Quedaron cuentas desalineadas');

		if (APLICAR) {
			await tx.commit();
			console.log('  COMMIT hospital');
		} else {
			await tx.rollback();
			await restaurarIdentity();
			console.log('  ROLLBACK (dry-run), IDENTITY restaurado a', identOriginal);
		}
	} catch (err) {
		await tx.rollback().catch(() => {});
		await restaurarIdentity().catch(() => {});
		throw err;
	} finally {
		await pool.close();
	}
	return true;
}

async function nube() {
	const conn = await mysql.createConnection({
		host: process.env.AUTH_DB_HOST || process.env.MYSQLHOST,
		port: Number(process.env.AUTH_DB_PORT || process.env.MYSQLPORT || 3306),
		user: process.env.AUTH_DB_USER || process.env.MYSQLUSER,
		password: process.env.AUTH_DB_PASSWORD || process.env.MYSQLPASSWORD,
		database: process.env.AUTH_DB_NAME || process.env.MYSQLDATABASE,
	});
	try {
		// DDL en MySQL hace commit implícito: el backup va antes de abrir la transacción.
		if (APLICAR) {
			await conn.query(
				`CREATE TABLE IF NOT EXISTS ${BK}imPassword_102 AS SELECT * FROM imPassword WHERE IdEmpresa = ?`,
				[ID_EMPRESA],
			);
		}
		await conn.beginTransaction();
		const [r] = await conn.query(
			`UPDATE imPassword SET CodOperador = ValorPersonal
			 WHERE IdEmpresa = ? AND ValorPersonal IS NOT NULL AND CodOperador <> ValorPersonal
			 ORDER BY ValorPersonal ASC`,
			[ID_EMPRESA],
		);
		console.log('  nube imPassword actualizadas:', r.affectedRows);
		const [d] = await conn.query(
			`SELECT COUNT(*) n FROM imPassword WHERE IdEmpresa = ? AND CodOperador <> ValorPersonal`,
			[ID_EMPRESA],
		);
		console.log('  nube desalineados:', d[0].n);
		if (Number(d[0].n) !== 0) throw new Error('Nube: quedaron cuentas desalineadas');
		const [s] = await conn.query(
			`UPDATE AuthSessions SET Revoked = 1 WHERE IdEmpresa = ? AND Revoked = 0`,
			[ID_EMPRESA],
		);
		console.log('  sesiones revocadas:', s.affectedRows);
		if (APLICAR) {
			await conn.commit();
			console.log('  COMMIT nube');
		} else {
			await conn.rollback();
			console.log('  ROLLBACK nube (dry-run)');
		}
	} catch (err) {
		await conn.rollback().catch(() => {});
		throw err;
	} finally {
		await conn.end();
	}
}

(async () => {
	cargarEntorno();
	console.log(APLICAR ? 'MODO APLICAR' : 'MODO DRY-RUN (--aplicar para escribir)');
	const [empresa] = await obtenerEmpresas([ID_EMPRESA]);
	console.log(`\n== Hospital ${empresa.DbServer}/${empresa.DbName} ==`);
	await hospital(empresa);
	console.log('\n== Nube ==');
	await nube();
})().catch((err) => {
	console.error('ERROR:', err.message);
	process.exit(1);
});
