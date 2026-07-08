/**
 * Elimina vínculos imPersonalEmpresas sin credencial imPassword en esa empresa.
 * Corrige logins que muestran empresas incorrectas (ej. admin importado en poli + vínculo huérfano en Vidal).
 *
 * Uso: node scripts/fix_orphan_personal_empresas.js --env-file .env.railway.local
 */
const mysql = require('mysql2/promise');
const path = require('path');
const dotenv = require('dotenv');

const envArg = process.argv.find((a) => a.startsWith('--env-file='));
if (envArg) {
	dotenv.config({ path: path.resolve(envArg.split('=')[1]) });
} else {
	dotenv.config();
}

(async () => {
	const pool = await mysql.createPool({
		host: process.env.AUTH_DB_HOST,
		port: Number(process.env.AUTH_DB_PORT || 3306),
		user: process.env.AUTH_DB_USER,
		password: process.env.AUTH_DB_PASSWORD,
		database: process.env.AUTH_DB_NAME,
	});
	const [orphans] = await pool.query(
		`SELECT pe.IdPersonal, pe.IdEmpresa, e.DESCRIPCION
     FROM imPersonalEmpresas pe
     LEFT JOIN imPassword pw
       ON pw.IdEmpresa = pe.IdEmpresa AND pw.ValorPersonal = pe.IdPersonal
     LEFT JOIN Empresas e ON e.IDEMPRESA = pe.IdEmpresa
     WHERE pw.ValorPersonal IS NULL`,
	);
	console.log('Vínculos huérfanos:', orphans.length);
	for (const r of orphans) {
		console.log(`  • IdPersonal=${r.IdPersonal} IdEmpresa=${r.IdEmpresa} (${r.DESCRIPCION})`);
	}
	if (orphans.length) {
		const [res] = await pool.query(
			`DELETE pe FROM imPersonalEmpresas pe
       LEFT JOIN imPassword pw
         ON pw.IdEmpresa = pe.IdEmpresa AND pw.ValorPersonal = pe.IdPersonal
       WHERE pw.ValorPersonal IS NULL`,
		);
		console.log('Eliminados:', res.affectedRows);
	}
	await pool.end();
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
