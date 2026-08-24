const { executeQuery } = require('../models/db');

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

async function _catalogoDescripciones() {
	const map = new Map();
	const add = (rows) => {
		for (const r of rows || []) {
			const valor = _code(_col(r, 'Valor', 'IdServicio'));
			const desc = String(_col(r, 'Descripcion') || '').trim();
			if (!valor || !desc || _esCodigo(desc, valor)) continue;
			for (const k of _claves(valor)) {
				if (!map.has(k)) map.set(k, desc);
			}
		}
	};
	for (const sql of [
		`SELECT Valor, Descripcion FROM dbo.imServicios`,
		`SELECT Valor, Descripcion FROM dbo.imServiciosMedicos`,
	]) {
		try {
			add(await executeQuery(sql));
		} catch {
			/* tabla ausente */
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
		        RTRIM(LTRIM(CAST(ISNULL(NULLIF(LTRIM(RTRIM(CAST(s.Descripcion AS VARCHAR(200)))), ''), '') AS VARCHAR(200)))) AS Descripcion
		 FROM dbo.imPersonalServicios ps
		 LEFT JOIN dbo.imServicios s
		   ON LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(ps.idServicio AS VARCHAR(50))))
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

module.exports = {
	ensureTable,
	listar,
	agregar,
	quitar,
	reemplazar,
	codigosDePersonal,
	asignarTodos,
};
