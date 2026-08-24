const { executeQuery } = require('../models/db');
const { sectorUsuarioCoincideServicio } = require('../utils/sectorServicioMatch');

let _tableReady = false;

const ID_SERVICIO_LEN = 50;

function _code(v) {
	return String(v || '').trim().slice(0, ID_SERVICIO_LEN);
}

function _col(row, ...names) {
	if (!row) return undefined;
	for (const n of names) {
		if (Object.prototype.hasOwnProperty.call(row, n) && row[n] != null) return row[n];
	}
	const lower = {};
	for (const [k, v] of Object.entries(row)) lower[String(k).toLowerCase()] = v;
	for (const n of names) {
		const v = lower[String(n).toLowerCase()];
		if (v !== undefined && v !== null) return v;
	}
	return undefined;
}

function _claves(valor) {
	const raw = String(valor || '').trim();
	if (!raw) return [];
	const keys = new Set([raw, raw.toUpperCase()]);
	const compact = raw.replace(/\s+/g, '');
	keys.add(compact);
	keys.add(compact.toUpperCase());
	if (/^\d+$/.test(compact)) {
		keys.add(String(Number(compact)));
		const sinCeros = compact.replace(/^0+/, '');
		if (sinCeros) keys.add(sinCeros);
	}
	return [...keys];
}

function _esCodigo(desc, codigo) {
	const d = String(desc || '').trim();
	const c = String(codigo || '').trim();
	if (!d || !c) return false;
	const dk = _claves(d);
	return _claves(c).some((k) => dk.includes(k));
}

function _indexKey(valor) {
	const compact = _code(valor).replace(/\s+/g, '');
	if (!compact) return '';
	if (/^\d+$/.test(compact)) return `n:${Number(compact)}`;
	return `s:${compact.toUpperCase()}`;
}

function _descReal(valor, desc) {
	const d = String(desc || '').trim();
	if (!d || _esCodigo(d, valor)) return '';
	return d;
}

function _ingestCatalogo(byKey, valorRaw, descRaw) {
	const valor = _code(valorRaw);
	if (!valor) return;
	const idx = _indexKey(valor);
	if (!idx) return;
	const real = _descReal(valor, descRaw);
	const prev = byKey.get(idx);
	if (!prev) {
		byKey.set(idx, { valor, descripcion: real });
		return;
	}
	if (!prev.descripcion && real) prev.descripcion = real;
}

async function _fuentesCatalogo() {
	const byKey = new Map();
	for (const sql of [
		`SELECT Valor, Descripcion FROM dbo.imServicios`,
		`SELECT Valor, Descripcion FROM dbo.imServiciosMedicos`,
	]) {
		try {
			const rows = await executeQuery(sql);
			for (const r of rows || []) {
				_ingestCatalogo(
					byKey,
					_col(r, 'Valor', 'IdServicio', 'id', 'idServicio', 'valor'),
					_col(r, 'Descripcion', 'descripcion'),
				);
			}
		} catch {
			/* tabla ausente */
		}
	}
	try {
		const { getTenantId } = require('../context/tenantContext');
		const tid = Number(getTenantId());
		if (Number.isFinite(tid) && tid > 0) {
			const nube = require('./nubeTenant.service');
			const items = await nube.listarServicios(tid);
			for (const s of items || []) {
				_ingestCatalogo(byKey, s.id || s.valor, s.descripcion);
			}
		}
	} catch {
		/* sin tenant / mysql */
	}
	return [...byKey.values()];
}

async function listarCatalogo() {
	const items = await _fuentesCatalogo();
	return items.sort((a, b) =>
		String(a.descripcion || a.valor).localeCompare(String(b.descripcion || b.valor), 'es'),
	);
}

async function _catalogoDescripciones() {
	const map = new Map();
	for (const it of await _fuentesCatalogo()) {
		if (!it.descripcion) continue;
		for (const k of _claves(it.valor)) {
			if (!map.has(k)) map.set(k, it.descripcion);
		}
	}
	return map;
}

