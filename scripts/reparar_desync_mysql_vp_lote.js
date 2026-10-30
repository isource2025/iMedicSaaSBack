/**
 * Remedia desync MySQL↔físico (solo MySQL; el SQL hospital ya está alineado).
 *
 * Casos (AUDIT 2026-10-28):
 *   Vidal CASTRO:  remap imPassword 661264 → 7473
 *   Vidal CHAVEZ:  borrar fantasma VP=1; alinear cuenta 661273 (CO=115, NombreRed=CHAVEZ)
 *   Sarmiento ×3:  borrar cuentas duplicadas huérfanas 5537/5538/5539
 *   (ADMINVIDAL excluido a pedido)
 *
 * Uso:
 *   node scripts/reparar_desync_mysql_vp_lote.js
 *   node scripts/reparar_desync_mysql_vp_lote.js --apply
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const { getAuthCentralPool } = require('../src/config/authCentralDb');
const { runWithTenant } = require('../src/context/tenantContext');
const { executeQuery } = require('../src/models/db');

const APPLY = process.argv.includes('--apply');

function section(t) {
	console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);
}

async function tableExists(pool, name) {
	const [rows] = await pool.query(
		`SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
		[name],
	);
	return rows.length > 0;
}

async function remapPasswordVp(conn, { emp, fromVp, toVp, nombreRed }) {
	const [pwFrom] = await conn.query(
		`SELECT ValorPersonal, CodOperador, NombreRed FROM imPassword
     WHERE IdEmpresa=? AND ValorPersonal=? AND LOWER(TRIM(NombreRed))=LOWER(?)`,
		[emp, fromVp, nombreRed],
	);
	if (!pwFrom.length) throw new Error(`No está imPassword ${nombreRed} VP=${fromVp}@${emp}`);
	const [pwTo] = await conn.query(
		`SELECT ValorPersonal, NombreRed FROM imPassword WHERE IdEmpresa=? AND ValorPersonal=?`,
		[emp, toVp],
	);
	if (pwTo.length) {
		throw new Error(`Destino VP=${toVp}@${emp} ya tiene cuenta (${pwTo[0].NombreRed}) — usar merge/delete`);
	}

	const [peFrom] = await conn.query(`SELECT * FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`, [
		emp,
		fromVp,
	]);
	const [peTo] = await conn.query(`SELECT * FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`, [
		emp,
		toVp,
	]);
	const hasRoles = await tableExists(conn, 'imPersonalRoles');
	const hasSec = await tableExists(conn, 'imPersonalSectores');
	const [rolesFrom] = hasRoles
		? await conn.query(`SELECT * FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=?`, [emp, fromVp])
		: [[]];
	const [rolesTo] = hasRoles
		? await conn.query(`SELECT * FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=?`, [emp, toVp])
		: [[]];
	const [secFrom] = hasSec
		? await conn.query(`SELECT * FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=?`, [emp, fromVp])
		: [[]];
	const [secTo] = hasSec
		? await conn.query(`SELECT * FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=?`, [emp, toVp])
		: [[]];
	const [perFrom] = await conn.query(`SELECT Valor FROM imPersonal WHERE IdEmpresa=? AND Valor=?`, [emp, fromVp]);
	const [perTo] = await conn.query(`SELECT Valor FROM imPersonal WHERE IdEmpresa=? AND Valor=?`, [emp, toVp]);

	console.log({
		accion: 'REMAP_VP',
		emp,
		nombreRed,
		fromVp,
		toVp,
		peFrom: peFrom.length,
		peTo: peTo.length,
		rolesFrom: rolesFrom.length,
		rolesTo: rolesTo.length,
		secFrom: secFrom.length,
		secTo: secTo.length,
		perFrom: !!perFrom[0],
		perTo: !!perTo[0],
	});

	if (!APPLY) return;

	await conn.query(`UPDATE imPassword SET ValorPersonal=? WHERE IdEmpresa=? AND ValorPersonal=? AND LOWER(TRIM(NombreRed))=LOWER(?)`, [
		toVp,
		emp,
		fromVp,
		nombreRed,
	]);

	if (peFrom.length && !peTo.length) {
		await conn.query(`UPDATE imPersonalEmpresas SET IdPersonal=? WHERE IdEmpresa=? AND IdPersonal=?`, [
			toVp,
			emp,
			fromVp,
		]);
	} else if (peFrom.length && peTo.length) {
		await conn.query(`DELETE FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`, [emp, fromVp]);
	} else if (!peFrom.length && !peTo.length) {
		await conn.query(`INSERT INTO imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (?, ?)`, [toVp, emp]);
	}

	for (const s of secFrom) {
		const exists = secTo.some(
			(t) => String(t.idSector).trim().toUpperCase() === String(s.idSector).trim().toUpperCase(),
		);
		if (exists) {
			await conn.query(
				`DELETE FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=? AND idSector=?`,
				[emp, fromVp, s.idSector],
			);
		} else {
			await conn.query(
				`UPDATE imPersonalSectores SET idPersonal=? WHERE IdEmpresa=? AND idPersonal=? AND idSector=?`,
				[toVp, emp, fromVp, s.idSector],
			);
		}
	}

	for (const r of rolesFrom) {
		const exists = rolesTo.some((t) => Number(t.IdRol) === Number(r.IdRol));
		if (exists) {
			await conn.query(`DELETE FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=? AND IdRol=?`, [
				emp,
				fromVp,
				r.IdRol,
			]);
		} else {
			await conn.query(`UPDATE imPersonalRoles SET Valor=? WHERE IdEmpresa=? AND Valor=? AND IdRol=?`, [
				toVp,
				emp,
				fromVp,
				r.IdRol,
			]);
		}
	}

	if (perFrom[0]) {
		await conn.query(`DELETE FROM imPersonal WHERE IdEmpresa=? AND Valor=?`, [emp, fromVp]);
	}
}

/** Borra cuenta MySQL huérfana duplicada; no toca la cuenta buena (toVp). */
async function borrarCuentaHuerfana(conn, { emp, orphanVp, keepVp, nombreRed }) {
	const [orphan] = await conn.query(
		`SELECT ValorPersonal, CodOperador, NombreRed FROM imPassword
     WHERE IdEmpresa=? AND ValorPersonal=? AND LOWER(TRIM(NombreRed))=LOWER(?)`,
		[emp, orphanVp, nombreRed],
	);
	if (!orphan.length) throw new Error(`No está huérfana ${nombreRed} VP=${orphanVp}@${emp}`);
	const [keep] = await conn.query(
		`SELECT ValorPersonal, CodOperador, NombreRed FROM imPassword
     WHERE IdEmpresa=? AND ValorPersonal=? AND LOWER(TRIM(NombreRed))=LOWER(?)`,
		[emp, keepVp, nombreRed],
	);
	if (!keep.length) throw new Error(`Falta cuenta buena ${nombreRed} VP=${keepVp}@${emp}`);

	const hasRoles = await tableExists(conn, 'imPersonalRoles');
	const hasSec = await tableExists(conn, 'imPersonalSectores');

	console.log({
		accion: 'DELETE_ORPHAN_DUP',
		emp,
		nombreRed,
		orphanVp,
		keepVp,
		orphanCO: orphan[0].CodOperador,
		keepCO: keep[0].CodOperador,
	});

	if (!APPLY) return;

	await conn.query(`DELETE FROM imPassword WHERE IdEmpresa=? AND ValorPersonal=? AND LOWER(TRIM(NombreRed))=LOWER(?)`, [
		emp,
		orphanVp,
		nombreRed,
	]);
	await conn.query(`DELETE FROM imPersonalEmpresas WHERE IdEmpresa=? AND IdPersonal=?`, [emp, orphanVp]);
	if (hasRoles) {
		await conn.query(`DELETE FROM imPersonalRoles WHERE IdEmpresa=? AND Valor=?`, [emp, orphanVp]);
	}
	if (hasSec) {
		await conn.query(`DELETE FROM imPersonalSectores WHERE IdEmpresa=? AND idPersonal=?`, [emp, orphanVp]);
	}
	await conn.query(`DELETE FROM imPersonal WHERE IdEmpresa=? AND Valor=?`, [emp, orphanVp]);
}

