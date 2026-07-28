/**
 * Sync FÍSICO → MySQL (Railway) de personal exportable + export plano para Excel.
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const { getTenantPool, loadEmpresaConnectionRow } = require('../config/tenantDb');
const { empresaRowHasSqlConnection } = require('../utils/empresaDbConnection');
const { getTenantId } = require('../context/tenantContext');
const { executeQuery } = require('../models/db');
const {
	PERSONAL_EXPORT_FIELDS,
	PERSONAL_SYNC_COLUMNS,
	MYSQL_IMPERSONAL_EXTRA_COLS,
	listExportFields,
	resolveExportFieldIds,
} = require('../utils/personalExportFields');

function q(name) {
	return `\`${String(name).replace(/`/g, '``')}\``;
}

function chunk(arr, size) {
	const out = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

async function mysqlQuery(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function mysqlExec(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [r] = await pool.query(sql, params);
	return r;
}

function assertAuthCentral() {
	if (!isAuthCentralEnabled()) {
		const e = new Error('MySQL auth central no está habilitado');
		e.statusCode = 503;
		throw e;
	}
}

function resolveIdEmpresa(idEmpresa) {
	const id =
		idEmpresa != null && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0
			? Number(idEmpresa)
			: getTenantId();
	if (id == null || !Number.isFinite(Number(id)) || Number(id) <= 0) {
		const e = new Error('Se requiere empresa activa');
		e.statusCode = 400;
		throw e;
	}
	return Number(id);
}

async function puedeSyncDesdeFisico(idEmpresa) {
	try {
		const emp = resolveIdEmpresa(idEmpresa);
		if (!isAuthCentralEnabled()) return false;
		const row = await loadEmpresaConnectionRow(emp);
		return empresaRowHasSqlConnection(row);
	} catch {
		return false;
	}
}

async function ensureImPersonalExportColumns() {
	assertAuthCentral();
	const existing = await mysqlQuery(
		`SELECT COLUMN_NAME AS col
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imPersonal'`,
	);
	const have = new Set(existing.map((r) => String(r.col || '').toLowerCase()));
	for (const col of MYSQL_IMPERSONAL_EXTRA_COLS) {
		if (have.has(col.name.toLowerCase())) continue;
		await mysqlExec(`ALTER TABLE ${q('imPersonal')} ADD COLUMN ${q(col.name)} ${col.ddl}`);
		have.add(col.name.toLowerCase());
	}
}

function pickSyncRow(fisicoRow, idEmpresa) {
	const out = { IdEmpresa: Number(idEmpresa) };
	for (const col of PERSONAL_SYNC_COLUMNS) {
		let v = fisicoRow[col];
		if (v === undefined) v = fisicoRow[col.toLowerCase()];
		if (Buffer.isBuffer(v)) continue;
		if (v != null && typeof v === 'object' && !(v instanceof Date)) {
			out[col] = String(v);
		} else if (v instanceof Date) {
			out[col] = v;
		} else if (typeof v === 'string') {
			out[col] = v.trim() === '' ? null : v.trim();
		} else {
			out[col] = v === undefined ? null : v;
		}
	}
	return out;
}

async function upsertPersonalLote(rows) {
	if (!rows.length) return 0;
	const colList = ['IdEmpresa', ...PERSONAL_SYNC_COLUMNS];
	const placeholders = `(${colList.map(() => '?').join(', ')})`;
	const updates = colList
		.filter((c) => c !== 'IdEmpresa' && c !== 'Valor')
		.map((c) => `${q(c)} = VALUES(${q(c)})`)
		.join(', ');
	let escritas = 0;
	for (const lote of chunk(rows, 40)) {
		const flat = [];
		for (const row of lote) {
			for (const c of colList) flat.push(row[c] === undefined ? null : row[c]);
		}
		const valuesSql = lote.map(() => placeholders).join(', ');
		const r = await mysqlExec(
			`INSERT INTO ${q('imPersonal')} (${colList.map(q).join(', ')})
       VALUES ${valuesSql}
       ON DUPLICATE KEY UPDATE ${updates}`,
			flat,
		);
		escritas += Number(r?.affectedRows) || lote.length;
	}
	return escritas;
}

async function syncSectoresDesdeFisico(idEmpresa, pool) {
	const emp = Number(idEmpresa);
	// Sectores usados por el personal
	const sectores = await pool.request().query(`
    SELECT DISTINCT s.Valor, RTRIM(LTRIM(ISNULL(s.Descripcion, ''))) AS Descripcion
    FROM dbo.imSectores s
    INNER JOIN dbo.imPersonalSectores ps ON ps.idSector = s.Valor
  `);
	const secRows = sectores.recordset || [];
	for (const s of secRows) {
		const valor = String(s.Valor || '').trim();
		if (!valor) continue;
		await mysqlExec(
			`INSERT INTO ${q('imSectores')} (IdEmpresa, Valor, Descripcion)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE Descripcion = VALUES(Descripcion)`,
			[emp, valor, String(s.Descripcion || '').trim() || valor],
		);
	}

	const asign = await pool.request().query(`
    SELECT idPersonal, idSector FROM dbo.imPersonalSectores
  `);
	const asignRows = asign.recordset || [];
	await mysqlExec(`DELETE FROM ${q('imPersonalSectores')} WHERE IdEmpresa = ?`, [emp]);
	let n = 0;
	for (const lote of chunk(asignRows, 200)) {
		const flat = [];
		const valid = [];
		for (const r of lote) {
			const idP = Number(r.idPersonal);
			const idS = String(r.idSector || '').trim();
			if (!Number.isFinite(idP) || idP <= 0 || !idS) continue;
			valid.push(r);
			flat.push(emp, idP, idS);
		}
		if (!valid.length) continue;
		const valuesSql = valid.map(() => '(?, ?, ?)').join(', ');
		await mysqlExec(
			`INSERT INTO ${q('imPersonalSectores')} (IdEmpresa, idPersonal, idSector)
       VALUES ${valuesSql}
       ON DUPLICATE KEY UPDATE idSector = VALUES(idSector)`,
			flat,
		);
		n += valid.length;
	}
	return { sectoresCatalogo: secRows.length, asignaciones: n };
}

async function syncVinculosEmpresa(idEmpresa, pool) {
	const emp = Number(idEmpresa);
	let ids = [];
	try {
		const pass = await pool.request().query(`
      SELECT ValorPersonal AS pid FROM dbo.imPassword WHERE ValorPersonal IS NOT NULL
    `);
		ids = (pass.recordset || []).map((r) => Number(r.pid)).filter((n) => Number.isFinite(n) && n > 0);
	} catch {
		/* imPassword puede no existir */
	}
	if (!ids.length) {
		const pers = await pool.request().query(`SELECT Valor AS pid FROM dbo.imPersonal`);
		ids = (pers.recordset || []).map((r) => Number(r.pid)).filter((n) => Number.isFinite(n) && n > 0);
	}
	ids = [...new Set(ids)];
	let escritas = 0;
	for (const lote of chunk(ids, 500)) {
		const flat = [];
		for (const pid of lote) flat.push(pid, emp);
		const valuesSql = lote.map(() => '(?, ?)').join(', ');
		const r = await mysqlExec(
			`INSERT INTO ${q('imPersonalEmpresas')} (IdPersonal, IdEmpresa) VALUES ${valuesSql}
       ON DUPLICATE KEY UPDATE IdEmpresa = VALUES(IdEmpresa)`,
			flat,
		);
		escritas += Number(r?.affectedRows) || lote.length;
	}
	return escritas;
}

