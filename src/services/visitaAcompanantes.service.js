/**
 * @fileoverview Acompañantes, observación y novedades de una visita.
 *
 * Nombres legacy: los acompañantes viven en imVisitaFamiliarCercano y las
 * novedades en imVisiNovedades (no imAcompañantes / imVisitasNovedades).
 * La observación es el campo imVisita.OBSERVACIONES.
 * @module services/visitaAcompanantes.service
 */
const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	clarionAIsoCalendario,
	convertirHoraClarionAString,
	fechaCalendarioArgentina,
	horaWallArgentina,
} = require('../utils/dateUtils');

/** imVisitaFamiliarCercano.FechaFin es NOT NULL; 0 = sin vencimiento. */
const SIN_VENCIMIENTO = 0;

function errorHttp(mensaje, statusCode) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	return err;
}

function texto(valor, maxLength) {
	const s = valor == null ? '' : String(valor).trim();
	return maxLength ? s.slice(0, maxLength) : s;
}

function enteroOCero(valor) {
	const n = Number(valor);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function visitaValida(numeroVisita) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) {
		throw errorHttp('Número de visita inválido', 400);
	}
	return Math.trunc(nv);
}

function ahoraClarion() {
	return {
		fecha: convertirFechaAClarion(fechaCalendarioArgentina()),
		hora: convertirHoraAClarion(horaWallArgentina(true)),
	};
}

function isoDesdeClarion(valor) {
	const n = Number(valor);
	if (!Number.isFinite(n) || n <= 0) return '';
	try {
		return clarionAIsoCalendario(n) || '';
	} catch {
		return '';
	}
}

function horaDesdeClarion(valor) {
	const n = Number(valor);
	if (!Number.isFinite(n) || n <= 0) return '';
	try {
		return String(convertirHoraClarionAString(n) || '').slice(0, 5);
	} catch {
		return '';
	}
}

