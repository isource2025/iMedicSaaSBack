const { executeQuery } = require('../models/db');

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

function _asRows(rows) {
	if (Array.isArray(rows)) return rows;
	if (rows && Array.isArray(rows.recordset)) return rows.recordset;
	return [];
}

function _col(row, ...names) {
	if (!row || typeof row !== 'object') return undefined;
	const lower = {};
	for (const [k, v] of Object.entries(row)) {
		lower[String(k).toLowerCase().trim()] = v;
	}
	for (const n of names) {
		const v = lower[String(n).toLowerCase().trim()];
		if (v != null && String(v).trim() !== '') return v;
		try {
			const direct = row[n];
			if (direct != null && String(direct).trim() !== '') return direct;
		} catch {
			/* getters raros de mssql */
		}
	}
	return undefined;
}

function _mapSector(r) {
	const id = String(_col(r, 'IdSector', 'idSector', 'Valor', 'valor') || '').trim();
	if (!id || id === '0') return null;
	return {
		IdSector: id,
		Descripcion: String(_col(r, 'Descripcion', 'descripcion', 'descripcionSector') || '').trim(),
		AmbInt: String(_col(r, 'AmbInt', 'ambInt') || '').trim(),
		ValorServicio: String(_col(r, 'ValorServicio', 'valorServicio') || '').trim(),
		DescripcionServicio: String(_col(r, 'DescripcionServicio', 'descripcionServicio') || '').trim(),
	};
}

async function _sectoresNube() {
	try {
		const { getTenantId } = require('../context/tenantContext');
		const tid = Number(getTenantId());
		if (!Number.isFinite(tid) || tid <= 0) return [];
		const nube = require('./nubeTenant.service');
		const items = await nube.listarSectores(tid);
		const mapped = (items || [])
			.map((s) =>
				_mapSector({
					IdSector: s.id || s.valor,
					Descripcion: s.descripcion,
					AmbInt: s.ambInt,
					ValorServicio: s.valorServicio,
					DescripcionServicio: s.descripcionServicio,
				}),
			)
			.filter(Boolean);
		if (mapped.length) {
			console.log(`[sectores] catalogo nube emp=${tid} n=${mapped.length}`);
		}
		return mapped;
	} catch (err) {
		console.warn('[sectores] catalogo nube:', err?.message || err);
		return [];
	}
}

const obtenerSectores = async () => {
	const desdeNube = await _sectoresNube();
	if (desdeNube.length) {
		return desdeNube.sort((a, b) =>
			String(a.Descripcion || a.IdSector).localeCompare(String(b.Descripcion || b.IdSector), 'es'),
		);
	}

	const queries = [
		`
      SELECT
        LTRIM(RTRIM(Valor)) AS IdSector,
        LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
        LTRIM(RTRIM(ISNULL(AmbInt, ''))) AS AmbInt,
        LTRIM(RTRIM(ISNULL(ValorServicio, ''))) AS ValorServicio
      FROM dbo.imSectores WITH (NOLOCK)
      ORDER BY Descripcion`,
		`
      SELECT
        LTRIM(RTRIM(Valor)) AS IdSector,
        LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion
      FROM dbo.imSectores WITH (NOLOCK)
      ORDER BY Descripcion`,
		`SELECT Valor AS IdSector, Descripcion FROM imSectores WITH (NOLOCK)`,
	];
	let raw = [];
	for (const sqlText of queries) {
		try {
			raw = _asRows(await executeQuery(sqlText));
			if (raw.length) break;
		} catch (err) {
			console.warn('[sectores] catalogo sql:', err?.message || err);
		}
	}

	const mapped = [];
	const seen = new Set();
	for (const r of raw) {
		const m = _mapSector(r);
		if (!m) continue;
		const k = m.IdSector.toUpperCase();
		if (seen.has(k)) continue;
		seen.add(k);
		mapped.push(m);
	}
	if (raw.length && !mapped.length) {
		console.warn('[sectores] filas sin mapear, keys=', Object.keys(raw[0] || {}));
	}
	return mapped.sort((a, b) =>
		String(a.Descripcion || a.IdSector).localeCompare(String(b.Descripcion || b.IdSector), 'es'),
	);
};

