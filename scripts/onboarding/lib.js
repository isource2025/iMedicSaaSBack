/**
 * Utilidades compartidas para migración onboarding (origen legado → iMedic).
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

const SECTOR_OVERRIDES = (() => {
	try {
		const raw = JSON.parse(
			fs.readFileSync(path.join(__dirname, 'sector_map.default.json'), 'utf8'),
		);
		const { _nota, ...rest } = raw;
		return rest;
	} catch {
		return {};
	}
})();

function sqlConfig(dbName) {
	return {
		server: process.env.DB_SERVER || 'localhost',
		port: Number(process.env.DB_PORT || 1433),
		database: dbName,
		user: process.env.DB_USER || 'sa',
		password: process.env.DB_PASSWORD,
		options: {
			encrypt: false,
			trustServerCertificate: true,
			instanceName: process.env.DB_INSTANCE || undefined,
		},
		requestTimeout: 300000,
		connectionTimeout: 30000,
	};
}

function truncStr(v, max) {
	if (v == null) return null;
	const s = String(v).trim();
	return s === '' ? null : s.slice(0, max);
}

function normalizeSectorName(raw) {
	if (raw == null) return null;
	const s = String(raw).trim();
	return s === '' ? null : s;
}

function normalizeHabitacionCode(raw) {
	if (raw == null) return null;
	const s = String(raw).trim();
	if (!s || s === '.' || s === '-') return null;
	return s.slice(0, 4);
}

/** @deprecated Solo para overrides puntuales; el catálogo oficial viene de dbo.Sector */
function cleanSectorCode(raw) {
	const name = normalizeSectorName(raw);
	if (!name || name === '.' || name === '-') return null;
	return name.slice(0, 4);
}

function inferAmbInt(code) {
	const c = String(code || '').toUpperCase();
	if (c === 'AMBU' || c.startsWith('AMB')) return 'A';
	return 'I';
}

function resolveSectorEntry(code) {
	const name = normalizeSectorName(code);
	if (!name) return null;
	const override = SECTOR_OVERRIDES[name] || SECTOR_OVERRIDES[name.toUpperCase()];
	if (override) {
		return {
			nombre: name,
			valor: truncStr(override.valor || name, 4),
			descripcion: truncStr(override.descripcion || name, 40),
			ambInt: override.ambInt || inferAmbInt(name),
		};
	}
	return { nombre: name, valor: name.slice(0, 4), descripcion: name, ambInt: inferAmbInt(name) };
}

/** Catálogo oficial: dbo.Sector (nombre exacto → imSectores.Valor) */
async function loadSectorCatalog(sourcePool) {
	const rows = await sourcePool.request().query(`
    SELECT
      RTRIM(LTRIM(CAST(SECTOR AS VARCHAR(10)))) AS SectorNombre,
      RTRIM(LTRIM(CAST(DESCRIPCION AS VARCHAR(40)))) AS Descripcion
    FROM dbo.Sector
    WHERE LTRIM(RTRIM(CAST(SECTOR AS VARCHAR(10)))) <> ''
  `);
	const catalog = new Map();
	for (const r of rows.recordset || []) {
		const nombre = normalizeSectorName(r.SectorNombre);
		if (!nombre) continue;
		const override = SECTOR_OVERRIDES[nombre] || SECTOR_OVERRIDES[nombre.toUpperCase()];
		const entry = override
			? {
					nombre,
					valor: truncStr(override.valor || nombre, 4),
					descripcion: truncStr(override.descripcion || r.Descripcion, 40) || nombre,
					ambInt: override.ambInt || inferAmbInt(nombre),
				}
			: {
					nombre,
					valor: nombre.slice(0, 4),
					descripcion: truncStr(r.Descripcion, 40) || nombre,
					ambInt: inferAmbInt(nombre),
				};
		catalog.set(nombre, entry);
	}
	return catalog;
}

function resolveSectorFromCatalog(catalog, rawCode) {
	const nombre = normalizeSectorName(rawCode);
	if (!nombre || !catalog?.has(nombre)) return null;
	return catalog.get(nombre).valor;
}

/** Camas: dbo.Sectores.HABITACION donde Sectores.SECTOR = Sector.SECTOR (nombre exacto) */
async function loadBedCatalog(sourcePool, sectorCatalog) {
	const rows = await sourcePool.request().query(`
    SELECT DISTINCT
      RTRIM(LTRIM(CAST(sc.SECTOR AS VARCHAR(10)))) AS SectorNombre,
      RTRIM(LTRIM(CAST(sc.HABITACION AS VARCHAR(10)))) AS HabCode
    FROM dbo.Sectores sc
    WHERE LTRIM(RTRIM(sc.HABITACION)) <> ''
      AND LTRIM(RTRIM(sc.HABITACION)) <> '.'
  `);
	const beds = [];
	const seen = new Set();
	for (const r of rows.recordset || []) {
		const sectorNombre = normalizeSectorName(r.SectorNombre);
		const hab = normalizeHabitacionCode(r.HabCode);
		if (!sectorNombre || !hab || !sectorCatalog.has(sectorNombre)) continue;
		const sectorVal = sectorCatalog.get(sectorNombre).valor;
		const key = `${sectorVal}|${hab}`;
		if (seen.has(key)) continue;
		seen.add(key);
		beds.push({ sectorNombre, sectorVal, habCode: hab });
	}
	return beds;
}

