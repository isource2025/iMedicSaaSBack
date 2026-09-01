#!/usr/bin/env node
/**
 * Revierte el reemplazo accidental de imSectores / imHabitacionCamas
 * en el SQL de Sarmiento (empresa 101) al catálogo anterior al script.
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

const SECTORES = [
	['3P', '3P', '3 PISO', 'I'],
	['4P', '4P', '4 PISO', 'I'],
	['AMB', 'AMB', 'AMBULATORIO', 'A'],
	['CIR', 'CIR', 'CIRUGIA', 'A'],
	['ECO', 'ECO', 'ECOGRAFIA', 'A'],
	['EME', 'EME', 'EMERGENCIA GENERAL', 'A'],
	['LAB', 'LAB', 'LABORATORIO', 'A'],
	['PISO', 'PISO', 'PISO', 'A'],
	['QUIM', 'QUIM', 'QUIMIOTERAPIA', 'I'],
	['QUIR', 'QUIR', 'QUIROFANO', 'I'],
	['RAY', 'RAY', 'RAYOS', 'A'],
	['TOM', 'TOM', 'TOMOGRAFIA', 'A'],
	['UTI', 'UTI', 'UTI', 'I'],
];

function bedsFor(sector) {
	if (sector === '3P') {
		const out = [];
		for (let n = 301; n <= 308; n++) out.push(`${n}A`, `${n}B`);
		return out;
	}
	if (sector === '4P') {
		const out = [];
		for (const n of [401, 402, 403, 404, 405, 406, 407]) {
			out.push(`${n}A`, `${n}B`);
		}
		return out;
	}
	if (sector === 'QUIM') {
		return Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
	}
	if (sector === 'QUIR') {
		return ['01', '02'];
	}
	if (sector === 'UTI') {
		return Array.from({ length: 11 }, (_, i) => String(i + 1).padStart(2, '0'));
	}
	return [];
}

function pad4(v) {
	return String(v || '').trim().slice(0, 4).padEnd(4, ' ');
}

function normCama(sector, cama) {
	const c = String(cama || '').trim();
	if (sector === 'UTI' || sector === 'QUIM' || sector === 'QUIR') {
		const n = Number(c);
		if (Number.isFinite(n) && n > 0) return String(n).padStart(2, '0');
	}
	return c;
}

const BEDS_SQL = `
SELECT DISTINCT
  LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(20)))) AS valor,
  LTRIM(RTRIM(CAST(s.Descripcion AS VARCHAR(200)))) AS descripcion
FROM dbo.imSectores s
INNER JOIN dbo.imHabitacionCamas hc
  ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(hc.ValorSector AS VARCHAR(20))))
WHERE LTRIM(RTRIM(CAST(ISNULL(s.AmbInt,'') AS VARCHAR(4)))) = 'I'
ORDER BY descripcion
`;

(async () => {
	const mysql = await getAuthCentralPool();
	const [emps] = await mysql.query(`SELECT * FROM Empresas WHERE IDEMPRESA = 101`);
	const emp = normalizeEmpresaRow(emps[0]);
	const remote = await new sql.ConnectionPool({
		server: String(emp.DbServer),
		port: Number(emp.DbPort) || 1433,
		user: String(emp.DbUser),
		password: resolvePasswordFromEmpresaRow(emp),
		database: String(emp.DbName),
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 15000,
		requestTimeout: 120000,
	}).connect();

	const occRows = (
		await remote.request().query(`
      SELECT
        LTRIM(RTRIM(VALORSECTOR)) s,
        LTRIM(RTRIM(ValorHabitacionCama)) c,
        NumeroVisita,
        FECHAADMISIONS AS fecha
      FROM dbo.imVisita
      WHERE ISNULL(FechaEgreso, 0) = 0
        AND LTRIM(RTRIM(ISNULL(VALORSECTOR,''))) <> ''
        AND LTRIM(RTRIM(ISNULL(ValorHabitacionCama,''))) <> ''
    `)
	).recordset;

	const occ = new Map();
	const sortedOcc = [...occRows].sort((a, b) => {
		const sa = String(a.c || '').trim();
		const sb = String(b.c || '').trim();
		const pa = normCama(String(a.s || '').trim(), sa);
		const pb = normCama(String(b.s || '').trim(), sb);
		return (sa === pa ? 0 : 1) - (sb === pb ? 0 : 1);
	});
	for (const r of sortedOcc) {
		const s = String(r.s || '').trim();
		const raw = String(r.c || '').trim();
		const padded = normCama(s, raw);
		const key = `${s}|${padded}`;
		if (occ.has(key) && padded !== raw) continue;
		occ.set(key, {
			visita: Number(r.NumeroVisita) || 0,
			fecha: r.fecha == null ? null : Number(r.fecha) || null,
		});
	}

	const tx = new sql.Transaction(remote);
	await tx.begin();
	try {
		const req = () => new sql.Request(tx);
		await req().query(`DELETE FROM dbo.imHabitacionCamas`);
		await req().query(`DELETE FROM dbo.imSectores`);

		for (const [valor, vs, desc, amb] of SECTORES) {
			await req()
				.input('v', sql.VarChar(4), pad4(valor))
				.input('vs', sql.VarChar(4), pad4(vs))
				.input('d', sql.VarChar(40), desc)
				.input('p', sql.Int, 0)
				.input('a', sql.Char(1), amb)
				.query(`
          INSERT INTO dbo.imSectores (Valor, ValorServicio, Descripcion, ProtocoloN, AmbInt)
          VALUES (@v, @vs, @d, @p, @a)
        `);
		}

		for (const [valor] of SECTORES) {
			for (const cama of bedsFor(valor)) {
				const key = `${valor}|${cama}`;
				const o = occ.get(key);
				await req()
					.input('s', sql.VarChar(4), pad4(valor))
					.input('c', sql.VarChar(4), String(cama).slice(0, 4))
					.input('e', sql.Char(1), o ? 'O' : 'U')
					.input('fi', sql.Int, null)
					.input('fe', sql.Int, null)
					.input('nv', sql.Int, o ? o.visita : 0)
					.input('o', sql.VarChar(304), null)
					.input('t', sql.VarChar(20), 'Cama')
					.query(`
            INSERT INTO dbo.imHabitacionCamas
              (ValorSector, ValorHabitacionCama, ValorEstadoCama, FechaIngreso, FechaEgreso,
               NumeroVisita, Observaciones, IdEmpresa, IdSucursal, Tipo)
            VALUES (@s, @c, @e, @fi, @fe, @nv, @o, NULL, NULL, @t)
          `);
			}
		}

		await tx.commit();
	} catch (e) {
		await tx.rollback();
		throw e;
	}

	const after = (await remote.request().query(BEDS_SQL)).recordset;
	const camas = (
		await remote.request().query(`
      SELECT LTRIM(RTRIM(ValorSector)) s, COUNT(*) c,
             SUM(CASE WHEN ValorEstadoCama = 'O' THEN 1 ELSE 0 END) occ
      FROM dbo.imHabitacionCamas
      GROUP BY LTRIM(RTRIM(ValorSector))
      ORDER BY s
    `)
	).recordset;

	console.log('Sectores /beds:', after.map((r) => r.descripcion).join(', '));
	console.log('Camas:', camas);

	const want = ['3 PISO', '4 PISO', 'QUIMIOTERAPIA', 'QUIROFANO', 'UTI'].join('|');
	const got = after.map((r) => r.descripcion).sort().join('|');
	const wantSorted = want.split('|').sort().join('|');
	if (got !== wantSorted) throw new Error(`No volvió el combo. Quedó: ${got}`);

	await mysql.end();
	await remote.close();
	console.log('OK: revertido /dashboard/beds a 3 PISO, 4 PISO, QUIMIOTERAPIA, QUIROFANO, UTI');
	process.exit(0);
})().catch((e) => {
	console.error('✗', e.message);
	process.exit(1);
});
