/**
 * Feriados nacionales en dbo.imFeriados (Clarion).
 * Carga perezosa desde ArgentinaDatos: año actual + próximo, 1 sync/mes por hospital.
 */
const { executeQuery } = require('../models/db');
const { getTenantId, runWithTenant } = require('../context/tenantContext');
const {
	convertirFechaAClarion,
	clarionAIsoCalendario,
	fechaCalendarioArgentina,
} = require('../utils/dateUtils');

const API_BASE = 'https://api.argentinadatos.com/v1/feriados';
const API_TIMEOUT_MS = 3000;
const SYNC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_TTL_MS = 60 * 60 * 1000;

const schemaByTenant = new Map();
const syncAtByTenant = new Map();
const syncInflightByTenant = new Map();
const listCacheByTenant = new Map();

const DATE_NAME_RE = /^(fecha|fechaferiado|dia|date)$/i;
const DESC_NAME_RE = /^(descripcion|descripción|motivo|nombre|observacion|observaciones|detalle)$/i;

function tenantKey() {
	const id = getTenantId();
	return id != null ? String(id) : '_default';
}

function aniosAgenda() {
	const y = Number(String(fechaCalendarioArgentina()).slice(0, 4));
	const year = Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear();
	return [year, year + 1];
}

function isIntType(dataType) {
	const t = String(dataType || '').toLowerCase();
	return t === 'int' || t === 'smallint' || t === 'bigint' || t === 'numeric' || t === 'decimal';
}

function isDateType(dataType) {
	const t = String(dataType || '').toLowerCase();
	return t === 'date' || t === 'datetime' || t === 'datetime2' || t === 'smalldatetime';
}

function bracket(name) {
	return `[${String(name).replace(/]/g, '')}]`;
}

function isoFromDbValue(value, dataType) {
	if (value == null || value === '') return null;
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		const y = value.getFullYear();
		const m = String(value.getMonth() + 1).padStart(2, '0');
		const d = String(value.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	const s = String(value).trim();
	const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
	if (m) return m[1];
	if (isIntType(dataType) || Number.isFinite(Number(s))) {
		return clarionAIsoCalendario(Number(s));
	}
	return null;
}

function valorFechaParaDb(iso, dataType) {
	const day = String(iso).slice(0, 10);
	if (isIntType(dataType)) return convertirFechaAClarion(day);
	return day;
}

async function descubrirSchema() {
	const key = tenantKey();
	if (schemaByTenant.has(key)) return schemaByTenant.get(key);

	let cols;
	try {
		cols = await executeQuery(
			`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
			 FROM INFORMATION_SCHEMA.COLUMNS
			 WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'imFeriados'
			 ORDER BY ORDINAL_POSITION`,
		);
	} catch (err) {
		console.warn('[feriados] no se pudo leer esquema:', err?.message || err);
		const miss = { exists: false };
		schemaByTenant.set(key, miss);
		return miss;
	}

	if (!cols?.length) {
		const miss = { exists: false };
		schemaByTenant.set(key, miss);
		return miss;
	}

	const fechaCol = cols.find((c) => DATE_NAME_RE.test(String(c.COLUMN_NAME || '').replace(/\s+/g, '')));
	const descCol = cols.find((c) => DESC_NAME_RE.test(String(c.COLUMN_NAME || '').replace(/\s+/g, '')));
	if (!fechaCol) {
		console.warn('[feriados] imFeriados existe pero no hay columna de fecha reconocible');
		const miss = { exists: false };
		schemaByTenant.set(key, miss);
		return miss;
	}

	const schema = {
		exists: true,
		fecha: String(fechaCol.COLUMN_NAME),
		fechaType: String(fechaCol.DATA_TYPE || 'int'),
		desc: descCol ? String(descCol.COLUMN_NAME) : null,
		descType: descCol ? String(descCol.DATA_TYPE || 'varchar') : null,
	};
	schemaByTenant.set(key, schema);
	return schema;
}

function invalidarListCache(key) {
	listCacheByTenant.delete(key || tenantKey());
}

async function fetchFeriadosAnio(anio) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
	try {
		const resp = await fetch(`${API_BASE}/${anio}`, { signal: ctrl.signal });
		if (!resp.ok) {
			throw new Error(`ArgentinaDatos HTTP ${resp.status}`);
		}
		const data = await resp.json();
		if (!Array.isArray(data)) return [];
		return data
			.map((row) => {
				const fecha = String(row?.fecha || '').slice(0, 10);
				if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
				const nombre = String(row?.nombre || row?.motivo || '').trim() || 'Feriado';
				return { fecha, nombre };
			})
			.filter(Boolean);
	} finally {
		clearTimeout(timer);
	}
}