function _descripcionDe(id, descRaw, catalogo) {
	const idN = _code(id);
	const extra = String(descRaw || '').trim();
	if (extra && !_esCodigo(extra, idN)) return extra;
	if (!idN || !catalogo) return '';
	for (const k of _claves(idN)) {
		const hit = catalogo.get(k);
		if (hit) return hit;
	}
	return '';
}

function _normDesc(s) {
	return String(s || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toUpperCase()
		.replace(/\s+/g, ' ');
}

async function ensureTable() {
	if (_tableReady) return;
	try {
		await executeQuery(`
		IF OBJECT_ID(N'dbo.imPersonalServicios', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imPersonalServicios (
				idPersonal INT NOT NULL,
				idServicio VARCHAR(50) NOT NULL,
				CONSTRAINT PK_imPersonalServicios PRIMARY KEY (idPersonal, idServicio)
			);
			CREATE INDEX IX_imPersonalServicios_idServicio
				ON dbo.imPersonalServicios (idServicio);
		END
		`);

		// Un PK solo en idPersonal (legado 1 servicio) impide asignar el segundo.
		await executeQuery(`
		DECLARE @needWiden bit = 0;
		IF COL_LENGTH('dbo.imPersonalServicios', 'idServicio') IS NOT NULL
		   AND COL_LENGTH('dbo.imPersonalServicios', 'idServicio') < 50
			SET @needWiden = 1;

		DECLARE @pk sysname;
		DECLARE @hasServicio bit = 0;
		SELECT @pk = kc.name
		FROM sys.key_constraints kc
		WHERE kc.parent_object_id = OBJECT_ID(N'dbo.imPersonalServicios')
		  AND kc.type = 'PK';
		IF @pk IS NOT NULL
		BEGIN
			IF EXISTS (
				SELECT 1
				FROM sys.index_columns ic
				INNER JOIN sys.columns c
					ON c.object_id = ic.object_id AND c.column_id = ic.column_id
				INNER JOIN sys.key_constraints kc
					ON kc.parent_object_id = ic.object_id AND kc.unique_index_id = ic.index_id
				WHERE kc.name = @pk AND c.name = N'idServicio'
			)
				SET @hasServicio = 1;
			IF @hasServicio = 0 OR @needWiden = 1
			BEGIN
				DECLARE @drop nvarchar(400) = N'ALTER TABLE dbo.imPersonalServicios DROP CONSTRAINT ' + QUOTENAME(@pk);
				EXEC sp_executesql @drop;
			END
		END
		`);

		await executeQuery(`
		DECLARE @ix sysname;
		SELECT TOP 1 @ix = i.name
		FROM sys.indexes i
		WHERE i.object_id = OBJECT_ID(N'dbo.imPersonalServicios')
		  AND i.is_unique = 1
		  AND i.is_primary_key = 0
		  AND i.name IS NOT NULL
		  AND (
		    SELECT COUNT(*) FROM sys.index_columns ic
		    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
		  ) = 1
		  AND EXISTS (
		    SELECT 1 FROM sys.index_columns ic
		    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = N'idPersonal'
		  )
		  AND NOT EXISTS (
		    SELECT 1 FROM sys.index_columns ic
		    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = N'idServicio'
		  );
		IF @ix IS NOT NULL
		BEGIN
			DECLARE @dropIx nvarchar(400) = N'DROP INDEX ' + QUOTENAME(@ix) + N' ON dbo.imPersonalServicios';
			EXEC sp_executesql @dropIx;
		END
		`);

		await executeQuery(`
		IF COL_LENGTH('dbo.imPersonalServicios', 'idServicio') IS NOT NULL
		   AND COL_LENGTH('dbo.imPersonalServicios', 'idServicio') < 50
		BEGIN
			ALTER TABLE dbo.imPersonalServicios ALTER COLUMN idServicio VARCHAR(50) NOT NULL;
		END
		`);

		await executeQuery(`
		IF NOT EXISTS (
			SELECT 1 FROM sys.key_constraints
			WHERE parent_object_id = OBJECT_ID(N'dbo.imPersonalServicios') AND type = 'PK'
		)
		BEGIN
			ALTER TABLE dbo.imPersonalServicios
				ADD CONSTRAINT PK_imPersonalServicios PRIMARY KEY (idPersonal, idServicio);
		END
		`);

		_tableReady = true;
	} catch (err) {
		console.warn('[personalServicios] ensureTable:', err?.message || err);
	}
}

async function _mapRows(rows, catalogo) {
	const cat = catalogo || (await _catalogoDescripciones());
	return (rows || [])
		.map((r) => {
			const idServicio = _code(_col(r, 'idServicio'));
			if (!idServicio) return null;
			return {
				idServicio,
				Descripcion: _descripcionDe(idServicio, _col(r, 'Descripcion'), cat),
			};
		})
		.filter(Boolean);
}

async function listar(valorPersonal) {
	await ensureTable();
	const vp = Number(valorPersonal);
	const catalogo = await _catalogoDescripciones();
	const sqlConCatalogo = `SELECT RTRIM(LTRIM(CAST(ps.idServicio AS VARCHAR(50)))) AS idServicio,
		        COALESCE(
		          NULLIF(LTRIM(RTRIM(CAST(s.Descripcion AS VARCHAR(200)))), ''),
		          NULLIF(LTRIM(RTRIM(CAST(sm.Descripcion AS VARCHAR(200)))), '')
		        ) AS Descripcion
		 FROM dbo.imPersonalServicios ps
		 LEFT JOIN dbo.imServicios s
		   ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(ps.idServicio AS VARCHAR(50))))
		 LEFT JOIN dbo.imServiciosMedicos sm
		   ON LTRIM(RTRIM(CAST(sm.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(ps.idServicio AS VARCHAR(50))))
		 WHERE ps.idPersonal = @p0`;
	const sqlSinCatalogo = `SELECT RTRIM(LTRIM(CAST(ps.idServicio AS VARCHAR(50)))) AS idServicio
		 FROM dbo.imPersonalServicios ps
		 WHERE ps.idPersonal = @p0`;
	let list = [];
	try {
		list = await _mapRows(await executeQuery(sqlConCatalogo, [{ value: vp, type: 'Int' }]), catalogo);
	} catch (err) {
		try {
			list = await _mapRows(await executeQuery(sqlSinCatalogo, [{ value: vp, type: 'Int' }]), catalogo);
		} catch (err2) {
			console.warn('[personalServicios] listar:', err2?.message || err?.message);
			return [];
		}
	}

	if (list.length) {
		list.sort((a, b) =>
			String(a.Descripcion || a.idServicio).localeCompare(String(b.Descripcion || b.idServicio), 'es'),
		);
		return list;
	}

	const legacy = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(ISNULL(ValorServicio, ''))) AS ValorServicio
		 FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: vp, type: 'Int' }],
	).catch(() => []);
	const vs = _code(_col(legacy?.[0], 'ValorServicio'));
	if (!vs) return [];
	try {
		await agregar(vp, vs);
	} catch (err) {
		if (Number(err?.statusCode) !== 409) {
			console.warn('[personalServicios] legacy:', err?.message || err);
			return [{ idServicio: vs, Descripcion: _descripcionDe(vs, '', catalogo) }];
		}
	}
	try {
		list = await _mapRows(await executeQuery(sqlSinCatalogo, [{ value: vp, type: 'Int' }]), catalogo);
	} catch {
		list = [];
	}
	if (list.length) {
		list.sort((a, b) =>
			String(a.Descripcion || a.idServicio).localeCompare(String(b.Descripcion || b.idServicio), 'es'),
		);
		return list;
	}
	return [{ idServicio: vs, Descripcion: _descripcionDe(vs, '', catalogo) }];
}

