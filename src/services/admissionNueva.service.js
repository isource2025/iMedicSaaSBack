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
	clarionAIsoCalendario,
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
	fileServerFileUrl,
} = require('../utils/fileNameEncoding');

const EXTS_REQUISITO = ['.jpg', '.jpeg', '.png', '.pdf', '.gif'];

const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);
const FILE_SERVER_FALLBACK_LOCAL =
	process.env.FILE_SERVER_FALLBACK_LOCAL === '1' ||
	process.env.ADJUNTOS_LOCAL_FALLBACK === '1' ||
	process.env.NODE_ENV !== 'production';

/** @deprecated reservado; el alta ya no usa set base de requisitos */
const _CLIENTE_REQUISITOS_BASE_UNUSED = 0;

/**
 * Valor de imRequisitos.AplicableAlPacienteOVisita para los documentos que son
 * del paciente y no del episodio (DNI, carnet de obra social, etc.). Estos se
 * reutilizan entre admisiones: si ya los presentó, no hay que volver a pedirlos.
 */
const APLICABLE_PACIENTE = 'Paciente';

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
		// Incluye NoFacturable (p. ej. SUMAR): son coberturas válidas al admitir,
		// aunque no se facturen.
		executeQuery(
			`SELECT Valor, LTRIM(RTRIM(ISNULL(RazonSocial, ''))) AS Descripcion
			 FROM dbo.imClientes
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
 * Última presentación de cada requisito hecha por el paciente, en cualquier visita.
 * Se usa para no volver a pedir documentos que ya están escaneados.
 *
 * Clarion a menudo dejó IdPaciente vacío en imVisitaRequisitos: también se
 * resuelve por imVisita.IDPACIENTE de la misma visita.
 */
async function presentacionesPreviasDelPaciente(idPaciente) {
	const id = enteroOCero(idPaciente);
	if (!id) return new Map();

	const rows = await executeQuery(
		`
		SELECT Valor, NumeroVisita, FechaPresentacion, PatchDestino
		FROM (
			SELECT
				vr.Valor,
				vr.NumeroVisita,
				vr.FechaPresentacion,
				LTRIM(RTRIM(vr.PatchDestino)) AS PatchDestino,
				ROW_NUMBER() OVER (
					PARTITION BY vr.Valor
					ORDER BY vr.FechaPresentacion DESC, vr.NumeroVisita DESC
				) AS rn
			FROM dbo.imVisitaRequisitos vr
			LEFT JOIN dbo.imVisita v ON v.NUMEROVISITA = vr.NumeroVisita
			WHERE LTRIM(RTRIM(ISNULL(vr.PatchDestino, ''))) <> ''
			  AND (
					vr.IdPaciente = @p0
					OR v.IDPACIENTE = @p0
			  )
		) t
		WHERE t.rn = 1
		`,
		[{ value: id, type: 'Int' }],
	).catch(() => []);

	const mapa = new Map();
	for (const r of rows || []) {
		mapa.set(Number(r.Valor), {
			numeroVisita: Number(r.NumeroVisita) || 0,
			fecha: clarionAIsoCalendario(r.FechaPresentacion),
			ruta: texto(r.PatchDestino),
		});
	}
	return mapa;
}

/**
 * Requisitos documentales de la cobertura elegida (imClientesRequisitos).
 * Sin cobertura (cliente 0) → lista vacía. No hay set "base".
 *
 * Con idPaciente marca los requisitos del paciente que ya tienen un archivo
 * presentado en otra visita, con la fecha para que la admisora decida si sirve.
 * Si Clarion dejó el archivo en disco (PERSONALES\{DNI NOMBRE}\…) pero sin fila
 * en imVisitaRequisitos, se descubre contra el file server de la clínica.
 */
async function requisitosPorCliente(clienteId, idPaciente) {
	const cli = enteroOCero(clienteId);
	if (cli <= 0) return [];

	const rows = await executeQuery(
		`
		SELECT
			r.Valor,
			LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(r.AplicableAlPacienteOVisita, ''))) AS Aplicable,
			LTRIM(RTRIM(ISNULL(r.PatchDestino, ''))) AS PatchDestino
		FROM dbo.imClientesRequisitos cr
		INNER JOIN dbo.imRequisitos r ON r.Valor = cr.Requisito
		WHERE cr.Cliente = @p0
		ORDER BY r.Descripcion
		`,
		[{ value: cli, type: 'Int' }],
	);

	const idPac = enteroOCero(idPaciente);
	const previas = await presentacionesPreviasDelPaciente(idPac);
	const paciente = idPac ? await obtenerPaciente(idPac) : null;

	const out = await Promise.all((rows || []).map(async (r) => {
		const valor = Number(r.Valor);
		const aplicable = texto(r.Aplicable);
		const esPaciente = aplicable.toLowerCase() === 'paciente';
		let previa = esPaciente ? previas.get(valor) || null : null;

		if (esPaciente && previa?.ruta) {
			const rutaVigente = await existeEnFileServer(previa.ruta);
			if (!rutaVigente) {
				console.warn(
					`[admisionNueva] ruta DB inexistente paciente=${idPac} requisito=${valor}: ${previa.ruta}`,
				);
				previa = null;
			}
		}

		if (esPaciente && !previa && paciente) {
			previa = await descubrirPresentacionEnDisco(
				paciente,
				r.Descripcion,
				r.PatchDestino,
			);
		}

		return {
			Valor: valor,
			Descripcion: r.Descripcion,
			Aplicable: aplicable,
			DeCobertura: true,
			DeBase: false,
			Presentado: previa,
		};
	}));

	console.log(
		`[admisionNueva] requisitos cobertura=${cli} paciente=${idPac || 0} ` +
			`total=${out.length} presentados=${out.filter((x) => x.Presentado).length}`,
	);
	return out;
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
 * Última admisión del paciente, para sugerir valores al dar de alta una nueva.
 *
 * Solo devuelve los datos que se suelen repetir entre admisiones del mismo
 * paciente (cobertura, convenio, tipo de paciente, lugar del episodio y
 * profesional de cabecera). El diagnóstico y la fecha no se sugieren porque son
 * propios de cada episodio.
 */
async function obtenerUltimaVisita(idPaciente) {
	const id = enteroOCero(idPaciente);
	if (!id) throw errorHttp('Seleccioná un paciente', 400);

	const rows = await executeQuery(
		`
		SELECT TOP 1
			v.NUMEROVISITA AS NumeroVisita,
			CONVERT(varchar(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
			ISNULL(v.CLIENTE, 0) AS Cliente,
			LTRIM(RTRIM(ISNULL(cli.RazonSocial, ''))) AS ClienteDescripcion,
			ISNULL(v.CONTRATO, 0) AS Contrato,
			LTRIM(RTRIM(ISNULL(conv.Descripcion, ''))) AS ContratoDescripcion,
			LTRIM(RTRIM(ISNULL(v.TIPOPACIENTE, ''))) AS TipoPaciente,
			LTRIM(RTRIM(ISNULL(tp.Descripcion, ''))) AS TipoPacienteDescripcion,
			ISNULL(v.IdLugarEpisodio, 0) AS IdLugarEpisodio,
			LTRIM(RTRIM(ISNULL(le.Descripcion, ''))) AS LugarEpisodioDescripcion,
			ISNULL(v.DOCTORCONSULTOR, 0) AS DoctorCabecera,
			LTRIM(RTRIM(ISNULL(docCab.ApellidoNombre, ''))) AS DoctorCabeceraDescripcion
		FROM dbo.imVisita v
		LEFT JOIN dbo.imClientes cli ON v.CLIENTE = cli.Valor
		LEFT JOIN dbo.imClientesConvenios conv
			ON conv.Valor = v.CLIENTE AND conv.Codigo = v.CONTRATO
		LEFT JOIN dbo.imTipoPaciente tp
			ON LTRIM(RTRIM(ISNULL(v.TIPOPACIENTE, ''))) = LTRIM(RTRIM(ISNULL(tp.Valor, '')))
		LEFT JOIN dbo.imLugarEpisodio le ON v.IdLugarEpisodio = le.IdLugarEpisodio
		LEFT JOIN dbo.imPersonal docCab ON v.DOCTORCONSULTOR = docCab.Valor
		WHERE v.IDPACIENTE = @p0
		ORDER BY v.FECHAADMISIONS DESC, v.NUMEROVISITA DESC
		`,
		[{ value: id, type: 'Int' }],
	);

	const v = rows?.[0];
	if (!v) return null;

	return {
		numeroVisita: Number(v.NumeroVisita) || 0,
		fechaAdmision: texto(v.FechaAdmision),
		cliente: Number(v.Cliente) || 0,
		clienteDescripcion: texto(v.ClienteDescripcion),
		contrato: Number(v.Contrato) || 0,
		contratoDescripcion: texto(v.ContratoDescripcion),
		tipoPaciente: texto(v.TipoPaciente),
		tipoPacienteDescripcion: texto(v.TipoPacienteDescripcion),
		idLugarEpisodio: Number(v.IdLugarEpisodio) || 0,
		lugarEpisodioDescripcion: texto(v.LugarEpisodioDescripcion),
		doctorCabecera: Number(v.DoctorCabecera) || 0,
		doctorCabeceraDescripcion: texto(v.DoctorCabeceraDescripcion),
	};
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

	params.push({ value: APLICABLE_PACIENTE, type: 'VarChar', length: 10 });
	const aplicablePaciente = `@p${params.length - 1}`;

	// Los documentos que son del paciente (no del episodio) se heredan de la última
	// visita donde los presentó: se copia la ruta del escaneo en vez de volver a pedirlo.
	const insertRequisitos = requisitosPlaceholders.length
		? `
		INSERT INTO dbo.imVisitaRequisitos
			(NumeroVisita, Valor, FechaPresentacion, Observaciones, IdPaciente, PatchOrigen, PatchDestino)
		SELECT @nv, r.Valor, 0, '', @p0, '', ''
		FROM dbo.imRequisitos r
		WHERE r.Valor IN (${requisitosPlaceholders.join(', ')});

		UPDATE vr
		SET vr.PatchOrigen = prev.PatchDestino,
		    vr.PatchDestino = prev.PatchDestino,
		    vr.FechaPresentacion = prev.FechaPresentacion,
		    vr.Observaciones = prev.Observaciones
		FROM dbo.imVisitaRequisitos vr
		INNER JOIN dbo.imRequisitos r ON r.Valor = vr.Valor
		CROSS APPLY (
			SELECT TOP 1 p.PatchDestino, p.FechaPresentacion, p.Observaciones
			FROM dbo.imVisitaRequisitos p
			LEFT JOIN dbo.imVisita vprev ON vprev.NUMEROVISITA = p.NumeroVisita
			WHERE p.Valor = vr.Valor
			  AND p.NumeroVisita <> @nv
			  AND LTRIM(RTRIM(ISNULL(p.PatchDestino, ''))) <> ''
			  AND (p.IdPaciente = @p0 OR vprev.IDPACIENTE = @p0)
			ORDER BY p.FechaPresentacion DESC, p.NumeroVisita DESC
		) prev
		WHERE vr.NumeroVisita = @nv
		  AND LTRIM(RTRIM(ISNULL(r.AplicableAlPacienteOVisita, ''))) = ${aplicablePaciente};
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
		fechaPresentacion: clarionAIsoCalendario(r.FechaPresentacion),
		nombreArchivo: nombreDeRuta(r.PatchDestino),
	}));
}

