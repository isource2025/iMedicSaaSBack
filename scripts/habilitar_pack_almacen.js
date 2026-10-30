/**
 * Habilita el pack ALMACEN en EmpresasModuloPack (MySQL plataforma) para
 * las empresas indicadas, sin tocar el resto de packs.
 *
 * Uso:
 *   node scripts/habilitar_pack_almacen.js
 *   node scripts/habilitar_pack_almacen.js --empresas=1,103
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });

const mysql = require('mysql2/promise');

const DEFAULT_EMPRESAS = [1, 103]; // Vidal, Materno Infantil
const PACK = 'ALMACEN';

function parseEmpresas() {
	const arg = process.argv.find((a) => a.startsWith('--empresas='));
	if (!arg) return DEFAULT_EMPRESAS;
	return arg
		.slice('--empresas='.length)
		.split(',')
		.map((s) => Number(String(s).trim()))
		.filter((n) => Number.isFinite(n) && n > 0);
}

async function main() {
	const ids = parseEmpresas();
	const c = await mysql.createConnection({
		host: process.env.AUTH_DB_HOST || process.env.MYSQLHOST,
		port: Number(process.env.AUTH_DB_PORT || process.env.MYSQLPORT || 3306),
		user: process.env.AUTH_DB_USER || process.env.MYSQLUSER,
		password: process.env.AUTH_DB_PASSWORD || process.env.MYSQLPASSWORD,
		database: process.env.AUTH_DB_NAME || process.env.MYSQLDATABASE,
	});

	try {
		for (const id of ids) {
			const [emp] = await c.query(
				`SELECT IDEMPRESA, DESCRIPCION FROM Empresas WHERE IDEMPRESA = ? LIMIT 1`,
				[id],
			);
			if (!emp.length) {
				console.warn(`SKIP ${id}: empresa no encontrada`);
				continue;
			}
			const nombre = emp[0].DESCRIPCION;
			const [exist] = await c.query(
				`SELECT Activo FROM EmpresasModuloPack WHERE IdEmpresa = ? AND CodigoPack = ? LIMIT 1`,
				[id, PACK],
			);
			if (exist.length && Number(exist[0].Activo) === 1) {
				console.log(`OK  ${id} ${nombre}: ${PACK} ya activo`);
				continue;
			}
			if (exist.length) {
				await c.execute(
					`UPDATE EmpresasModuloPack SET Activo = 1 WHERE IdEmpresa = ? AND CodigoPack = ?`,
					[id, PACK],
				);
				console.log(`UPD ${id} ${nombre}: ${PACK} reactivado`);
			} else {
				await c.execute(
					`INSERT INTO EmpresasModuloPack (IdEmpresa, CodigoPack, Activo, FechaAlta) VALUES (?, ?, 1, NOW())`,
					[id, PACK],
				);
				console.log(`ADD ${id} ${nombre}: ${PACK} habilitado`);
			}
		}

		console.log('\nPacks actuales:');
		const [packs] = await c.query(
			`SELECT p.IdEmpresa, e.DESCRIPCION, p.CodigoPack, p.Activo
       FROM EmpresasModuloPack p
       JOIN Empresas e ON e.IDEMPRESA = p.IdEmpresa
       WHERE p.IdEmpresa IN (${ids.map(() => '?').join(',')})
       ORDER BY p.IdEmpresa, p.CodigoPack`,
			ids,
		);
		for (const p of packs) {
			console.log(`  ${p.IdEmpresa} ${p.DESCRIPCION} → ${p.CodigoPack} (activo=${p.Activo})`);
		}
	} finally {
		await c.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