async function agregar(valorPersonal, idServicio) {
	await ensureTable();
	const sid = _code(idServicio);
	if (!sid) {
		const e = new Error('idServicio es obligatorio');
		e.statusCode = 400;
		throw e;
	}
	const vp = Number(valorPersonal);
	const dup = await executeQuery(
		`SELECT 1 FROM dbo.imPersonalServicios WHERE idPersonal = @p0 AND LTRIM(RTRIM(idServicio)) = LTRIM(RTRIM(@p1))`,
		[
			{ value: vp, type: 'Int' },
			{ value: sid, type: 'VarChar', length: ID_SERVICIO_LEN },
		],
	);
	if (dup.length) {
		const e = new Error('El servicio ya está asignado');
		e.statusCode = 409;
		throw e;
	}
	await executeQuery(
		`INSERT INTO dbo.imPersonalServicios (idPersonal, idServicio) VALUES (@p0, @p1)`,
		[
			{ value: vp, type: 'Int' },
			{ value: sid, type: 'VarChar', length: ID_SERVICIO_LEN },
		],
	);
	const pers = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(ISNULL(ValorServicio, ''))) AS ValorServicio
		 FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: vp, type: 'Int' }],
	).catch(() => []);
	if (!_code(pers?.[0]?.ValorServicio)) {
		await executeQuery(
			`UPDATE dbo.imPersonal SET ValorServicio = @p1 WHERE Valor = @p0`,
			[
				{ value: vp, type: 'Int' },
				{ value: sid, type: 'VarChar', length: ID_SERVICIO_LEN },
			],
		).catch(() => {});
	}
	return listar(vp);
}