async function existeVisita(nv) {
	const filas = await executeQuery(
		`SELECT TOP 1 NUMEROVISITA FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
		[{ value: nv, type: 'Int' }],
	);
	return Array.isArray(filas) && filas.length > 0;
}

/* ------------------------------------------------------------------ */
/* Catálogos                                                           */
/* ------------------------------------------------------------------ */

/**
 * Parentescos y roles de contacto para los selects del formulario.
 * @returns {Promise<{parentescos: Array, rolesContacto: Array}>}
 */
async function obtenerCatalogos() {
	const [parentescos, rolesContacto] = await Promise.all([
		executeQuery(
			`SELECT LTRIM(RTRIM(Valor)) AS Valor, LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion
			 FROM dbo.imParentesco
			 ORDER BY Descripcion`,
		).catch(() => []),
		executeQuery(
			`SELECT LTRIM(RTRIM(Valor)) AS Valor, LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion
			 FROM dbo.imRolContacto
			 ORDER BY Descripcion`,
		).catch(() => []),
	]);

	return { parentescos: parentescos || [], rolesContacto: rolesContacto || [] };
}

/* ------------------------------------------------------------------ */
/* Acompañantes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Acompañantes cargados para la visita.
 *
 * La PK legacy son 7 columnas, así que se devuelven todas: el front las manda
 * de vuelta tal cual para poder borrar una fila puntual.
 */
async function listarAcompanantes(numeroVisita) {
	const nv = visitaValida(numeroVisita);

	const filas = await executeQuery(
		`
		SELECT
			a.NumeroVisita,
			LTRIM(RTRIM(ISNULL(a.Apellidos, ''))) AS Apellidos,
			LTRIM(RTRIM(ISNULL(a.Parentesco, ''))) AS Parentesco,
			LTRIM(RTRIM(ISNULL(p.Descripcion, ''))) AS ParentescoDescripcion,
			LTRIM(RTRIM(ISNULL(a.RolContacto, ''))) AS RolContacto,
			LTRIM(RTRIM(ISNULL(rc.Descripcion, ''))) AS RolContactoDescripcion,
			LTRIM(RTRIM(ISNULL(a.TipoDocumento, ''))) AS TipoDocumento,
			ISNULL(a.NumeroDocumento, 0) AS NumeroDocumento,
			LTRIM(RTRIM(ISNULL(a.Telefono, ''))) AS Telefono,
			LTRIM(RTRIM(ISNULL(a.TelefonoNegocio, ''))) AS TelefonoAlternativo,
			LTRIM(RTRIM(ISNULL(a.Direccion, ''))) AS Direccion,
			a.FechaComienzo,
			a.FechaFin,
			a.FechaCarga,
			a.HoraCarga,
			LTRIM(RTRIM(ISNULL(a.Operador, ''))) AS Operador,
			LTRIM(RTRIM(CONCAT(ISNULL(op.Apellido, ''), ' ', ISNULL(op.Nombres, '')))) AS OperadorNombre
		FROM dbo.imVisitaFamiliarCercano a
		LEFT JOIN dbo.imParentesco p ON p.Valor = a.Parentesco
		LEFT JOIN dbo.imRolContacto rc ON rc.Valor = a.RolContacto
		-- La base corre en compat level 100: sin TRY_CONVERT, se compara como texto.
		LEFT JOIN dbo.imPassword op ON CONVERT(varchar(11), op.CodOperador) = LTRIM(RTRIM(a.Operador))
		WHERE a.NumeroVisita = @p0
		ORDER BY a.FechaCarga DESC, a.HoraCarga DESC
		`,
		[{ value: nv, type: 'Int' }],
	);

	return (filas || []).map((f) => ({
		...f,
		FechaCargaISO: isoDesdeClarion(f.FechaCarga),
		HoraCargaISO: horaDesdeClarion(f.HoraCarga),
	}));
}

/**
 * Alta de un acompañante.
 *
 * Del legacy sólo se completan los campos propios del acompañante: el resto de
 * las 43 columnas replica datos del paciente y queda vacío.
 */
async function agregarAcompanante(numeroVisita, datos, { codOperador } = {}) {
	const nv = visitaValida(numeroVisita);

	const apellidos = texto(datos?.apellidos, 40);
	if (!apellidos) throw errorHttp('El apellido y nombre del acompañante es obligatorio', 400);

	const parentesco = texto(datos?.parentesco, 3).toUpperCase();
	if (!parentesco) throw errorHttp('El parentesco es obligatorio', 400);

	if (!(await existeVisita(nv))) throw errorHttp('La visita no existe', 404);

	const { fecha: fechaCarga, hora: horaCarga } = ahoraClarion();

	const params = [
		{ value: nv, type: 'Int' },
		{ value: apellidos, type: 'VarChar', length: 40 },
		{ value: parentesco, type: 'VarChar', length: 3 },
		{ value: texto(datos?.direccion, 40), type: 'VarChar', length: 40 },
		{ value: texto(datos?.telefono, 20), type: 'VarChar', length: 20 },
		{ value: texto(datos?.telefonoAlternativo, 20), type: 'VarChar', length: 20 },
		{ value: texto(datos?.rolContacto, 3).toUpperCase(), type: 'VarChar', length: 3 },
		{ value: texto(datos?.tipoDocumento, 3).toUpperCase(), type: 'VarChar', length: 3 },
		{ value: enteroOCero(datos?.numeroDocumento), type: 'Int' },
		{ value: fechaCarga, type: 'Int' },
		{ value: SIN_VENCIMIENTO, type: 'Int' },
		{ value: codOperador != null ? String(codOperador) : '', type: 'VarChar', length: 10 },
		{ value: fechaCarga, type: 'Int' },
		{ value: horaCarga, type: 'Int' },
	];

	await executeQuery(
		`
		INSERT INTO dbo.imVisitaFamiliarCercano
			(NumeroVisita, Apellidos, Parentesco, Direccion, Telefono, TelefonoNegocio,
			 RolContacto, TipoDocumento, NumeroDocumento,
			 FechaComienzo, FechaFin, Operador, FechaCarga, HoraCarga)
		VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13);
		`,
		params,
	);

	return listarAcompanantes(nv);
}

/**
 * Baja de un acompañante. Requiere la PK completa porque la tabla legacy no
 * tiene identity ni ninguna columna única por sí sola.
 */
async function quitarAcompanante(numeroVisita, clave) {
	const nv = visitaValida(numeroVisita);

	const apellidos = texto(clave?.apellidos, 40);
	const parentesco = texto(clave?.parentesco, 3).toUpperCase();
	const fechaComienzo = Number(clave?.fechaComienzo);
	const fechaFin = Number(clave?.fechaFin);
	const fechaCarga = Number(clave?.fechaCarga);
	const horaCarga = Number(clave?.horaCarga);

	const clavesNumericas = [fechaComienzo, fechaFin, fechaCarga, horaCarga];
	if (!apellidos || !parentesco || clavesNumericas.some((v) => !Number.isFinite(v))) {
		throw errorHttp('Faltan datos para identificar al acompañante', 400);
	}

	await executeQuery(
		`
		DELETE FROM dbo.imVisitaFamiliarCercano
		WHERE NumeroVisita = @p0
		  AND Apellidos = @p1
		  AND Parentesco = @p2
		  AND FechaComienzo = @p3
		  AND FechaFin = @p4
		  AND FechaCarga = @p5
		  AND HoraCarga = @p6
		`,
		[
			{ value: nv, type: 'Int' },
			{ value: apellidos, type: 'VarChar', length: 40 },
			{ value: parentesco, type: 'VarChar', length: 3 },
			{ value: Math.trunc(fechaComienzo), type: 'Int' },
			{ value: Math.trunc(fechaFin), type: 'Int' },
			{ value: Math.trunc(fechaCarga), type: 'Int' },
			{ value: Math.trunc(horaCarga), type: 'Int' },
		],
	);

	return listarAcompanantes(nv);
}

/* ------------------------------------------------------------------ */
/* Observación                                                         */
/* ------------------------------------------------------------------ */

async function obtenerObservacion(numeroVisita) {
	const nv = visitaValida(numeroVisita);

	const filas = await executeQuery(
		`SELECT LTRIM(RTRIM(ISNULL(OBSERVACIONES, ''))) AS Observaciones
		 FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
		[{ value: nv, type: 'Int' }],
	);

	if (!filas || filas.length === 0) throw errorHttp('La visita no existe', 404);
	return { observaciones: filas[0].Observaciones || '' };
}