async function crearSector({ valor, descripcion, ambInt }) {
	const id = String(valor || '')
		.trim()
		.toUpperCase()
		.slice(0, 10);
	const desc = String(descripcion || '').trim();
	if (!id) throw _httpError('El código del sector es obligatorio');
	if (!desc) throw _httpError('La descripción del sector es obligatoria');
	const amb = String(ambInt || 'A').trim().slice(0, 1) || 'A';

	const dup = await executeQuery(`SELECT TOP 1 Valor FROM dbo.imSectores WHERE LTRIM(RTRIM(Valor)) = @p0`, [
		{ value: id, type: 'VarChar' },
	]);
	if (dup?.length) throw _httpError('Ya existe un sector con ese código', 409);

	const valorServicio = `${id} `.slice(0, 4);
	await executeQuery(
		`
    INSERT INTO dbo.imSectores (Valor, ValorServicio, Descripcion, ProtocoloN, AmbInt)
    VALUES (@p0, @p1, @p2, 0, @p3)
    `,
		[
			{ value: id, type: 'VarChar' },
			{ value: valorServicio, type: 'VarChar' },
			{ value: desc, type: 'VarChar' },
			{ value: amb, type: 'Char' },
		],
	);
	return { IdSector: id, Descripcion: desc, AmbInt: amb };
}

async function actualizarSector(valor, { descripcion, ambInt }) {
	const id = String(valor || '').trim().toUpperCase();
	const desc = String(descripcion || '').trim();
	if (!id) throw _httpError('Código inválido');
	if (!desc) throw _httpError('La descripción es obligatoria');

	const params = [
		{ value: id, type: 'VarChar' },
		{ value: desc, type: 'VarChar' },
	];
	let sql = `UPDATE dbo.imSectores SET Descripcion = @p1`;
	if (ambInt != null && String(ambInt).trim() !== '') {
		sql += `, AmbInt = @p2`;
		params.push({ value: String(ambInt).trim().slice(0, 1), type: 'Char' });
		sql += ` WHERE LTRIM(RTRIM(Valor)) = @p0`;
	} else {
		sql += ` WHERE LTRIM(RTRIM(Valor)) = @p0`;
	}
	const r = await executeQuery(sql, params);
	return { IdSector: id, Descripcion: desc, AmbInt: ambInt ?? null, rowsAffected: r };
}

async function obtenerServiciosMedicos() {
	const rows = await executeQuery(
		`
    SELECT
      LTRIM(RTRIM(Valor)) AS IdServicio,
      LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion
    FROM dbo.imServiciosMedicos
    ORDER BY Descripcion
    `,
	);
	return rows || [];
}

async function crearServicioMedico({ valor, descripcion }) {
	const id = String(valor || '').trim().slice(0, 10);
	const desc = String(descripcion || '').trim();
	if (!id) throw _httpError('El código del servicio es obligatorio');
	if (!desc) throw _httpError('La descripción del servicio es obligatoria');

	const dup = await executeQuery(
		`SELECT TOP 1 Valor FROM dbo.imServiciosMedicos WHERE LTRIM(RTRIM(Valor)) = @p0`,
		[{ value: id, type: 'VarChar' }],
	);
	if (dup?.length) throw _httpError('Ya existe un servicio con ese código', 409);

	await executeQuery(
		`INSERT INTO dbo.imServiciosMedicos (Valor, Descripcion) VALUES (@p0, @p1)`,
		[
			{ value: id, type: 'VarChar' },
			{ value: desc, type: 'VarChar' },
		],
	);
	return { IdServicio: id, Descripcion: desc };
}

async function actualizarServicioMedico(valor, { descripcion }) {
	const id = String(valor || '').trim();
	const desc = String(descripcion || '').trim();
	if (!id) throw _httpError('Código inválido');
	if (!desc) throw _httpError('La descripción es obligatoria');
	await executeQuery(
		`UPDATE dbo.imServiciosMedicos SET Descripcion = @p1 WHERE LTRIM(RTRIM(Valor)) = @p0`,
		[
			{ value: id, type: 'VarChar' },
			{ value: desc, type: 'VarChar' },
		],
	);
	return { IdServicio: id, Descripcion: desc };
}

module.exports = {
	obtenerSectores,
	crearSector,
	actualizarSector,
	obtenerServiciosMedicos,
	crearServicioMedico,
	actualizarServicioMedico,
};
