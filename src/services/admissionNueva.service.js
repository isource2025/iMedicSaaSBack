/**
 * @fileoverview Alta de admisiones (ambulatorias e internaciones) sobre imVisita,
 * con los requisitos documentales de la cobertura en imVisitaRequisitos.
 * @module services/admissionNueva.service
 */
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const FormData = require('form-data');

const { executeQuery } = require('../models/db');
const { obtenerCatalogosAdmision } = require('./admissionSearch.service');
const { asignarPacienteACama } = require('./visitaMovimientos.service');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	fechaCalendarioArgentina,
	horaWallArgentina,
} = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');
const {
	resolveFileServerUrl,
	fileServerHeaders,
	pickUploadedFilePath,
	fileServerUploadOk,
	isFileServerUnreachable,
	describeFileServerError,
} = require('../utils/fileServerUrl');
const {
	sanitizeWindowsFileName,
	sanitizeFolderName,
	formDataFileOptions,
} = require('../utils/fileNameEncoding');

const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);
const FILE_SERVER_FALLBACK_LOCAL =
	process.env.FILE_SERVER_FALLBACK_LOCAL === '1' ||
	process.env.ADJUNTOS_LOCAL_FALLBACK === '1' ||
	process.env.NODE_ENV !== 'production';

/** Requisitos que hereda toda visita, sin importar la cobertura. */
const CLIENTE_REQUISITOS_BASE = 0;

function errorHttp(mensaje, statusCode) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	return err;
}

function texto(valor, maxLength) {
	const s = valor == null ? '' : String(valor).trim();
	return maxLength ? s.slice(0, maxLength) : s;
}

