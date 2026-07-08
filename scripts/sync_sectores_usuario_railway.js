/**
 * Replica imPersonalSectores del SQL físico → Railway para un usuario.
 * Uso: node scripts/sync_sectores_usuario_railway.js --env-file .env.railway.local 100 14662558
 */
require('dotenv').config({ path: '.env.railway.local' });
const { runWithTenant } = require('../src/context/tenantContext');
const authCentralSync = require('../src/services/authCentralSync.service');
const { getAuthCentralPool } = require('../src/config/authCentralDb');

async function main() {
	const idEmpresa = Number(process.argv[2] || 100);
	const username = String(process.argv[3] || '').trim();
	if (!username) {
		console.error('Uso: node scripts/sync_sectores_usuario_railway.js [idEmpresa] [nombreRed]');
		process.exit(1);
	}

	const pool = await getAuthCentralPool();
	const [pw] = await pool.query(
		`SELECT ValorPersonal FROM imPassword WHERE IdEmpresa = ? AND LOWER(TRIM(NombreRed)) = LOWER(TRIM(?)) LIMIT 1`,
		[idEmpresa, username],
	);
	if (!pw.length) {
		console.error('Usuario no encontrado en Railway imPassword');
		process.exit(1);
	}
	const vp = Number(pw[0].ValorPersonal);

	await runWithTenant(idEmpresa, async () => {
		await authCentralSync.syncPersonalSectores(idEmpresa, vp);
	});

	const [sec] = await pool.query(
		`SELECT ps.idSector, s.Descripcion FROM imPersonalSectores ps
     LEFT JOIN imSectores s ON s.IdEmpresa = ps.IdEmpresa AND s.Valor = ps.idSector
     WHERE ps.IdEmpresa = ? AND ps.idPersonal = ?`,
		[idEmpresa, vp],
	);
	console.log(`Sectores en Railway para ${username} (vp=${vp}):`, sec);
	await pool.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
