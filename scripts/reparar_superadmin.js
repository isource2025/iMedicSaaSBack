/**
 * Repara el superadmin de plataforma (IdEmpresa=0).
 * Libera el username "superadmin" si lo usurpó un tenant (p.ej. Vidal).
 *
 *   node scripts/reparar_superadmin.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const publicUrl = process.env.MYSQL_PUBLIC_URL || '';
if (publicUrl.startsWith('mysql://')) {
	const u = new URL(publicUrl);
	process.env.AUTH_DB_HOST = u.hostname;
	process.env.AUTH_DB_PORT = u.port || '3306';
	process.env.AUTH_DB_USER = decodeURIComponent(u.username);
	process.env.AUTH_DB_PASSWORD = decodeURIComponent(u.password);
	process.env.AUTH_DB_NAME = (u.pathname || '/railway').replace(/^\//, '') || 'railway';
}

process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';
process.env.SA_USER = process.env.SA_USER || 'superadmin';
process.env.SA_PASS = process.env.SA_PASS || 'SuperAdmin2026!';

const { ensureSuperAdmin, SA_USER, SA_PASS } = require('../src/services/ensureSuperAdmin.service');
const { getAuthCentralPool } = require('../src/config/authCentralDb');
const authCentral = require('../src/services/authCentral.service');

async function main() {
	const pool = await getAuthCentralPool();

	console.log('=== Antes ===');
	const [antes] = await pool.query(
		`SELECT IdEmpresa, ValorPersonal, NombreRed, Grupo,
            LEFT(Password, 20) AS PassPrefix
     FROM imPassword
     WHERE LOWER(TRIM(NombreRed)) = LOWER(?)
     ORDER BY IdEmpresa, ValorPersonal`,
		[SA_USER],
	);
	console.table(antes);

	const repair = await ensureSuperAdmin();
	console.log('\n=== ensureSuperAdmin ===');
	console.log(JSON.stringify(repair, null, 2));

	console.log('\n=== Despues ===');
	const [despues] = await pool.query(
		`SELECT pw.IdEmpresa, pw.ValorPersonal, pw.NombreRed, pw.Grupo, p.Rol
     FROM imPassword pw
     LEFT JOIN imPersonal p
       ON p.Valor = pw.ValorPersonal AND p.IdEmpresa = pw.IdEmpresa
     WHERE LOWER(TRIM(pw.NombreRed)) = LOWER(?)
        OR (COALESCE(pw.IdEmpresa,0)=0 AND pw.ValorPersonal >= 1000000)
     ORDER BY pw.IdEmpresa, pw.ValorPersonal`,
		[SA_USER],
	);
	console.table(despues);

	const usuario = await authCentral.autenticarPlataforma(SA_USER, SA_PASS);
	console.log('\n=== Login plataforma ===');
	if (usuario) {
		console.log({
			ok: true,
			IdEmpresa: usuario.IdEmpresa,
			ValorPersonal: usuario.ValorPersonal,
			Rol: usuario.RolNombre || usuario.PersonalRol,
			Grupo: usuario.Grupo,
			esSuperAdmin: usuario.esSuperAdmin ?? usuario.RolNombre === 'SUPER_ADMIN',
		});
	} else {
		console.log({ ok: false });
		process.exit(2);
	}

	console.log(`\nListo. Credenciales: ${SA_USER} / ${SA_PASS}`);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
