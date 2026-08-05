#!/usr/bin/env node
/**
 * Copia imSectores (mínimo para camas), imPersonal, imPacientes e imHabitacionCamas
 * desde SQL local [Sarmiento] → remoto Empresa #101 (Sanatorio Sarmiento en Railway).
 *
 *   node scripts/migrar_sarmiento_local_a_remoto.js
 *   node scripts/migrar_sarmiento_local_a_remoto.js --dry-run
 *   node scripts/migrar_sarmiento_local_a_remoto.js --skip-pacientes
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: false });

const sql = require('mssql');
const { getAuthCentralPool } = require('../src/config/authCentralDb');
const {
	resolvePasswordFromEmpresaRow,
	normalizeEmpresaRow,
} = require('../src/utils/empresaDbConnection');

const ID_EMPRESA = Number(process.env.SARMIENTO_EMPRESA_ID || 101);
const LOCAL_DB = process.env.LOCAL_DB_NAME || 'Sarmiento';
const DRY = process.argv.includes('--dry-run');
const SKIP_PACIENTES = process.argv.includes('--skip-pacientes');
const SKIP_PERSONAL = process.argv.includes('--skip-personal');
const SKIP_CAMAS = process.argv.includes('--skip-camas');
const BATCH = Number(process.env.MIGRATE_BATCH || 80);

const EXCLUDE_COLS = new Set(['firma']); // blob pesado

function localCfg() {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: parseInt(process.env.DB_PORT, 10) || 1433,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: LOCAL_DB,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 600000,
		connectionTimeout: 30000,
	};
}

function remoteCfg(emp, password) {
	return {
		server: String(emp.DbServer),
		port: Number(emp.DbPort) || 1433,
		user: String(emp.DbUser),
		password: String(password),
		database: String(emp.DbName),
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 600000,
		connectionTimeout: 30000,
	};
}

async function columnasComunes(local, remote, table) {
	const q = `
    SELECT c.name, c.is_identity, c.column_id
    FROM sys.columns c
    INNER JOIN sys.tables t ON t.object_id = c.object_id
    WHERE t.name = @t
    ORDER BY c.column_id`;
	const lc = (
		await local.request().input('t', sql.NVarChar, table).query(q)
	).recordset;
	const rc = (
		await remote.request().input('t', sql.NVarChar, table).query(q)
	).recordset;
	const rmap = new Map(rc.map((r) => [String(r.name).toLowerCase(), r]));
	const common = [];
	let hasIdentity = false;
	for (const c of lc) {
		const name = String(c.name);
		if (EXCLUDE_COLS.has(name.toLowerCase())) continue;
		if (!rmap.has(name.toLowerCase())) continue;
		common.push(name);
		if (c.is_identity) hasIdentity = true;
	}
	return { cols: common, hasIdentity };
}

function chunk(arr, n) {
	const out = [];
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
	return out;
}

function sqlLiteral(v) {
	if (v === null || v === undefined) return 'NULL';
	if (Buffer.isBuffer(v)) return 'NULL';
	if (v instanceof Date) {
		const iso = v.toISOString().slice(0, 23).replace('T', ' ');
		return `'${iso}'`;
	}
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
	if (typeof v === 'boolean') return v ? '1' : '0';
	const s = String(v).replace(/'/g, "''");
	return `N'${s}'`;
}

async function upsertMerge(remote, table, cols, rows, keyCols, hasIdentity) {
	if (!rows.length) return 0;
	let written = 0;
	const colList = cols.map((c) => `[${c}]`).join(', ');
	const on = keyCols.map((k) => `T.[${k}] = S.[${k}]`).join(' AND ');
	const nonKeys = cols.filter((c) => !keyCols.includes(c));
	const updates = nonKeys.map((c) => `T.[${c}] = S.[${c}]`).join(', ');
	const insertCols = cols.map((c) => `[${c}]`).join(', ');
	const insertVals = cols.map((c) => `S.[${c}]`).join(', ');

	for (const lote of chunk(rows, BATCH)) {
		const valuesSql = lote
			.map((row) => `(${cols.map((c) => sqlLiteral(row[c])).join(', ')})`)
			.join(',\n');
		const merge = `
SET NOCOUNT ON;
${hasIdentity ? `SET IDENTITY_INSERT dbo.[${table}] ON;` : ''}
MERGE dbo.[${table}] AS T
USING (VALUES
${valuesSql}
) AS S (${colList})
ON ${on}
WHEN MATCHED THEN UPDATE SET ${updates || 'T.[' + keyCols[0] + '] = T.[' + keyCols[0] + ']'}
WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});
${hasIdentity ? `SET IDENTITY_INSERT dbo.[${table}] OFF;` : ''}
`;
		if (DRY) {
			written += lote.length;
			continue;
		}
		await remote.request().query(merge);
		written += lote.length;
		process.stdout.write(`\r  ${table}: ${written}/${rows.length}    `);
	}
	process.stdout.write('\n');
	return written;
}

async function replaceCamas(remote, cols, rows) {
	if (DRY) return rows.length;
	// Solo reemplaza camas de sectores que vienen del local (PISO/UTI/…)
	const sectores = [...new Set(rows.map((r) => String(r.ValorSector || '').trim()).filter(Boolean))];
	if (!sectores.length) return 0;
	for (const s of sectores) {
		await remote
			.request()
			.input('s', sql.VarChar, s)
			.query(`DELETE FROM dbo.imHabitacionCamas WHERE ValorSector = @s`);
	}
	return upsertMerge(remote, 'imHabitacionCamas', cols, rows, ['ValorSector', 'ValorHabitacionCama'], false);
}

(async () => {
	console.log('=== Migrar Sarmiento local → remoto (Railway empresa) ===\n');
	if (DRY) console.log('MODO DRY-RUN (no escribe)\n');

	process.env.LOCAL_DEV_ONLY = '0';
	process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';

	const mysql = await getAuthCentralPool();
	const [erows] = await mysql.query(`SELECT * FROM Empresas WHERE IDEMPRESA = ? LIMIT 1`, [
		ID_EMPRESA,
	]);
	await mysql.end();
	if (!erows.length) throw new Error(`Empresa ${ID_EMPRESA} no encontrada en Railway`);
	const emp = normalizeEmpresaRow(erows[0]);
	const password = resolvePasswordFromEmpresaRow(emp);
	if (!emp.DbServer || !password) throw new Error('Empresa sin DbServer/password');

	console.log(`Origen:  ${process.env.DB_SERVER}/${LOCAL_DB}`);
	console.log(
		`Destino: ${emp.DbServer}:${emp.DbPort}/${emp.DbName}  (${erows[0].DESCRIPCION})\n`,
	);

	const local = await new sql.ConnectionPool(localCfg()).connect();
	const remote = await new sql.ConnectionPool(remoteCfg(emp, password)).connect();

	// 1) Sectores usados por camas locales
	const secMeta = await columnasComunes(local, remote, 'imSectores');
	const localSecs = (
		await local.request().query(`
      SELECT DISTINCT s.*
      FROM dbo.imSectores s
      INNER JOIN dbo.imHabitacionCamas c ON c.ValorSector = s.Valor
    `)
	).recordset;
	const allLocalSecs = (await local.request().query(`SELECT * FROM dbo.imSectores`)).recordset;
	const secs = allLocalSecs.length ? allLocalSecs : localSecs;
	console.log(`Sectores locales a sincronizar: ${secs.length}`);
	await upsertMerge(remote, 'imSectores', secMeta.cols, secs, ['Valor'], false);

	// 2) Personal
	if (!SKIP_PERSONAL) {
		const meta = await columnasComunes(local, remote, 'imPersonal');
		const rows = (await local.request().query(`SELECT * FROM dbo.imPersonal`)).recordset;
		console.log(`Personal: ${rows.length} filas`);
		await upsertMerge(remote, 'imPersonal', meta.cols, rows, ['Valor'], meta.hasIdentity);
	}

	// 3) Pacientes
	if (!SKIP_PACIENTES) {
		const meta = await columnasComunes(local, remote, 'imPacientes');
		const rows = (await local.request().query(`SELECT * FROM dbo.imPacientes`)).recordset;
		console.log(`Pacientes: ${rows.length} filas`);
		await upsertMerge(remote, 'imPacientes', meta.cols, rows, ['IdPaciente'], meta.hasIdentity);
	}

	// 4) Camas
	if (!SKIP_CAMAS) {
		const meta = await columnasComunes(local, remote, 'imHabitacionCamas');
		const rows = (await local.request().query(`SELECT * FROM dbo.imHabitacionCamas`)).recordset;
		console.log(`Camas: ${rows.length} filas`);
		await replaceCamas(remote, meta.cols, rows);
	}

	// Conteos finales
	console.log('\n--- Conteos remotos ---');
	for (const t of ['imSectores', 'imPersonal', 'imPacientes', 'imHabitacionCamas']) {
		const r = await remote.request().query(`SELECT COUNT(*) AS c FROM dbo.[${t}]`);
		console.log(`  ${t}: ${r.recordset[0].c}`);
	}

	await local.close();
	await remote.close();
	console.log(DRY ? '\n✓ Dry-run OK' : '\n✓ Migración OK');
	process.exit(0);
})().catch((e) => {
	console.error('\nError:', e.message || e);
	process.exit(1);
});
