/**
 * Migración imTurnos.Sector → imSectores.Valor exacto.
 *
 * Uso:
 *   node scripts/migrar_imturnos_sector.js --empresa 100              # dry-run
 *   node scripts/migrar_imturnos_sector.js --empresa 100 --aplicar
 *   node scripts/migrar_imturnos_sector.js --empresa 103 --aplicar
 *   node scripts/migrar_imturnos_sector.js --all --aplicar
 *
 * Reglas (solo destino ∈ imSectores.Valor):
 *   NUM:  A) moda IdServicio del IDConsultorio en horarios si es sector
 *         B) primer imPersonalSectores.idSector válido del profesional
 *   BAD:  CIR+QUIROFANO(999999) → QUI (Materno)
 *         NaN / otras letras → vía B
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.railway.local'), override: true });
process.env.AUTH_DB_ENABLED = '1';
process.env.LOCAL_DEV_ONLY = '0';

const platformMysql = require('../src/services/platformMysql.service');
const { runWithTenant } = require('../src/context/tenantContext');
const { executeQuery } = require('../src/models/db');

const APLICAR = process.argv.includes('--aplicar');
const ALL = process.argv.includes('--all');

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

function isNumericSector(v) {
	const s = String(v ?? '').trim();
	return s !== '' && /^[0-9]+$/.test(s);
}

function isBadLetter(v, sectorSet) {
	const s = String(v ?? '').trim();
	if (!s || isNumericSector(s)) return false;
	if (/^nan$/i.test(s)) return true;
	const n = norm(s);
	return !n || !sectorSet.has(n);
}

async function loadSectorSet() {
	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS Valor FROM dbo.imSectores`,
	);
	return new Set((rows || []).map((r) => norm(r.Valor)).filter(Boolean));
}

async function ensureBackupTable(stamp) {
	const table = `imTurnos_SectorBackup_${stamp}`;
	await executeQuery(
		`IF OBJECT_ID('dbo.${table}', 'U') IS NULL
		 CREATE TABLE dbo.${table} (
		   IdTurno INT NOT NULL PRIMARY KEY,
		   SectorAntes VARCHAR(20) NULL,
		   SectorDespues VARCHAR(20) NULL,
		   Via VARCHAR(40) NULL,
		   MigradoEn DATETIME NOT NULL DEFAULT GETDATE()
		 )`,
	);
	return table;
}

async function buildConsultorioMap(sectorSet) {
	// Sin TRY_CONVERT: compatible SQL Server 2008 (Materno).
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
	const best = new Map(); // consultorio → { srv, n }
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

async function sectorPersonalValido(matricula, sectorSet) {
	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(CAST(ps.idSector AS VARCHAR(50)))) AS idSector
		 FROM dbo.imPersonal p
		 INNER JOIN dbo.imPersonalSectores ps ON ps.idPersonal = p.Valor
		 WHERE p.Matricula = @p0
		 ORDER BY ps.idSector`,
		[{ value: Number(matricula), type: 'Int' }],
	).catch(() => []);
	for (const r of rows || []) {
		const c = norm(r.idSector);
		if (c && sectorSet.has(c)) return c;
	}
	// Fallback exacto: ValorServicio del personal si también es imSectores.Valor
	const pers = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(ISNULL(CONVERT(VARCHAR(20), ValorServicio), ''))) AS VS
		 FROM dbo.imPersonal WHERE Matricula = @p0`,
		[{ value: Number(matricula), type: 'Int' }],
	).catch(() => []);
	const vs = norm(pers?.[0]?.VS);
	if (vs && sectorSet.has(vs)) return vs;
	return null;
}

async function resolveDestino(turno, { sectorSet, consultorioMap, personalCache }) {
	const raw = String(turno.Sector ?? '').trim();
	const mat = Number(turno.Profesional);

	// Caso Materno: CIR en QUIROFANO → QUI
	if (norm(raw) === 'CIR' && mat === 999999 && sectorSet.has('QUI')) {
		return { destino: 'QUI', via: 'especial_CIR_QUIROFANO' };
	}

	if (isNumericSector(raw)) {
		const keys = [raw, String(Number(raw))];
		for (const k of keys) {
			if (consultorioMap.has(k)) {
				return { destino: consultorioMap.get(k), via: 'A_mapa_consultorio' };
			}
		}
		if (!personalCache.has(mat)) {
			personalCache.set(mat, await sectorPersonalValido(mat, sectorSet));
		}
		const ps = personalCache.get(mat);
		if (ps) return { destino: ps, via: 'B_sector_personal' };
		return { destino: null, via: 'D_sin_resolver' };
	}

	if (isBadLetter(raw, sectorSet)) {
		if (!personalCache.has(mat)) {
			personalCache.set(mat, await sectorPersonalValido(mat, sectorSet));
		}
		const ps = personalCache.get(mat);
		if (ps) return { destino: ps, via: 'B_sector_personal_badletter' };
		return { destino: null, via: 'D_sin_resolver' };
	}

	return { destino: null, via: 'skip_ok' };
}

async function migrarEmpresa(emp) {
	const id = Number(emp.IDEMPRESA);
	const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
	console.log(`\n=== Empresa ${id} ${emp.DESCRIPCION} (${APLICAR ? 'APLICAR' : 'dry-run'}) ===`);

	return runWithTenant(id, async () => {
		const sectorSet = await loadSectorSet();
		const consultorioMap = await buildConsultorioMap(sectorSet);
		const personalCache = new Map();

		// Traer todos los Sector no vacíos y filtrar en JS (evita TRY_CONVERT en SQL viejo).
		const todos = await executeQuery(
			`SELECT IdTurno, Profesional,
			        LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), Sector), ''))) AS Sector
			 FROM dbo.imTurnos
			 WHERE NULLIF(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), Sector), ''))), '') IS NOT NULL`,
		);
		const candidatos = (todos || []).filter((t) => {
			const s = String(t.Sector ?? '').trim();
			if (isNumericSector(s)) return true;
			if (/^nan$/i.test(s)) return true;
			return isBadLetter(s, sectorSet);
		});

		const plan = [];
		const byVia = {};
		for (const t of candidatos || []) {
			const r = await resolveDestino(t, { sectorSet, consultorioMap, personalCache });
			byVia[r.via] = (byVia[r.via] || 0) + 1;
			if (r.destino && r.via !== 'skip_ok') {
				const antes = String(t.Sector ?? '').trim();
				if (norm(antes) === norm(r.destino)) {
					byVia.skip_ya_ok = (byVia.skip_ya_ok || 0) + 1;
					continue;
				}
				plan.push({
					idTurno: Number(t.IdTurno),
					antes,
					despues: r.destino,
					via: r.via,
					matricula: Number(t.Profesional),
				});
			}
		}

		console.log('candidatos', (candidatos || []).length);
		console.log('por vía', byVia);
		console.log('a actualizar', plan.length);
		if (plan.length) {
			const sample = plan.slice(0, 12).map((p) => `${p.idTurno}: ${p.antes}→${p.despues} (${p.via})`);
			console.log('muestra', sample);
		}

		if (!APLICAR || !plan.length) {
			return { id, desc: emp.DESCRIPCION, dryRun: !APLICAR, plan: plan.length, byVia };
		}

		const bak = await ensureBackupTable(stamp);
		// PK de imTurnos incluye Sector: chequear colisión antes de UPDATE.
		let ok = 0;
		let conflictos = 0;
		const chunk = 80;
		for (let i = 0; i < plan.length; i += chunk) {
			const slice = plan.slice(i, i + chunk);
			for (const p of slice) {
				const colision = await executeQuery(
					`SELECT TOP 1 t2.IdTurno AS Otro
					 FROM dbo.imTurnos t1
					 INNER JOIN dbo.imTurnos t2
					   ON t2.FechaAsignada = t1.FechaAsignada
					  AND t2.HoraAsignada = t1.HoraAsignada
					  AND t2.Profesional = t1.Profesional
					  AND LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), t2.Sector), ''))) = @p1
					  AND t2.IdTurno <> t1.IdTurno
					 WHERE t1.IdTurno = @p0`,
					[
						{ value: p.idTurno, type: 'Int' },
						{ value: p.despues.slice(0, 4), type: 'VarChar', length: 4 },
					],
				).catch(() => []);
				if (colision?.length) {
					conflictos += 1;
					await executeQuery(
						`IF NOT EXISTS (SELECT 1 FROM dbo.${bak} WHERE IdTurno = @p0)
						 INSERT INTO dbo.${bak} (IdTurno, SectorAntes, SectorDespues, Via)
						 VALUES (@p0, @p1, @p2, @p3)`,
						[
							{ value: p.idTurno, type: 'Int' },
							{ value: p.antes.slice(0, 20), type: 'VarChar', length: 20 },
							{ value: p.despues.slice(0, 20), type: 'VarChar', length: 20 },
							{ value: 'CONFLICTO_PK', type: 'VarChar', length: 40 },
						],
					).catch(() => null);
					continue;
				}
				await executeQuery(
					`IF NOT EXISTS (SELECT 1 FROM dbo.${bak} WHERE IdTurno = @p0)
					 INSERT INTO dbo.${bak} (IdTurno, SectorAntes, SectorDespues, Via)
					 VALUES (@p0, @p1, @p2, @p3)`,
					[
						{ value: p.idTurno, type: 'Int' },
						{ value: p.antes.slice(0, 20), type: 'VarChar', length: 20 },
						{ value: p.despues.slice(0, 20), type: 'VarChar', length: 20 },
						{ value: p.via.slice(0, 40), type: 'VarChar', length: 40 },
					],
				);
				try {
					await executeQuery(
						`UPDATE dbo.imTurnos
						 SET Sector = @p1
						 WHERE IdTurno = @p0
						   AND LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), Sector), ''))) = @p2`,
						[
							{ value: p.idTurno, type: 'Int' },
							{ value: p.despues.slice(0, 4), type: 'VarChar', length: 4 },
							{ value: p.antes.slice(0, 20), type: 'VarChar', length: 20 },
						],
					);
					ok += 1;
				} catch (e) {
					if (String(e.message || '').includes('PRIMARY KEY') || e.number === 2627) {
						conflictos += 1;
						continue;
					}
					throw e;
				}
			}
			process.stdout.write(`  … ${Math.min(i + chunk, plan.length)}/${plan.length}\r`);
		}
		console.log(`\nactualizados ${ok} · conflictos PK ${conflictos} · backup dbo.${bak}`);

		const after = await executeQuery(
			`SELECT LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), Sector), ''))) AS Sector
			 FROM dbo.imTurnos
			 WHERE NULLIF(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), Sector), ''))), '') IS NOT NULL`,
		);
		const residualNumeric = (after || []).filter((r) => isNumericSector(r.Sector)).length;
		const residualBad = (after || []).filter((r) => isBadLetter(r.Sector, sectorSet)).length;
		console.log('residuales numéricos', residualNumeric, 'letras inválidas', residualBad);
		return {
			id,
			desc: emp.DESCRIPCION,
			applied: ok,
			conflictos,
			backup: bak,
			residualNumeric,
			residualBad,
			byVia,
		};
	});
}

async function main() {
	const empresas = await platformMysql.listarEmpresasRows('');
	let targets = [];
	if (ALL) {
		targets = empresas.filter((e) => [100, 103, 1].includes(Number(e.IDEMPRESA)));
	} else {
		const id = Number(arg('empresa', 0));
		if (!id) {
			console.error('Usá --empresa <id> o --all');
			process.exit(1);
		}
		const emp = empresas.find((e) => Number(e.IDEMPRESA) === id);
		if (!emp) throw new Error(`Empresa ${id} no encontrada`);
		targets = [emp];
	}

	const results = [];
	for (const emp of targets) {
		results.push(await migrarEmpresa(emp));
	}
	console.log('\n=== RESUMEN ===');
	console.table(results);
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