/** Último tramo de una ruta de Windows o UNC, para mostrar el nombre del archivo. */
function nombreDeRuta(ruta) {
	const s = texto(ruta);
	if (!s) return '';
	const partes = s.split(/[\\/]/).filter(Boolean);
	return partes.length ? partes[partes.length - 1] : '';
}

/**
 * ¿Existe esta ruta relativa/absoluta en el file server de la clínica?
 * Usa GET y corta el stream apenas responde 2xx (no descarga el archivo entero).
 */
async function existeEnFileServer(rutaRelativa) {
	const pedida = texto(rutaRelativa);
	if (!pedida) return null;

	let fileServerUrl;
	try {
		fileServerUrl = await resolveFileServerUrl();
	} catch (e) {
		console.warn('[admisionNueva] file server no resuelto al sondear:', e.message);
		return null;
	}

	try {
		const respuesta = await axios.get(fileServerFileUrl(fileServerUrl, pedida), {
			responseType: 'stream',
			headers: fileServerHeaders(),
			timeout: 2500,
			validateStatus: (s) => s >= 200 && s < 300,
		});
		respuesta.data.destroy?.();
		return pedida;
	} catch {
		return null;
	}
}

/**
 * Lista entradas (dirs/files) bajo una ruta relativa del file server.
 * Sirve para encontrar carpetas Clarion `0 NOMBRE` / `21 NOMBRE` en PERSONALES.
 */