/**
 * CHAVEZ: fantasma VP=1 (EMERGENCIAS) + cuenta DNI 29981092 con CO malo.
 * No tocar imPersonal/pe/roles de Valor=1.
 */
async function repararChavez(conn) {
	const emp = 1;
	const [ghost] = await conn.query(
		`SELECT ValorPersonal, CodOperador, NombreRed FROM imPassword
     WHERE IdEmpresa=? AND ValorPersonal=1 AND CodOperador=115 AND LOWER(TRIM(NombreRed))='chavez'`,
		[emp],
	);
	const [good] = await conn.query(
		`SELECT ValorPersonal, CodOperador, NombreRed FROM imPassword
     WHERE IdEmpresa=? AND ValorPersonal=661273`,
		[emp],
	);
	if (!ghost.length) console.warn('CHAVEZ ghost VP=1 no encontrado (¿ya reparado?)');
	if (!good.length) throw new Error('CHAVEZ: falta imPassword VP=661273');
	if (String(good[0].NombreRed).trim() !== '29981092' && String(good[0].NombreRed).trim().toUpperCase() !== 'CHAVEZ') {
		throw new Error(`CHAVEZ: VP=661273 inesperado NombreRed=${good[0].NombreRed}`);
	}

	console.log({
		accion: 'CHAVEZ_MERGE',
		borrarGhost: ghost[0] || null,
		alinear: { vp: 661273, co: 115, nombreRed: 'CHAVEZ', desde: good[0] },
		nota: 'No se toca imPersonal Valor=1 (EMERGENCIAS)',
	});

	if (!APPLY) return;

	if (ghost.length) {
		await conn.query(
			`DELETE FROM imPassword WHERE IdEmpresa=? AND ValorPersonal=1 AND CodOperador=115 AND LOWER(TRIM(NombreRed))='chavez'`,
			[emp],
		);
	}
	await conn.query(
		`UPDATE imPassword SET CodOperador=115, NombreRed='CHAVEZ' WHERE IdEmpresa=? AND ValorPersonal=661273`,
		[emp],
	);
	// pe/roles de 661273 ya existen; no tocar pe de IdPersonal=1
}