async function quitar(valorPersonal, idServicio) {
	await ensureTable();
	const sid = _code(idServicio);
	if (!sid) {
		const e = new Error('idServicio es obligatorio');
		e.statusCode = 400;
		throw e;
	}
	const vp = Number(valorPersonal);
	await executeQuery(
		`DELETE FROM dbo.imPersonalServicios WHERE idPersonal = @p0 AND LTRIM(RTRIM(idServicio)) = LTRIM(RTRIM(@p1))`,
		[
			{ value: vp, type: 'Int' },
			{ value: sid, type: 'VarChar', length: ID_SERVICIO_LEN },
		],
	);
	return listar(vp);
}

async function codigosDePersonal(valorPersonal) {
	const list = await listar(valorPersonal);
	return list.map((r) => r.idServicio);
}

async function reemplazar(valorPersonal, servicios) {
	await ensureTable();
	const vp = Number(valorPersonal);
	await executeQuery(`DELETE FROM dbo.imPersonalServicios WHERE idPersonal = @p0`, [
		{ value: vp, type: 'Int' },
	]);
	const seen = new Set();
	for (const raw of servicios || []) {
		const sid = _code(raw);
		if (!sid || seen.has(sid.toUpperCase())) continue;
		seen.add(sid.toUpperCase());
		try {
			await executeQuery(
				`INSERT INTO dbo.imPersonalServicios (idPersonal, idServicio) VALUES (@p0, @p1)`,
				[
					{ value: vp, type: 'Int' },
					{ value: sid, type: 'VarChar', length: ID_SERVICIO_LEN },
				],
			);
		} catch (err) {
			const msg = String(err?.message || '');
			if (!/PRIMARY KEY|duplicate|UNIQUE|2627|2601|8152|truncated/i.test(msg)) throw err;
			_tableReady = false;
			await ensureTable();
			await executeQuery(
				`INSERT INTO dbo.imPersonalServicios (idPersonal, idServicio) VALUES (@p0, @p1)`,
				[
					{ value: vp, type: 'Int' },
					{ value: sid, type: 'VarChar', length: ID_SERVICIO_LEN },
				],
			);
		}
	}
	const first = [...seen][0];
	if (first) {
		await executeQuery(
			`UPDATE dbo.imPersonal SET ValorServicio = @p1 WHERE Valor = @p0 AND (ValorServicio IS NULL OR LTRIM(RTRIM(ValorServicio)) = '')`,
			[
				{ value: vp, type: 'Int' },
				{ value: first, type: 'VarChar', length: ID_SERVICIO_LEN },
			],
		).catch(() => {});
	}
	return listar(vp);
}