async function listarEnFileServer(rutaRelativa) {
	const pedida = texto(rutaRelativa) || 'PERSONALES';
	let fileServerUrl;
	try {
		fileServerUrl = await resolveFileServerUrl();
	} catch (e) {
		console.warn('[admisionNueva] file server no resuelto al listar:', e.message);
		return [];
	}
	try {
		const url = `${String(fileServerUrl).replace(/\/+$/, '')}/list?path=${encodeURIComponent(pedida)}`;
		const respuesta = await axios.get(url, {
			headers: fileServerHeaders(),
			timeout: 3000,
			validateStatus: (s) => s >= 200 && s < 300,
		});
		const entries = respuesta.data?.entries;
		return Array.isArray(entries) ? entries : [];
	} catch (e) {
		console.warn(`[admisionNueva] /list ${pedida}:`, e.message);
		return [];
	}
}

/** Elige la carpeta Clarion de PERSONALES que corresponde al paciente. */
function elegirCarpetaPersonales(entradas, paciente) {
	const dirs = (entradas || [])
		.filter((e) => e && (e.type === 'dir' || !e.type))
		.map((e) => String(e.name || e).trim())
		.filter(Boolean);
	if (!dirs.length) return null;

	const nombre = sanitizeFolderName(texto(paciente?.ApellidoyNombre)).toUpperCase();
	if (!nombre) return null;

	const preferidas = carpetasPersonalesCandidatas(paciente).map((c) => c.toUpperCase());
	const porExacta = new Map(dirs.map((d) => [d.toUpperCase(), d]));
	for (const p of preferidas) {
		if (porExacta.has(p)) return porExacta.get(p);
	}

	// Clarion a veces usa otro prefijo numérico: "21 GAVILAN MABEL"
	const sufijo = ` ${nombre}`;
	const porSufijo = dirs.find((d) => {
		const u = d.toUpperCase();
		return u === nombre || u.endsWith(sufijo);
	});
	return porSufijo || null;
}

