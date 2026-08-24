const { executeQuery } = require('../models/db');

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
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

function _mapSector(r) {
	const id = String(_col(r, 'IdSector', 'idSector', 'Valor', 'valor', 'id') || '').trim();
	if (!id) return null;
	return {
		IdSector: id,
		Descripcion: String(_col(r, 'Descripcion', 'descripcion') || '').trim(),
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
		return (items || [])
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
	} catch {
		return [];
	}
}

const obtenerSectores = async () => {
	const sqlConServicio = `
      SELECT
        LTRIM(RTRIM(CAST(s.Valor AS VARCHAR(50)))) AS IdSector,
        LTRIM(RTRIM(CAST(ISNULL(s.Descripcion, '') AS VARCHAR(200)))) AS Descripcion,
        LTRIM(RTRIM(CAST(ISNULL(s.AmbInt, '') AS VARCHAR(4)))) AS AmbInt,
        LTRIM(RTRIM(CAST(ISNULL(s.ValorServicio, '') AS VARCHAR(50)))) AS ValorServicio,
        LTRIM(RTRIM(CAST(ISNULL(srv.Descripcion, '') AS VARCHAR(200)))) AS DescripcionServicio
      FROM dbo.imSectores s
      LEFT JOIN dbo.imServicios srv
        ON LTRIM(RTRIM(CAST(srv.Valor AS VARCHAR(50)))) = LTRIM(RTRIM(CAST(s.ValorServicio AS VARCHAR(50))))
      WHERE LTRIM(RTRIM(ISNULL(s.Valor, ''))) <> ''
      ORDER BY s.Descripcion`;
	const sqlMin = `
      SELECT
        LTRIM(RTRIM(CAST(Valor AS VARCHAR(50)))) AS IdSector,
        LTRIM(RTRIM(CAST(ISNULL(Descripcion, '') AS VARCHAR(200)))) AS Descripcion
      FROM dbo.imSectores
      WHERE LTRIM(RTRIM(ISNULL(Valor, ''))) <> ''
      ORDER BY Descripcion`;
	let rows = [];
	try {
		rows = await executeQuery(sqlConServicio);
	} catch {
		try {
			rows = await executeQuery(sqlMin);
		} catch (e2) {
			console.error('Error al obtener sectores:', e2);
			rows = [];
		}
	}
	const mapped = (rows || []).map(_mapSector).filter(Boolean);
	if (mapped.length) return mapped;
	return _sectoresNube();
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