async function asignarTodos(valorPersonal) {
	await ensureTable();
	const vp = Number(valorPersonal);
	const all = await executeQuery(
		`SELECT RTRIM(LTRIM(Valor)) AS valor FROM dbo.imServicios
		 WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''`,
	);
	for (const r of all || []) {
		const sid = _code(r.valor);
		if (!sid) continue;
		try {
			await agregar(vp, sid);
		} catch (err) {
			if (Number(err?.statusCode) !== 409) {
				console.warn('[personalServicios] asignar', sid, err?.message || err);
			}
		}
	}
	return listar(vp);
}

async function _filasPedidos() {
	try {
		return await executeQuery(
			`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor,
			        RTRIM(LTRIM(CAST(ISNULL(Descripcion, '') AS VARCHAR(200)))) AS descripcion,
			        RTRIM(LTRIM(ISNULL(PrefijosPractica, ''))) AS prefijosPractica
			 FROM dbo.imServicios
			 WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''`,
		);
	} catch {
		return executeQuery(
			`SELECT RTRIM(LTRIM(CAST(Valor AS VARCHAR(50)))) AS valor,
			        RTRIM(LTRIM(CAST(ISNULL(Descripcion, '') AS VARCHAR(200)))) AS descripcion,
			        '' AS prefijosPractica
			 FROM dbo.imServicios
			 WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''`,
		).catch(() => []);
	}
}

function _indexarPedidos(rows) {
	const byKey = new Map();
	const byDesc = new Map();
	for (const r of rows || []) {
		const valor = _code(_col(r, 'valor', 'Valor'));
		if (!valor) continue;
		const item = {
			valor,
			descripcion: String(_col(r, 'descripcion', 'Descripcion') || '').trim(),
			prefijosPractica: String(_col(r, 'prefijosPractica', 'PrefijosPractica') || '').trim(),
		};
		for (const k of _claves(valor)) {
			if (!byKey.has(k)) byKey.set(k, item);
		}
		const nd = _normDesc(item.descripcion);
		if (nd && !byDesc.has(nd)) byDesc.set(nd, item);
	}
	return { byKey, byDesc };
}

async function _catalogoPedidos() {
	return _indexarPedidos(await _filasPedidos());
}

function _itemsPedidosUnicos(cat) {
	const seen = new Set();
	const items = [];
	for (const it of cat.byKey.values()) {
		const k = String(it.valor || '').trim().toUpperCase();
		if (!k || seen.has(k)) continue;
		seen.add(k);
		items.push(it);
	}
	return items;
}

async function _asignacionesNube(vp) {
	try {
		const { getTenantId } = require('../context/tenantContext');
		const tid = Number(getTenantId());
		if (!Number.isFinite(tid) || tid <= 0) return [];
		const nube = require('./nubeTenant.service');
		const items = await nube.listarServiciosDeUsuario(tid, vp);
		return (items || [])
			.map((s) => ({
				idServicio: _code(s.id || s.valor),
				Descripcion: String(s.descripcion || '').trim(),
			}))
			.filter((s) => s.idServicio);
	} catch {
		return [];
	}
}