async function fechasExistentes(schema, desdeIso, hastaIso) {
	const fechaCol = bracket(schema.fecha);
	const descCol = schema.desc ? bracket(schema.desc) : null;
	const desde = valorFechaParaDb(desdeIso, schema.fechaType);
	const hasta = valorFechaParaDb(hastaIso, schema.fechaType);
	const selectDesc = descCol ? `, ${descCol} AS Nombre` : `, CAST(NULL AS VARCHAR(200)) AS Nombre`;
	const rows = await executeQuery(
		`SELECT ${fechaCol} AS Fecha${selectDesc}
		 FROM dbo.imFeriados
		 WHERE ${fechaCol} >= @p0 AND ${fechaCol} <= @p1`,
		[
			{ value: desde, type: isIntType(schema.fechaType) ? 'Int' : undefined },
			{ value: hasta, type: isIntType(schema.fechaType) ? 'Int' : undefined },
		],
	);
	const map = new Map();
	for (const r of rows || []) {
		const iso = isoFromDbValue(r.Fecha, schema.fechaType);
		if (!iso) continue;
		map.set(iso, String(r.Nombre || '').trim());
	}
	return map;
}

async function insertarFeriado(schema, iso, nombre) {
	const fechaCol = bracket(schema.fecha);
	const fechaVal = valorFechaParaDb(iso, schema.fechaType);
	const fechaType = isIntType(schema.fechaType) ? 'Int' : undefined;
	const texto = String(nombre || 'Feriado').slice(0, 200);
	if (schema.desc) {
		await executeQuery(
			`INSERT INTO dbo.imFeriados (${fechaCol}, ${bracket(schema.desc)}) VALUES (@p0, @p1)`,
			[
				{ value: fechaVal, type: fechaType },
				{ value: texto },
			],
		);
		return;
	}
	await executeQuery(`INSERT INTO dbo.imFeriados (${fechaCol}) VALUES (@p0)`, [
		{ value: fechaVal, type: fechaType },
	]);
}

async function completarDescripcion(schema, iso, nombre) {
	if (!schema.desc) return;
	const texto = String(nombre || '').trim().slice(0, 200);
	if (!texto) return;
	await executeQuery(
		`UPDATE dbo.imFeriados
		 SET ${bracket(schema.desc)} = @p1
		 WHERE ${bracket(schema.fecha)} = @p0
		   AND ( ${bracket(schema.desc)} IS NULL OR LTRIM(RTRIM(${bracket(schema.desc)})) = '' )`,
		[
			{
				value: valorFechaParaDb(iso, schema.fechaType),
				type: isIntType(schema.fechaType) ? 'Int' : undefined,
			},
			{ value: texto },
		],
	);
}