/**
 * Copia personal (+ sectores + vínculos) del SQL físico a MySQL Railway.
 */
async function syncPersonalDesdeFisico(idEmpresa) {
	assertAuthCentral();
	const emp = resolveIdEmpresa(idEmpresa);
	const row = await loadEmpresaConnectionRow(emp);
	if (!empresaRowHasSqlConnection(row)) {
		const e = new Error(
			'Esta empresa no tiene conexión al servidor físico configurada en Super Admin',
		);
		e.statusCode = 400;
		throw e;
	}

	await ensureImPersonalExportColumns();

	const pool = await getTenantPool(emp);
	const selectCols = PERSONAL_SYNC_COLUMNS.map((c) => `[${c}]`).join(', ');
	const data = await pool.request().query(`SELECT ${selectCols} FROM dbo.imPersonal`);
	const filas = data.recordset || [];
	const syncRows = filas.map((f) => pickSyncRow(f, emp));
	const personalEscritos = await upsertPersonalLote(syncRows);
	const sec = await syncSectoresDesdeFisico(emp, pool);
	const vinculos = await syncVinculosEmpresa(emp, pool);

	return {
		personal: filas.length,
		personalEscritos,
		sectoresCatalogo: sec.sectoresCatalogo,
		sectoresAsignaciones: sec.asignaciones,
		vinculos,
	};
}

