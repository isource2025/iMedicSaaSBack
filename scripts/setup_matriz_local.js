/**
 * Instala el esquema local de la matriz de permisos (SQL Server) y siembra el catálogo.
 *
 *   node scripts/setup_matriz_local.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB } = require('../src/config/database');

async function aplicarSql(pool, sqlPath) {
	const sql = fs.readFileSync(sqlPath, 'utf8');
	const batches = sql
		.split(/^\s*GO\s*$/gim)
		.map((b) => b.trim())
		.filter(Boolean);
	for (const batch of batches) {
		await pool.request().query(batch);
	}
}

(async () => {
	const pool = await connectDB();
	const setupPermisos = path.join(__dirname, 'sql', 'setup_permisos.sql');
	const setupMatriz = path.join(__dirname, 'sql', 'setup_matriz_local.sql');

	console.log('• setup_permisos.sql…');
	await aplicarSql(pool, setupPermisos);
	console.log('• setup_matriz_local.sql…');
	await aplicarSql(pool, setupMatriz);

	console.log('• seed_permisos.js…');
	require('child_process').execSync('node scripts/seed_permisos.js', {
		cwd: path.join(__dirname, '..'),
		stdio: 'inherit',
		env: process.env,
	});

	const checks = await pool.request().query(`
		SELECT
			(SELECT COUNT(*) FROM dbo.imPermisos) AS permisos,
			(SELECT COUNT(*) FROM dbo.imRolPermisos) AS rolPermisos,
			CASE WHEN COL_LENGTH('dbo.imRoles', 'IdEmpresa') IS NULL THEN 0 ELSE 1 END AS colIdEmpresa,
			CASE WHEN OBJECT_ID('dbo.imRolPermisosCustom', 'U') IS NULL THEN 0 ELSE 1 END AS tblCustom,
			CASE WHEN OBJECT_ID('dbo.imPersonalPermisosOverride', 'U') IS NULL THEN 0 ELSE 1 END AS tblOverride,
			CASE WHEN OBJECT_ID('dbo.imAuditoria', 'U') IS NULL THEN 0 ELSE 1 END AS tblAuditoria
	`);
	console.log('OK matriz local:', checks.recordset[0]);
	process.exit(0);
})().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
