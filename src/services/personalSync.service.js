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
const {
	isTenantEmpresa,
	canSyncPasswordRowToTenant,
	canSyncPersonalRowToTenant,
	isPlatformValorPersonal,
} = require('../config/tenantIdentity');
const { permisosDeRol, modulosVisibles } = require('../utils/permisos');

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
	if (!isTenantEmpresa(idEmpresa)) {
		throw Object.assign(new Error('Sync físico solo permite IdEmpresa de tenant (>0)'), {
			statusCode: 400,
		});
	}
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

/** Normaliza valores para comparar físico vs MySQL (delta real). */
function normCmp(v) {
	if (v === undefined || v === null) return '';
	if (v instanceof Date) return v.toISOString();
	if (Buffer.isBuffer(v)) return '';
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
	if (typeof v === 'boolean') return v ? '1' : '0';
	return String(v).trim();
}

function fingerprint(row, cols) {
	return cols.map((c) => `${c}=${normCmp(row[c])}`).join('\n');
}

const COL_LABEL = Object.fromEntries(
	PERSONAL_EXPORT_FIELDS.filter((f) => f.column).map((f) => [f.column, f.label]),
);

const PW_SKIP_RE = /password|hash|clave|salt/i;

const PW_LABEL = {
	NombreRed: 'Usuario de red',
	Grupo: 'Grupo',
	CodOperador: 'Código operador',
	Email: 'Email',
	Mail: 'Email',
	Estado: 'Estado',
	Habilitado: 'Habilitado',
	Activo: 'Activo',
};