async function loadCatalogMaps() {
	const [esp, sv, cat] = await Promise.all([
		executeQuery(`SELECT Valor, Descripcion FROM dbo.imEspecialidad`).catch(() => []),
		executeQuery(`SELECT Valor, Descripcion FROM dbo.imServicios`).catch(() => []),
		executeQuery(`SELECT Valor, Descripcion FROM dbo.imCategorias`).catch(() => []),
	]);
	const mapEsp = new Map(esp.map((r) => [Number(r.Valor), String(r.Descripcion || '').trim()]));
	const mapSv = new Map(
		sv.map((r) => [String(r.Valor || '').trim(), String(r.Descripcion || '').trim()]),
	);
	const mapCat = new Map(cat.map((r) => [Number(r.Valor), String(r.Descripcion || '').trim()]));
	return { mapEsp, mapSv, mapCat };
}

async function loadSectoresPorPersonal() {
	const rows = await executeQuery(
		`SELECT ps.idPersonal, ps.idSector,
            RTRIM(LTRIM(ISNULL(s.Descripcion, ''))) AS Descripcion
     FROM dbo.imPersonalSectores ps
     LEFT JOIN dbo.imSectores s ON s.Valor = ps.idSector`,
	).catch(() => []);
	const map = new Map();
	for (const r of rows) {
		const id = Number(r.idPersonal);
		if (!Number.isFinite(id)) continue;
		const label =
			String(r.Descripcion || '').trim() || String(r.idSector || '').trim();
		if (!label) continue;
		if (!map.has(id)) map.set(id, []);
		map.get(id).push(label);
	}
	return map;
}

function formatEstado(v) {
	if (v == null || v === '') return '';
	const n = Number(v);
	if (n === 1) return 'Activo';
	if (n === 0) return 'Inactivo';
	return String(v);
}

function cellForField(fieldId, row, ctx) {
	const { mapEsp, mapSv, mapCat, sectoresMap } = ctx;
	switch (fieldId) {
		case 'valor':
			return row.Valor ?? '';
		case 'apellidoNombre':
			return row.ApellidoNombre ?? '';
		case 'tipoDocumento':
			return row.TipoDocumento ?? '';
		case 'dni':
			return row.Numero ?? '';
		case 'matricula':
			return row.Matricula ?? '';
		case 'matriculaNacional':
			return row.MatriculaNacional ?? '';
		case 'especialidad': {
			const code = row.ValorEspecialidad;
			const desc = mapEsp.get(Number(code));
			return desc || (code != null ? String(code) : '');
		}
		case 'servicio': {
			const code = String(row.ValorServicio || '').trim();
			const desc = mapSv.get(code);
			return desc || code;
		}
		case 'servicioFacturar':
			return row.ValorServicioParaFacturar ?? '';
		case 'sectores': {
			const list = sectoresMap.get(Number(row.Valor)) || [];
			return list.join(', ');
		}
		case 'telefono':
			return row.Telefono ?? '';
		case 'cuit':
			return row.CUIT ?? '';
		case 'categoria': {
			const code = row.ValorCategoria;
			const desc = mapCat.get(Number(code));
			return desc || (code != null ? String(code) : '');
		}
		case 'domicilio':
			return row.Domicilio ?? '';
		case 'estado':
			return formatEstado(row.Estado);
		case 'rol':
			return row.Rol ?? '';
		default:
			return '';
	}
}

/**
 * Lista plana para Excel. `campos` = ids del catálogo.
 */
async function listarParaExport(campos) {
	const ids = resolveExportFieldIds(campos);
	const fields = PERSONAL_EXPORT_FIELDS.filter((f) => ids.includes(f.id));
	const selectCols = [
		...new Set(
			['Valor', ...PERSONAL_SYNC_COLUMNS].filter(Boolean),
		),
	];
	const sqlCols = selectCols.map((c) => `p.[${c}]`).join(', ');
	const filas = await executeQuery(
		`SELECT ${sqlCols} FROM dbo.imPersonal p ORDER BY p.ApellidoNombre`,
	);
	const catalogs = await loadCatalogMaps();
	const sectoresMap = ids.includes('sectores')
		? await loadSectoresPorPersonal()
		: new Map();
	const ctx = { ...catalogs, sectoresMap };

	const columns = fields.map((f) => ({ id: f.id, label: f.label }));
	const rows = (filas || []).map((row) => {
		const obj = {};
		for (const f of fields) {
			obj[f.id] = cellForField(f.id, row, ctx);
		}
		return obj;
	});

	return { columns, rows };
}

module.exports = {
	listExportFields,
	puedeSyncDesdeFisico,
	ensureImPersonalExportColumns,
	syncPersonalDesdeFisico,
	listarParaExport,
	PERSONAL_SYNC_COLUMNS,
};
