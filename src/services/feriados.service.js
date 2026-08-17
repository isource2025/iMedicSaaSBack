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
const API_TIMEOUT_MS = 8000;
const SYNC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LIST_TTL_MS = 60 * 60 * 1000;

const schemaByTenant = new Map();
const syncAtByTenant = new Map();
const syncInflightByTenant = new Map();
const listCacheByTenant = new Map();

const DATE_NAME_RE = /fecha|feriado|^dia$|^date$/i;
const DESC_NAME_RE = /descrip|motivo|nombre|observ/i;

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
			`SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
			        COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') AS IS_IDENTITY
			 FROM INFORMATION_SCHEMA.COLUMNS c
			 WHERE c.TABLE_SCHEMA = 'dbo' AND LOWER(c.TABLE_NAME) = 'imferiados'
			 ORDER BY c.ORDINAL_POSITION`,
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

	const norm = (c) => String(c.COLUMN_NAME || '').replace(/\s+/g, '');
	const fechaCol =
		cols.find((c) => /fecha/i.test(norm(c))) ||
		cols.find((c) => Number(c.IS_IDENTITY) !== 1 && DATE_NAME_RE.test(norm(c)));
	const descCol = cols.find(
		(c) => c !== fechaCol && DESC_NAME_RE.test(norm(c)),
	);
	if (!fechaCol) {
		console.warn(
			'[feriados] imFeriados existe pero no hay columna de fecha. Columnas:',
			cols.map((c) => c.COLUMN_NAME).join(', '),
		);
		const miss = { exists: false };
		schemaByTenant.set(key, miss);
		return miss;
	}

	const extras = cols.filter((c) => {
		if (c === fechaCol || c === descCol) return false;
		if (Number(c.IS_IDENTITY) === 1) return false;
		if (String(c.IS_NULLABLE).toUpperCase() === 'YES') return false;
		if (c.COLUMN_DEFAULT != null && String(c.COLUMN_DEFAULT).trim() !== '') return false;
		return true;
	});

	const schema = {
		exists: true,
		fecha: String(fechaCol.COLUMN_NAME),
		fechaType: String(fechaCol.DATA_TYPE || 'int'),
		desc: descCol ? String(descCol.COLUMN_NAME) : null,
		descType: descCol ? String(descCol.DATA_TYPE || 'varchar') : null,
		extras: extras.map((c) => ({
			name: String(c.COLUMN_NAME),
			type: String(c.DATA_TYPE || 'int'),
		})),
	};
	console.log(
		'[feriados] esquema',
		schema.fecha,
		schema.fechaType,
		schema.desc || '(sin texto)',
		schema.extras.map((e) => e.name).join(',') || 'sin extras',
	);
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

function defaultExtraValue(type) {
	const t = String(type || '').toLowerCase();
	if (t.includes('char') || t === 'text' || t === 'ntext') return '';
	if (t === 'bit') return 0;
	if (isDateType(t)) return '1800-12-28';
	return 0;
}

function sqlParamType(dataType) {
	if (isIntType(dataType)) return 'Int';
	return undefined;
}

async function insertarFeriado(schema, iso, nombre) {
	const fechaVal = valorFechaParaDb(iso, schema.fechaType);
	const texto = String(nombre || 'Feriado').slice(0, 200);
	const cols = [bracket(schema.fecha)];
	const params = [{ value: fechaVal, type: sqlParamType(schema.fechaType) }];
	if (schema.desc) {
		cols.push(bracket(schema.desc));
		params.push({ value: texto });
	}
	for (const extra of schema.extras || []) {
		cols.push(bracket(extra.name));
		params.push({
			value: defaultExtraValue(extra.type),
			type: sqlParamType(extra.type),
		});
	}
	const placeholders = params.map((_, i) => `@p${i}`).join(', ');
	await executeQuery(
		`INSERT INTO dbo.imFeriados (${cols.join(', ')}) VALUES (${placeholders})`,
		params,
	);
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
	const packs = await Promise.all(
		years.map((y) =>
			fetchFeriadosAnio(y).catch((err) => {
				console.warn('[feriados] API año', y, err?.message || err);
				return [];
			}),
		),
	);
	const apiRows = packs.flat();
	if (!apiRows.length) return { ok: false, reason: 'api' };

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
	const missing = apiRows.filter((r) => !existentes.has(r.fecha)).length;
	return { ok: true, inserted, updated, missing };
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
				return { skipped: true, reason: 'no-table' };
			}
			const result = await syncDesdeApi();
			if (result.ok && Number(result.missing || 0) === 0) {
				syncAtByTenant.set(key, Date.now());
			}
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

	if (items.length) {
		listCacheByTenant.set(key, {
			desde,
			hasta,
			items,
			expires: Date.now() + LIST_TTL_MS,
		});
	}
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