async function syncDesdeApi() {
	const schema = await descubrirSchema();
	if (!schema.exists) return { ok: false, reason: 'no-table' };

	const years = aniosAgenda();
	let apiRows = [];
	try {
		const packs = await Promise.all(years.map((y) => fetchFeriadosAnio(y)));
		apiRows = packs.flat();
	} catch (err) {
		console.warn('[feriados] API ArgentinaDatos:', err?.message || err);
		return { ok: false, reason: 'api' };
	}

	if (!apiRows.length) return { ok: true, inserted: 0, updated: 0 };

	const desde = `${years[0]}-01-01`;
	const hasta = `${years[years.length - 1]}-12-31`;
	let existentes;
	try {
		existentes = await fechasExistentes(schema, desde, hasta);
	} catch (err) {
		console.warn('[feriados] lectura imFeriados:', err?.message || err);
		return { ok: false, reason: 'sql-read' };
	}

	let inserted = 0;
	let updated = 0;
	for (const row of apiRows) {
		if (!existentes.has(row.fecha)) {
			try {
				await insertarFeriado(schema, row.fecha, row.nombre);
				existentes.set(row.fecha, row.nombre);
				inserted += 1;
			} catch (err) {
				console.warn('[feriados] INSERT', row.fecha, err?.message || err);
			}
			continue;
		}
		if (!existentes.get(row.fecha)) {
			try {
				await completarDescripcion(schema, row.fecha, row.nombre);
				existentes.set(row.fecha, row.nombre);
				updated += 1;
			} catch (err) {
				console.warn('[feriados] UPDATE desc', row.fecha, err?.message || err);
			}
		}
	}

	invalidarListCache();
	return { ok: true, inserted, updated };
}

async function ensureFeriados() {
	const key = tenantKey();
	const last = syncAtByTenant.get(key) || 0;
	if (Date.now() - last < SYNC_TTL_MS) return { skipped: true };

	if (syncInflightByTenant.has(key)) return syncInflightByTenant.get(key);

	const job = (async () => {
		try {
			const schema = await descubrirSchema();
			if (!schema.exists) {
				syncAtByTenant.set(key, Date.now());
				return { skipped: true, reason: 'no-table' };
			}
			const result = await syncDesdeApi();
			if (result.ok) syncAtByTenant.set(key, Date.now());
			return result;
		} catch (err) {
			console.warn('[feriados] ensure:', err?.message || err);
			return { ok: false, reason: 'error' };
		} finally {
			syncInflightByTenant.delete(key);
		}
	})();

	syncInflightByTenant.set(key, job);
	return job;
}

function scheduleEnsure(idEmpresa) {
	const id = idEmpresa != null ? Number(idEmpresa) : Number(getTenantId());
	if (!Number.isFinite(id) || id <= 0) return;
	setImmediate(() => {
		runWithTenant(id, () => ensureFeriados()).catch((err) => {
			console.warn('[feriados] schedule:', err?.message || err);
		});
	});
}

async function listarEnRango(desdeIso, hastaIso, opts = {}) {
	const schema = await descubrirSchema();
	if (!schema.exists) return [];

	const desde = String(desdeIso || '').slice(0, 10);
	const hasta = String(hastaIso || '').slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return [];

	const key = tenantKey();
	const cache = listCacheByTenant.get(key);
	if (!opts.skipCache && cache && cache.expires > Date.now() && cache.desde <= desde && cache.hasta >= hasta) {
		return cache.items.filter((f) => f.fecha >= desde && f.fecha <= hasta);
	}

	let map;
	try {
		map = await fechasExistentes(schema, desde, hasta);
	} catch (err) {
		console.warn('[feriados] listar:', err?.message || err);
		return [];
	}

	const items = [...map.entries()]
		.map(([fecha, nombre]) => ({ fecha, nombre: nombre || 'Feriado' }))
		.sort((a, b) => a.fecha.localeCompare(b.fecha));

	listCacheByTenant.set(key, {
		desde,
		hasta,
		items,
		expires: Date.now() + LIST_TTL_MS,
	});
	return items;
}

async function listarEnRangoConEnsure(desdeIso, hastaIso) {
	let items = await listarEnRango(desdeIso, hastaIso);
	if (!items.length) {
		await ensureFeriados();
		items = await listarEnRango(desdeIso, hastaIso, { skipCache: true });
		return items;
	}
	scheduleEnsure(getTenantId());
	return items;
}

function feriadoEnFecha(fechaIso, feriados) {
	const key = String(fechaIso || '').slice(0, 10);
	if (!key) return null;
	return (feriados || []).find((f) => f.fecha === key) || null;
}

module.exports = {
	ensureFeriados,
	scheduleEnsure,
	listarEnRango,
	listarEnRangoConEnsure,
	feriadoEnFecha,
};
