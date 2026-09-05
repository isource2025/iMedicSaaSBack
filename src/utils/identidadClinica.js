/**
 * Valida que ProfesionalAsiste / OperadorCarga existan y estén vinculados
 * en el SQL del hospital. Evita grabar IDs huérfanos que luego el listado
 * no puede resolver (errores silenciosos).
 */
const { executeQuery } = require('../models/db');

function errIdentidad(mensaje, detalle = {}) {
	const e = new Error(mensaje);
	e.statusCode = 400;
	e.code = 'IDENTIDAD_CLINICA';
	e.detalle = detalle;
	return e;
}

/**
 * Resuelve ficha + cuenta a partir del valor que Clarion guarda en ProfesionalAsiste
 * (matrícula, ValorPersonal o CodOperador).
 */
async function resolverIdentidadProfesional(profesionalAsiste) {
	const id = Number(profesionalAsiste);
	if (!Number.isFinite(id) || id <= 0) {
		throw errIdentidad(
			'No se puede grabar: la sesión no tiene matrícula ni operador clínico válido.',
			{ profesionalAsiste },
		);
	}

	const personal = await executeQuery(
		`
    SELECT TOP 1
      Valor,
      Matricula,
      LTRIM(RTRIM(ISNULL(ApellidoNombre, ''))) AS ApellidoNombre
    FROM dbo.imPersonal
    WHERE Valor = @p0 OR Matricula = @p0
    ORDER BY CASE WHEN Valor = @p0 THEN 0 ELSE 1 END
    `,
		[{ value: id, type: 'Int' }],
	);

	if (personal?.[0]) {
		const valor = Number(personal[0].Valor);
		const cuenta = await executeQuery(
			`
      SELECT TOP 1
        ValorPersonal,
        CodOperador,
        LTRIM(RTRIM(ISNULL(NombreRed, ''))) AS NombreRed
      FROM dbo.imPassword
      WHERE ValorPersonal = @p0
      `,
			[{ value: valor, type: 'Int' }],
		);

		if (!cuenta?.[0]) {
			throw errIdentidad(
				`No se puede grabar la indicación: el profesional "${personal[0].ApellidoNombre || valor}" (Valor=${valor}, matrícula=${personal[0].Matricula ?? '—'}) no tiene cuenta de acceso (imPassword) vinculada a esa ficha. Corregí la vinculación en Personal antes de indicar.`,
				{
					profesionalAsiste: id,
					valorPersonal: valor,
					matricula: personal[0].Matricula,
					motivo: 'SIN_CUENTA_IMPASSWORD',
				},
			);
		}

		return {
			modo: 'personal',
			valorPersonal: valor,
			matricula: personal[0].Matricula != null ? Number(personal[0].Matricula) : null,
			apellidoNombre: personal[0].ApellidoNombre,
			nombreRed: cuenta[0].NombreRed,
			codOperador: cuenta[0].CodOperador,
		};
	}

	// Enfermería / operadores sin ficha por matrícula: CodOperador o ValorPersonal directo
	const soloCuenta = await executeQuery(
		`
    SELECT TOP 1
      ValorPersonal,
      CodOperador,
      LTRIM(RTRIM(ISNULL(NombreRed, ''))) AS NombreRed,
      LTRIM(RTRIM(ISNULL(Apellido, '') + ' ' + ISNULL(Nombres, ''))) AS Nombre
    FROM dbo.imPassword
    WHERE ValorPersonal = @p0 OR CodOperador = @p0
    ORDER BY CASE WHEN ValorPersonal = @p0 THEN 0 ELSE 1 END
    `,
		[{ value: id, type: 'Int' }],
	);

	if (!soloCuenta?.[0]) {
		throw errIdentidad(
			`No se puede grabar la indicación: el identificador profesional ${id} no existe como matrícula, personal ni cuenta (imPassword) en este establecimiento. Revisá la matrícula del usuario o la vinculación de la cuenta.`,
			{ profesionalAsiste: id, motivo: 'ID_HUERFANO' },
		);
	}

	return {
		modo: 'cuenta',
		valorPersonal: Number(soloCuenta[0].ValorPersonal),
		matricula: null,
		apellidoNombre: soloCuenta[0].Nombre,
		nombreRed: soloCuenta[0].NombreRed,
		codOperador: soloCuenta[0].CodOperador,
	};
}

async function assertOperadorCarga(operadorCarga) {
	const op = Number(operadorCarga);
	if (!Number.isFinite(op)) {
		throw errIdentidad(
			'No se puede grabar: la sesión no tiene CodOperador válido (OperadorCarga).',
			{ operadorCarga },
		);
	}

	const rows = await executeQuery(
		`
    SELECT TOP 1 ValorPersonal, CodOperador, NombreRed
    FROM dbo.imPassword
    WHERE CodOperador = @p0 OR ValorPersonal = @p0
    `,
		[{ value: op, type: 'Int' }],
	);

	if (!rows?.[0]) {
		throw errIdentidad(
			`No se puede grabar: OperadorCarga=${op} no existe en imPassword. La cuenta de sesión está mal vinculada.`,
			{ operadorCarga: op, motivo: 'OPERADOR_HUERFANO' },
		);
	}

	return rows[0];
}

/**
 * Valida identidad antes de INSERT/UPDATE de indicación.
 * @returns {Promise<{profesional: object, operador: object}>}
 */
async function assertIdentidadParaIndicacion({ ProfesionalAsiste, OperadorCarga }) {
	const profesional = await resolverIdentidadProfesional(ProfesionalAsiste);
	const operador = await assertOperadorCarga(OperadorCarga);
	return { profesional, operador };
}

module.exports = {
	resolverIdentidadProfesional,
	assertOperadorCarga,
	assertIdentidadParaIndicacion,
};