async function guardarObservacion(numeroVisita, observaciones) {
	const nv = visitaValida(numeroVisita);
	const texto1000 = texto(observaciones, 1000);

	const filas = await executeQuery(
		`UPDATE dbo.imVisita SET OBSERVACIONES = @p1
		 OUTPUT INSERTED.NUMEROVISITA AS NumeroVisita
		 WHERE NUMEROVISITA = @p0`,
		[
			{ value: nv, type: 'Int' },
			{ value: texto1000, type: 'VarChar', length: 1000 },
		],
	);

	if (!filas || filas.length === 0) throw errorHttp('La visita no existe', 404);
	return { observaciones: texto1000 };
}

/* ------------------------------------------------------------------ */
/* Novedades                                                           */
/* ------------------------------------------------------------------ */

async function listarNovedades(numeroVisita) {
	const nv = visitaValida(numeroVisita);

	const filas = await executeQuery(
		`
		SELECT
			n.NumeroVisita,
			LTRIM(RTRIM(ISNULL(n.Observaciones, ''))) AS Novedad,
			ISNULL(n.CodOperador, 0) AS CodOperador,
			LTRIM(RTRIM(CONCAT(ISNULL(op.Apellido, ''), ' ', ISNULL(op.Nombres, '')))) AS OperadorNombre,
			n.FechaCarga,
			n.HoraCarga
		FROM dbo.imVisiNovedades n
		LEFT JOIN dbo.imPassword op ON op.CodOperador = n.CodOperador
		WHERE n.NumeroVisita = @p0
		ORDER BY n.FechaCarga DESC, n.HoraCarga DESC
		`,
		[{ value: nv, type: 'Int' }],
	);

	return (filas || []).map((f) => ({
		...f,
		FechaCargaISO: isoDesdeClarion(f.FechaCarga),
		HoraCargaISO: horaDesdeClarion(f.HoraCarga),
	}));
}