function displayVal(v) {
	const s = normCmp(v);
	if (!s) return '—';
	return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function nombrePersona(row) {
	const n = String(row?.ApellidoNombre || '').trim();
	return n || null;
}

function diffRows(prev, next, cols, labelOf) {
	const out = [];
	for (const c of cols) {
		const low = String(c).toLowerCase();
		if (low === 'valor' || low === 'idempresa' || low === 'valorpersonal') continue;
		if (PW_SKIP_RE.test(low)) continue;
		const a = displayVal(prev?.[c]);
		const b = displayVal(next?.[c]);
		if (a === b) continue;
		out.push({
			campo: (typeof labelOf === 'function' ? labelOf(c) : null) || COL_LABEL[c] || c,
			de: a,
			a: b,
		});
	}
	return out;
}

/**
 * Escribe solo personal nuevo o modificado. Evita re-contar 100% en cada clic.
 */
async function syncPersonalDelta(emp, syncRows) {
	const colList = ['IdEmpresa', ...PERSONAL_SYNC_COLUMNS];
	const existing = await mysqlQuery(
		`SELECT ${colList.map(q).join(', ')} FROM ${q('imPersonal')} WHERE IdEmpresa = ?`,
		[emp],
	);
	const byId = new Map();
	for (const r of existing) {
		const id = Number(r.Valor);
		if (Number.isFinite(id)) byId.set(id, r);
	}

	let nuevos = 0;
	let actualizados = 0;
	let sinCambio = 0;
	const toWrite = [];
	const detalle = [];

	for (const row of syncRows) {
		const id = Number(row.Valor);
		if (!canSyncPersonalRowToTenant(emp, row)) {
			sinCambio += 1;
			continue;
		}
		const prev = byId.get(id);
		const nombre = nombrePersona(row) || nombrePersona(prev) || `ID ${id}`;
		if (!prev) {
			nuevos += 1;
			toWrite.push(row);
			detalle.push({
				valor: id,
				nombre,
				accion: 'alta',
				campos: [],
			});
			continue;
		}
		if (fingerprint(row, PERSONAL_SYNC_COLUMNS) !== fingerprint(prev, PERSONAL_SYNC_COLUMNS)) {
			actualizados += 1;
			toWrite.push(row);
			detalle.push({
				valor: id,
				nombre,
				accion: 'actualizacion',
				campos: diffRows(prev, row, PERSONAL_SYNC_COLUMNS),
			});
		} else {
			sinCambio += 1;
		}
	}

	if (toWrite.length) {
		const placeholders = `(${colList.map(() => '?').join(', ')})`;
		const updates = colList
			.filter((c) => c !== 'IdEmpresa' && c !== 'Valor')
			.map((c) => `${q(c)} = VALUES(${q(c)})`)
			.join(', ');
		for (const lote of chunk(toWrite, 40)) {
			const flat = [];
			for (const row of lote) {
				for (const c of colList) flat.push(row[c] === undefined ? null : row[c]);
			}
			const valuesSql = lote.map(() => placeholders).join(', ');
			await mysqlExec(
				`INSERT INTO ${q('imPersonal')} (${colList.map(q).join(', ')})
         VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE ${updates}`,
				flat,
			);
		}
	}

	return {
		total: syncRows.length,
		nuevos,
		actualizados,
		sinCambio,
		detalle,
		// Cantidad que “cambiaron” (para UI: 0 si ya estaba al día)
		cambios: nuevos + actualizados,
	};
}

function emptyCatalogSync() {
	return {
		catalogo: 0,
		catalogoCambios: 0,
		detalleCatalogo: [],
		asignaciones: 0,
		asignacionesTotal: 0,
		detalleAsignaciones: [],
	};
}

async function queryFisicoRecordset(pool, sql) {
	const r = await pool.request().query(sql);
	return r.recordset || [];
}

function mapNombreCatalogo(rows) {
	return new Map(
		(rows || []).map((s) => {
			const valor = String(rowField(s, 'Valor') || '').trim();
			const desc = String(rowField(s, 'Descripcion') || '').trim() || valor;
			return [valor, desc];
		}),
	);
}

/**
 * Upsert catálogo físico → MySQL (Valor + Descripcion, AmbInt / ValorServicio si existen).
 */
async function upsertCatalogoMysql(emp, mysqlTable, fisicoRows, { ambInt = false, valorServicio = false } = {}) {
	const mysqlCols = await getMysqlColumnNames(mysqlTable);
	const writeAmb = ambInt && mysqlCols.has('ambint');
	const writeVs = valorServicio && mysqlCols.has('valorservicio');
	const selectCols = ['Valor', 'Descripcion'];
	if (writeAmb) selectCols.push('AmbInt');
	if (writeVs) selectCols.push('ValorServicio');
	const existing = await mysqlQuery(
		`SELECT ${selectCols.join(', ')} FROM ${q(mysqlTable)} WHERE IdEmpresa = ?`,
		[emp],
	);
	const byValor = new Map(
		(existing || []).map((r) => [
			String(rowField(r, 'Valor') || '').trim(),
			{
				desc: normCmp(rowField(r, 'Descripcion')),
				amb: writeAmb ? normCmp(rowField(r, 'AmbInt')) : '',
				vs: writeVs ? normCmp(rowField(r, 'ValorServicio')) : '',
			},
		]),
	);

	let cambios = 0;
	const detalleCatalogo = [];
	for (const s of fisicoRows || []) {
		const valor = String(rowField(s, 'Valor') || '').trim();
		if (!valor) continue;
		const desc = String(rowField(s, 'Descripcion') || '').trim() || valor;
		const amb = writeAmb ? String(rowField(s, 'AmbInt') || '').trim() : '';
		const vs = writeVs ? String(rowField(s, 'ValorServicio') || '').trim() : '';
		const prev = byValor.get(valor);
		const descChanged = !prev || prev.desc !== normCmp(desc);
		const ambChanged = writeAmb && amb !== '' && (!prev || prev.amb !== normCmp(amb));
		const vsChanged = writeVs && (!prev || prev.vs !== normCmp(vs));
		if (!descChanged && !ambChanged && !vsChanged) continue;
		cambios += 1;
		detalleCatalogo.push({
			valor,
			descripcion: desc,
			accion: prev === undefined ? 'alta' : 'actualizacion',
			de: prev === undefined ? '—' : displayVal(prev.desc),
		});
		const cols = ['IdEmpresa', 'Valor', 'Descripcion'];
		const vals = [emp, valor, desc];
		const updates = ['Descripcion = VALUES(Descripcion)'];
		if (writeAmb && (amb || prev === undefined)) {
			cols.push('AmbInt');
			vals.push(amb || 'A');
			updates.push('AmbInt = VALUES(AmbInt)');
		}
		if (writeVs) {
			cols.push('ValorServicio');
			vals.push(vs);
			updates.push('ValorServicio = VALUES(ValorServicio)');
		}
		await mysqlExec(
			`INSERT INTO ${q(mysqlTable)} (${cols.join(', ')})
       VALUES (${cols.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
			vals,
		);
	}
	return { catalogo: (fisicoRows || []).length, catalogoCambios: cambios, detalleCatalogo };
}

function rowField(row, ...names) {
	if (!row) return undefined;
	const lower = {};
	for (const [k, v] of Object.entries(row)) lower[String(k).toLowerCase()] = v;
	for (const n of names) {
		const v = Object.prototype.hasOwnProperty.call(row, n)
			? row[n]
			: lower[String(n).toLowerCase()];
		if (v !== undefined && v !== null) return v;
	}
	return undefined;
}

function parseAsignFisico(rows, idItemField) {
	const asignFisico = [];
	const setFisico = new Set();
	for (const r of rows || []) {
		const idP = Number(rowField(r, 'idPersonal'));
		const idS = String(rowField(r, idItemField) || '').trim();
		if (!Number.isFinite(idP) || idP <= 0 || !idS) continue;
		const key = `${idP}\t${idS}`;
		if (setFisico.has(key)) continue;
		setFisico.add(key);
		asignFisico.push({ idP, idS });
	}
	return { asignFisico, setFisico };
}

function setsIguales(a, b) {
	if (a.size !== b.size) return false;
	for (const k of a) if (!b.has(k)) return false;
	return true;
}

function diffAsignaciones(setFisico, setNube, labelById) {
	const byUser = new Map();
	const touch = (idP, accion, idS) => {
		if (!byUser.has(idP)) byUser.set(idP, { valor: idP, agregados: [], quitados: [] });
		const label = (labelById && labelById.get(idS)) || idS;
		if (accion === 'agregado') byUser.get(idP).agregados.push(label);
		else byUser.get(idP).quitados.push(label);
	};
	let onlyFisico = 0;
	let onlyNube = 0;
	for (const k of setFisico) {
		if (setNube.has(k)) continue;
		onlyFisico += 1;
		const [idP, idS] = k.split('\t');
		touch(Number(idP), 'agregado', idS);
	}
	for (const k of setNube) {
		if (setFisico.has(k)) continue;
		onlyNube += 1;
		const [idP, idS] = k.split('\t');
		touch(Number(idP), 'quitado', idS);
	}
	return {
		asignaciones: onlyFisico + onlyNube,
		detalleAsignaciones: [...byUser.values()],
	};
}

/**
 * Reemplaza asignaciones de la empresa en MySQL si el set físico difiere.
 * Si `asignRows` es null, no toca las asignaciones (tabla física ausente).
 */
async function syncAsignacionesMysql(emp, { mysqlTable, idItemCol, asignRows, labelById }) {
	if (asignRows == null) {
		return { asignaciones: 0, asignacionesTotal: 0, detalleAsignaciones: [] };
	}
	const { asignFisico, setFisico } = parseAsignFisico(asignRows, idItemCol);
	const existingAsign = await mysqlQuery(
		`SELECT idPersonal, ${q(idItemCol)} AS idItem FROM ${q(mysqlTable)} WHERE IdEmpresa = ?`,
		[emp],
	);
	const setNube = new Set(
		(existingAsign || []).map(
			(r) => `${Number(r.idPersonal)}\t${String(r.idItem || '').trim()}`,
		),
	);
	if (setsIguales(setFisico, setNube)) {
		return {
			asignaciones: 0,
			asignacionesTotal: asignFisico.length,
			detalleAsignaciones: [],
		};
	}

	await mysqlExec(`DELETE FROM ${q(mysqlTable)} WHERE IdEmpresa = ?`, [emp]);
	for (const lote of chunk(asignFisico, 200)) {
		const flat = [];
		for (const r of lote) flat.push(emp, r.idP, r.idS);
		const valuesSql = lote.map(() => '(?, ?, ?)').join(', ');
		await mysqlExec(
			`INSERT INTO ${q(mysqlTable)} (IdEmpresa, idPersonal, ${q(idItemCol)})
       VALUES ${valuesSql}
       ON DUPLICATE KEY UPDATE ${q(idItemCol)} = VALUES(${q(idItemCol)})`,
			flat,
		);
	}

	const diff = diffAsignaciones(setFisico, setNube, labelById);
	return {
		asignaciones: diff.asignaciones,
		asignacionesTotal: asignFisico.length,
		detalleAsignaciones: diff.detalleAsignaciones,
	};
}

async function leerCatalogoFisico(pool, tabla, { ambInt = false, valorServicio = false } = {}) {
	const allowed = new Set(['imSectores', 'imServicios']);
	if (!allowed.has(tabla)) {
		throw new Error(`Catálogo físico no permitido: ${tabla}`);
	}
	const extra = [];
	if (ambInt) extra.push(`RTRIM(LTRIM(ISNULL(AmbInt, ''))) AS AmbInt`);
	if (valorServicio) extra.push(`RTRIM(LTRIM(ISNULL(ValorServicio, ''))) AS ValorServicio`);
	if (extra.length) {
		try {
			return await queryFisicoRecordset(
				pool,
				`
      SELECT
        Valor,
        RTRIM(LTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
        ${extra.join(',\n        ')}
      FROM dbo.${tabla}
    `,
			);
		} catch {
			/* columnas opcionales ausentes en este SQL físico */
		}
	}
	return queryFisicoRecordset(
		pool,
		`
      SELECT Valor, RTRIM(LTRIM(ISNULL(Descripcion, ''))) AS Descripcion
      FROM dbo.${tabla}
    `,
	);
}

async function ensureImSectoresNubeColumns() {
	await mysqlExec(
		`ALTER TABLE ${q('imSectores')} ADD COLUMN ValorServicio VARCHAR(50) NULL`,
	).catch(() => {});
	await mysqlExec(`ALTER TABLE ${q('imSectores')} ADD COLUMN AmbInt VARCHAR(4) NULL`).catch(() => {});
}

async function syncSectoresDesdeFisico(idEmpresa, pool) {
	const emp = Number(idEmpresa);
	await ensureImSectoresNubeColumns();
	let secRows = [];
	try {
		secRows = await leerCatalogoFisico(pool, 'imSectores', { ambInt: true, valorServicio: true });
	} catch (e) {
		console.warn('[personalSync] catálogo imSectores físico:', e.message);
		return {
			...emptyCatalogSync(),
			sectoresCatalogo: 0,
			sectoresCatalogoCambios: 0,
		};
	}

	const cat = await upsertCatalogoMysql(emp, 'imSectores', secRows, { ambInt: true, valorServicio: true });

	let asignRows = null;
	try {
		asignRows = await queryFisicoRecordset(
			pool,
			`SELECT idPersonal, idSector FROM dbo.imPersonalSectores`,
		);
	} catch (e) {
		console.warn('[personalSync] imPersonalSectores físico:', e.message);
	}

	const asig = await syncAsignacionesMysql(emp, {
		mysqlTable: 'imPersonalSectores',
		idItemCol: 'idSector',
		asignRows,
		labelById: mapNombreCatalogo(secRows),
	});

	return {
		sectoresCatalogo: cat.catalogo,
		sectoresCatalogoCambios: cat.catalogoCambios,
		detalleCatalogo: cat.detalleCatalogo,
		asignaciones: asig.asignaciones,
		asignacionesTotal: asig.asignacionesTotal,
		detalleAsignaciones: asig.detalleAsignaciones,
	};
}

async function ensureServiciosMysqlTables() {
	await mysqlExec(`
    CREATE TABLE IF NOT EXISTS ${q('imServicios')} (
      IdEmpresa INT NOT NULL,
      Valor VARCHAR(50) NOT NULL,
      Descripcion VARCHAR(200) NULL,
      PRIMARY KEY (IdEmpresa, Valor)
    )
  `);
	await mysqlExec(`
    CREATE TABLE IF NOT EXISTS ${q('imPersonalServicios')} (
      IdEmpresa INT NOT NULL,
      idPersonal INT NOT NULL,
      idServicio VARCHAR(50) NOT NULL,
      PRIMARY KEY (IdEmpresa, idPersonal, idServicio)
    )
  `);
	await mysqlExec(
		`ALTER TABLE ${q('imPersonalServicios')} MODIFY idServicio VARCHAR(50) NOT NULL`,
	).catch(() => {});
	await mysqlExec(`ALTER TABLE ${q('imServicios')} MODIFY Valor VARCHAR(50) NOT NULL`).catch(
		() => {},
	);
}

async function syncServiciosDesdeFisico(idEmpresa, pool) {
	const emp = Number(idEmpresa);
	try {
		await ensureServiciosMysqlTables();
	} catch (e) {
		console.warn('[personalSync] tablas MySQL imServicios:', e.message);
		return emptyCatalogSync();
	}

	let srvRows = [];
	try {
		srvRows = await leerCatalogoFisico(pool, 'imServicios', { ambInt: false });
	} catch (e) {
		console.warn('[personalSync] catálogo imServicios físico:', e.message);
		return emptyCatalogSync();
	}

	const cat = await upsertCatalogoMysql(emp, 'imServicios', srvRows);

	let asignRows = null;
	try {
		asignRows = await queryFisicoRecordset(
			pool,
			`SELECT idPersonal, idServicio FROM dbo.imPersonalServicios`,
		);
	} catch (e) {
		console.warn('[personalSync] imPersonalServicios físico:', e.message);
	}

	const asig = await syncAsignacionesMysql(emp, {
		mysqlTable: 'imPersonalServicios',
		idItemCol: 'idServicio',
		asignRows,
		labelById: mapNombreCatalogo(srvRows),
	});

	return {
		catalogo: cat.catalogo,
		catalogoCambios: cat.catalogoCambios,
		detalleCatalogo: cat.detalleCatalogo,
		asignaciones: asig.asignaciones,
		asignacionesTotal: asig.asignacionesTotal,
		detalleAsignaciones: asig.detalleAsignaciones,
	};
}

async function getMysqlColumnNames(table) {
	const rows = await mysqlQuery(
		`
    SELECT COLUMN_NAME AS col
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `,
		[String(table)],
	);
	return new Map((rows || []).map((r) => [String(r.col).toLowerCase(), String(r.col)]));
}

function isBinaryLike(value) {
	return (
		Buffer.isBuffer(value) ||
		(value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data))
	);
}

function sanitizePasswordCell(v) {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (isBinaryLike(v)) return null;
	if (v instanceof Date) return v;
	if (typeof v === 'string') {
		const t = v.trim();
		return t === '' ? null : t;
	}
	if (typeof v === 'object') return String(v);
	return v;
}

/**
 * Credenciales imPassword del SQL físico → MySQL (auth SaaS).
 * Solo escribe altas/modificaciones; limpia PasswordHash si el físico no trae Argon2.
 */
async function syncPasswordsDesdeFisico(idEmpresa, pool) {
	const emp = Number(idEmpresa);
	let fisicoRows;
	try {
		const data = await pool.request().query(`SELECT * FROM dbo.imPassword`);
		fisicoRows = data.recordset || [];
	} catch (e) {
		console.warn('[personalSync] imPassword no disponible en físico:', e.message);
		return {
			passwords: 0,
			nuevos: 0,
			actualizados: 0,
			sinCambio: 0,
			cambios: 0,
			errores: 0,
			detalleErrores: [],
			detalle: [],
		};
	}

	if (!fisicoRows.length) {
		return {
			passwords: 0,
			nuevos: 0,
			actualizados: 0,
			sinCambio: 0,
			cambios: 0,
			errores: 0,
			detalleErrores: [],
			detalle: [],
		};
	}

	const mysqlColByLower = await getMysqlColumnNames('imPassword');
	if (!mysqlColByLower.has('idempresa') || !mysqlColByLower.has('valorpersonal')) {
		const e = new Error('MySQL imPassword no tiene IdEmpresa/ValorPersonal');
		e.statusCode = 500;
		throw e;
	}

	const skipHashCmp = new Set(['passwordhash', 'idempresa']);
	const mapped = [];
	let omitidos = 0;
	for (const fr of fisicoRows) {
		const row = {};
		for (const [rawKey, rawVal] of Object.entries(fr)) {
			const canon = mysqlColByLower.get(String(rawKey).toLowerCase());
			if (!canon) continue;
			const v = sanitizePasswordCell(rawVal);
			if (v === undefined) continue;
			row[canon] = v;
		}
		row.IdEmpresa = emp;
		const vp = Number(row.ValorPersonal);
		if (!canSyncPasswordRowToTenant(emp, row)) {
			omitidos += 1;
			continue;
		}
		row.ValorPersonal = vp;

		if (mysqlColByLower.has('passwordhash')) {
			const hashKey = mysqlColByLower.get('passwordhash');
			const hash = row[hashKey];
			if (hash == null || hash === '' || !String(hash).startsWith('$argon2')) {
				row[hashKey] = null;
			}
		}
		mapped.push(row);
	}

	const cmpCols = [...new Set(mapped.flatMap((r) => Object.keys(r)))].filter(
		(c) => !skipHashCmp.has(String(c).toLowerCase()),
	);
	// Password legacy siempre en la comparación
	if (mysqlColByLower.has('password') && !cmpCols.some((c) => c.toLowerCase() === 'password')) {
		cmpCols.push(mysqlColByLower.get('password'));
	}
	if (mysqlColByLower.has('nombrered') && !cmpCols.some((c) => c.toLowerCase() === 'nombrered')) {
		cmpCols.push(mysqlColByLower.get('nombrered'));
	}

	const existing = await mysqlQuery(`SELECT * FROM ${q('imPassword')} WHERE IdEmpresa = ?`, [emp]);
	const byVp = new Map();
	for (const r of existing || []) {
		const vp = Number(r.ValorPersonal);
		if (Number.isFinite(vp)) byVp.set(vp, r);
	}

	let nuevos = 0;
	let actualizados = 0;
	let sinCambio = 0;
	const toWrite = [];
	const detalle = [];
	const hashKey = mysqlColByLower.has('passwordhash')
		? mysqlColByLower.get('passwordhash')
		: null;

	for (const row of mapped) {
		const prev = byVp.get(row.ValorPersonal);
		const nombreRed = String(row.NombreRed || row.nombrered || prev?.NombreRed || '').trim();
		if (!prev) {
			nuevos += 1;
			toWrite.push(row);
			detalle.push({
				valor: row.ValorPersonal,
				nombreRed: nombreRed || null,
				accion: 'alta',
				campos: [],
			});
			continue;
		}
		if (fingerprint(row, cmpCols) !== fingerprint(prev, cmpCols)) {
			const payload = { ...row };
			if (hashKey) payload[hashKey] = null;
			actualizados += 1;
			toWrite.push(payload);
			detalle.push({
				valor: row.ValorPersonal,
				nombreRed: nombreRed || null,
				accion: 'actualizacion',
				campos: diffRows(prev, payload, cmpCols, (c) => PW_LABEL[c] || c),
			});
		} else {
			sinCambio += 1;
		}
	}

	const colSet = new Set(['IdEmpresa', 'ValorPersonal']);
	for (const r of toWrite) {
		for (const c of Object.keys(r)) colSet.add(c);
	}
	if (mysqlColByLower.has('passwordhash')) {
		colSet.add(mysqlColByLower.get('passwordhash'));
	}
	const colList = [...colSet].filter((c) => mysqlColByLower.has(String(c).toLowerCase()));
	const pkLower = new Set(['idempresa', 'valorpersonal']);
	const updates = colList
		.filter((c) => !pkLower.has(String(c).toLowerCase()))
		.map((c) => `${q(c)} = VALUES(${q(c)})`)
		.join(', ');
	const placeholders = `(${colList.map(() => '?').join(', ')})`;

	let errores = 0;
	const detalleErrores = [];

	async function insertLote(lote) {
		const flat = [];
		for (const row of lote) {
			for (const c of colList) flat.push(row[c] === undefined ? null : row[c]);
		}
		const valuesSql = lote.map(() => placeholders).join(', ');
		const sql = updates
			? `INSERT INTO ${q('imPassword')} (${colList.map(q).join(', ')})
         VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE ${updates}`
			: `INSERT INTO ${q('imPassword')} (${colList.map(q).join(', ')})
         VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE ValorPersonal = VALUES(ValorPersonal)`;
		await mysqlExec(sql, flat);
	}

	for (const lote of chunk(toWrite, 50)) {
		try {
			await insertLote(lote);
		} catch {
			for (const row of lote) {
				try {
					await insertLote([row]);
				} catch (rowErr) {
					errores += 1;
					const d = detalle.find((x) => x.valor === row.ValorPersonal);
					if (d) d.accion = 'error';
					if (detalleErrores.length < 15) {
						detalleErrores.push({
							valorPersonal: row.ValorPersonal,
							nombreRed: row.NombreRed || row.nombrered || null,
							error: String(rowErr.message || rowErr).slice(0, 200),
						});
					}
					console.warn(
						`[personalSync] imPassword ValorPersonal=${row.ValorPersonal}:`,
						rowErr.message,
					);
				}
			}
		}
	}

	const cambios = Math.max(0, nuevos + actualizados - errores);
	return {
		passwords: mapped.length,
		omitidos,
		nuevos,
		actualizados,
		sinCambio,
		cambios,
		written: toWrite.length - errores,
		errores,
		detalleErrores,
		detalle,
	};
}

/**
 * Vínculos en MySQL + espejo en SQL físico. Solo cuenta altas nuevas.
 */
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

	const existingMysql = await mysqlQuery(
		`SELECT IdPersonal FROM ${q('imPersonalEmpresas')} WHERE IdEmpresa = ?`,
		[emp],
	);
	const haveMysql = new Set(
		(existingMysql || [])
			.map((r) => Number(r.IdPersonal))
			.filter((n) => Number.isFinite(n) && n > 0),
	);
	const missingMysql = ids.filter((id) => !haveMysql.has(id));

	if (missingMysql.length) {
		for (const lote of chunk(missingMysql, 500)) {
			const flat = [];
			for (const pid of lote) flat.push(pid, emp);
			const valuesSql = lote.map(() => '(?, ?)').join(', ');
			await mysqlExec(
				`INSERT INTO ${q('imPersonalEmpresas')} (IdPersonal, IdEmpresa) VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE IdEmpresa = VALUES(IdEmpresa)`,
				flat,
			);
		}
	}

	let nuevosFisico = 0;
	try {
		const exist = await pool
			.request()
			.input('emp', emp)
			.query(`SELECT IdPersonal FROM dbo.imPersonalEmpresas WHERE IdEmpresa = @emp`);
		const have = new Set(
			(exist.recordset || [])
				.map((r) => Number(r.IdPersonal))
				.filter((n) => Number.isFinite(n) && n > 0),
		);
		const missing = ids.filter((id) => !have.has(id));
		nuevosFisico = missing.length;
		for (const lote of chunk(missing, 200)) {
			const valuesSql = lote.map((pid) => `(${Number(pid)}, ${Number(emp)})`).join(', ');
			await pool.request().query(`
        INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa)
        SELECT v.IdPersonal, v.IdEmpresa
        FROM (VALUES ${valuesSql}) AS v(IdPersonal, IdEmpresa)
        WHERE NOT EXISTS (
          SELECT 1 FROM dbo.imPersonalEmpresas pe
          WHERE pe.IdPersonal = v.IdPersonal AND pe.IdEmpresa = v.IdEmpresa
        )
      `);
		}
	} catch (e) {
		console.warn('[personalSync] espejo imPersonalEmpresas físico:', e.message);
	}

	return {
		ids: ids.length,
		nuevos: missingMysql.length,
		nuevosFisico,
		detalle: missingMysql.map((valor) => ({ valor })),
		// UI: solo lo que se agregó en esta corrida
		cambios: missingMysql.length,
	};
}

/**
 * Copia personal + credenciales + catálogos/asignaciones de sectores y servicios + vínculos.
 * Los contadores de la UI son deltas (0 si ya estaba al día).
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
	const personal = await syncPersonalDelta(emp, syncRows);

	const passwords = await syncPasswordsDesdeFisico(emp, pool);
	let sec = {
		sectoresCatalogo: 0,
		sectoresCatalogoCambios: 0,
		detalleCatalogo: [],
		asignaciones: 0,
		asignacionesTotal: 0,
		detalleAsignaciones: [],
	};
	try {
		sec = await syncSectoresDesdeFisico(emp, pool);
	} catch (e) {
		console.warn('[personalSync] sectores:', e.message);
	}
	let srv = emptyCatalogSync();
	try {
		srv = await syncServiciosDesdeFisico(emp, pool);
	} catch (e) {
		console.warn('[personalSync] servicios:', e.message);
	}
	const vinculos = await syncVinculosEmpresa(emp, pool);
	const roles = await syncRolesDesdeFisico(emp, pool);

	const namesByValor = new Map();
	for (const r of syncRows) {
		const id = Number(r.Valor);
		if (!Number.isFinite(id)) continue;
		const n = nombrePersona(r);
		if (n) namesByValor.set(id, n);
	}

	const bruto = {
		personal: personal.cambios,
		personalTotal: personal.total,
		personalNuevos: personal.nuevos,
		personalActualizados: personal.actualizados,
		personalSinCambio: personal.sinCambio,
		passwordsEscritos: passwords.cambios,
		passwordsTotal: passwords.passwords,
		passwordsNuevos: passwords.nuevos,
		passwordsActualizados: passwords.actualizados,
		passwordsSinCambio: passwords.sinCambio,
		passwordsErrores: passwords.errores,
		passwordsDetalleErrores: passwords.detalleErrores,
		sectoresAsignaciones: sec.asignaciones,
		sectoresAsignacionesTotal: sec.asignacionesTotal,
		sectoresCatalogoCambios: sec.sectoresCatalogoCambios,
		serviciosAsignaciones: srv.asignaciones,
		serviciosAsignacionesTotal: srv.asignacionesTotal,
		serviciosCatalogoCambios: srv.catalogoCambios,
		vinculos: vinculos.cambios,
		vinculosTotal: vinculos.ids,
		vinculosMysql: vinculos.nuevos,
		vinculosFisico: vinculos.nuevosFisico,
		rolesAsignados: roles.asignados,
		rolesYaTenia: roles.yaTenia,
		rolesSinAsignar: roles.sinRol,
		rolesPorTipo: roles.porRol,
	};
	const informe = buildSyncInforme({
		bruto,
		personal,
		passwords,
		sec,
		srv,
		vinculos,
		roles,
		namesByValor,
	});
	const totalCambios =
		(Number(bruto.personal) || 0) +
		(Number(bruto.passwordsEscritos) || 0) +
		(Number(bruto.sectoresAsignaciones) || 0) +
		(Number(bruto.sectoresCatalogoCambios) || 0) +
		(Number(bruto.serviciosAsignaciones) || 0) +
		(Number(bruto.serviciosCatalogoCambios) || 0) +
		(Number(bruto.vinculos) || 0) +
		(Number(bruto.rolesAsignados) || 0);

	return {
		...bruto,
		informe,
		usuarios: informe.usuarios,
		sinCambios: informe.sinCambios,
		totalCambios,
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

/** Roles generales migrables desde el SQL físico. No incluye SUPER_ADMIN (5). */
const ROLES_GENERALES = new Set([1, 2, 3, 4, 6]);

function inferRolDesdeFisico(row) {
	const fromRol = Number(String(row?.Rol || '').trim());
	if (ROLES_GENERALES.has(fromRol)) return fromRol;
	if (Number(row?.Grupo) === 11) return 1;
	const esp = Number(row?.ValorEspecialidad);
	if (esp === 26) return 3;
	if (Number.isFinite(esp) && esp > 0 && ![7, 9, 26, 27].includes(esp)) return 2;
	return null;
}

/**
 * Completa imPersonalRoles + imPersonal.Rol desde el SQL físico
 * (Grupo 11 → ADMIN, especialidad 26 → ENFERMERO, resto médico, o Rol ya grabado).
 * No pisa roles ya asignados en Railway ni SUPER_ADMIN.
 */
async function syncRolesDesdeFisico(idEmpresa, pool) {
	const emp = Number(idEmpresa);
	await mysqlExec(`
    CREATE TABLE IF NOT EXISTS \`imPersonalRoles\` (
      \`IdEmpresa\` INT NOT NULL,
      \`Valor\` INT NOT NULL,
      \`IdRol\` INT NOT NULL,
      \`EsPrincipal\` TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (\`IdEmpresa\`, \`Valor\`, \`IdRol\`),
      KEY \`IX_imPersonalRoles_Rol\` (\`IdRol\`),
      KEY \`IX_imPersonalRoles_Personal\` (\`IdEmpresa\`, \`Valor\`, \`EsPrincipal\`)
    )
  `);

	let fisicoRows = [];
	try {
		const data = await pool.request().query(`
      SELECT
        p.Valor,
        RTRIM(LTRIM(ISNULL(p.ApellidoNombre, ''))) AS ApellidoNombre,
        LTRIM(RTRIM(ISNULL(p.Rol, ''))) AS Rol,
        p.ValorEspecialidad,
        CAST(ISNULL((
          SELECT MAX(pw.Grupo) FROM dbo.imPassword pw WHERE pw.ValorPersonal = p.Valor
        ), 0) AS INT) AS Grupo
      FROM dbo.imPersonal p
    `);
		fisicoRows = data.recordset || [];
	} catch (e) {
		console.warn('[personalSync] roles físico:', e.message);
		return { asignados: 0, yaTenia: 0, sinRol: 0, porRol: {}, detalle: [] };
	}

	const existing = await mysqlQuery(
		`SELECT Valor FROM ${q('imPersonalRoles')} WHERE IdEmpresa = ?`,
		[emp],
	);
	const have = new Set(
		(existing || []).map((r) => Number(r.Valor)).filter((n) => Number.isFinite(n)),
	);

	const toWrite = [];
	let yaTenia = 0;
	let sinRol = 0;
	const porRol = { 1: 0, 2: 0, 3: 0, 4: 0, 6: 0 };

	for (const row of fisicoRows) {
		if (!canSyncPersonalRowToTenant(emp, row)) continue;
		const vp = Number(row.Valor);
		if (!Number.isFinite(vp) || isPlatformValorPersonal(vp)) continue;
		if (have.has(vp)) {
			yaTenia += 1;
			continue;
		}
		const idRol = inferRolDesdeFisico(row);
		if (!idRol) {
			sinRol += 1;
			continue;
		}
		toWrite.push({
			vp,
			idRol,
			nombre: nombrePersona(row) || `ID ${vp}`,
		});
		porRol[idRol] = (porRol[idRol] || 0) + 1;
	}

	let insertados = 0;
	for (const lote of chunk(toWrite, 80)) {
		const flat = [];
		for (const r of lote) flat.push(emp, r.vp, r.idRol, 1);
		const valuesSql = lote.map(() => '(?, ?, ?, ?)').join(', ');
		const ins = await mysqlExec(
			`INSERT IGNORE INTO ${q('imPersonalRoles')} (IdEmpresa, Valor, IdRol, EsPrincipal)
       VALUES ${valuesSql}`,
			flat,
		);
		insertados += Number(ins?.affectedRows) || 0;
		for (const r of lote) {
			await mysqlExec(
				`UPDATE ${q('imPersonal')} SET Rol = ? WHERE IdEmpresa = ? AND Valor = ?
         AND (Rol IS NULL OR TRIM(Rol) = '' OR TRIM(Rol) = '0')`,
				[String(r.idRol), emp, r.vp],
			);
		}
	}

	return {
		asignados: insertados,
		yaTenia,
		sinRol,
		porRol,
		detalle: toWrite.map((r) => ({
			valor: r.vp,
			nombre: r.nombre,
			idRol: r.idRol,
		})),
	};
}

const ROL_INFORME_LABEL = {
	1: { uno: 'admin', muchos: 'admins', nombre: 'ADMIN', etiqueta: 'Administrador' },
	2: { uno: 'médico', muchos: 'médicos', nombre: 'MEDICO', etiqueta: 'Médico' },
	3: { uno: 'enfermero', muchos: 'enfermeros', nombre: 'ENFERMERO', etiqueta: 'Enfermero' },
	4: {
		uno: 'administrativo',
		muchos: 'administrativos',
		nombre: 'ADMINISTRATIVO',
		etiqueta: 'Administrativo',
	},
	6: { uno: 'carga HC', muchos: 'carga HC', nombre: 'CARGA_HC', etiqueta: 'Carga de adjuntos' },
};

function resumenPermisosRol(idRol) {
	const meta = ROL_INFORME_LABEL[idRol];
	if (!meta) return null;
	try {
		const codigos = permisosDeRol(meta.nombre);
		const arbol = modulosVisibles(meta.nombre).map((m) => ({
			modulo: m.label,
			items: (m.submodulos || []).map((s) => ({
				nombre: s.label,
				acciones: [...(s.acciones || [])],
			})),
		}));
		return {
			idRol: Number(idRol),
			nombre: meta.nombre,
			etiqueta: meta.etiqueta,
			permisos: codigos.length,
			modulos: arbol,
		};
	} catch {
		return {
			idRol: Number(idRol),
			nombre: meta.nombre,
			etiqueta: meta.etiqueta,
			permisos: 0,
			modulos: [],
		};
	}
}

function pushInformeItem(items, cantidad, uno, muchos, opts = {}) {
	const n = Number(cantidad) || 0;
	if (n <= 0) return;
	items.push({
		cantidad: n,
		texto: n === 1 ? uno : muchos,
		extra: opts.extra || null,
		error: !!opts.error,
	});
}

function ensureUser(users, valor, namesByValor, fallbackNombre) {
	const id = Number(valor);
	if (!Number.isFinite(id) || id <= 0) return null;
	if (!users.has(id)) {
		users.set(id, {
			valor: id,
			nombre: fallbackNombre || namesByValor.get(id) || `ID ${id}`,
			cambios: [],
		});
	} else if (fallbackNombre && String(users.get(id).nombre).startsWith('ID ')) {
		users.get(id).nombre = fallbackNombre;
	}
	return users.get(id);
}

/**
 * Informe del modal: resumen + detalle por usuario (desplegables).
 */
function buildSyncInforme({ bruto: r, personal, passwords, sec, srv, vinculos, roles, namesByValor }) {
	const items = [];
	pushInformeItem(items, r.personalNuevos, 'persona dada de alta', 'personas dadas de alta');
	pushInformeItem(
		items,
		r.personalActualizados,
		'ficha de personal actualizada',
		'fichas de personal actualizadas',
	);

	const errPw = Number(r.passwordsErrores) || 0;
	if (errPw > 0) {
		pushInformeItem(
			items,
			r.passwordsEscritos,
			'cuenta de acceso copiada',
			'cuentas de acceso copiadas',
		);
		pushInformeItem(
			items,
			errPw,
			'cuenta no copiada (conflicto de clave u otro error)',
			'cuentas no copiadas (conflicto de clave u otros errores)',
			{ error: true },
		);
	} else {
		pushInformeItem(items, r.passwordsNuevos, 'cuenta de acceso nueva', 'cuentas de acceso nuevas');
		pushInformeItem(
			items,
			r.passwordsActualizados,
			'cuenta de acceso actualizada',
			'cuentas de acceso actualizadas',
		);
	}

	pushInformeItem(
		items,
		r.sectoresCatalogoCambios,
		'sector del catálogo actualizado',
		'sectores del catálogo actualizados',
	);
	pushInformeItem(
		items,
		r.sectoresAsignaciones,
		'asignación de sector distinta a la nube',
		'asignaciones de sectores distintas a la nube',
	);
	pushInformeItem(
		items,
		r.serviciosCatalogoCambios,
		'servicio del catálogo actualizado',
		'servicios del catálogo actualizados',
	);
	pushInformeItem(
		items,
		r.serviciosAsignaciones,
		'asignación de servicio distinta a la nube',
		'asignaciones de servicios distintas a la nube',
	);
	pushInformeItem(
		items,
		r.vinculos,
		'vínculo usuario-empresa nuevo',
		'vínculos usuario-empresa nuevos',
	);

	const por = r.rolesPorTipo || {};
	const rolBits = Object.keys(ROL_INFORME_LABEL)
		.map((id) => {
			const c = Number(por[id] ?? por[Number(id)] ?? 0);
			if (c <= 0) return null;
			const lab = ROL_INFORME_LABEL[id];
			return `${c} ${c === 1 ? lab.uno : lab.muchos}`;
		})
		.filter(Boolean);
	pushInformeItem(items, r.rolesAsignados, 'rol general asignado', 'roles generales asignados', {
		extra: rolBits.length ? rolBits.join(', ') : null,
	});

	const names = namesByValor instanceof Map ? namesByValor : new Map();
	const users = new Map();

	for (const d of personal?.detalle || []) {
		const u = ensureUser(users, d.valor, names, d.nombre);
		if (!u) continue;
		u.cambios.push({
			tipo: 'ficha',
			accion: d.accion,
			titulo: d.accion === 'alta' ? 'Ficha dada de alta' : 'Ficha actualizada',
			campos: d.campos || [],
		});
	}

	const errByVp = new Map(
		(passwords?.detalleErrores || []).map((e) => [Number(e.valorPersonal), e.error]),
	);
	for (const d of passwords?.detalle || []) {
		const u = ensureUser(
			users,
			d.valor,
			names,
			d.nombreRed ? `${names.get(Number(d.valor)) || d.nombreRed}` : null,
		);
		if (!u) continue;
		const err = errByVp.get(Number(d.valor));
		const accion = d.accion === 'error' || err ? 'error' : d.accion;
		u.cambios.push({
			tipo: 'cuenta',
			accion,
			titulo:
				accion === 'alta'
					? 'Cuenta de acceso nueva'
					: accion === 'error'
					  ? 'Cuenta no copiada'
					  : 'Cuenta de acceso actualizada',
			campos: d.campos || [],
			usuarioRed: d.nombreRed || null,
			error: err || null,
		});
	}

	for (const d of roles?.detalle || []) {
		const meta = ROL_INFORME_LABEL[d.idRol];
		const u = ensureUser(users, d.valor, names, d.nombre);
		if (!u) continue;
		u.cambios.push({
			tipo: 'rol',
			accion: 'asignado',
			titulo: `Rol asignado: ${meta ? meta.etiqueta : d.idRol}`,
			idRol: d.idRol,
		});
	}

	for (const d of sec?.detalleAsignaciones || []) {
		const u = ensureUser(users, d.valor, names, null);
		if (!u) continue;
		u.cambios.push({
			tipo: 'sector',
			accion: 'asignacion',
			titulo: 'Sectores',
			agregados: d.agregados || [],
			quitados: d.quitados || [],
		});
	}

	for (const d of srv?.detalleAsignaciones || []) {
		const u = ensureUser(users, d.valor, names, null);
		if (!u) continue;
		u.cambios.push({
			tipo: 'servicio',
			accion: 'asignacion',
			titulo: 'Servicios',
			agregados: d.agregados || [],
			quitados: d.quitados || [],
		});
	}

	for (const d of vinculos?.detalle || []) {
		const u = ensureUser(users, d.valor, names, null);
		if (!u) continue;
		u.cambios.push({
			tipo: 'vinculo',
			accion: 'nuevo',
			titulo: 'Vínculo con la empresa',
		});
	}

	const usuarios = [...users.values()].sort((a, b) =>
		String(a.nombre).localeCompare(String(b.nombre), 'es'),
	);

	const porTipo = Object.keys(ROL_INFORME_LABEL)
		.map((id) => {
			const c = Number(por[id] ?? por[Number(id)] ?? 0);
			if (c <= 0) return null;
			const resumen = resumenPermisosRol(id);
			if (!resumen) return null;
			return { ...resumen, usuarios: c };
		})
		.filter(Boolean);

	const huboCambio = items.some((i) => !i.error);
	const huboError = items.some((i) => i.error);
	let mensaje;
	if (!huboCambio && !huboError) {
		mensaje = 'La nube ya estaba al día. No hubo cambios respecto a la base física.';
	} else if (!huboCambio && huboError) {
		mensaje = 'No se pudo copiar algunas cuentas. El resto ya estaba al día.';
	} else {
		mensaje = 'Se aplicaron estos cambios desde la base física:';
	}

	return {
		mensaje,
		sinCambios: !huboCambio && !huboError,
		items,
		usuarios,
		catalogoSectores: sec?.detalleCatalogo || [],
		catalogoServicios: srv?.detalleCatalogo || [],
		roles: {
			asignados: Number(r.rolesAsignados) || 0,
			yaTenia: Number(r.rolesYaTenia) || 0,
			sinRol: Number(r.rolesSinAsignar) || 0,
			porTipo,
		},
	};
}

module.exports = {
	listExportFields,
	puedeSyncDesdeFisico,
	ensureImPersonalExportColumns,
	syncPersonalDesdeFisico,
	listarParaExport,
	PERSONAL_SYNC_COLUMNS,
};
