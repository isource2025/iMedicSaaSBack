/**
 * Migración imVisita.VALORSECTOR (consultorio numérico → imSectores.Valor).
 *
 *   node scripts/migrar_imvisita_valorsector.js --empresa 100
 *   node scripts/migrar_imvisita_valorsector.js --empresa 100 --aplicar
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.railway.local'), override: true });
process.env.AUTH_DB_ENABLED = '1';
process.env.LOCAL_DEV_ONLY = '0';

const platformMysql = require('../src/services/platformMysql.service');
const { runWithTenant } = require('../src/context/tenantContext');
const { executeQuery } = require('../src/models/db');

const APLICAR = process.argv.includes('--aplicar');

function arg(name, def = null) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 || i === process.argv.length - 1 ? def : process.argv[i + 1];
}

function norm(v) {
	const s = String(v ?? '')
		.trim()
		.toUpperCase()
		.split(/\s+/)[0] || '';
	const t = s.replace(/[^A-Z0-9]/g, '').slice(0, 10);
	return t && t !== '0000' && t !== 'NULL' && t !== 'NAN' ? t : null;
}

function isNumeric(v) {
	const s = String(v ?? '').trim();
	return s !== '' && /^[0-9]+$/.test(s);
}

async function loadSectorSet() {
	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS Valor FROM dbo.imSectores`,
	);
	return new Set((rows || []).map((r) => norm(r.Valor)).filter(Boolean));
}

async function buildConsultorioMap(sectorSet) {
	const rows = await executeQuery(
		`SELECT
		   LTRIM(RTRIM(CONVERT(VARCHAR(20), IDConsultorio))) AS Consultorio,
		   LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), IdServicio), ''))) AS IdServicio,
		   COUNT(*) AS n
		 FROM dbo.imPersonalHorarios
		 WHERE IDConsultorio IS NOT NULL
		   AND ISNUMERIC(CONVERT(VARCHAR(20), IDConsultorio)) = 1
		   AND CONVERT(FLOAT, CONVERT(VARCHAR(20), IDConsultorio)) <> 0
		   AND NULLIF(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), IdServicio), ''))), '') IS NOT NULL
		 GROUP BY LTRIM(RTRIM(CONVERT(VARCHAR(20), IDConsultorio))),
		          LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), IdServicio), '')))`,
	).catch(() => []);
	const best = new Map();
	for (const r of rows || []) {
		const c = String(r.Consultorio ?? '').trim();
		const srv = norm(r.IdServicio);
		const n = Number(r.n) || 0;
		if (!c || !srv || !sectorSet.has(srv)) continue;
		const prev = best.get(c);
		if (!prev || n > prev.n) best.set(c, { srv, n });
	}
	const map = new Map();
	for (const [c, { srv }] of best) {
		map.set(c, srv);
		const asInt = String(Number(c));
		if (Number.isFinite(Number(c)) && asInt !== c && !map.has(asInt)) map.set(asInt, srv);
	}
	return map;
}

async function main() {
	const id = Number(arg('empresa', 0));
	if (!id) {
		console.error('Usá --empresa <id>');
		process.exit(1);
	}
	const empresas = await platformMysql.listarEmpresasRows('');
	const emp = empresas.find((e) => Number(e.IDEMPRESA) === id);
	if (!emp) throw new Error(`Empresa ${id} no encontrada`);

	const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	console.log(`=== ${id} ${emp.DESCRIPCION} (${APLICAR ? 'APLICAR' : 'dry-run'}) ===`);

	await runWithTenant(id, async () => {
		const sectorSet = await loadSectorSet();
		const consultorioMap = await buildConsultorioMap(sectorSet);

		const rows = await executeQuery(
			`SELECT v.NUMEROVISITA,
			        LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) AS Sector,
			        tur.SectorValido
			 FROM dbo.imVisita v
			 OUTER APPLY (
			   SELECT TOP 1 LTRIM(RTRIM(CONVERT(VARCHAR(20), t.Sector))) AS SectorValido
			   FROM dbo.imTurnos t
			   INNER JOIN dbo.imSectores s
			     ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) =
			        LTRIM(RTRIM(CONVERT(VARCHAR(20), t.Sector)))
			   WHERE t.NumeroVisita = v.NUMEROVISITA
			   ORDER BY t.IdTurno DESC
			 ) tur
			 WHERE NULLIF(LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))), '') IS NOT NULL
			   AND ISNUMERIC(LTRIM(RTRIM(ISNULL(v.VALORSECTOR, '')))) = 1`,
		);

		const plan = [];
		let sinResolver = 0;
		for (const r of rows || []) {
			const raw = String(r.Sector ?? '').trim();
			if (!isNumeric(raw)) continue;
			let destino =
				norm(r.SectorValido) ||
				consultorioMap.get(raw) ||
				consultorioMap.get(String(Number(raw)));
			if (!destino || !sectorSet.has(destino)) {
				sinResolver += 1;
				continue;
			}
			plan.push({
				nv: Number(r.NUMEROVISITA),
				antes: raw,
				despues: destino,
			});
		}

		console.log({
			numericas: (rows || []).length,
			sinResolver,
			aActualizar: plan.length,
			muestra: plan.slice(0, 10),
		});

		if (!APLICAR || !plan.length) return;

		const bak = `imVisita_ValorSectorBackup_${stamp}`;
		await executeQuery(
			`IF OBJECT_ID('dbo.${bak}', 'U') IS NULL
			 CREATE TABLE dbo.${bak} (
			   NumeroVisita INT NOT NULL PRIMARY KEY,
			   ValorAntes VARCHAR(20) NULL,
			   ValorDespues VARCHAR(20) NULL,
			   MigradoEn DATETIME NOT NULL DEFAULT GETDATE()
			 )`,
		);

		let ok = 0;
		for (const p of plan) {
			await executeQuery(
				`IF NOT EXISTS (SELECT 1 FROM dbo.${bak} WHERE NumeroVisita = @p0)
				 INSERT INTO dbo.${bak} (NumeroVisita, ValorAntes, ValorDespues)
				 VALUES (@p0, @p1, @p2)`,
				[
					{ value: p.nv, type: 'Int' },
					{ value: p.antes.slice(0, 20), type: 'VarChar', length: 20 },
					{ value: p.despues.slice(0, 20), type: 'VarChar', length: 20 },
				],
			);
			await executeQuery(
				`UPDATE dbo.imVisita
				 SET VALORSECTOR = @p1
				 WHERE NUMEROVISITA = @p0
				   AND LTRIM(RTRIM(ISNULL(VALORSECTOR, ''))) = @p2`,
				[
					{ value: p.nv, type: 'Int' },
					{ value: p.despues.slice(0, 4), type: 'VarChar', length: 4 },
					{ value: p.antes.slice(0, 20), type: 'VarChar', length: 20 },
				],
			);
			ok += 1;
			if (ok % 50 === 0) process.stdout.write(`  … ${ok}/${plan.length}\r`);
		}
		console.log(`\nactualizados ${ok} · backup dbo.${bak}`);
	});
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
