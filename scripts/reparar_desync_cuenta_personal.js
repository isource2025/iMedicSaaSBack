/**
 * Remedia desync cuenta MySQL/SQL vs ficha física.
 * Caso: login NombreRed=26812159 → ValorPersonal=5536, pero ficha DNI es Valor=347.
 *
 * Uso:
 *   node scripts/reparar_desync_cuenta_personal.js --dry-run
 *   node scripts/reparar_desync_cuenta_personal.js --apply
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const sql = require('mssql');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const APPLY = process.argv.includes('--apply');
const EMP = 101;
const FROM_VP = 5536;
const TO_VP = 347;
const NOMBRE_RED = '26812159';

function section(t) {
	console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);
}

async function main() {
	console.log(APPLY ? 'MODE: APPLY (escribe cambios)' : 'MODE: DRY-RUN (solo lectura)');
	const mp = await mysql.createPool(process.env.MYSQL_PUBLIC_URL);
	const conn = await mp.getConnection();

	try {
		section('1. Validar estado MySQL');
		const [[pwFrom]] = await conn.query(
			`SELECT * FROM imPassword WHERE IdEmpresa=? AND ValorPersonal=?`,
			[EMP, FROM_VP],
		);
		const [[pwTo]] = await conn.query(
			`SELECT * FROM imPassword WHERE IdEmpresa=? AND ValorPersonal=?`,
			[EMP, TO_VP],
		);
		const [[perTo]] = await conn.query(
			`SELECT Valor, ApellidoNombre, Numero, Rol FROM imPersonal WHERE IdEmpresa=? AND Valor=?`,
			[EMP, TO_VP],
		);
		const [[perFrom]] = await conn.query(
			`SELECT Valor, ApellidoNombre, Numero, Rol FROM imPersonal WHERE IdEmpresa=? AND Valor=?`,
			[EMP, FROM_VP],
		);
		console.log('pwFrom', pwFrom && { ValorPersonal: pwFrom.ValorPersonal, NombreRed: pwFrom.NombreRed });
		console.log('pwTo', pwTo && { ValorPersonal: pwTo.ValorPersonal, NombreRed: pwTo.NombreRed });
		console.log('perTo', perTo);
		console.log('perFrom', perFrom);

		if (!pwFrom) throw new Error(`No existe imPassword ${FROM_VP}@${EMP}`);
		if (String(pwFrom.NombreRed).trim() !== NOMBRE_RED) {
			throw new Error(`NombreRed inesperado: ${pwFrom.NombreRed}`);
		}
		if (pwTo) throw new Error(`Ya existe imPassword en destino ${TO_VP} — abortar`);
		if (!perTo) throw new Error(`No existe ficha destino imPersonal ${TO_VP}`);
		if (Number(perTo.Numero) !== Number(NOMBRE_RED) && String(perTo.Numero) !== NOMBRE_RED) {
			console.warn('⚠ Numero ficha destino no coincide exactamente con DNI login:', perTo.Numero);
		}

		const [peFrom] = await conn.query(
			`SELECT * FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`,
			[EMP, FROM_VP],
		);
		const [peTo] = await conn.query(
			`SELECT * FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`,
			[EMP, TO_VP],
		);
		const [psFrom] = await conn.query(
			`SELECT * FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=?`,
			[EMP, FROM_VP],
		);
		const [psTo] = await conn.query(
			`SELECT * FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=?`,
			[EMP, TO_VP],
		);
		const [prFrom] = await conn.query(
			`SELECT * FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=?`,
			[EMP, FROM_VP],
		);
		const [prTo] = await conn.query(
			`SELECT * FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=?`,
			[EMP, TO_VP],
		);
		console.log({ peFrom, peTo, psFrom, psTo, prFrom, prTo });

		section('2. Validar estado SQL hospital');
		const [er] = await conn.query(`SELECT * FROM Empresas WHERE IDEMPRESA=?`, [EMP]);
		const password = resolvePasswordFromEmpresaRow(normalizeEmpresaRow(er[0]));
		const pool = await sql.connect({
			server: String(er[0].DbServer).trim(),
			port: Number(er[0].DbPort) || 1433,
			database: String(er[0].DbName).trim(),
			user: String(er[0].DbUser).trim(),
			password,
			options: { encrypt: false, trustServerCertificate: true },
			connectionTimeout: 20000,
			requestTimeout: 60000,
		});
		const q = async (text) => (await pool.request().query(text)).recordset;

		const sqlPwFrom = await q(
			`SELECT ValorPersonal, NombreRed FROM dbo.imPassword WHERE ValorPersonal=${FROM_VP}`,
		);
		const sqlPwTo = await q(
			`SELECT ValorPersonal, NombreRed FROM dbo.imPassword WHERE ValorPersonal=${TO_VP}`,
		);
		const sqlPerTo = await q(
			`SELECT Valor, ApellidoNombre, Numero FROM dbo.imPersonal WHERE Valor=${TO_VP}`,
		);
		const sqlPerFrom = await q(
			`SELECT Valor, ApellidoNombre, Numero FROM dbo.imPersonal WHERE Valor=${FROM_VP}`,
		);
		const sqlPs = await q(
			`SELECT idPersonal, idSector FROM dbo.imPersonalSectores WHERE idPersonal IN (${FROM_VP},${TO_VP})`,
		);
		console.log({ sqlPwFrom, sqlPwTo, sqlPerTo, sqlPerFrom, sqlPs });
		if (!sqlPerTo.length) throw new Error('SQL hospital sin ficha 347');
		if (sqlPwTo.length) throw new Error('SQL hospital ya tiene imPassword 347');

		if (!APPLY) {
			section('Plan (dry-run)');
			console.log(`MySQL: UPDATE imPassword SET ValorPersonal=${TO_VP} WHERE IdEmpresa=${EMP} AND ValorPersonal=${FROM_VP}`);
			console.log(`MySQL: remap imPersonalEmpresas / Sectores / Roles ${FROM_VP}→${TO_VP}`);
			console.log(`MySQL: DELETE orphan imPersonal ${FROM_VP} si existe`);
			console.log(`SQL: UPDATE imPassword SET ValorPersonal=${TO_VP} WHERE ValorPersonal=${FROM_VP}`);
			console.log(`SQL: merge/delete imPersonalSectores huérfano ${FROM_VP}`);
			console.log('\nEjecutá con --apply para aplicar.');
			await pool.close();
			return;
		}

		section('3. APPLY MySQL');
		await conn.beginTransaction();
		try {
			await conn.query(
				`UPDATE imPassword SET ValorPersonal=?, NumeroDocumento=? WHERE IdEmpresa=? AND ValorPersonal=?`,
				[TO_VP, Number(NOMBRE_RED), EMP, FROM_VP],
			);

			if (peFrom.length && !peTo.length) {
				await conn.query(
					`UPDATE imPersonalEmpresas SET IdPersonal=? WHERE IdEmpresa=? AND IdPersonal=?`,
					[TO_VP, EMP, FROM_VP],
				);
			} else if (peFrom.length && peTo.length) {
				await conn.query(
					`DELETE FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`,
					[EMP, FROM_VP],
				);
			} else if (!peFrom.length && !peTo.length) {
				await conn.query(
					`INSERT INTO imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (?, ?)`,
					[TO_VP, EMP],
				);
			}

			for (const s of psFrom) {
				const exists = psTo.some(
					(t) => String(t.idSector).trim().toUpperCase() === String(s.idSector).trim().toUpperCase(),
				);
				if (exists) {
					await conn.query(
						`DELETE FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=? AND idSector=?`,
						[EMP, FROM_VP, s.idSector],
					);
				} else {
					await conn.query(
						`UPDATE imPersonalSectores SET idPersonal=? WHERE IdEmpresa=? AND idPersonal=? AND idSector=?`,
						[TO_VP, EMP, FROM_VP, s.idSector],
					);
				}
			}

			for (const r of prFrom) {
				const exists = prTo.some((t) => Number(t.IdRol) === Number(r.IdRol));
				if (exists) {
					await conn.query(
						`DELETE FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=? AND IdRol=?`,
						[EMP, FROM_VP, r.IdRol],
					);
				} else {
					await conn.query(
						`UPDATE imPersonalRoles SET Valor=? WHERE IdEmpresa=? AND Valor=? AND IdRol=?`,
						[TO_VP, EMP, FROM_VP, r.IdRol],
					);
				}
			}

			if (!prTo.length && !prFrom.length && perTo.Rol) {
				await conn.query(
					`INSERT IGNORE INTO imPersonalRoles (IdEmpresa, Valor, IdRol, EsPrincipal) VALUES (?, ?, ?, 1)`,
					[EMP, TO_VP, Number(perFrom?.Rol || perTo.Rol || 2)],
				);
			}

			// Copiar rol de la ficha huérfana si destino no tiene rol en MySQL
			if (perFrom && perFrom.Rol && (!perTo.Rol || String(perTo.Rol).trim() === '')) {
				await conn.query(`UPDATE imPersonal SET Rol=? WHERE IdEmpresa=? AND Valor=?`, [
					perFrom.Rol,
					EMP,
					TO_VP,
				]);
			}

			if (perFrom) {
				await conn.query(`DELETE FROM imPersonal WHERE IdEmpresa=? AND Valor=?`, [EMP, FROM_VP]);
			}

			await conn.commit();
			console.log('✓ MySQL remapeado');
		} catch (err) {
			await conn.rollback();
			throw err;
		}

		section('4. APPLY SQL hospital');
		const tx = new sql.Transaction(pool);
		await tx.begin();
		try {
			const req = () => new sql.Request(tx);
			await req().query(
				`UPDATE dbo.imPassword SET ValorPersonal=${TO_VP}, NumeroDocumento=${Number(NOMBRE_RED)} WHERE ValorPersonal=${FROM_VP}`,
			);

			const sqlPsFrom = sqlPs.filter((r) => Number(r.idPersonal) === FROM_VP);
			const sqlPsTo = sqlPs.filter((r) => Number(r.idPersonal) === TO_VP);
			for (const s of sqlPsFrom) {
				const exists = sqlPsTo.some(
					(t) => String(t.idSector).trim().toUpperCase() === String(s.idSector).trim().toUpperCase(),
				);
				if (exists) {
					await req().query(
						`DELETE FROM dbo.imPersonalSectores WHERE idPersonal=${FROM_VP} AND idSector='${String(s.idSector).replace(/'/g, "''")}'`,
					);
				} else {
					await req().query(
						`UPDATE dbo.imPersonalSectores SET idPersonal=${TO_VP} WHERE idPersonal=${FROM_VP} AND idSector='${String(s.idSector).replace(/'/g, "''")}'`,
					);
				}
			}

			await tx.commit();
			console.log('✓ SQL hospital remapeado');
		} catch (err) {
			await tx.rollback();
			throw err;
		}

		section('5. Verificación final');
		const [[pwOk]] = await conn.query(
			`SELECT IdEmpresa, ValorPersonal, NombreRed, NumeroDocumento FROM imPassword WHERE IdEmpresa=? AND NombreRed=?`,
			[EMP, NOMBRE_RED],
		);
		const [[peOk]] = await conn.query(
			`SELECT * FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`,
			[EMP, TO_VP],
		);
		const sqlPwOk = await q(
			`SELECT ValorPersonal, NombreRed, NumeroDocumento FROM dbo.imPassword WHERE NombreRed='${NOMBRE_RED}'`,
		);
		const sqlPerOk = await q(
			`SELECT Valor, ApellidoNombre, Numero FROM dbo.imPersonal WHERE Valor=${TO_VP}`,
		);
		console.log({ mysqlPassword: pwOk, mysqlEmpresa: peOk, sqlPassword: sqlPwOk, sqlPersonal: sqlPerOk });
		console.log('\nListo. El usuario debe cerrar sesión y volver a entrar.');

		await pool.close();
	} finally {
		conn.release();
		await mp.end();
	}
}

main().catch((e) => {
	console.error('FAIL', e.message);
	process.exit(1);
});