/**
 * Cierra internaciones abiertas cuyo ingreso supera N meses respecto a una fecha de referencia.
 * Egreso: día siguiente al ingreso (convención Clarion compatible con el resto del sistema).
 */
async function closeStaleInternaciones(targetPool, { referenceDate = null, months = 1, dryRun = false } = {}) {
	const ref =
		referenceDate ||
		process.env.ONBOARDING_REFERENCE_DATE ||
		new Date().toISOString().slice(0, 10);

	if (dryRun) {
		const count = await targetPool
			.request()
			.input('ref', sql.Date, ref)
			.input('months', sql.Int, months)
			.query(`
        SELECT COUNT(*) AS c FROM dbo.imVisita
        WHERE (FECHAEGRESO IS NULL OR FECHAEGRESO = 0)
          AND CAST(FECHAADMISIONS AS DATE) < DATEADD(month, -@months, @ref)
      `);
		return { closed: 0, wouldClose: count.recordset[0]?.c || 0, referenceDate: ref };
	}

	const upd = await targetPool
		.request()
		.input('ref', sql.Date, ref)
		.input('months', sql.Int, months)
		.query(`
      UPDATE dbo.imVisita
      SET
        FECHAEGRESO = DATEDIFF(day, '1800-12-28', DATEADD(day, 1, CAST(FECHAADMISIONS AS DATE))),
        HORAEGRESO = DATEPART(hour, FECHAADMISIONS) * 360000
                   + DATEPART(minute, FECHAADMISIONS) * 6000
                   + DATEPART(second, FECHAADMISIONS) * 100 + 1
      WHERE (FECHAEGRESO IS NULL OR FECHAEGRESO = 0)
        AND CAST(FECHAADMISIONS AS DATE) < DATEADD(month, -@months, @ref)
    `);

	await targetPool.request().query(`
    UPDATE dbo.imHabitacionCamas SET ValorEstadoCama='U', NumeroVisita=0
  `);

	const occ = await targetPool
		.request()
		.input('ref', sql.Date, ref)
		.input('months', sql.Int, months)
		.query(`
      UPDATE hc SET hc.NumeroVisita = v.NUMEROVISITA, hc.ValorEstadoCama = 'O'
      FROM dbo.imHabitacionCamas hc
      INNER JOIN dbo.imVisita v
        ON v.VALORSECTOR = hc.ValorSector
       AND v.VALORHABITACIONCAMA = hc.ValorHabitacionCama
      WHERE (v.FECHAEGRESO IS NULL OR v.FECHAEGRESO = 0)
        AND CAST(v.FECHAADMISIONS AS DATE) >= DATEADD(month, -@months, @ref)
        AND v.VALORHABITACIONCAMA IS NOT NULL
        AND LTRIM(RTRIM(v.VALORHABITACIONCAMA)) <> ''
    `);

	return {
		closed: upd.rowsAffected[0] || 0,
		bedsOccupied: occ.rowsAffected[0] || 0,
		referenceDate: ref,
	};
}

function clarionToDateTime(fechaClarion, horaClarion) {
	if (fechaClarion == null || fechaClarion <= 0) return new Date();
	const base = Date.UTC(1800, 11, 28);
	const ms = base + Number(fechaClarion) * 86400000;
	const d = new Date(ms);
	if (horaClarion != null && horaClarion > 0) {
		const cs = Number(horaClarion);
		d.setUTCHours(Math.floor(cs / 360000), Math.floor((cs % 360000) / 6000), Math.floor((cs % 6000) / 100), 0);
	}
	return d;
}

function parseMatricula(v) {
	if (v == null) return null;
	const n = parseInt(String(v).replace(/\D/g, ''), 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function parseArgs(argv, defaults = {}) {
	const out = {
		sourceDb: process.env.SOURCE_DB_NAME || '',
		targetDb: process.env.IMEDIC_TARGET_DB || '',
		dryRun: false,
		phase: 'all',
		adminUser: process.env.ONBOARDING_ADMIN_USER || 'admin',
		adminPass: process.env.ONBOARDING_ADMIN_PASS || 'Admin2026!',
		...defaults,
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') out.dryRun = true;
		else if (a === '--source-db') out.sourceDb = argv[++i];
		else if (a === '--target-db') out.targetDb = argv[++i];
		else if (a === '--phase') out.phase = String(argv[++i] || 'all').toLowerCase();
		else if (a.startsWith('--phase=')) out.phase = String(a.split('=')[1] || 'all').toLowerCase();
		else if (a === '--admin-user') out.adminUser = argv[++i];
		else if (a.startsWith('--admin-user=')) out.adminUser = a.split('=')[1];
		else if (a === '--admin-pass') out.adminPass = argv[++i];
		else if (a.startsWith('--admin-pass=')) out.adminPass = a.split('=')[1];
	}
	return out;
}

module.exports = {
	SECTOR_OVERRIDES,
	sqlConfig,
	truncStr,
	normalizeSectorName,
	normalizeHabitacionCode,
	cleanSectorCode,
	inferAmbInt,
	resolveSectorEntry,
	loadSectorCatalog,
	resolveSectorFromCatalog,
	loadBedCatalog,
	closeStaleInternaciones,
	clarionToDateTime,
	parseMatricula,
	parseArgs,
};
