#!/usr/bin/env node
/**
 * Agrega Empresas.FileServerUrl en MySQL Railway (o SQL Server plataforma).
 *
 *   node scripts/setup_empresa_fileserver.js --railway --env-file .env.railway.local
 *   node scripts/setup_empresa_fileserver.js
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const args = process.argv.slice(2);
const useRailway = args.includes('--railway');
const envFileIdx = args.indexOf('--env-file');
const envFile =
	envFileIdx >= 0 && args[envFileIdx + 1]
		? path.resolve(process.cwd(), args[envFileIdx + 1])
		: null;

if (envFile) {
	if (!fs.existsSync(envFile)) {
		console.error(`No existe: ${envFile}`);
		process.exit(1);
	}
	dotenv.config({ path: envFile, override: true });
} else {
	dotenv.config();
}

if (useRailway) {
	process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '1';
	process.env.LOCAL_DEV_ONLY = '0';
}

async function migrateMysql() {
	const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');
	if (!isAuthCentralEnabled()) {
		throw new Error('MySQL AUTH_DB no configurado');
	}
	const pool = await getAuthCentralPool();
	const [cols] = await pool.query(
		`SELECT COLUMN_NAME AS col FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'FileServerUrl'`,
	);
	if (cols.length) {
		console.log('MySQL: FileServerUrl ya existe');
	} else {
		await pool.query(
			`ALTER TABLE \`Empresas\` ADD COLUMN \`FileServerUrl\` VARCHAR(500) NULL COMMENT 'URL pública del file server / túnel (adjuntos)'`,
		);
		console.log('MySQL: columna FileServerUrl agregada');
	}

	// Semilla Vidal si está vacío y hay default histórico
	const [r] = await pool.query(
		`SELECT IDEMPRESA, FileServerUrl, DbServer FROM \`Empresas\` WHERE IDEMPRESA = 1 LIMIT 1`,
	);
	if (r[0] && !String(r[0].FileServerUrl || '').trim()) {
		const seed = process.env.FILE_SERVER_URL || 'http://181.4.71.230:3002';
		await pool.query(`UPDATE \`Empresas\` SET FileServerUrl = ? WHERE IDEMPRESA = 1`, [seed]);
		console.log(`MySQL: Empresa #1 FileServerUrl = ${seed}`);
	}
}

async function migrateSqlServer() {
	const { connectDB, isPlatformSqlConfigured } = require('../src/config/database');
	if (!isPlatformSqlConfigured()) {
		console.log('SQL Server plataforma no configurado — skip');
		return;
	}
	const pool = await connectDB();
	await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Empresas' AND COLUMN_NAME = 'FileServerUrl'
    )
      ALTER TABLE dbo.Empresas ADD FileServerUrl NVARCHAR(500) NULL;
  `);
	console.log('SQL Server: FileServerUrl OK');
}

(async () => {
	if (useRailway) {
		await migrateMysql();
	} else {
		try {
			await migrateMysql();
		} catch (e) {
			console.warn('MySQL skip:', e.message);
		}
		await migrateSqlServer();
	}
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
