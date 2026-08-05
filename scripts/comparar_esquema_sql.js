#!/usr/bin/env node
/**
 * Compara esquemas de dos bases SQL Server en el mismo servidor (.env).
 *
 *   node scripts/comparar_esquema_sql.js
 *   node scripts/comparar_esquema_sql.js --ref iSource --tgt Sarmiento
 *
 * Por defecto: REF=iSource  TGT=DB_NAME del .env (o Sarmiento).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function arg(name, fallback) {
	const i = process.argv.indexOf(name);
	if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
	return fallback;
}

const REF = arg('--ref', 'iSource');
const TGT = arg('--tgt', process.env.DB_NAME || 'Sarmiento');

function baseCfg(database) {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: parseInt(process.env.DB_PORT, 10) || 1433,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database,
		options: { encrypt: false, trustServerCertificate: true },
		connectionTimeout: 20000,
		requestTimeout: 120000,
	};
}

async function schemaSnapshot(database) {
	const pool = await sql.connect(baseCfg(database));
	try {
		const tables = await pool.request().query(`
      SELECT s.name AS schema_name, t.name AS table_name
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE t.is_ms_shipped = 0`);
		const cols = await pool.request().query(`
      SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name,
             ty.name AS type_name, c.max_length, c.precision, c.scale, c.is_nullable
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      INNER JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      WHERE t.is_ms_shipped = 0`);
		const views = await pool.request().query(`
      SELECT s.name AS schema_name, v.name AS view_name
      FROM sys.views v
      INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
      WHERE v.is_ms_shipped = 0`);
		const procs = await pool.request().query(`
      SELECT s.name AS schema_name, p.name AS proc_name
      FROM sys.procedures p
      INNER JOIN sys.schemas s ON s.schema_id = p.schema_id
      WHERE p.is_ms_shipped = 0`);
		return {
			tables: new Set(tables.recordset.map((r) => `${r.schema_name}.${r.table_name}`)),
			cols: new Map(
				cols.recordset.map((r) => [
					`${r.schema_name}.${r.table_name}.${r.column_name}`,
					`${r.type_name}(${r.max_length},${r.precision},${r.scale}) null=${r.is_nullable}`,
				]),
			),
			views: new Set(views.recordset.map((r) => `${r.schema_name}.${r.view_name}`)),
			procs: new Set(procs.recordset.map((r) => `${r.schema_name}.${r.proc_name}`)),
		};
	} finally {
		await pool.close();
		sql.close();
	}
}

function diff(a, b) {
	return [...a].filter((x) => !b.has(x)).sort();
}

(async () => {
	console.log(`Comparando REF=${REF} vs TGT=${TGT} en ${process.env.DB_SERVER || 'localhost'}…\n`);
	const ref = await schemaSnapshot(REF);
	const tgt = await schemaSnapshot(TGT);

	const missingTables = diff(ref.tables, tgt.tables);
	const extraTables = diff(tgt.tables, ref.tables);
	const missingCols = [...ref.cols.keys()]
		.filter((c) => {
			const table = c.split('.').slice(0, 2).join('.');
			return tgt.tables.has(table) && !tgt.cols.has(c);
		})
		.sort();
	const typeDiff = [...ref.cols.keys()]
		.filter((c) => tgt.cols.has(c) && ref.cols.get(c) !== tgt.cols.get(c))
		.sort();
	const missingViews = diff(ref.views, tgt.views);
	const missingProcs = diff(ref.procs, tgt.procs);

	console.log(`Tablas REF=${ref.tables.size} TGT=${tgt.tables.size}`);
	console.log(`Columnas REF=${ref.cols.size} TGT=${tgt.cols.size}`);
	console.log(`Vistas REF=${ref.views.size} TGT=${tgt.views.size}`);
	console.log(`Procs REF=${ref.procs.size} TGT=${tgt.procs.size}\n`);

	console.log(`Tablas faltantes en ${TGT}: ${missingTables.length}`);
	missingTables.forEach((t) => console.log('  -', t));
	console.log(`\nColumnas faltantes: ${missingCols.length}`);
	missingCols.slice(0, 100).forEach((c) => console.log('  -', c));
	if (missingCols.length > 100) console.log(`  … +${missingCols.length - 100}`);
	console.log(`\nTipos distintos: ${typeDiff.length}`);
	typeDiff.slice(0, 40).forEach((c) =>
		console.log(`  - ${c}: REF=${ref.cols.get(c)} | TGT=${tgt.cols.get(c)}`),
	);
	console.log(`\nVistas faltantes: ${missingViews.length}`);
	missingViews.forEach((v) => console.log('  -', v));
	console.log(`\nProcs faltantes: ${missingProcs.length}`);
	missingProcs.slice(0, 50).forEach((p) => console.log('  -', p));
	console.log(`\nTablas extra en ${TGT}: ${extraTables.length}`);
	extraTables.slice(0, 40).forEach((t) => console.log('  +', t));

	const out = path.join(__dirname, `_schema_diff_${TGT}.json`);
	fs.writeFileSync(
		out,
		JSON.stringify(
			{ REF, TGT, missingTables, missingCols, typeDiff, missingViews, missingProcs, extraTables },
			null,
			2,
		),
	);
	console.log(`\nDiff → ${out}`);

	const gaps = missingTables.length + missingCols.length + missingViews.length + missingProcs.length;
	if (gaps === 0) {
		console.log(`\n✓ ${TGT} cubre el esquema de ${REF} (puede tener objetos extra).`);
		process.exit(0);
	}
	console.log(`\n⚠ Hay ${gaps} diferencias faltantes en ${TGT}.`);
	console.log('Sugerido: node scripts/ejecutar_setup_saas_tenant.js  (con DB_NAME del target)');
	process.exit(2);
})().catch((e) => {
	console.error(e.message || e);
	process.exit(1);
});
