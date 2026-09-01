#!/usr/bin/env node
/**
 * Reemplaza imSectores de la nube (MySQL, IdEmpresa=101 Sarmiento)
 * por el catálogo del SQL físico local [Sarmiento].
 *
 *   node scripts/reemplazar_sectores_sarmiento_nube_desde_fisico.js
 *   node scripts/reemplazar_sectores_sarmiento_nube_desde_fisico.js --dry-run
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const sql = require('mssql');
const { getAuthCentralPool } = require('../src/config/authCentralDb');

const ID_EMPRESA = Number(process.env.SARMIENTO_EMPRESA_ID || 101);
const LOCAL_DB = process.env.LOCAL_DB_NAME || 'Sarmiento';
const DRY = process.argv.includes('--dry-run');

function localCfg() {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: parseInt(process.env.DB_PORT, 10) || 1433,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: LOCAL_DB,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 60000,
		connectionTimeout: 15000,
	};
}

(async () => {
	console.log(`=== Reemplazar imSectores nube empresa ${ID_EMPRESA} desde físico ${LOCAL_DB} ===`);
	if (DRY) console.log('MODO DRY-RUN\n');

	const local = await new sql.ConnectionPool(localCfg()).connect();
	let fisico;
	try {
		fisico = (
			await local.request().query(`
        SELECT
          LTRIM(RTRIM(CAST(Valor AS VARCHAR(20)))) AS Valor,
          LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(200)))) AS Descripcion,
          LTRIM(RTRIM(CAST(ISNULL(AmbInt, 'I') AS VARCHAR(4)))) AS AmbInt
        FROM dbo.imSectores
        WHERE LTRIM(RTRIM(CAST(Valor AS VARCHAR(20)))) <> ''
        ORDER BY Valor
      `)
		).recordset;
	} catch {
		fisico = (
			await local.request().query(`
        SELECT
          LTRIM(RTRIM(CAST(Valor AS VARCHAR(20)))) AS Valor,
          LTRIM(RTRIM(CAST(Descripcion AS VARCHAR(200)))) AS Descripcion
        FROM dbo.imSectores
        WHERE LTRIM(RTRIM(CAST(Valor AS VARCHAR(20)))) <> ''
        ORDER BY Valor
      `)
		).recordset;
	}
	await local.close();

	if (!fisico.length) throw new Error(`El físico ${LOCAL_DB} no tiene filas en imSectores`);

	const seen = new Set();
	const rows = [];
	for (const r of fisico) {
		const valor = String(r.Valor || '').trim();
		if (!valor || seen.has(valor)) continue;
		seen.add(valor);
		rows.push({
			valor,
			desc: String(r.Descripcion || valor).trim() || valor,
			amb: String(r.AmbInt || 'I').trim().slice(0, 1) || 'I',
		});
	}

	console.log(`Físico: ${rows.length} sectores`);
	for (const r of rows) console.log(`  ${r.valor} | ${r.desc} | AmbInt=${r.amb}`);

	const mysql = await getAuthCentralPool();
	const [nubeAntes] = await mysql.query(
		`SELECT Valor, Descripcion FROM imSectores WHERE IdEmpresa = ? ORDER BY Valor`,
		[ID_EMPRESA],
	);
	console.log(`\nNube antes: ${nubeAntes.length} sectores`);

	const keep = new Set(rows.map((r) => r.valor));
	const [asigAntes] = await mysql.query(
		`SELECT idSector, COUNT(*) c FROM imPersonalSectores WHERE IdEmpresa = ? GROUP BY idSector ORDER BY idSector`,
		[ID_EMPRESA],
	);
	const asigHuérfanas = (asigAntes || []).filter((a) => !keep.has(String(a.idSector).trim()));
	if (asigHuérfanas.length) {
		console.log('\nAsignaciones a sectores que no existen en el físico (se van a borrar):');
		for (const a of asigHuérfanas) console.log(`  ${a.idSector}: ${a.c}`);
	}

	if (DRY) {
		console.log('\nDry-run: no se escribió nada.');
		await mysql.end();
		process.exit(0);
	}

	const [cols] = await mysql.query(
		`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imSectores'`,
	);
	const colSet = new Set((cols || []).map((x) => String(x.c)));
	const hasAmb = colSet.has('AmbInt');

	await mysql.query('START TRANSACTION');
	try {
		if (asigHuérfanas.length) {
			await mysql.query(
				`DELETE FROM imPersonalSectores
         WHERE IdEmpresa = ?
           AND TRIM(idSector) NOT IN (${rows.map(() => '?').join(',')})`,
				[ID_EMPRESA, ...rows.map((r) => r.valor)],
			);
		}

		await mysql.query(`DELETE FROM imSectores WHERE IdEmpresa = ?`, [ID_EMPRESA]);

		for (const r of rows) {
			if (hasAmb) {
				await mysql.query(
					`INSERT INTO imSectores (IdEmpresa, Valor, Descripcion, AmbInt)
           VALUES (?, ?, ?, ?)`,
					[ID_EMPRESA, r.valor, r.desc, r.amb],
				);
			} else {
				await mysql.query(
					`INSERT INTO imSectores (IdEmpresa, Valor, Descripcion) VALUES (?, ?, ?)`,
					[ID_EMPRESA, r.valor, r.desc],
				);
			}
		}

		await mysql.query('COMMIT');
	} catch (e) {
		await mysql.query('ROLLBACK');
		throw e;
	}

	const [nubeDesp] = await mysql.query(
		`SELECT Valor, Descripcion, ${hasAmb ? 'AmbInt' : "'' AS AmbInt"}
     FROM imSectores WHERE IdEmpresa = ? ORDER BY Valor`,
		[ID_EMPRESA],
	);
	const [asigDesp] = await mysql.query(
		`SELECT idSector, COUNT(*) c FROM imPersonalSectores WHERE IdEmpresa = ? GROUP BY idSector ORDER BY idSector`,
		[ID_EMPRESA],
	);

	console.log(`\nNube después: ${nubeDesp.length} sectores`);
	for (const s of nubeDesp) {
		console.log(`  ${String(s.Valor).trim()} | ${String(s.Descripcion || '').trim()}`);
	}
	console.log('\nAsignaciones personales restantes:');
	console.log(JSON.stringify(asigDesp));

	const ok =
		nubeDesp.length === rows.length &&
		nubeDesp.every((s) => keep.has(String(s.Valor).trim()));
	if (!ok) throw new Error('Verificación falló: la nube no coincide con el físico');
	console.log('\nOK: imSectores de Sarmiento en la nube = físico.');

	await mysql.end();
	process.exit(0);
})().catch((e) => {
	console.error('✗', e.message);
	process.exit(1);
});