/**
 * Alta de una novedad con la fecha y hora del momento de carga.
 *
 * FechaCarga y HoraCarga integran la PK: si dos novedades caen en la misma
 * centésima se corre la hora unas unidades en vez de fallar.
 */
async function agregarNovedad(numeroVisita, novedad, { codOperador } = {}) {
	const nv = visitaValida(numeroVisita);

	const textoNovedad = texto(novedad, 1000);
	if (!textoNovedad) throw errorHttp('La novedad no puede estar vacía', 400);

	if (!(await existeVisita(nv))) throw errorHttp('La visita no existe', 404);

	const { fecha: fechaCarga, hora: horaBase } = ahoraClarion();

	for (let intento = 0; intento < 5; intento += 1) {
		const insertadas = await executeQuery(
			`
			INSERT INTO dbo.imVisiNovedades (NumeroVisita, Observaciones, CodOperador, FechaCarga, HoraCarga)
			SELECT @p0, @p1, @p2, @p3, @p4
			WHERE NOT EXISTS (
				SELECT 1 FROM dbo.imVisiNovedades
				WHERE NumeroVisita = @p0 AND FechaCarga = @p3 AND HoraCarga = @p4
			);
			SELECT @@ROWCOUNT AS Insertadas;
			`,
			[
				{ value: nv, type: 'Int' },
				{ value: textoNovedad, type: 'VarChar', length: 1000 },
				{ value: enteroOCero(codOperador), type: 'Int' },
				{ value: fechaCarga, type: 'Int' },
				{ value: horaBase + intento, type: 'Int' },
			],
		);
		if (Number(insertadas?.[0]?.Insertadas) > 0) break;
	}

	return listarNovedades(nv);
}

async function quitarNovedad(numeroVisita, fechaCarga, horaCarga) {
	const nv = visitaValida(numeroVisita);
	const fc = Number(fechaCarga);
	const hc = Number(horaCarga);

	if (!Number.isFinite(fc) || !Number.isFinite(hc)) {
		throw errorHttp('Faltan datos para identificar la novedad', 400);
	}

	await executeQuery(
		`DELETE FROM dbo.imVisiNovedades
		 WHERE NumeroVisita = @p0 AND FechaCarga = @p1 AND HoraCarga = @p2`,
		[
			{ value: nv, type: 'Int' },
			{ value: Math.trunc(fc), type: 'Int' },
			{ value: Math.trunc(hc), type: 'Int' },
		],
	);

	return listarNovedades(nv);
}

/* ------------------------------------------------------------------ */

/** Todo lo que necesita la solapa en una sola llamada. */
async function obtenerPanel(numeroVisita) {
	const nv = visitaValida(numeroVisita);
	const [catalogos, acompanantes, observacion, novedades] = await Promise.all([
		obtenerCatalogos(),
		listarAcompanantes(nv),
		obtenerObservacion(nv),
		listarNovedades(nv),
	]);

	return {
		catalogos,
		acompanantes,
		observaciones: observacion.observaciones,
		novedades,
	};
}

module.exports = {
	obtenerCatalogos,
	obtenerPanel,
	listarAcompanantes,
	agregarAcompanante,
	quitarAcompanante,
	obtenerObservacion,
	guardarObservacion,
	listarNovedades,
	agregarNovedad,
	quitarNovedad,
};
