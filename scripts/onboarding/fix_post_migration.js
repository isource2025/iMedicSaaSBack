#!/usr/bin/env node
/**
 * Correcciones post-migración (sectores, camas, internaciones antiguas).
 * HC, medicamentos y facturación quedan fuera de alcance.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const {
	sqlConfig,
	truncStr,
	loadSectorCatalog,
	loadBedCatalog,
	resolveSectorFromCatalog,
	normalizeHabitacionCode,
	closeStaleInternaciones,
	parseArgs,
} = require('./lib');

async function findLegacyMapTable(targetPool) {
	const r = await targetPool.request().query(`
    SELECT TOP 1 t.TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES t
    INNER JOIN INFORMATION_SCHEMA.COLUMNS c
      ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
    WHERE t.TABLE_SCHEMA = 'dbo'
      AND t.TABLE_NAME LIKE '%MigracionMap'
      AND t.TABLE_NAME <> '_onboardingMigracionMap'
      AND c.COLUMN_NAME LIKE '%Key'
      AND c.COLUMN_NAME NOT IN ('ImedicKey')
    ORDER BY t.TABLE_NAME
  `);
	return r.recordset[0]?.TABLE_NAME || null;
}

async function findLegacyLogTable(targetPool) {
	const r = await targetPool.request().query(`
    SELECT TOP 1 TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME LIKE '%MigracionLog'
      AND TABLE_NAME <> '_onboardingMigracionLog'
    ORDER BY TABLE_NAME
  `);
	return r.recordset[0]?.TABLE_NAME || null;
}

async function upgradeSchema(targetPool) {
	const ddl = fs.readFileSync(path.join(__dirname, 'setup_migration_schema.sql'), 'utf8');
	await targetPool.request().query(ddl);

	const legacyMap = await findLegacyMapTable(targetPool);
	const newMap = await targetPool.request().query(`
    SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '_onboardingMigracionMap'
  `);

	if (legacyMap && !newMap.recordset.length) {
		const cols = await targetPool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${legacyMap.replace(/'/g, "''")}'
    `);
		const names = new Set(cols.recordset.map((c) => c.COLUMN_NAME));
		const keyCol = [...names].find((n) => n.endsWith('Key') && n !== 'ImedicKey') || 'SourceKey';
		const idCol = [...names].find((n) => n.endsWith('Id') && n !== 'ImedicId') || 'SourceId';

		await targetPool.request().query(`
      SELECT Entidad, ${keyCol} AS SourceKey, ${idCol} AS SourceId, ImedicId, ImedicKey, MetadataJson, CreadoEn
      INTO dbo._onboardingMigracionMap
      FROM dbo.[${legacyMap.replace(/]/g, ']]')}]
    `);
		console.log(`  Mapa legacy (${legacyMap}) copiado → _onboardingMigracionMap`);
	}

	const legacyLog = await findLegacyLogTable(targetPool);
	if (legacyLog) {
		await targetPool.request().query(`
      INSERT INTO dbo._onboardingMigracionLog (Fase, Nivel, Mensaje, Detalle, CreadoEn)
      SELECT Fase, Nivel, Mensaje, Detalle, CreadoEn FROM dbo.[${legacyLog.replace(/]/g, ']]')}]
      WHERE NOT EXISTS (SELECT 1 FROM dbo._onboardingMigracionLog)
    `).catch(() => {});
	}
}

async function fixSectores(sourcePool, targetPool, dryRun, catalog) {
	const valid = [...catalog.values()].map((e) => e.valor);
	let inserted = 0;
	let removed = 0;

	if (!dryRun) {
		const placeholders = valid.map((_, i) => `@v${i}`).join(',');
		const req = targetPool.request();
		valid.forEach((v, i) => req.input(`v${i}`, sql.VarChar(4), v));

		if (valid.length) {
			await req.query(`
        DELETE FROM dbo.imPersonalSectores
        WHERE IdSector NOT IN (${placeholders})
      `).catch(() => {});

			const del = await targetPool.request().query(`
        DELETE FROM dbo.imSectores
        WHERE Valor NOT IN (${valid.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})
      `);
			removed = del.rowsAffected[0] || 0;
		}

		for (const entry of catalog.values()) {
			const ex = await targetPool
				.request()
				.input('v', sql.VarChar(4), entry.valor)
				.query(`SELECT 1 FROM dbo.imSectores WHERE Valor=@v`);
			if (ex.recordset.length) continue;
			await targetPool
				.request()
				.input('v', sql.VarChar(4), entry.valor)
				.input('vs', sql.VarChar(4), `${entry.valor} `.slice(0, 4))
				.input('d', sql.VarChar(40), entry.descripcion)
				.input('a', sql.Char(1), entry.ambInt)
				.query(
					`INSERT INTO dbo.imSectores (Valor, ValorServicio, Descripcion, ProtocoloN, AmbInt) VALUES (@v,@vs,@d,0,@a)`,
				);
			inserted++;
		}
	}

	return { inserted, removed, total: catalog.size };
}

async function fixHabitaciones(sourcePool, targetPool, dryRun, catalog) {
	const beds = await loadBedCatalog(sourcePool, catalog);
	let inserted = 0;

	if (!dryRun) {
		await targetPool.request().query(`DELETE FROM dbo.imHabitacionCamas`);
	}

	for (const bed of beds) {
		if (!dryRun) {
			await targetPool
				.request()
				.input('vs', sql.VarChar(4), bed.sectorVal)
				.input('vh', sql.VarChar(4), bed.habCode)
				.input('est', sql.Char(1), 'U')
				.query(`
          INSERT INTO dbo.imHabitacionCamas (ValorSector, ValorHabitacionCama, ValorEstadoCama, NumeroVisita)
          VALUES (@vs, @vh, @est, 0)
        `);
			inserted++;
		}
	}

	const bedIndex = new Set(beds.map((b) => `${b.sectorVal}|${b.habCode}`));
	let occupied = 0;
	if (!dryRun) {
		const activas = await sourcePool.request().query(`
      SELECT INTERNACIONESID, SECTOR, HABITACION
      FROM dbo.Internaciones
      WHERE (FECHAEGRESO IS NULL OR FECHAEGRESO = 0)
        AND LTRIM(RTRIM(HABITACION)) <> ''
    `);

		for (const a of activas.recordset || []) {
			const sectorVal = resolveSectorFromCatalog(catalog, a.SECTOR);
			const hab = normalizeHabitacionCode(a.HABITACION);
			if (!sectorVal || !hab || !bedIndex.has(`${sectorVal}|${hab}`)) continue;

			const r = await targetPool
				.request()
				.input('nv', sql.Int, a.INTERNACIONESID)
				.input('vs', sql.VarChar(4), sectorVal)
				.input('vh', sql.VarChar(4), hab)
				.query(`
          UPDATE dbo.imHabitacionCamas
          SET NumeroVisita=@nv, ValorEstadoCama='O'
          WHERE ValorSector=@vs AND ValorHabitacionCama=@vh
        `);
			if (r.rowsAffected[0]) occupied++;
		}
	}

	return { inserted, beds: beds.length, occupied };
}

async function main() {
	const opts = parseArgs(process.argv);
	if (!opts.sourceDb || !opts.targetDb) {
		console.error('Uso: node scripts/onboarding/fix_post_migration.js --source-db Origen --target-db Destino [--dry-run]');
		process.exit(1);
	}

	console.log('Corrección post-migración');
	console.log(`  Origen:  ${opts.sourceDb}`);
	console.log(`  Destino: ${opts.targetDb}`);
	console.log(`  Modo:    ${opts.dryRun ? 'DRY-RUN' : 'EJECUCIÓN'}`);

	const sourcePool = await new sql.ConnectionPool(sqlConfig(opts.sourceDb)).connect();
	const targetPool = await new sql.ConnectionPool(sqlConfig(opts.targetDb)).connect();
	const sectorCatalog = await loadSectorCatalog(sourcePool);

	console.log('\n── schema upgrade ──');
	if (!opts.dryRun) await upgradeSchema(targetPool);
	else console.log('  DRY-RUN: omitido');

	console.log('\n── sectores ──');
	const sectores = await fixSectores(sourcePool, targetPool, opts.dryRun, sectorCatalog);
	console.log(`  ${sectores.removed} sectores inválidos eliminados, ${sectores.inserted} insertados (${sectores.total} oficiales)`);

	console.log('\n── habitaciones ──');
	const beds = await fixHabitaciones(sourcePool, targetPool, opts.dryRun, sectorCatalog);
	console.log(`  ${beds.inserted} camas reconstruidas, ${beds.occupied} ocupadas (${beds.beds} catálogo Sectores↔Sector)`);

	console.log('\n── internaciones abiertas antiguas ──');
	const stale = await closeStaleInternaciones(targetPool, {
		referenceDate: process.env.ONBOARDING_REFERENCE_DATE || '2026-07-11',
		months: 1,
		dryRun: opts.dryRun,
	});
	console.log(
		`  ${stale.closed || stale.wouldClose} internaciones >1 mes cerradas (ref: ${stale.referenceDate}), ${stale.bedsOccupied ?? '-'} camas reocupadas`,
	);

	const verify = await targetPool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM imSectores) AS Sectores,
      (SELECT COUNT(*) FROM imHabitacionCamas) AS Camas,
      (SELECT COUNT(*) FROM imHabitacionCamas WHERE ValorEstadoCama='O') AS CamasOcupadas,
      (SELECT COUNT(*) FROM imVisita WHERE FECHAEGRESO IS NULL OR FECHAEGRESO=0) AS VisitasActivas
  `);
	console.log('\n── verificación ──');
	console.table(verify.recordset);

	await sourcePool.close();
	await targetPool.close();
}

main().catch((e) => {
	console.error('Corrección fallida:', e.message);
	process.exit(1);
});
