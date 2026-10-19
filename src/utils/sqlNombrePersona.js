/**
 * Nombre "Apellido Nombres" de quien hizo un registro clínico (SQL Server).
 *
 * CodOperador e imPersonal.Valor (= imPassword.ValorPersonal) son claves independientes:
 * el mismo número puede ser el CodOperador de una persona y el Valor de otra. Cada
 * columna de autor guarda una sola de ellas, la que graba el escritorio Clarion:
 *   - CodOperador: OperadorCarga, imHCI.IdProfecional  → sqlApplyOperador
 *   - Valor:       Profesional, ProfesionalAsiste      → sqlApplyFicha
 * Las claves siguientes del orden solo nombran filas que versiones anteriores de la web
 * grabaron con otra clave; nunca le ganan a la clave propia de la columna.
 *
 * Expone `<alias>.NombreCompleto`, `<alias>.ValorPersonal` y `<alias>.Matricula`.
 * CodOperador se compara como texto: en algunas bases Clarion es VARCHAR con valores
 * no numéricos y la conversión implícita a INT haría fallar toda la consulta.
 */
const ORDEN_OPERADOR = ['operador', 'valor', 'matricula'];
const ORDEN_FICHA = ['valor', 'matricula', 'operador'];
const CLAVES = ORDEN_OPERADOR;

const nombreCuenta = (a) =>
	`NULLIF(LTRIM(RTRIM(ISNULL(${a}.Apellido, '') + ' ' + ISNULL(${a}.Nombres, ''))), '')`;

function sqlApplyNombrePersona(columnaOriginal, alias, orden = CLAVES) {
	// 0 = "sin profesional" en Clarion; sin esto matchea con cualquier ficha de Valor/CodOperador 0.
	const columna = `NULLIF(${columnaOriginal}, 0)`;
	const rama = (valor, nombre, prio, desde) =>
		`SELECT ${valor} AS ValorPersonal, CAST(${nombre} AS VARCHAR(400)) AS NombreCuenta, ${prio} AS Prio ${desde}`;
	const ramas = [];
	orden.forEach((clave, prio) => {
		if (clave === 'operador') {
			ramas.push(
				rama(
					'pw0.ValorPersonal',
					nombreCuenta('pw0'),
					prio,
					`FROM dbo.imPassword pw0
					 WHERE LTRIM(RTRIM(CAST(pw0.CodOperador AS VARCHAR(40)))) = CAST(${columna} AS VARCHAR(40))`,
				),
			);
		} else if (clave === 'valor') {
			ramas.push(
				rama('per0.Valor', 'NULL', prio, `FROM dbo.imPersonal per0 WHERE per0.Valor = ${columna}`),
				rama('pw1.ValorPersonal', nombreCuenta('pw1'), prio, `FROM dbo.imPassword pw1 WHERE pw1.ValorPersonal = ${columna}`),
			);
		} else if (clave === 'matricula') {
			ramas.push(
				rama('per1.Valor', 'NULL', prio, `FROM dbo.imPersonal per1 WHERE per1.Matricula = ${columna}`),
			);
		} else {
			throw new Error(`sqlApplyNombrePersona: clave desconocida "${clave}"`);
		}
	});

	const nombre = `COALESCE(
		c.NombreCuenta,
		${nombreCuenta('pwN')},
		NULLIF(LTRIM(RTRIM(perN.ApellidoNombre)), '')
	)`;

	return `
	OUTER APPLY (
		SELECT TOP 1
			${nombre} AS NombreCompleto,
			COALESCE(perN.Valor, c.ValorPersonal) AS ValorPersonal,
			perN.Matricula AS Matricula
		FROM (
			${ramas.join('\n\t\t\tUNION ALL\n\t\t\t')}
		) c
		LEFT JOIN dbo.imPersonal perN ON perN.Valor = c.ValorPersonal
		OUTER APPLY (
			SELECT TOP 1 pwx.Apellido, pwx.Nombres
			FROM dbo.imPassword pwx
			WHERE pwx.ValorPersonal = c.ValorPersonal
		) pwN
		WHERE ${nombre} IS NOT NULL
		ORDER BY c.Prio
	) ${alias}`;
}

const sqlApplyOperador = (columna, alias) => sqlApplyNombrePersona(columna, alias, ORDEN_OPERADOR);
const sqlApplyFicha = (columna, alias) => sqlApplyNombrePersona(columna, alias, ORDEN_FICHA);

module.exports = { sqlApplyNombrePersona, sqlApplyOperador, sqlApplyFicha };
