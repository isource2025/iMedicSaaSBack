const { executeQuery } = require('../models/db');

function _httpError(message, statusCode = 400) {
	const e = new Error(message);
	e.statusCode = statusCode;
	return e;
}

/**
 * Obtiene todos los sectores
 */
const obtenerSectores = async () => {
	try {
		const consulta = `
      SELECT 
        LTRIM(RTRIM(Valor)) as IdSector,
        LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
        LTRIM(RTRIM(ISNULL(AmbInt, ''))) AS AmbInt
      FROM dbo.imSectores
      ORDER BY Descripcion
    `;
		return await executeQuery(consulta);
	} catch (error) {
		try {
			return await executeQuery(`
      SELECT 
        LTRIM(RTRIM(Valor)) as IdSector,
        LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion
      FROM dbo.imSectores
      ORDER BY Descripcion
    `);
		} catch (e2) {
			console.error('Error al obtener sectores:', e2);
			throw e2;
		}
	}
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