/** Texto comparable para nombres Clarion: ignora puntos, guiones, acentos y extensión. */
function claveNombreRequisito(valor) {
	return String(valor || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\.[A-Za-z0-9]{2,5}$/i, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.replace(/\s+0$/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function elegirArchivoRequisito(entradas, descripcion) {
	const archivos = (entradas || [])
		.filter((e) => e && e.type === 'file')
		.map((e) => String(e.name || '').trim())
		.filter((name) => EXTS_REQUISITO.includes(path.extname(name).toLowerCase()));
	if (!archivos.length) return null;

	const objetivo = claveNombreRequisito(descripcion);
	const tokensObjetivo = objetivo.split(' ').filter(Boolean);
	const direccion = tokensObjetivo.find((t) => t === 'FRENTE' || t === 'REVERSO');

	const puntuados = archivos.map((name) => {
		const clave = claveNombreRequisito(name);
		const tokens = new Set(clave.split(' ').filter(Boolean));
		let score = 0;
		if (clave === objetivo) score += 100;
		else if (clave.startsWith(`${objetivo} `) || objetivo.startsWith(`${clave} `)) score += 70;
		for (const token of tokensObjetivo) {
			if (tokens.has(token)) score += token === 'DNI' ? 15 : 10;
		}
		if (direccion) {
			if (tokens.has(direccion)) score += 50;
			else if (tokens.has(direccion === 'FRENTE' ? 'REVERSO' : 'FRENTE')) score -= 100;
		}
		return { name, score };
	});
	puntuados.sort((a, b) => b.score - a.score);
	return puntuados[0]?.score >= 15 ? puntuados[0].name : null;
}

/**
 * Si Clarion dejó el escaneo en PERSONALES\{0|n|DNI} NOMBRE\ sin fila en
 * imVisitaRequisitos, lo descubrimos contra el file server.
 */
async function descubrirPresentacionEnDisco(paciente, descripcionRequisito, patchDestino) {
	if (!paciente?.ApellidoyNombre) return null;

	const base = baseDestinoRequisito(patchDestino, APLICABLE_PACIENTE) || 'PERSONALES';
	const carpetas = carpetasPersonalesCandidatas(paciente);

	const listado = await listarEnFileServer(base);
	const carpetaListada = elegirCarpetaPersonales(listado, paciente);
	if (carpetaListada && !carpetas.includes(carpetaListada)) {
		carpetas.unshift(carpetaListada);
	}

	// El nombre físico no siempre coincide exactamente con imRequisitos.Descripcion.
	// Listar la carpeta permite asociar variantes como D.N.I., DNI Frente, etc.
	for (const carpeta of carpetas) {
		const rutaCarpeta = [base, carpeta].filter(Boolean).join('\\');
		const entradas = await listarEnFileServer(rutaCarpeta);
		const nombreReal = elegirArchivoRequisito(entradas, descripcionRequisito);
		if (!nombreReal) continue;
		const hallada = [rutaCarpeta, nombreReal].join('\\');
		console.log(
			`[admisionNueva] descubierto por listado paciente=${paciente.IdPaciente || paciente.Documento} ruta=${hallada}`,
		);
		return {
			numeroVisita: 0,
			fecha: null,
			ruta: hallada,
		};
	}

	const archivos = [];
	for (const carpeta of carpetas) {
		for (const ext of EXTS_REQUISITO) {
			archivos.push(
				[base, carpeta, sanitizeWindowsFileName(`${texto(descripcionRequisito)} - 0${ext}`)]
					.filter(Boolean)
					.join('\\'),
			);
		}
	}

	const rutas = [...new Set(archivos.filter(Boolean))];
	const resultados = await Promise.all(rutas.map((ruta) => existeEnFileServer(ruta)));
	const hallada = resultados.find(Boolean);
	if (!hallada) return null;

	console.log(
		`[admisionNueva] descubierto en disco paciente=${paciente.IdPaciente || paciente.Documento} ruta=${hallada}`,
	);
	return {
		numeroVisita: 0,
		fecha: null,
		ruta: hallada,
	};
}

/**
 * Ruta del archivo de un requisito, para que el controlador lo sirva desde el
 * file server. Devuelve null si el requisito todavía no tiene nada adjunto.
 */
async function obtenerArchivoRequisito(numeroVisita, valorRequisito) {
	const nv = enteroOCero(numeroVisita);
	const valor = enteroOCero(valorRequisito);
	if (!nv || !valor) throw errorHttp('Datos de requisito inválidos', 400);

	const rows = await executeQuery(
		`
		SELECT TOP 1
			LTRIM(RTRIM(ISNULL(vr.PatchDestino, ''))) AS PatchDestino,
			LTRIM(RTRIM(ISNULL(r.Descripcion, ''))) AS Descripcion
		FROM dbo.imVisitaRequisitos vr
		LEFT JOIN dbo.imRequisitos r ON r.Valor = vr.Valor
		WHERE vr.NumeroVisita = @p0 AND vr.Valor = @p1
		`,
		[
			{ value: nv, type: 'Int' },
			{ value: valor, type: 'TinyInt' },
		],
	);

	const ruta = texto(rows?.[0]?.PatchDestino);
	if (!ruta) return null;
	return {
		ruta,
		nombreArchivo: nombreDeRuta(ruta) || texto(rows?.[0]?.Descripcion) || 'archivo',
	};
}

/**
 * Archivo de un requisito "Paciente" sin visita: presentación previa en DB o
 * descubrimiento en PERSONALES\{DNI NOMBRE}\ vía file server.
 */
async function obtenerArchivoRequisitoPaciente(idPaciente, valorRequisito) {
	const idPac = enteroOCero(idPaciente);
	const valor = enteroOCero(valorRequisito);
	if (!idPac || !valor) throw errorHttp('Datos de requisito inválidos', 400);

	const previas = await presentacionesPreviasDelPaciente(idPac);
	const previa = previas.get(valor);
	if (previa?.ruta) {
		const rutaVigente = await existeEnFileServer(previa.ruta);
		if (rutaVigente) {
			return {
				ruta: previa.ruta,
				nombreArchivo: nombreDeRuta(previa.ruta) || 'archivo',
			};
		}
		console.warn(
			`[admisionNueva] visor descarta ruta DB inexistente paciente=${idPac} requisito=${valor}: ${previa.ruta}`,
		);
	}

	const rows = await executeQuery(
		`
		SELECT TOP 1
			LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Descripcion,
			LTRIM(RTRIM(ISNULL(PatchDestino, ''))) AS PatchDestino,
			LTRIM(RTRIM(ISNULL(AplicableAlPacienteOVisita, ''))) AS Aplicable
		FROM dbo.imRequisitos
		WHERE Valor = @p0
		`,
		[{ value: valor, type: 'TinyInt' }],
	);
	const meta = rows?.[0];
	if (!meta || !esRequisitoPaciente(meta.Aplicable)) return null;

	const paciente = await obtenerPaciente(idPac);
	if (!paciente) return null;

	const descubierta = await descubrirPresentacionEnDisco(
		paciente,
		meta.Descripcion,
		meta.PatchDestino,
	);
	if (!descubierta?.ruta) return null;
	return {
		ruta: descubierta.ruta,
		nombreArchivo: nombreDeRuta(descubierta.ruta) || texto(meta.Descripcion) || 'archivo',
	};
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
 * Ruta destino de un requisito — SIEMPRE relativa al UncRoot de la clínica.
 * El file server del túnel antepone su propio root (Vidal, Sarmiento, etc.).
 * No se usa IP ni host de imRequisitos.PatchDestino.
 *
 * – Paciente (Clarion Vidal): PERSONALES\0 APELLIDO NOMBRE\<requisito> - 0.<ext>
 * – Visita:                   \<DNI APELLIDO NOMBRE>\<requisito> - 0.<ext>
 */
function esRequisitoPaciente(aplicable) {
	return String(aplicable || '').trim().toLowerCase() === 'paciente';
}

function baseDestinoRequisito(patchDestino, aplicable) {
	const raw = texto(patchDestino).replace(/[\\/]+$/, '');
	const pidePersonales =
		esRequisitoPaciente(aplicable) || /\\PERSONALES$/i.test(raw) || /\\PERSONALES\\/i.test(raw);
	return pidePersonales ? 'PERSONALES' : '';
}

/** Carpetas Clarion bajo PERSONALES: casi siempre `0 NOMBRE`, a veces `{n} NOMBRE` o DNI. */
function carpetasPersonalesCandidatas(paciente) {
	const nombre = sanitizeFolderName(texto(paciente?.ApellidoyNombre));
	const doc = sanitizeFolderName(texto(paciente?.Documento));
	if (!nombre) return [];
	const out = [];
	const push = (s) => {
		const v = sanitizeFolderName(s);
		if (v && !out.includes(v)) out.push(v);
	};
	push(`0 ${nombre}`);
	if (doc) push(`${doc} ${nombre}`);
	push(nombre);
	return out;
}

function rutaDestinoRequisito(
	patchDestino,
	paciente,
	descripcionRequisito,
	nombreArchivo,
	aplicable,
) {
	const base = baseDestinoRequisito(patchDestino, aplicable);
	const carpeta = esRequisitoPaciente(aplicable)
		? carpetasPersonalesCandidatas(paciente)[0] ||
			sanitizeFolderName(`0 ${texto(paciente.ApellidoyNombre)}`)
		: sanitizeFolderName(
				`${texto(paciente.Documento)} ${texto(paciente.ApellidoyNombre)}`.trim(),
			);
	const ext = path.extname(nombreArchivo || '') || '.jpg';
	const archivo = sanitizeWindowsFileName(`${texto(descripcionRequisito)} - 0${ext}`);

	const partes = [base, carpeta, archivo].filter(Boolean);
	return partes.join('\\');
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
			LTRIM(RTRIM(ISNULL(r.AplicableAlPacienteOVisita, ''))) AS Aplicable,
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
		meta.Aplicable,
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
	obtenerUltimaVisita,
	obtenerArchivoRequisito,
	obtenerArchivoRequisitoPaciente,
	crearAdmision,
	listarRequisitosVisita,
	agregarRequisito,
	quitarRequisito,
	adjuntarArchivoRequisito,
};