async function verificarFisico() {
	const checks = [];
	await runWithTenant(1, async () => {
		for (const [red, vp, co] of [
			['36548020', 7473, 661267],
			['CHAVEZ', 661273, 115],
		]) {
			const rows = await executeQuery(
				`SELECT ValorPersonal, CodOperador, NombreRed FROM dbo.imPassword WHERE UPPER(LTRIM(RTRIM(NombreRed)))=UPPER(@p0)`,
				[{ value: red, type: 'NVarChar', length: 40 }],
			);
			checks.push({ emp: 1, red, esperado: { vp, co }, fisico: rows[0] || null });
		}
	});
	await runWithTenant(101, async () => {
		for (const [red, vp, co] of [
			['34900164', 4474, 34],
			['43697938', 4475, 35],
			['33218359', 4473, 33],
		]) {
			const rows = await executeQuery(
				`SELECT ValorPersonal, CodOperador, NombreRed FROM dbo.imPassword WHERE UPPER(LTRIM(RTRIM(NombreRed)))=UPPER(@p0)`,
				[{ value: red, type: 'NVarChar', length: 40 }],
			);
			checks.push({ emp: 101, red, esperado: { vp, co }, fisico: rows[0] || null });
		}
	});
	return checks;
}

async function verificarMysql(pool) {
	const out = [];
	for (const [emp, red] of [
		[1, '36548020'],
		[1, 'CHAVEZ'],
		[1, '29981092'],
		[101, '34900164'],
		[101, '43697938'],
		[101, '33218359'],
	]) {
		const [rows] = await pool.query(
			`SELECT ValorPersonal, CodOperador, NombreRed, Apellido, Nombres
       FROM imPassword WHERE IdEmpresa=? AND LOWER(TRIM(NombreRed))=LOWER(?)`,
			[emp, red],
		);
		out.push({ emp, red, rows });
	}
	const [orphans] = await pool.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed FROM imPassword
     WHERE (IdEmpresa=1 AND ValorPersonal IN (661264,1) AND LOWER(TRIM(NombreRed)) IN ('36548020','chavez'))
        OR (IdEmpresa=101 AND ValorPersonal IN (5537,5538,5539))`,
	);
	return { cuentas: out, restosOrphan: orphans };
}

async function main() {
	console.log(APPLY ? 'MODE: APPLY' : 'MODE: DRY-RUN (pasar --apply para escribir)');
	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();

	try {
		section('0. Verificar SQL físico (referencia)');
		const fisico = await verificarFisico();
		console.table(
			fisico.map((c) => ({
				emp: c.emp,
				red: c.red,
				ok:
					c.fisico &&
					Number(c.fisico.ValorPersonal) === c.esperado.vp &&
					Number(c.fisico.CodOperador) === c.esperado.co,
				vp: c.fisico?.ValorPersonal,
				co: c.fisico?.CodOperador,
			})),
		);
		for (const c of fisico) {
			if (
				!c.fisico ||
				Number(c.fisico.ValorPersonal) !== c.esperado.vp ||
				Number(c.fisico.CodOperador) !== c.esperado.co
			) {
				throw new Error(`Físico no coincide para ${c.red}@${c.emp}`);
			}
		}

		section('1. Plan / apply MySQL');
		await conn.beginTransaction();
		try {
			await remapPasswordVp(conn, { emp: 1, fromVp: 661264, toVp: 7473, nombreRed: '36548020' });
			await repararChavez(conn);
			await borrarCuentaHuerfana(conn, {
				emp: 101,
				orphanVp: 5537,
				keepVp: 4474,
				nombreRed: '34900164',
			});
			await borrarCuentaHuerfana(conn, {
				emp: 101,
				orphanVp: 5538,
				keepVp: 4475,
				nombreRed: '43697938',
			});
			await borrarCuentaHuerfana(conn, {
				emp: 101,
				orphanVp: 5539,
				keepVp: 4473,
				nombreRed: '33218359',
			});

			if (APPLY) {
				await conn.commit();
				console.log('✓ MySQL commit');
			} else {
				await conn.rollback();
				console.log('✓ Dry-run OK (rollback)');
			}
		} catch (e) {
			await conn.rollback();
			throw e;
		}

		section('2. Verificación MySQL post');
		const ver = await verificarMysql(pool);
		console.log(JSON.stringify(ver, null, 2));

		if (!APPLY) {
			console.log('\nEjecutá con --apply para aplicar. Los usuarios deben re-loguearse.');
		} else {
			console.log('\nListo. Pedir re-login a: CASTRO 36548020, CHAVEZ, BENITEZ, ARCE, PINTOS.');
		}
	} finally {
		conn.release();
		await pool.end().catch(() => {});
	}
}

main().catch((e) => {
	console.error('FAIL', e.message);
	process.exit(1);
});
