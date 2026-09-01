const { executeQuery } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');

const ID_SERVICIO_LEN = 50;

function _code(v) {
	return String(v || '').trim().slice(0, ID_SERVICIO_LEN);
}

const ensureTable = createTenantOnce(async () => {
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
	} catch (err) {
		console.warn('[personalServicios] ensureTable:', err?.message || err);
	}
});

function _mapRows(rows) {
	return (rows || [])
		.map((r) => ({
			idServicio: _code(r.idServicio),
			Descripcion: String(r.Descripcion || r.idServicio || '').trim() || _code(r.idServicio),
		}))
		.filter((r) => r.idServicio);
}

async function listar(valorPersonal) {
	await ensureTable();
	const vp = Number(valorPersonal);
	const sqlConCatalogo = `SELECT RTRIM(LTRIM(ps.idServicio)) AS idServicio,
		        RTRIM(LTRIM(ISNULL(s.Descripcion, ps.idServicio))) AS Descripcion
		 FROM dbo.imPersonalServicios ps
		 LEFT JOIN dbo.imServicios s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(ps.idServicio))
		 WHERE ps.idPersonal = @p0
		 ORDER BY ISNULL(s.Descripcion, ps.idServicio)`;
	const sqlSinCatalogo = `SELECT RTRIM(LTRIM(ps.idServicio)) AS idServicio,
		        RTRIM(LTRIM(ps.idServicio)) AS Descripcion
		 FROM dbo.imPersonalServicios ps
		 WHERE ps.idPersonal = @p0`;
	let list = [];
	try {
		list = _mapRows(await executeQuery(sqlConCatalogo, [{ value: vp, type: 'Int' }]));
	} catch (err) {
		try {
			list = _mapRows(await executeQuery(sqlSinCatalogo, [{ value: vp, type: 'Int' }]));
		} catch (err2) {
			console.warn('[personalServicios] listar:', err2?.message || err?.message);
			return [];
		}
	}

	if (list.length) return list;

	const legacy = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(ISNULL(ValorServicio, ''))) AS ValorServicio
		 FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: vp, type: 'Int' }],
	).catch(() => []);
	const vs = _code(legacy?.[0]?.ValorServicio);
	if (!vs) return [];
	try {
		await agregar(vp, vs);
	} catch (err) {
		if (Number(err?.statusCode) !== 409) {
			console.warn('[personalServicios] legacy:', err?.message || err);
			return [{ idServicio: vs, Descripcion: vs }];
		}
	}
	try {
		return _mapRows(await executeQuery(sqlConCatalogo, [{ value: vp, type: 'Int' }]));
	} catch {
		try {
			return _mapRows(await executeQuery(sqlSinCatalogo, [{ value: vp, type: 'Int' }]));
		} catch {
			return [{ idServicio: vs, Descripcion: vs }];
		}
	}
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
			ensureTable.reset();
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
