#!/usr/bin/env node
/**
 * Valida que la BD destino iMedic esté vacía (onboarding limpio).
 * Opcionalmente purga datos clínicos si --purge.
 *
 *   node scripts/onboarding/prepare_target_db.js --target-db MiClienteImedic
 *   node scripts/onboarding/prepare_target_db.js --target-db MiClienteImedic --purge
 */
require('dotenv').config();
const sql = require('mssql');

const CLINICAL_TABLES = [
	'imVisitaMovimiento',
	'imHCI',
	'imVisita',
	'imPacientesTrabajos',
	'imPacientes',
	'imPersonalSectores',
	'imPersonalCodsFacturacion',
	'imPassword',
	'imPersonal',
	'imClientesConvenios',
	'imClientes',
	'imHabitacionCamas',
	'imSectores',
	'imLocalidades',
	'imTurneroPantalla',
	'imTurneroLlamado',
	'_onboardingMigracionLog',
	'_onboardingMigracionMap',
];

function parseArgs(argv) {
	const out = { targetDb: '', purge: false };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === '--target-db') out.targetDb = argv[++i];
		else if (argv[i] === '--purge') out.purge = true;
	}
	return out;
}

function sqlConfig(dbName) {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: Number(process.env.DB_PORT || 1433),
		database: dbName,
		user: process.env.DB_USER || 'sa',
		password: process.env.DB_PASSWORD,
		options: { encrypt: false, trustServerCertificate: true },
		requestTimeout: 300000,
	};
}

async function tableExists(pool, name) {
	const r = await pool
		.request()
		.input('t', sql.VarChar(128), name)
		.query(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @t`);
	return r.recordset.length > 0;
}

async function countRows(pool, name) {
	try {
		const r = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.[${name.replace(/]/g, ']]')}]`);
		return r.recordset[0].c;
	} catch {
		return -1;
	}
}

async function main() {
	const opts = parseArgs(process.argv);
	if (!opts.targetDb) {
		console.error('Uso: node scripts/onboarding/prepare_target_db.js --target-db NombreBD [--purge]');
		process.exit(1);
	}

	const pool = await new sql.ConnectionPool(sqlConfig(opts.targetDb)).connect();
	const required = ['imPacientes', 'imVisita', 'imPersonal', 'imSectores'];
	for (const t of required) {
		if (!(await tableExists(pool, t))) {
			console.error(`Falta tabla requerida dbo.${t}. Cloná el esquema iMedic vacío antes de migrar.`);
			process.exit(1);
		}
	}

	const counts = {};
	for (const t of CLINICAL_TABLES) {
		if (await tableExists(pool, t)) counts[t] = await countRows(pool, t);
	}

	console.log('Estado BD destino:', opts.targetDb);
	console.table(
		Object.entries(counts).map(([Tabla, Registros]) => ({ Tabla, Registros })),
	);

	const hasData = ['imPacientes', 'imVisita', 'imPersonal'].some((t) => (counts[t] || 0) > 0);

	if (opts.purge && hasData) {
		console.log('\nPurga de datos clínicos…');
		await pool.request().query('EXEC sp_MSforeachtable "ALTER TABLE ? NOCHECK CONSTRAINT ALL"').catch(() => {});
		for (const t of CLINICAL_TABLES) {
			if (!(await tableExists(pool, t))) continue;
			try {
				await pool.request().query(`DELETE FROM dbo.[${t}]`);
				console.log(`  DELETE ${t}`);
			} catch (e) {
				console.warn(`  ${t}: ${e.message}`);
			}
		}
		await pool.request().query('EXEC sp_MSforeachtable "ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL"').catch(() => {});
		console.log('Purga completada.');
	} else if (hasData) {
		console.warn('\nLa BD destino tiene datos clínicos. Usá --purge o cloná una BD vacía.');
		process.exit(2);
	} else {
		console.log('\nBD destino OK para migración onboarding (sin datos clínicos).');
	}

	await pool.close();
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
