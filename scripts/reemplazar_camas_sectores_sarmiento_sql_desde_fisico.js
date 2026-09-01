#!/usr/bin/env node
/**
 * /dashboard/beds lee SQL (imSectores ⋈ imHabitacionCamas, AmbInt='I'),
 * NO el catálogo MySQL. Sarmiento (empresa 101) apunta al SQL remoto.
 * PELIGRO: ya se ejecutó y borró el catálogo real de Sarmiento. NO volver a correrlo.
 * Para revertir usá scripts/revertir_sarmiento_sectores_camas.js
 *
 * Este script reemplaza sectores y camas por los del físico local [Sarmiento].
 *
 *   node scripts/reemplazar_camas_sectores_sarmiento_sql_desde_fisico.js
 *   node scripts/reemplazar_camas_sectores_sarmiento_sql_desde_fisico.js --dry-run
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });
process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const sql = require('mssql');
const { getAuthCentralPool } = require('../src/config/authCentralDb');
const {
	normalizeEmpresaRow,
	resolvePasswordFromEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const ID_EMPRESA = Number(process.env.SARMIENTO_EMPRESA_ID || 101);
const LOCAL_DB = process.env.LOCAL_DB_NAME || 'Sarmiento';
const DRY = process.argv.includes('--dry-run');

const BEDS_SECTORES_SQL = `
SELECT DISTINCT
  LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(20)))) AS valor,
  LTRIM(RTRIM(CAST(s.Descripcion AS VARCHAR(200)))) AS descripcion
FROM dbo.imSectores s
INNER JOIN dbo.imHabitacionCamas hc
  ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(hc.ValorSector AS VARCHAR(20))))
WHERE LTRIM(RTRIM(CAST(ISNULL(s.AmbInt,'') AS VARCHAR(4)))) = 'I'
ORDER BY descripcion
`;

function localCfg() {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: parseInt(process.env.DB_PORT, 10) || 1433,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: LOCAL_DB,
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 15000,
		requestTimeout: 120000,
	};
}

function pad4(v) {
	return String(v || '').trim().slice(0, 4).padEnd(4, ' ');
}

function sqlLiteral(v) {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
	if (typeof v === 'boolean') return v ? '1' : '0';
	return `N'${String(v).replace(/'/g, "''")}'`;
}

(async () => {
	console.log(`=== Reemplazar SQL tenant Sarmiento (empresa ${ID_EMPRESA}) desde físico ${LOCAL_DB} ===`);
	if (DRY) console.log('MODO DRY-RUN\n');

	const local = await new sql.ConnectionPool(localCfg()).connect();
	const fisicoSecs = (
		await local.request().query(`SELECT * FROM dbo.imSectores`)
	).recordset;
	const fisicoCamas = (
		await local.request().query(`SELECT * FROM dbo.imHabitacionCamas`)
	).recordset;
	const localBeds = (await local.request().query(BEDS_SECTORES_SQL)).recordset;
	await local.close();

	if (!fisicoSecs.length) throw new Error('Físico sin imSectores');
	console.log(`Físico sectores: ${fisicoSecs.length}`);
	console.log(
		fisicoSecs
			.map(
				(r) =>
					`${String(r.Valor).trim()} | ${String(r.Descripcion || '').trim()} | AmbInt=${String(r.AmbInt || '').trim()}`,
			)
			.join('\n'),
	);
	console.log(`Físico camas: ${fisicoCamas.length}`);
	console.log(`Físico /beds/sectores: ${localBeds.map((r) => r.descripcion).join(', ')}`);

	const mysql = await getAuthCentralPool();
	const [emps] = await mysql.query(`SELECT * FROM Empresas WHERE IDEMPRESA = ?`, [ID_EMPRESA]);
	await mysql.end();
	if (!emps.length) throw new Error(`Empresa ${ID_EMPRESA} no encontrada`);
	const emp = normalizeEmpresaRow(emps[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	console.log(`\nDestino: ${emp.DbServer}:${emp.DbPort}/${emp.DbName}`);

	const remote = await new sql.ConnectionPool({
		server: String(emp.DbServer),
		port: Number(emp.DbPort) || 1433,
		user: String(emp.DbUser),
		password,
		database: String(emp.DbName),
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 15000,
		requestTimeout: 120000,
	}).connect();

	const before = (await remote.request().query(BEDS_SECTORES_SQL)).recordset;
	console.log(`\nNube /beds/sectores ANTES: ${before.map((r) => r.descripcion).join(', ')}`);

	const keepVals = [
		...new Set(fisicoSecs.map((r) => String(r.Valor || '').trim()).filter(Boolean)),
	];

	if (DRY) {
		console.log('\nDry-run: no se escribió.');
		await remote.close();
		process.exit(0);
	}

	const tx = new sql.Transaction(remote);
	await tx.begin();
	try {
		const req = () => new sql.Request(tx);

		await req().query(`DELETE FROM dbo.imHabitacionCamas`);
		await req().query(`DELETE FROM dbo.imSectores`);

		for (const r of fisicoSecs) {
			const valor = pad4(r.Valor);
			const vs = pad4(r.ValorServicio || r.Valor);
			const desc = String(r.Descripcion || r.Valor || '').trim().slice(0, 40);
			const proto = r.ProtocoloN == null ? 0 : Number(r.ProtocoloN) || 0;
			const amb = String(r.AmbInt || 'I').trim().slice(0, 1) || 'I';
			await req()
				.input('v', sql.VarChar(4), valor)
				.input('vs', sql.VarChar(4), vs)
				.input('d', sql.VarChar(40), desc)
				.input('p', sql.Int, proto)
				.input('a', sql.Char(1), amb)
				.query(`
          INSERT INTO dbo.imSectores (Valor, ValorServicio, Descripcion, ProtocoloN, AmbInt)
          VALUES (@v, @vs, @d, @p, @a)
        `);
		}

		for (const r of fisicoCamas) {
			const sector = pad4(r.ValorSector);
			const cama = String(r.ValorHabitacionCama || '').trim().slice(0, 4);
			if (!cama) continue;
			const estado = String(r.ValorEstadoCama || 'D').trim().slice(0, 1) || 'D';
			const tipo = r.Tipo != null ? String(r.Tipo).slice(0, 20) : null;
			const obs = r.Observaciones != null ? String(r.Observaciones).slice(0, 304) : null;
			await req()
				.input('s', sql.VarChar(4), sector)
				.input('c', sql.VarChar(4), cama)
				.input('e', sql.Char(1), estado)
				.input('fi', sql.Int, r.FechaIngreso == null ? null : Number(r.FechaIngreso))
				.input('fe', sql.Int, r.FechaEgreso == null ? null : Number(r.FechaEgreso))
				.input('nv', sql.Int, r.NumeroVisita == null ? null : Number(r.NumeroVisita))
				.input('o', sql.VarChar(304), obs)
				.input('ie', sql.Int, r.IdEmpresa == null ? null : Number(r.IdEmpresa))
				.input('is', sql.Int, r.IdSucursal == null ? null : Number(r.IdSucursal))
				.input('t', sql.VarChar(20), tipo)
				.query(`
          INSERT INTO dbo.imHabitacionCamas
            (ValorSector, ValorHabitacionCama, ValorEstadoCama, FechaIngreso, FechaEgreso,
             NumeroVisita, Observaciones, IdEmpresa, IdSucursal, Tipo)
          VALUES (@s, @c, @e, @fi, @fe, @nv, @o, @ie, @is, @t)
        `);
		}

		await tx.commit();
	} catch (e) {
		await tx.rollback();
		throw e;
	}

	const after = (await remote.request().query(BEDS_SECTORES_SQL)).recordset;
	const secsAfter = (
		await remote.request().query(`
      SELECT LTRIM(RTRIM(Valor)) v, LTRIM(RTRIM(Descripcion)) d, AmbInt a
      FROM dbo.imSectores ORDER BY v
    `)
	).recordset;
	const camasAfter = (
		await remote.request().query(`
      SELECT LTRIM(RTRIM(ValorSector)) s, COUNT(*) c
      FROM dbo.imHabitacionCamas
      GROUP BY LTRIM(RTRIM(ValorSector))
      ORDER BY s
    `)
	).recordset;

	console.log('\nimSectores DESPUÉS:');
	console.log(secsAfter.map((r) => `${r.v} | ${r.d} | AmbInt=${String(r.a || '').trim()}`).join('\n'));
	console.log('\nCamas DESPUÉS:');
	console.log(camasAfter.map((r) => `${r.s}: ${r.c}`).join('\n'));
	console.log(`\nNube /beds/sectores DESPUÉS: ${after.map((r) => r.descripcion).join(', ')}`);

	const want = localBeds.map((r) => String(r.descripcion).trim()).sort().join('|');
	const got = after.map((r) => String(r.descripcion).trim()).sort().join('|');
	if (want !== got) {
		throw new Error(`Verificación /beds/sectores falló.\nFísico: ${want}\nNube: ${got}`);
	}
	const extra = secsAfter.filter((s) => !keepVals.includes(String(s.v).trim()));
	if (extra.length) throw new Error(`Quedaron sectores de más: ${extra.map((s) => s.v).join(', ')}`);

	console.log('\nOK: /dashboard/beds de Sarmiento ahora usa los sectores del físico.');
	await remote.close();
	process.exit(0);
})().catch((e) => {
	console.error('✗', e.message);
	process.exit(1);
});
