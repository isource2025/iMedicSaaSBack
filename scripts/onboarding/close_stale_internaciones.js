#!/usr/bin/env node
/**
 * Cierra internaciones abiertas con ingreso anterior a N meses respecto a una fecha de referencia.
 *
 *   node scripts/onboarding/close_stale_internaciones.js --target-db Sarmiento --reference-date 2026-07-11
 */
require('dotenv').config();
const sql = require('mssql');
const { sqlConfig, closeStaleInternaciones, parseArgs } = require('./lib');

async function main() {
	const opts = parseArgs(process.argv);
	const refIdx = process.argv.indexOf('--reference-date');
	const referenceDate =
		(refIdx >= 0 ? process.argv[refIdx + 1] : null) ||
		process.env.ONBOARDING_REFERENCE_DATE ||
		new Date().toISOString().slice(0, 10);

	if (!opts.targetDb) {
		console.error('Uso: node scripts/onboarding/close_stale_internaciones.js --target-db Destino [--reference-date YYYY-MM-DD] [--dry-run]');
		process.exit(1);
	}

	const pool = await new sql.ConnectionPool(sqlConfig(opts.targetDb)).connect();
	console.log(`Cierre internaciones abiertas >1 mes (ref: ${referenceDate}, destino: ${opts.targetDb})`);

	const result = await closeStaleInternaciones(pool, {
		referenceDate,
		months: 1,
		dryRun: opts.dryRun,
	});
	console.log(result);

	await pool.close();
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
