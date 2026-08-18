const { executeQuery } = require('../models/db');

let _tableReady = false;

function _code(v) {
	return String(v || '').trim();
}

async function ensureTable() {
	if (_tableReady) return;
	await executeQuery(`
		IF OBJECT_ID(N'dbo.imPersonalServicios', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imPersonalServicios (
				idPersonal INT NOT NULL,
				idServicio VARCHAR(20) NOT NULL,
				CONSTRAINT PK_imPersonalServicios PRIMARY KEY (idPersonal, idServicio)
			);
			CREATE INDEX IX_imPersonalServicios_idServicio
				ON dbo.imPersonalServicios (idServicio);
		END
	`);
	_tableReady = true;
}

async function listar(valorPersonal) {
	await ensureTable();
	const vp = Number(valorPersonal);
	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(ps.idServicio)) AS idServicio,
		        RTRIM(LTRIM(ISNULL(s.Descripcion, ps.idServicio))) AS Descripcion
		 FROM dbo.imPersonalServicios ps
		 LEFT JOIN dbo.imServicios s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(ps.idServicio))
		 WHERE ps.idPersonal = @p0
		 ORDER BY ISNULL(s.Descripcion, ps.idServicio)`,
		[{ value: vp, type: 'Int' }],
	);
	const list = (rows || []).map((r) => ({
		idServicio: _code(r.idServicio),
		Descripcion: _code(r.Descripcion) || _code(r.idServicio),
	})).filter((r) => r.idServicio);

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
		if (Number(err?.statusCode) !== 409) throw err;
	}
	const again = await executeQuery(
		`SELECT RTRIM(LTRIM(ps.idServicio)) AS idServicio,
		        RTRIM(LTRIM(ISNULL(s.Descripcion, ps.idServicio))) AS Descripcion
		 FROM dbo.imPersonalServicios ps
		 LEFT JOIN dbo.imServicios s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(ps.idServicio))
		 WHERE ps.idPersonal = @p0
		 ORDER BY ISNULL(s.Descripcion, ps.idServicio)`,
		[{ value: vp, type: 'Int' }],
	);
	return (again || []).map((r) => ({
		idServicio: _code(r.idServicio),
		Descripcion: _code(r.Descripcion) || _code(r.idServicio),
	})).filter((r) => r.idServicio);
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
			{ value: sid, type: 'VarChar' },
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
			{ value: sid, type: 'VarChar' },
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
				{ value: sid, type: 'VarChar' },
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
			{ value: sid, type: 'VarChar' },
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
		if (!sid || seen.has(sid)) continue;
		seen.add(sid);
		await executeQuery(
			`INSERT INTO dbo.imPersonalServicios (idPersonal, idServicio) VALUES (@p0, @p1)`,
			[
				{ value: vp, type: 'Int' },
				{ value: sid, type: 'VarChar' },
			],
		);
	}
	const first = [...seen][0];
	if (first) {
		await executeQuery(
			`UPDATE dbo.imPersonal SET ValorServicio = @p1 WHERE Valor = @p0 AND (ValorServicio IS NULL OR LTRIM(RTRIM(ValorServicio)) = '')`,
			[
				{ value: vp, type: 'Int' },
				{ value: first, type: 'VarChar' },
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