async function _asignacionesDesdeSectores(vp) {
	const sqlConServicio = `
		SELECT
		  RTRIM(LTRIM(CAST(ps.idSector AS VARCHAR(50)))) AS idSector,
		  RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS sectorDescripcion,
		  RTRIM(LTRIM(CAST(ISNULL(s.ValorServicio, '') AS VARCHAR(50)))) AS valorServicio,
		  RTRIM(LTRIM(CAST(ISNULL(s.Valor, '') AS VARCHAR(50)))) AS valorSector
		 FROM dbo.imPersonalSectores ps
		 LEFT JOIN dbo.imSectores s
		   ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(ps.idSector AS VARCHAR(50))))
		 WHERE ps.idPersonal = @p0`;
	const sqlSinServicio = `
		SELECT
		  RTRIM(LTRIM(CAST(ps.idSector AS VARCHAR(50)))) AS idSector,
		  RTRIM(LTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS sectorDescripcion,
		  '' AS valorServicio,
		  RTRIM(LTRIM(CAST(ISNULL(s.Valor, '') AS VARCHAR(50)))) AS valorSector
		 FROM dbo.imPersonalSectores ps
		 LEFT JOIN dbo.imSectores s
		   ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(ps.idSector AS VARCHAR(50))))
		 WHERE ps.idPersonal = @p0`;
	let rows = [];
	try {
		rows = await executeQuery(sqlConServicio, [{ value: vp, type: 'Int' }]);
	} catch {
		rows = await executeQuery(sqlSinServicio, [{ value: vp, type: 'Int' }]).catch(() => []);
	}
	return (rows || [])
		.map((r) => {
			const idServicio =
				_code(_col(r, 'valorServicio')) ||
				_code(_col(r, 'valorSector')) ||
				_code(_col(r, 'idSector'));
			if (!idServicio) return null;
			return {
				idServicio,
				Descripcion: String(_col(r, 'sectorDescripcion') || '').trim(),
			};
		})
		.filter(Boolean);
}

function _pushAsignacion(bucket, seen, item) {
	const id = _code(item?.idServicio);
	if (!id) return;
	const key = id.toUpperCase();
	if (seen.has(key)) return;
	for (const k of _claves(id)) {
		if (seen.has(`k:${String(k).toUpperCase()}`)) return;
	}
	seen.add(key);
	for (const k of _claves(id)) seen.add(`k:${String(k).toUpperCase()}`);
	bucket.push({ idServicio: id, Descripcion: String(item.Descripcion || '').trim() });
}

async function listarParaBandeja(valorPersonal) {
	const vp = Number(valorPersonal);
	if (!Number.isFinite(vp) || vp <= 0) return [];
	const catalogo = await _catalogoDescripciones();
	const merged = [];
	const seen = new Set();
	for (const a of await listar(vp)) _pushAsignacion(merged, seen, a);
	for (const a of await _asignacionesNube(vp)) _pushAsignacion(merged, seen, a);
	for (const a of await _asignacionesDesdeSectores(vp)) _pushAsignacion(merged, seen, a);
	if (!merged.length) return [];

	const cat = await _catalogoPedidos();
	const out = [];
	const seenVal = new Set();
	for (const a of merged) {
		let item = null;
		for (const k of _claves(a.idServicio)) {
			item = cat.byKey.get(k);
			if (item) break;
		}
		if (!item) {
			const desc = a.Descripcion || _descripcionDe(a.idServicio, '', catalogo);
			const nd = _normDesc(desc);
			if (nd) item = cat.byDesc.get(nd) || null;
			if (!item) {
				for (const it of _itemsPedidosUnicos(cat)) {
					if (
						sectorUsuarioCoincideServicio(
							{ idSector: a.idServicio, descripcion: desc },
							{ valor: it.valor, descripcion: it.descripcion },
						)
					) {
						item = it;
						break;
					}
				}
			}
		}
		const valor = _code(item?.valor || a.idServicio);
		if (!valor) continue;
		const key = valor.toUpperCase();
		if (seenVal.has(key)) continue;
		seenVal.add(key);
		out.push({
			valor,
			descripcion: String(
				item?.descripcion || a.Descripcion || _descripcionDe(valor, '', catalogo) || valor,
			).trim(),
			prefijosPractica: String(item?.prefijosPractica || '').trim(),
		});
	}
	out.sort((a, b) =>
		String(a.descripcion || a.valor).localeCompare(String(b.descripcion || b.valor), 'es'),
	);
	return out;
}

module.exports = {
	ensureTable,
	listar,
	agregar,
	quitar,
	reemplazar,
	codigosDePersonal,
	asignarTodos,
	listarCatalogo,
	listarParaBandeja,
	descripcionDe: _descripcionDe,
	catalogoDescripciones: _catalogoDescripciones,
};
