/**
 * Espejo único dbo.imSectores (físico) → MySQL imSectores (nube).
 * No corre en cada request.
 *
 *   node scripts/sync_catalogo_sectores_nube.js
 *   node scripts/sync_catalogo_sectores_nube.js --env-file .env.railway.local
 *   node scripts/sync_catalogo_sectores_nube.js 1
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const args = process.argv.slice(2).filter((a) => a !== '--env-file');
const envIdx = process.argv.indexOf('--env-file');
const envFile =
	envIdx >= 0 && process.argv[envIdx + 1]
		? path.resolve(process.cwd(), process.argv[envIdx + 1])
		: null;
if (envFile) {
	if (!fs.existsSync(envFile)) {
		console.error('No existe', envFile);
		process.exit(1);
	}
	dotenv.config({ path: envFile, override: true });
} else {
	dotenv.config();
}

process.env.LOCAL_DEV_ONLY = '0';
if (!process.env.AUTH_DB_HOST && !process.env.MYSQLHOST) {
	process.env.AUTH_DB_ENABLED = process.env.AUTH_DB_ENABLED || '0';
} else {
	process.env.AUTH_DB_ENABLED = '1';
}

const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');
const { getTenantPool } = require('../src/config/tenantDb');
const { runWithTenant } = require('../src/context/tenantContext');
const { executeQuery } = require('../src/models/db');
const personalSync = require('../src/services/personalSync.service');

function rowField(row, ...names) {
	if (!row) return undefined;
	const lower = {};
	for (const [k, v] of Object.entries(row)) lower[String(k).toLowerCase()] = v;
	for (const n of names) {
		const v = Object.prototype.hasOwnProperty.call(row, n) ? row[n] : lower[String(n).toLowerCase()];
		if (v !== undefined && v !== null && String(v).trim() !== '') return v;
	}
	return undefined;
}

async function dumpFisicoLocal() {
	console.log('\n=== dbo.imSectores en SQL local (.env DB_*) ===');
	const rows = await executeQuery(`
    SELECT
      LTRIM(RTRIM(CAST(Valor AS VARCHAR(50)))) AS Valor,
      LTRIM(RTRIM(CAST(ISNULL(Descripcion, '') AS VARCHAR(200)))) AS Descripcion,
      LTRIM(RTRIM(CAST(ISNULL(AmbInt, '') AS VARCHAR(4)))) AS AmbInt,
      LTRIM(RTRIM(CAST(ISNULL(ValorServicio, '') AS VARCHAR(50)))) AS ValorServicio
    FROM dbo.imSectores
    WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''
    ORDER BY Descripcion
  `);
	console.table(rows || []);
	const intern = (rows || []).filter((r) => String(r.AmbInt || '').trim().toUpperCase() === 'I');
	console.log('Internación (AmbInt=I):', intern.length);
	console.table(intern);
	return rows || [];
}

async function main() {
	const only = Number(args.find((a) => /^\d+$/.test(a)) || 0);

	try {
		await dumpFisicoLocal();
	} catch (e) {
		console.warn('No se pudo leer SQL físico local:', e.message);
	}

	if (!isAuthCentralEnabled()) {
		console.error(
			'\nNo hay AUTH_DB / MYSQLHOST en este entorno: no puedo escribir Railway desde acá.\n' +
				'Poné un .env.railway.local y corré:\n' +
				'  node scripts/sync_catalogo_sectores_nube.js --env-file .env.railway.local',
		);
		process.exit(1);
	}

	const mysql = await getAuthCentralPool();
	const empresas = await mysql.query(
		`SELECT IDEMPRESA, DESCRIPCION FROM \`Empresas\` ORDER BY IDEMPRESA`,
	);
	const list = empresas[0] || empresas;
	const ids = (list || [])
		.map((r) => Number(rowField(r, 'IDEMPRESA', 'IdEmpresa')))
		.filter((id) => Number.isFinite(id) && id > 0 && (!only || id === only));

	for (const emp of ids) {
		const ok = await personalSync.puedeSyncDesdeFisico(emp);
		if (!ok) {
			console.log(`[skip] emp=${emp} (sin SQL físico)`);
			continue;
		}
		console.log(`\n=== emp=${emp} físico → nube imSectores ===`);
		await runWithTenant(emp, async () => {
			const [antes] = await mysql.query(`SELECT COUNT(*) AS n FROM \`imSectores\` WHERE IdEmpresa = ?`, [
				emp,
			]);
			console.log('nube antes:', Number(antes[0]?.n || 0));
			const pool = await getTenantPool(emp);
			const r = await personalSync.reemplazarCatalogoSectoresDesdeFisico(emp, pool);
			console.log('filas físico:', r.sectoresCatalogo, 'cambios:', r.sectoresCatalogoCambios);
			const [despues] = await mysql.query(
				`SELECT Valor, Descripcion, AmbInt, ValorServicio
				 FROM \`imSectores\` WHERE IdEmpresa = ? ORDER BY Descripcion`,
				[emp],
			);
			console.log('nube después:', despues.length);
			console.table(
				(despues || []).map((s) => ({
					Valor: s.Valor,
					Descripcion: s.Descripcion,
					AmbInt: s.AmbInt,
					ValorServicio: s.ValorServicio,
				})),
			);
		});
	}
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