function enteroONull(valor) {
	const n = Number(valor);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function enteroOCero(valor) {
	const n = Number(valor);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Catálogos del formulario de alta.
 *
 * imVisita.ORIGENADMISION guarda el centro derivante (imCentroAsistencial), no el
 * catálogo imOrigenAdmision: en la base hay miles de visitas con valores por encima
 * del rango de imOrigenAdmision y coinciden uno a uno con los hospitales y CAPS.
 */
async function obtenerCatalogos(clienteId) {
	const [catalogosBase, coberturas] = await Promise.all([
		obtenerCatalogosAdmision(clienteId),
		executeQuery(
			`SELECT Valor, RazonSocial AS Descripcion
			 FROM dbo.imClientes
			 WHERE ISNULL(NoFacturable, 0) = 0
			 ORDER BY RazonSocial`,
		).catch(() => []),
	]);

	return {
		...catalogosBase,
		centrosSalud: catalogosBase.origenesAdmision || [],
		coberturas: coberturas || [],
	};
}

/**
 * Requisitos documentales que corresponden a una cobertura, más los de base
 * (imClientesRequisitos con Cliente = 0), que aplican a cualquier admisión.
 */
async function requisitosPorCliente(clienteId) {
	const cli = enteroOCero(clienteId);

	const rows = await executeQuery(
		`
		SELECT
			r.Valor,
			LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(r.AplicableAlPacienteOVisita, ''))) AS Aplicable,
			MAX(CASE WHEN cr.Cliente = @p0 THEN 1 ELSE 0 END) AS DeCobertura
		FROM dbo.imClientesRequisitos cr
		INNER JOIN dbo.imRequisitos r ON r.Valor = cr.Requisito
		WHERE cr.Cliente IN (@p0, @p1)
		GROUP BY r.Valor, r.Descripcion, r.AplicableAlPacienteOVisita
		ORDER BY r.Descripcion
		`,
		[
			{ value: cli, type: 'Int' },
			{ value: CLIENTE_REQUISITOS_BASE, type: 'Int' },
		],
	);

	return (rows || []).map((r) => ({
		Valor: Number(r.Valor),
		Descripcion: r.Descripcion,
		Aplicable: r.Aplicable,
		DeCobertura: Number(r.DeCobertura) === 1,
	}));
}

/** Catálogo completo, para agregar un requisito que la cobertura no trae. */
async function listarRequisitos() {
	const rows = await executeQuery(
		`
		SELECT
			Valor,
			LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(AplicableAlPacienteOVisita, ''))) AS Aplicable
		FROM dbo.imRequisitos
		ORDER BY Descripcion
		`,
	);
	return (rows || []).map((r) => ({
		Valor: Number(r.Valor),
		Descripcion: r.Descripcion,
		Aplicable: r.Aplicable,
	}));
}

/** Nombre del operador para el texto de Observaciones que espera el sistema legacy. */
async function nombreOperador(codOperador) {
	const cod = enteroOCero(codOperador);
	if (!cod) return '';
	const rows = await executeQuery(
		`
		SELECT TOP 1 LTRIM(RTRIM(
			CONCAT(ISNULL(Apellido, ''), ' ', ISNULL(Nombres, ''))
		)) AS Nombre
		FROM dbo.imPassword
		WHERE CodOperador = @p0
		`,
		[{ value: cod, type: 'Int' }],
	).catch(() => []);
	return texto(rows?.[0]?.Nombre);
}

async function obtenerPaciente(idPaciente) {
	const rows = await executeQuery(
		`
		SELECT TOP 1
			IdPaciente,
			LTRIM(RTRIM(ISNULL(ApellidoyNombre, ''))) AS ApellidoyNombre,
			LTRIM(RTRIM(ISNULL(CAST(NumeroDocumento AS VARCHAR(20)), ''))) AS Documento,
			ISNULL(NumeroCuenta, 0) AS NumeroCuenta
		FROM dbo.imPacientes
		WHERE IdPaciente = @p0
		`,
		[{ value: enteroOCero(idPaciente), type: 'Int' }],
	);
	return rows?.[0] || null;
}

/**
 * Normaliza y valida el cuerpo del alta. Devuelve los valores ya recortados a los
 * anchos de imVisita (TIPOADMISION char(1), DIAGNOSTICO varchar(8), etc.).
 */
function normalizarDatosAdmision(body = {}) {
	const idPaciente = enteroOCero(body.idPaciente);
	if (!idPaciente) throw errorHttp('Seleccioná un paciente', 400);

	const clasePaciente = texto(body.clasePaciente, 1);
	if (!clasePaciente) throw errorHttp('La clase de paciente es obligatoria', 400);

	const fechaStr = texto(body.fechaAdmision) || fechaCalendarioArgentina();
	const horaStr = texto(body.horaAdmision) || horaWallArgentina(false);
	const hm = /^\d{1,2}:\d{2}/.test(horaStr) ? horaStr.slice(0, 5) : '00:00';
	const fechaAdmision = new Date(`${fechaStr}T${hm}:00`);
	if (Number.isNaN(fechaAdmision.getTime())) {
		throw errorHttp('La fecha u hora de admisión no es válida', 400);
	}

	return {
		idPaciente,
		fechaAdmision,
		clasePaciente,
		tipoAdmision: texto(body.tipoAdmision, 1) || ' ',
		tipoPaciente: texto(body.tipoPaciente, 1) || null,
		idLugarEpisodio: enteroONull(body.idLugarEpisodio),
		centroSalud: enteroOCero(body.centroSalud),
		diagnostico: texto(body.diagnostico, 8).padEnd(8, ' ').slice(0, 8),
		estadoAmbulatorio: texto(body.estadoAmbulatorio, 2),
		doctorAdmisor: enteroOCero(body.doctorAdmisor),
		doctorAsistiendo: enteroOCero(body.doctorAsistiendo),
		doctorCabecera: enteroONull(body.doctorCabecera),
		cliente: enteroOCero(body.cliente),
		contrato: enteroOCero(body.contrato),
		numeroInternacion: texto(body.numeroInternacion, 40),
		observaciones: texto(body.observaciones, 1000),
		requisitos: [
			...new Set(
				(Array.isArray(body.requisitos) ? body.requisitos : [])
					.map((v) => enteroOCero(v))
					.filter((v) => v > 0 && v <= 255),
			),
		],
		cama: body.cama && body.cama.bedId ? body.cama : null,
	};
}

/**
 * Crea la visita y sus requisitos documentales en una sola transacción.
 *
 * NUMEROVISITA no es IDENTITY, así que se calcula MAX + 1 tomando UPDLOCK/HOLDLOCK
 * sobre la tabla: sin el bloqueo, dos altas simultáneas se llevan el mismo número.
 */
async function crearAdmision(body, ctx = {}) {
	const datos = normalizarDatosAdmision(body);

	const paciente = await obtenerPaciente(datos.idPaciente);
	if (!paciente) throw errorHttp(`No existe el paciente ${datos.idPaciente}`, 404);

	const codOperador = enteroOCero(ctx.codOperador);
	const fechaCarga = convertirFechaAClarion(fechaCalendarioArgentina());
	const horaCarga = convertirHoraAClarion(horaWallArgentina(true));

	const params = [
		{ value: datos.idPaciente, type: 'Int' },
		{ value: datos.fechaAdmision, type: 'DateTime' },
		{ value: datos.tipoAdmision, type: 'VarChar', length: 1 },
		{ value: datos.clasePaciente, type: 'VarChar', length: 1 },
		{ value: datos.tipoPaciente, type: 'VarChar', length: 1 },
		{ value: datos.numeroInternacion, type: 'VarChar', length: 40 },
		{ value: datos.diagnostico, type: 'VarChar', length: 8 },
		{ value: datos.estadoAmbulatorio, type: 'VarChar', length: 2 },
		{ value: datos.idLugarEpisodio, type: 'Int' },
		{ value: datos.centroSalud, type: 'TinyInt' },
		{ value: datos.doctorAdmisor, type: 'Int' },
		{ value: datos.doctorAsistiendo, type: 'Int' },
		{ value: datos.doctorCabecera, type: 'Int' },
		{ value: datos.cliente, type: 'Int' },
		{ value: datos.contrato, type: 'Int' },
		{ value: datos.observaciones, type: 'VarChar', length: 1000 },
		{ value: String(codOperador), type: 'VarChar', length: 10 },
		{ value: codOperador, type: 'Int' },
		{ value: fechaCarga, type: 'Int' },
		{ value: horaCarga, type: 'Int' },
	];

	// Los requisitos van como parámetros para no interpolar nada en el SQL.
	const requisitosPlaceholders = datos.requisitos.map((valor) => {
		params.push({ value: valor, type: 'TinyInt' });
		return `@p${params.length - 1}`;
	});

	const insertRequisitos = requisitosPlaceholders.length
		? `
		INSERT INTO dbo.imVisitaRequisitos
			(NumeroVisita, Valor, FechaPresentacion, Observaciones, IdPaciente, PatchOrigen, PatchDestino)
		SELECT @nv, r.Valor, 0, '', @p0, '', ''
		FROM dbo.imRequisitos r
		WHERE r.Valor IN (${requisitosPlaceholders.join(', ')});
		`
		: '';

	const rows = await executeQuery(
		`
		SET XACT_ABORT ON;
		BEGIN TRANSACTION;

		DECLARE @nv int;
		SELECT @nv = ISNULL(MAX(NUMEROVISITA), 0) + 1
		FROM dbo.imVisita WITH (UPDLOCK, HOLDLOCK);

		INSERT INTO dbo.imVisita (
			NUMEROVISITA, IDPACIENTE, IDDESCONOCIDA, FECHAADMISIONS,
			TIPOADMISION, CLASEPACIENTE, TIPOPACIENTE, NUMEROINTERNACION,
			DIAGNOSTICO, ESTADOAMBULATORIO, IdLugarEpisodio, ORIGENADMISION,
			DOCTORADMISOR, DOCTORASISTIENDO, DOCTORCONSULTOR,
			CLIENTE, CONTRATO, CLASEFINANCIERA, OBSERVACIONES,
			VALORSECTOR, VALORHABITACIONCAMA,
			FECHAEGRESO, HORAEGRESO, FECHACARGA, HORACARGA,
			ESTADO, OPERADOR, OperadorEgreso, STATUS
		) VALUES (
			@nv, @p0, 0, @p1,
			@p2, @p3, @p4, @p5,
			@p6, @p7, @p8, @p9,
			@p10, @p11, @p12,
			@p13, @p14, ' ', @p15,
			'', '',
			0, 0, @p18, @p19,
			'', @p16, @p17, 0
		);

		${insertRequisitos}

		COMMIT;
		SELECT @nv AS NumeroVisita;
		`,
		params,
	);

	const numeroVisita = Number(rows?.[0]?.NumeroVisita);
	if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
		throw new Error('No se pudo generar el número de visita');
	}

	// La cama es un paso aparte porque toca imVisitaMovimiento e imHabitacionCamas:
	// si falla, la admisión ya existe y el paciente se ubica después sin recargar todo.
	let cama = null;
	if (datos.cama) {
		try {
			await asignarPacienteACama(numeroVisita, {
				FechaAdmision: convertirFechaAClarion(fechaCalendarioArgentina()),
				HoraAdmision: convertirHoraAClarion(horaWallArgentina(true)),
				ClasePaciente: datos.clasePaciente,
				EstadoAmbulatorio: datos.estadoAmbulatorio,
				Diagnostico: datos.diagnostico,
				bedId: texto(datos.cama.bedId),
				ValorSector: texto(datos.cama.valorSector),
				Operador: String(codOperador),
				FechaCarga: fechaCarga,
				HoraCarga: horaCarga,
			});
			cama = {
				asignada: true,
				bedId: texto(datos.cama.bedId),
				valorSector: texto(datos.cama.valorSector),
			};
		} catch (e) {
			console.warn(`[admisionNueva] visita ${numeroVisita} sin cama:`, e.message);
			cama = { asignada: false, error: e.message };
		}
	}

	return {
		numeroVisita,
		idPaciente: datos.idPaciente,
		paciente: paciente.ApellidoyNombre,
		requisitos: datos.requisitos,
		cama,
	};
}

/** Requisitos ya cargados en una visita, con el estado de su archivo. */
async function listarRequisitosVisita(numeroVisita) {
	const nv = enteroOCero(numeroVisita);
	if (!nv) throw errorHttp('numeroVisita inválido', 400);

	const rows = await executeQuery(
		`
		SELECT
			vr.Valor,
			LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(r.AplicableAlPacienteOVisita, ''))) AS Aplicable,
			vr.FechaPresentacion,
			LTRIM(RTRIM(ISNULL(vr.Observaciones, ''))) AS Observaciones,
			LTRIM(RTRIM(ISNULL(vr.PatchDestino, ''))) AS PatchDestino
		FROM dbo.imVisitaRequisitos vr
		LEFT JOIN dbo.imRequisitos r ON r.Valor = vr.Valor
		WHERE vr.NumeroVisita = @p0
		ORDER BY r.Descripcion
		`,
		[{ value: nv, type: 'Int' }],
	);

	return (rows || []).map((r) => ({
		Valor: Number(r.Valor),
		Descripcion: r.Descripcion,
		Aplicable: r.Aplicable,
		Observaciones: r.Observaciones,
		tieneArchivo: Boolean(r.PatchDestino),
	}));
}

/** Agrega un requisito a una visita ya creada (idempotente por la PK). */
async function agregarRequisito(numeroVisita, valorRequisito, idPaciente) {
	const nv = enteroOCero(numeroVisita);
	const valor = enteroOCero(valorRequisito);
	if (!nv || !valor) throw errorHttp('Datos de requisito inválidos', 400);

	await executeQuery(
		`
		IF NOT EXISTS (SELECT 1 FROM dbo.imVisitaRequisitos WHERE NumeroVisita = @p0 AND Valor = @p1)
		INSERT INTO dbo.imVisitaRequisitos
			(NumeroVisita, Valor, FechaPresentacion, Observaciones, IdPaciente, PatchOrigen, PatchDestino)
		VALUES (@p0, @p1, 0, '', @p2, '', '');
		`,
		[
			{ value: nv, type: 'Int' },
			{ value: valor, type: 'TinyInt' },
			{ value: enteroOCero(idPaciente), type: 'Int' },
		],
	);

	return { numeroVisita: nv, valor };
}

async function quitarRequisito(numeroVisita, valorRequisito) {
	const nv = enteroOCero(numeroVisita);
	const valor = enteroOCero(valorRequisito);
	if (!nv || !valor) throw errorHttp('Datos de requisito inválidos', 400);

	await executeQuery(
		`DELETE FROM dbo.imVisitaRequisitos WHERE NumeroVisita = @p0 AND Valor = @p1`,
		[
			{ value: nv, type: 'Int' },
			{ value: valor, type: 'TinyInt' },
		],
	);
	return { numeroVisita: nv, valor };
}

/**
 * Ruta destino de la imagen de un requisito, respetando el layout que dejó el
 * sistema Clarion: <PatchDestino del requisito>\<documento apellido y nombre>\<requisito> - 0.<ext>
 */
function rutaDestinoRequisito(patchDestino, paciente, descripcionRequisito, nombreArchivo) {
	const base = texto(patchDestino).replace(/[\\/]+$/, '');
	if (!base) return null;

	const carpeta = sanitizeFolderName(
		`${texto(paciente.Documento)} ${texto(paciente.ApellidoyNombre)}`.trim(),
	);
	const ext = path.extname(nombreArchivo || '') || '.jpg';
	const archivo = sanitizeWindowsFileName(`${texto(descripcionRequisito)} - 0${ext}`);

	return carpeta ? `${base}\\${carpeta}\\${archivo}` : `${base}\\${archivo}`;
}

/**
 * Sube la imagen de un requisito al file server de la clínica y deja la ruta en
 * imVisitaRequisitos. La PK (NumeroVisita, Valor) admite un archivo por requisito:
 * volver a subir reemplaza el anterior.
 */
async function adjuntarArchivoRequisito(numeroVisita, valorRequisito, file, ctx = {}) {
	const nv = enteroOCero(numeroVisita);
	const valor = enteroOCero(valorRequisito);
	if (!nv || !valor) throw errorHttp('Datos de requisito inválidos', 400);
	if (!file) throw errorHttp('No se recibió ningún archivo', 400);

	const rows = await executeQuery(
		`
		SELECT TOP 1
			LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(r.PatchDestino, ''))) AS PatchDestino,
			v.IDPACIENTE AS IdPaciente
		FROM dbo.imVisita v
		CROSS JOIN dbo.imRequisitos r
		WHERE v.NUMEROVISITA = @p0 AND r.Valor = @p1
		`,
		[
			{ value: nv, type: 'Int' },
			{ value: valor, type: 'TinyInt' },
		],
	);
	const meta = rows?.[0];
	if (!meta) throw errorHttp('No existe la visita o el requisito indicado', 404);

	const paciente = await obtenerPaciente(meta.IdPaciente);
	if (!paciente) throw errorHttp('La visita no tiene un paciente válido', 409);

	const destino = rutaDestinoRequisito(
		meta.PatchDestino,
		paciente,
		meta.Descripcion,
		file.originalname,
	);

	let rutaGuardada;
	try {
		const formData = new FormData();
		formData.append(
			'file',
			fsSync.createReadStream(file.path),
			formDataFileOptions(file.originalname, file.mimetype),
		);
		formData.append('nombreArchivo', sanitizeWindowsFileName(file.originalname));
		formData.append('numeroVisita', String(nv));
		formData.append('nombrePaciente', texto(paciente.ApellidoyNombre));
		// Sin PatchDestino configurado, el file server usa su propio layout por visita.
		if (destino) formData.append('path', destino);

		const fileServerUrl = await resolveFileServerUrl();
		const respuesta = await axios.post(`${fileServerUrl}/upload`, formData, {
			headers: fileServerHeaders(formData.getHeaders()),
			timeout: FILE_SERVER_TIMEOUT_MS,
		});

		if (!fileServerUploadOk(respuesta.data)) {
			throw new Error(respuesta.data?.error || 'El servidor de archivos rechazó el archivo');
		}
		rutaGuardada = pickUploadedFilePath(respuesta.data);
		await fs.unlink(file.path).catch(() => {});
	} catch (e) {
		if (FILE_SERVER_FALLBACK_LOCAL && isFileServerUnreachable(e)) {
			rutaGuardada = path.resolve(file.path);
			console.warn(
				`[admisionNueva] file server no alcanzable; requisito ${valor} guardado local: ${rutaGuardada}`,
			);
		} else {
			await fs.unlink(file.path).catch(() => {});
			throw errorHttp(describeFileServerError(e), 503);
		}
	}

	const responsable = await nombreOperador(ctx.codOperador);
	const observaciones = normalizarTextoParaClarionAnsi(
		`Documentacion escanada:${meta.Descripcion}, Resp.: ${responsable}`,
		{ maxLength: 8000 },
	);

	await executeQuery(
		`
		UPDATE dbo.imVisitaRequisitos
		SET PatchOrigen = @p2,
		    PatchDestino = @p2,
		    FechaPresentacion = @p3,
		    Observaciones = @p4,
		    IdPaciente = @p5
		WHERE NumeroVisita = @p0 AND Valor = @p1
		`,
		[
			{ value: nv, type: 'Int' },
			{ value: valor, type: 'TinyInt' },
			{ value: rutaGuardada, type: 'VarChar', length: 600 },
			{ value: convertirFechaAClarion(fechaCalendarioArgentina()), type: 'Int' },
			{ value: observaciones, type: 'VarChar', length: 8000 },
			{ value: Number(meta.IdPaciente) || 0, type: 'Int' },
		],
	);

	return {
		numeroVisita: nv,
		valor,
		descripcion: meta.Descripcion,
		ruta: rutaGuardada,
		nombreArchivo: file.originalname,
	};
}

module.exports = {
	obtenerCatalogos,
	requisitosPorCliente,
	listarRequisitos,
	crearAdmision,
	listarRequisitosVisita,
	agregarRequisito,
	quitarRequisito,
	adjuntarArchivoRequisito,
};
