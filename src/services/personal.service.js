/**
 * Servicio CRUD de Personal (tabla imPersonal).
 * Solo maneja la sección "Datos Personales":
 *   Valor (PK, autonumérico MAX+1), TipoDocumento, Numero (DNI),
 *   ApellidoNombre, Domicilio, ValorLocalidad, Provincia,
 *   Nacionalidad, FechaNacimiento, Sexo, EstadoCivil, Telefono.
 *
 * La tabla imPersonal en la base legacy no es IDENTITY → generamos Valor con MAX+1
 * (excluyendo los registros "admin" con Valor = 999999 / 1000000).
 */
const { executeQuery, sql } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirFechaClarionADate,
} = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');
const { connectDB } = require('../config/database');

const ADMIN_VALOR_THRESHOLD = 900000; // Valor >= 900000 se considera "reservado" (admin/sistema)

/** Convierte Clarion date -> "YYYY-MM-DD" */
function clarionToIso(fechaClarion) {
	const d = convertirFechaClarionADate(fechaClarion);
	if (!d) return null;
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

/** Normaliza string (trim) o null */
const strOrNull = (v) => {
	if (v === undefined || v === null) return null;
	const s = String(v).trim();
	return s === '' ? null : s;
};

const stripDiacritics = (s) =>
	String(s)
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');

/** Recorta a longitud máx. para evitar error 8152 en columnas VARCHAR legacy */
function truncStr(v, max) {
	const s = strOrNull(v);
	if (!s) return null;
	return s.length <= max ? s : s.slice(0, max);
}

/**
 * imPersonal.Nacionalidad suele ser VARCHAR(2) (código ISO alpha-2).
 * La API de provincias / RENAPER puede enviar la descripción completa ("ARGENTINA").
 */
function nacionalidadToCodigoImPersonal(v) {
	const s = strOrNull(v);
	if (!s) return null;
	if (s.length <= 2) return s.toUpperCase();
	const k = stripDiacritics(s)
		.toUpperCase()
		.replace(/\s+/g, ' ')
		.trim();
	const map = {
		ARGENTINA: 'AR',
		'REPUBLICA ARGENTINA': 'AR',
		CHILE: 'CL',
		URUGUAY: 'UY',
		PARAGUAY: 'PY',
		BRASIL: 'BR',
		BRAZIL: 'BR',
		BOLIVIA: 'BO',
		PERU: 'PE',
		COLOMBIA: 'CO',
		VENEZUELA: 'VE',
		ECUADOR: 'EC',
		MEXICO: 'MX',
		ESPANA: 'ES',
		SPAIN: 'ES',
		ITALIA: 'IT',
		FRANCIA: 'FR',
		'ESTADOS UNIDOS': 'US',
		USA: 'US',
		ALEMANIA: 'DE',
		CHINA: 'CN',
		JAPON: 'JP',
		CANADA: 'CA',
		PORTUGAL: 'PT',
	};
	if (map[k]) return map[k];
	if (/\bARGENTIN/i.test(k)) return 'AR';
	if (/\bCHILE\b/i.test(k)) return 'CL';
	if (/\bURUGUAY/i.test(k)) return 'UY';
	if (/\bPARAGUAY/i.test(k)) return 'PY';
	if (/\bBRASIL|\bBRAZIL/i.test(k)) return 'BR';
	// Sin coincidencia: no forzar 'AR' en servidor (evita nacionalidad incorrecta).
	return null;
}
const numOrNull = (v) => {
	if (v === undefined || v === null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** Transforma fila de BD -> objeto de salida */
function mapRow(row) {
	if (!row) return null;
	return {
		Valor: row.Valor,
		TipoDocumento: strOrNull(row.TipoDocumento),
		NumeroDocumento: row.Numero != null ? Number(row.Numero) : null,
		ApellidoNombre: strOrNull(row.ApellidoNombre) || '',
		Domicilio: strOrNull(row.Domicilio),
		ValorLocalidad: row.ValorLocalidad != null ? Number(row.ValorLocalidad) : null,
		Provincia: row.Provincia != null ? Number(row.Provincia) : null,
		Nacionalidad: strOrNull(row.Nacionalidad),
		FechaNacimiento: clarionToIso(row.FechaNacimiento),
		FechaNacimientoClarion: row.FechaNacimiento != null ? Number(row.FechaNacimiento) : null,
		Sexo: strOrNull(row.Sexo),
		EstadoCivil: strOrNull(row.EstadoCivil),
		Telefono: strOrNull(row.Telefono),
		// Datos profesionales
		MatriculaProvincial: row.Matricula != null ? Number(row.Matricula) : null,
		MatriculaNacional: row.MatriculaNacional != null ? Number(row.MatriculaNacional) : null,
		ValorEspecialidad: row.ValorEspecialidad != null ? Number(row.ValorEspecialidad) : null,
		ValorFunciones: row.ValorFunciones != null ? Number(row.ValorFunciones) : null,
		ValorServicio: strOrNull(row.ValorServicio),
		ValorServicioParaFacturar: strOrNull(row.ValorServicioParaFacturar),
		ValorCategoria: row.ValorCategoria != null ? Number(row.ValorCategoria) : null,
		ValorClase: strOrNull(row.ValorClase),
		LugarTrabajo: strOrNull(row.LugarTrabajo),
		LugarCobro: strOrNull(row.LugarCobro),
		NumeroSocio: row.NumeroSocio != null ? Number(row.NumeroSocio) : null,
		ConvenioFacturacion: strOrNull(row.ConvenioFacturacion),
		IdEspecialidadME: row.IdEspecialidadME != null ? Number(row.IdEspecialidadME) : null,
		Estado: row.Estado != null ? Number(row.Estado) : null,
		CUIT: strOrNull(row.CUIT),
		Observaciones: strOrNull(row.Observaciones),
		// Rol: en imPersonal.Rol (varchar(20)) se persiste el IdRol como string.
		// La asignación se hace por el endpoint dedicado PUT /api/roles/personal/:valor.
		Rol: (() => {
			const r = strOrNull(row.Rol);
			if (!r) return null;
			const n = Number(r);
			return Number.isFinite(n) ? n : null;
		})(),
	};
}

const SELECT_COLS = `
	p.Valor,
	p.TipoDocumento,
	p.Numero,
	p.ApellidoNombre,
	p.Domicilio,
	p.ValorLocalidad,
	p.Provincia,
	p.Nacionalidad,
	p.FechaNacimiento,
	p.Sexo,
	p.EstadoCivil,
	p.Telefono,
	p.Matricula,
	p.MatriculaNacional,
	p.ValorEspecialidad,
	p.ValorFunciones,
	p.ValorServicio,
	p.ValorServicioParaFacturar,
	p.ValorCategoria,
	p.ValorClase,
	p.LugarTrabajo,
	p.LugarCobro,
	p.NumeroSocio,
	p.ConvenioFacturacion,
	p.IdEspecialidadME,
	p.Estado,
	p.CUIT,
	p.Observaciones,
	p.Rol
`;

/**
 * Listado paginado con búsqueda opcional.
 */
async function listar(page = 1, limit = 30, search = '') {
	const offset = (page - 1) * limit;
	const searchTerm = `%${String(search || '').trim()}%`;
	const hasSearch = String(search || '').trim().length > 0;

	const pool = await connectDB();

	const whereParts = [`p.Valor < ${ADMIN_VALOR_THRESHOLD}`];
	const whereArgs = [];
	if (hasSearch) {
		whereParts.push(
			`(p.ApellidoNombre LIKE @search OR CAST(p.Numero AS VARCHAR(20)) LIKE @search OR CAST(p.Valor AS VARCHAR(20)) LIKE @search)`,
		);
	}
	const whereSql = whereParts.join(' AND ');

	// Count
	const reqCount = pool.request();
	if (hasSearch) reqCount.input('search', sql.VarChar, searchTerm);
	const countRes = await reqCount.query(`
		SELECT COUNT(*) AS total
		FROM dbo.imPersonal p
		WHERE ${whereSql}
	`);
	const totalCount = countRes.recordset[0]?.total || 0;

	const reqData = pool.request();
	reqData.input('offset', sql.Int, offset);
	reqData.input('limit', sql.Int, limit);
	if (hasSearch) reqData.input('search', sql.VarChar, searchTerm);

	const dataRes = await reqData.query(`
		SELECT ${SELECT_COLS}
		FROM dbo.imPersonal p
		WHERE ${whereSql}
		ORDER BY p.ApellidoNombre
		OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
	`);

	return {
		data: dataRes.recordset.map(mapRow),
		totalCount,
		totalPages: Math.max(1, Math.ceil(totalCount / limit)),
	};
}

async function obtenerPorId(valor) {
	const rows = await executeQuery(
		`SELECT ${SELECT_COLS} FROM dbo.imPersonal p WHERE p.Valor = @p0`,
		[{ value: valor, type: 'Int' }],
	);
	return rows.length ? mapRow(rows[0]) : null;
}

/** Obtiene el próximo Valor (MAX+1) excluyendo admins. */
async function obtenerProximoValor() {
	const rows = await executeQuery(
		`SELECT ISNULL(MAX(Valor), 0) AS maxVal FROM dbo.imPersonal WHERE Valor < ${ADMIN_VALOR_THRESHOLD}`,
	);
	const max = rows[0]?.maxVal || 0;
	return Number(max) + 1;
}

/** Valida que no exista otro personal con el mismo Numero (DNI) */
async function existeDocumento(numero, excluirValor = null) {
	if (numero == null) return false;
	let query = `SELECT TOP 1 Valor FROM dbo.imPersonal WHERE Numero = @p0 AND Valor < ${ADMIN_VALOR_THRESHOLD}`;
	const params = [{ value: numero, type: 'Int' }];
	if (excluirValor != null) {
		query += ` AND Valor <> @p1`;
		params.push({ value: excluirValor, type: 'Int' });
	}
	const rows = await executeQuery(query, params);
	return rows.length > 0;
}

function normalizarInput(data) {
	const numDoc = numOrNull(data.NumeroDocumento);
	return {
		TipoDocumento: truncStr(data.TipoDocumento, 10),
		Numero: numDoc,
		ApellidoNombre: truncStr(data.ApellidoNombre, 80) || '',
		Domicilio: truncStr(data.Domicilio, 100),
		ValorLocalidad: numOrNull(data.ValorLocalidad),
		Provincia: numOrNull(data.Provincia),
		Nacionalidad: nacionalidadToCodigoImPersonal(data.Nacionalidad),
		FechaNacimiento: data.FechaNacimiento
			? convertirFechaAClarion(data.FechaNacimiento)
			: null,
		Sexo: truncStr(data.Sexo, 1),
		EstadoCivil: truncStr(data.EstadoCivil, 1),
		Telefono: truncStr(data.Telefono, 30),
		// Datos profesionales
		MatriculaProvincial: numOrNull(data.MatriculaProvincial),
		MatriculaNacional: numOrNull(data.MatriculaNacional),
		ValorEspecialidad: numOrNull(data.ValorEspecialidad),
		ValorFunciones: numOrNull(data.ValorFunciones),
		ValorCategoria: numOrNull(data.ValorCategoria),
		ValorClase: truncStr(data.ValorClase, 15),
		LugarTrabajo: truncStr(data.LugarTrabajo, 40),
		LugarCobro: truncStr(data.LugarCobro, 40),
		NumeroSocio: numOrNull(data.NumeroSocio),
		ConvenioFacturacion: truncStr(data.ConvenioFacturacion, 10),
		IdEspecialidadME: numOrNull(data.IdEspecialidadME),
	};
}

/** Verifica que una Matricula provincial no esté duplicada (ignora nulls y al propio registro) */
async function existeMatricula(matricula, excluirValor = null) {
	if (matricula == null) return false;
	let query = `SELECT TOP 1 Valor FROM dbo.imPersonal WHERE Matricula = @p0 AND Valor < ${ADMIN_VALOR_THRESHOLD}`;
	const params = [{ value: matricula, type: 'Int' }];
	if (excluirValor != null) {
		query += ` AND Valor <> @p1`;
		params.push({ value: excluirValor, type: 'Int' });
	}
	const rows = await executeQuery(query, params);
	return rows.length > 0;
}

async function crear(data) {
	const input = normalizarInput(data);

	if (!input.ApellidoNombre) {
		const e = new Error('ApellidoNombre es obligatorio');
		e.statusCode = 400;
		throw e;
	}

	if (input.Numero != null && (await existeDocumento(input.Numero))) {
		const e = new Error('Ya existe un personal con ese número de documento');
		e.statusCode = 409;
		throw e;
	}

	if (
		input.MatriculaProvincial != null &&
		(await existeMatricula(input.MatriculaProvincial))
	) {
		const e = new Error('Ya existe un personal con esa matrícula provincial');
		e.statusCode = 409;
		throw e;
	}

	// Intentar hasta 5 veces por si hay carrera en MAX+1
	let lastErr = null;
	for (let intento = 0; intento < 5; intento++) {
		const nuevoValor = await obtenerProximoValor();
		// Si el usuario NO ingresó matrícula provincial, la seteamos en Valor
		// (la tabla tiene índice único en Matricula y no admite múltiples NULL).
		const matriculaFinal =
			input.MatriculaProvincial != null ? input.MatriculaProvincial : nuevoValor;
		try {
			await executeQuery(
				`
				INSERT INTO dbo.imPersonal (
					Valor, Matricula, MatriculaNacional, TipoDocumento, Numero,
					ApellidoNombre, Domicilio, ValorLocalidad, Provincia, Nacionalidad,
					FechaNacimiento, Sexo, EstadoCivil, Telefono,
					ValorEspecialidad, ValorFunciones, ValorServicio, ValorCategoria,
					ValorClase, LugarTrabajo, LugarCobro, NumeroSocio,
					ConvenioFacturacion, IdEspecialidadME, Estado
				) VALUES (
					@p0, @p1, @p2, @p3, @p4,
					@p5, @p6, @p7, @p8, @p9,
					@p10, @p11, @p12, @p13,
					@p14, @p15, NULL, @p16,
					@p17, @p18, @p19, @p20,
					@p21, @p22, @p23
				)
				`,
				[
					{ value: nuevoValor, type: 'Int' },
					{ value: matriculaFinal, type: 'Int' },
					{ value: input.MatriculaNacional, type: 'Int' },
					{ value: input.TipoDocumento, type: 'VarChar' },
					{ value: input.Numero, type: 'Int' },
					{ value: input.ApellidoNombre, type: 'VarChar' },
					{ value: input.Domicilio, type: 'VarChar' },
					{ value: input.ValorLocalidad, type: 'Int' },
					{ value: input.Provincia, type: 'SmallInt' },
					{ value: input.Nacionalidad, type: 'VarChar' },
					{ value: input.FechaNacimiento, type: 'Int' },
					{ value: input.Sexo, type: 'Char' },
					{ value: input.EstadoCivil, type: 'Char' },
					{ value: input.Telefono, type: 'VarChar' },
					{ value: input.ValorEspecialidad, type: 'SmallInt' },
					{ value: input.ValorFunciones, type: 'TinyInt' },
					{ value: input.ValorCategoria, type: 'TinyInt' },
					{ value: input.ValorClase, type: 'VarChar' },
					{ value: input.LugarTrabajo, type: 'VarChar' },
					{ value: input.LugarCobro, type: 'VarChar' },
					{ value: input.NumeroSocio, type: 'Int' },
					{ value: input.ConvenioFacturacion, type: 'VarChar' },
					{ value: input.IdEspecialidadME, type: 'Int' },
					{ value: 1, type: 'TinyInt' },
				],
			);
			return await obtenerPorId(nuevoValor);
		} catch (err) {
			const n = err?.number ?? err?.originalError?.info?.number;
			// 2601/2627 = Duplicate key (PK). Reintentar.
			if (n === 2601 || n === 2627) {
				lastErr = err;
				continue;
			}
			throw err;
		}
	}
	throw lastErr || new Error('No se pudo crear el personal (conflicto de ID)');
}

async function actualizar(valor, data) {
	const existente = await obtenerPorId(valor);
	if (!existente) return null;

	const input = normalizarInput(data);
	if (!input.ApellidoNombre) {
		const e = new Error('ApellidoNombre es obligatorio');
		e.statusCode = 400;
		throw e;
	}

	if (input.Numero != null && (await existeDocumento(input.Numero, valor))) {
		const e = new Error('Ya existe otro personal con ese número de documento');
		e.statusCode = 409;
		throw e;
	}

	if (
		input.MatriculaProvincial != null &&
		(await existeMatricula(input.MatriculaProvincial, valor))
	) {
		const e = new Error('Ya existe otro personal con esa matrícula provincial');
		e.statusCode = 409;
		throw e;
	}

	// Si no mandaron matrícula provincial, caemos al Valor para mantener la
	// unicidad del índice (no admite múltiples NULL).
	const matriculaFinal =
		input.MatriculaProvincial != null ? input.MatriculaProvincial : valor;

	await executeQuery(
		`
		UPDATE dbo.imPersonal SET
			Matricula = @p1,
			MatriculaNacional = @p2,
			TipoDocumento = @p3,
			Numero = @p4,
			ApellidoNombre = @p5,
			Domicilio = @p6,
			ValorLocalidad = @p7,
			Provincia = @p8,
			Nacionalidad = @p9,
			FechaNacimiento = @p10,
			Sexo = @p11,
			EstadoCivil = @p12,
			Telefono = @p13,
			ValorEspecialidad = @p14,
			ValorFunciones = @p15,
			ValorCategoria = @p16,
			ValorClase = @p17,
			LugarTrabajo = @p18,
			LugarCobro = @p19,
			NumeroSocio = @p20,
			ConvenioFacturacion = @p21,
			IdEspecialidadME = @p22
		WHERE Valor = @p0
		`,
		[
			{ value: valor, type: 'Int' },
			{ value: matriculaFinal, type: 'Int' },
			{ value: input.MatriculaNacional, type: 'Int' },
			{ value: input.TipoDocumento, type: 'VarChar' },
			{ value: input.Numero, type: 'Int' },
			{ value: input.ApellidoNombre, type: 'VarChar' },
			{ value: input.Domicilio, type: 'VarChar' },
			{ value: input.ValorLocalidad, type: 'Int' },
			{ value: input.Provincia, type: 'SmallInt' },
			{ value: input.Nacionalidad, type: 'VarChar' },
			{ value: input.FechaNacimiento, type: 'Int' },
			{ value: input.Sexo, type: 'Char' },
			{ value: input.EstadoCivil, type: 'Char' },
			{ value: input.Telefono, type: 'VarChar' },
			{ value: input.ValorEspecialidad, type: 'SmallInt' },
			{ value: input.ValorFunciones, type: 'TinyInt' },
			{ value: input.ValorCategoria, type: 'TinyInt' },
			{ value: input.ValorClase, type: 'VarChar' },
			{ value: input.LugarTrabajo, type: 'VarChar' },
			{ value: input.LugarCobro, type: 'VarChar' },
			{ value: input.NumeroSocio, type: 'Int' },
			{ value: input.ConvenioFacturacion, type: 'VarChar' },
			{ value: input.IdEspecialidadME, type: 'Int' },
		],
	);
	return await obtenerPorId(valor);
}

async function eliminar(valor) {
	if (valor >= ADMIN_VALOR_THRESHOLD) {
		const e = new Error('No se puede eliminar un registro reservado del sistema');
		e.statusCode = 403;
		throw e;
	}
	const existente = await obtenerPorId(valor);
	if (!existente) return false;
	await executeQuery(`DELETE FROM dbo.imPersonal WHERE Valor = @p0`, [
		{ value: valor, type: 'Int' },
	]);
	return true;
}

// ---------- Catálogos (dropdowns de la solapa "Datos Profesionales") ----------

async function listarEspecialidades() {
	const rows = await executeQuery(
		`SELECT Valor, Descripcion FROM dbo.imEspecialidad ORDER BY Descripcion`,
	);
	return rows.map((r) => ({
		valor: Number(r.Valor),
		descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function listarFunciones() {
	const rows = await executeQuery(
		`SELECT Valor, Descripcion FROM dbo.imFunciones ORDER BY Descripcion`,
	);
	return rows.map((r) => ({
		valor: Number(r.Valor),
		descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function listarServicios() {
	const rows = await executeQuery(
		`SELECT Valor, Descripcion FROM dbo.imServicios ORDER BY Descripcion`,
	);
	return rows.map((r) => ({
		valor: String(r.Valor || '').trim(),
		descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function listarCategorias() {
	const rows = await executeQuery(
		`SELECT Valor, Descripcion FROM dbo.imCategorias ORDER BY Valor`,
	);
	return rows.map((r) => ({
		valor: Number(r.Valor),
		descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function listarClases() {
	const rows = await executeQuery(
		`SELECT Valor, Descripcion FROM dbo.imClases ORDER BY Descripcion`,
	);
	return rows.map((r) => ({
		valor: String(r.Valor || '').trim(),
		descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function listarEmpresasCatalogo() {
	const rows = await executeQuery(
		`SELECT IDEMPRESA AS IdEmpresa, RTRIM(LTRIM(ISNULL(DESCRIPCION, ''))) AS Descripcion
		 FROM dbo.Empresas ORDER BY DESCRIPCION`,
	);
	return rows.map((r) => ({
		IdEmpresa: Number(r.IdEmpresa),
		Descripcion: String(r.Descripcion || '').trim(),
	}));
}

/** Servicio asistencial + servicio para facturar (solo vía acciones, no por el form CRUD). */
async function obtenerServicioPersonal(valor) {
	const rows = await executeQuery(
		`SELECT ValorServicio, ValorServicioParaFacturar FROM dbo.imPersonal WHERE Valor = @p0`,
		[{ value: valor, type: 'Int' }],
	);
	if (!rows.length) return null;
	return {
		ValorServicio: strOrNull(rows[0].ValorServicio),
		ValorServicioParaFacturar: strOrNull(rows[0].ValorServicioParaFacturar),
	};
}

async function actualizarServicioPersonal(valor, data) {
	const vs = strOrNull(data.ValorServicio);
	const vsf = strOrNull(data.ValorServicioParaFacturar);
	await executeQuery(
		`UPDATE dbo.imPersonal SET ValorServicio = @p1, ValorServicioParaFacturar = @p2 WHERE Valor = @p0`,
		[
			{ value: valor, type: 'Int' },
			{ value: vs, type: 'VarChar' },
			{ value: vsf, type: 'VarChar' },
		],
	);
	return obtenerServicioPersonal(valor);
}

async function listarEmpresasPersonal(valor) {
	const rows = await executeQuery(
		`SELECT pe.IdEmpresa, RTRIM(LTRIM(ISNULL(e.DESCRIPCION, ''))) AS Descripcion
		 FROM dbo.imPersonalEmpresas pe
		 INNER JOIN dbo.Empresas e ON e.IDEMPRESA = pe.IdEmpresa
		 WHERE pe.IdPersonal = @p0
		 ORDER BY e.DESCRIPCION`,
		[{ value: valor, type: 'Int' }],
	);
	return rows.map((r) => ({
		IdEmpresa: Number(r.IdEmpresa),
		Descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function agregarEmpresaPersonal(valor, idEmpresa) {
	const id = Number(idEmpresa);
	if (!Number.isFinite(id)) {
		const e = new Error('IdEmpresa inválido');
		e.statusCode = 400;
		throw e;
	}
	const dup = await executeQuery(
		`SELECT 1 FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: id, type: 'Int' },
		],
	);
	if (dup.length) {
		const e = new Error('La empresa ya está asociada a este personal');
		e.statusCode = 409;
		throw e;
	}
	await executeQuery(
		`INSERT INTO dbo.imPersonalEmpresas (IdPersonal, IdEmpresa) VALUES (@p0, @p1)`,
		[
			{ value: valor, type: 'Int' },
			{ value: id, type: 'Int' },
		],
	);
	return listarEmpresasPersonal(valor);
}

async function quitarEmpresaPersonal(valor, idEmpresa) {
	const id = Number(idEmpresa);
	await executeQuery(
		`DELETE FROM dbo.imPersonalEmpresas WHERE IdPersonal = @p0 AND IdEmpresa = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: id, type: 'Int' },
		],
	);
	return listarEmpresasPersonal(valor);
}

function _sniffImageMime(buf) {
	if (!buf || buf.length < 3) return 'application/octet-stream';
	if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return 'image/png';
	if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
	if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
	return 'image/png';
}

async function obtenerFirmaPersonal(valor) {
	const pool = await connectDB();
	const r = await pool.request().input('v', sql.Int, valor).query(`
		SELECT Firma FROM dbo.imPersonal WHERE Valor = @v
	`);
	const row = r.recordset[0];
	if (!row || row.Firma == null) return { hasFirma: false };
	const buf = Buffer.isBuffer(row.Firma) ? row.Firma : Buffer.from(row.Firma);
	if (!buf.length) return { hasFirma: false };
	const mime = _sniffImageMime(buf);
	return {
		hasFirma: true,
		mime,
		dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
	};
}

async function actualizarFirmaPersonal(valor, buffer) {
	if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
		const e = new Error('Archivo de firma vacío');
		e.statusCode = 400;
		throw e;
	}
	const pool = await connectDB();
	await pool
		.request()
		.input('v', sql.Int, valor)
		.input('firma', sql.VarBinary(sql.MAX), buffer)
		.query(`UPDATE dbo.imPersonal SET Firma = @firma WHERE Valor = @v`);
	return { ok: true };
}

async function eliminarFirmaPersonal(valor) {
	await executeQuery(`UPDATE dbo.imPersonal SET Firma = NULL WHERE Valor = @p0`, [
		{ value: valor, type: 'Int' },
	]);
	return { ok: true };
}

async function listarSectoresPersonal(valor) {
	const rows = await executeQuery(
		`SELECT ps.idSector, RTRIM(LTRIM(ISNULL(s.Descripcion, ''))) AS Descripcion
		 FROM dbo.imPersonalSectores ps
		 INNER JOIN dbo.imSectores s ON ps.idSector = s.Valor
		 WHERE ps.idPersonal = @p0
		 ORDER BY s.Descripcion`,
		[{ value: valor, type: 'Int' }],
	);
	return rows.map((r) => ({
		idSector: String(r.idSector || '').trim(),
		Descripcion: String(r.Descripcion || '').trim(),
	}));
}

async function agregarSectorPersonal(valor, idSector) {
	const sid = strOrNull(idSector);
	if (!sid) {
		const e = new Error('idSector es obligatorio');
		e.statusCode = 400;
		throw e;
	}
	const dup = await executeQuery(
		`SELECT 1 FROM dbo.imPersonalSectores WHERE idPersonal = @p0 AND idSector = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: sid, type: 'VarChar' },
		],
	);
	if (dup.length) {
		const e = new Error('El sector ya está asignado');
		e.statusCode = 409;
		throw e;
	}
	await executeQuery(
		`INSERT INTO dbo.imPersonalSectores (idPersonal, idSector) VALUES (@p0, @p1)`,
		[
			{ value: valor, type: 'Int' },
			{ value: sid, type: 'VarChar' },
		],
	);
	return listarSectoresPersonal(valor);
}

async function quitarSectorPersonal(valor, idSector) {
	const sid = strOrNull(idSector);
	if (!sid) {
		const e = new Error('idSector es obligatorio');
		e.statusCode = 400;
		throw e;
	}
	await executeQuery(
		`DELETE FROM dbo.imPersonalSectores WHERE idPersonal = @p0 AND idSector = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: sid, type: 'VarChar' },
		],
	);
	return listarSectoresPersonal(valor);
}

const LIM_COD_ASOC = 8;
const LIM_COD_FAC = 30;

function normalizarCodigoAsociacion(v, obligatorio = true) {
	const s = strOrNull(v);
	if (!s) {
		if (obligatorio) {
			const e = new Error('CodigoAsociacion es obligatorio');
			e.statusCode = 400;
			throw e;
		}
		return null;
	}
	if (s.length > LIM_COD_ASOC) {
		const e = new Error(`CodigoAsociacion admite hasta ${LIM_COD_ASOC} caracteres`);
		e.statusCode = 400;
		throw e;
	}
	return s;
}

function normalizarCodigoFacturacion(v) {
	const s = strOrNull(v);
	if (!s) {
		const e = new Error('CodigoFacturacion es obligatorio');
		e.statusCode = 400;
		throw e;
	}
	if (s.length > LIM_COD_FAC) {
		const e = new Error(`CodigoFacturacion admite hasta ${LIM_COD_FAC} caracteres`);
		e.statusCode = 400;
		throw e;
	}
	return s;
}

async function listarCodigosFacturacionPersonal(valor) {
	const rows = await executeQuery(
		`SELECT RTRIM(LTRIM(CodigoAsociacion)) AS CodigoAsociacion,
		        RTRIM(LTRIM(CodigoFacturacion)) AS CodigoFacturacion
		 FROM dbo.imPersonalCodsFacturacion
		 WHERE ValorPersonal = @p0
		 ORDER BY CodigoAsociacion`,
		[{ value: valor, type: 'Int' }],
	);
	return rows.map((r) => ({
		CodigoAsociacion: String(r.CodigoAsociacion || '').trim(),
		CodigoFacturacion: String(r.CodigoFacturacion || '').trim(),
	}));
}

async function crearCodigoFacturacionPersonal(valor, body) {
	const ca = normalizarCodigoAsociacion(body.CodigoAsociacion, true);
	const cf = normalizarCodigoFacturacion(body.CodigoFacturacion);
	const dup = await executeQuery(
		`SELECT 1 FROM dbo.imPersonalCodsFacturacion WHERE ValorPersonal = @p0 AND CodigoAsociacion = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: ca, type: 'VarChar' },
		],
	);
	if (dup.length) {
		const e = new Error('Ya existe un registro con ese código de asociación');
		e.statusCode = 409;
		throw e;
	}
	await executeQuery(
		`INSERT INTO dbo.imPersonalCodsFacturacion (ValorPersonal, CodigoAsociacion, CodigoFacturacion)
		 VALUES (@p0, @p1, @p2)`,
		[
			{ value: valor, type: 'Int' },
			{ value: ca, type: 'VarChar' },
			{ value: cf, type: 'VarChar' },
		],
	);
	return listarCodigosFacturacionPersonal(valor);
}

async function actualizarCodigoFacturacionPersonal(valor, body) {
	const ca = normalizarCodigoAsociacion(body.CodigoAsociacion, true);
	const cf = normalizarCodigoFacturacion(body.CodigoFacturacion);
	const existe = await executeQuery(
		`SELECT 1 FROM dbo.imPersonalCodsFacturacion WHERE ValorPersonal = @p0 AND CodigoAsociacion = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: ca, type: 'VarChar' },
		],
	);
	if (!existe.length) {
		const e = new Error('Código de asociación no encontrado');
		e.statusCode = 404;
		throw e;
	}
	await executeQuery(
		`UPDATE dbo.imPersonalCodsFacturacion SET CodigoFacturacion = @p2
		 WHERE ValorPersonal = @p0 AND CodigoAsociacion = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: ca, type: 'VarChar' },
			{ value: cf, type: 'VarChar' },
		],
	);
	return listarCodigosFacturacionPersonal(valor);
}

async function eliminarCodigoFacturacionPersonal(valor, codigoAsociacionRaw) {
	const ca = normalizarCodigoAsociacion(codigoAsociacionRaw, true);
	await executeQuery(
		`DELETE FROM dbo.imPersonalCodsFacturacion WHERE ValorPersonal = @p0 AND CodigoAsociacion = @p1`,
		[
			{ value: valor, type: 'Int' },
			{ value: ca, type: 'VarChar' },
		],
	);
	return listarCodigosFacturacionPersonal(valor);
}

/** CUIT y observaciones (campos sueltos en imPersonal), fuera del form CRUD principal. */
async function actualizarAdicionalesPersonal(valor, body) {
	const hasObs = Object.prototype.hasOwnProperty.call(body, 'Observaciones');
	const hasCuit = Object.prototype.hasOwnProperty.call(body, 'CUIT');
	if (!hasObs && !hasCuit) {
		const e = new Error('Indique Observaciones y/o CUIT');
		e.statusCode = 400;
		throw e;
	}
	const sets = [];
	const params = [{ value: valor, type: 'Int' }];
	let pi = 1;
	if (hasObs) {
		sets.push(`Observaciones = @p${pi}`);
		const obs = strOrNull(body.Observaciones);
		params.push({
			value: obs == null ? null : normalizarTextoParaClarionAnsi(obs),
			type: 'VarChar',
		});
		pi += 1;
	}
	if (hasCuit) {
		sets.push(`CUIT = @p${pi}`);
		params.push({ value: strOrNull(body.CUIT), type: 'VarChar' });
		pi += 1;
	}
	await executeQuery(
		`UPDATE dbo.imPersonal SET ${sets.join(', ')} WHERE Valor = @p0`,
		params,
	);
	return obtenerPorId(valor);
}

module.exports = {
	listar,
	obtenerPorId,
	obtenerProximoValor,
	crear,
	actualizar,
	eliminar,
	listarEspecialidades,
	listarFunciones,
	listarServicios,
	listarCategorias,
	listarClases,
	listarEmpresasCatalogo,
	obtenerServicioPersonal,
	actualizarServicioPersonal,
	listarEmpresasPersonal,
	agregarEmpresaPersonal,
	quitarEmpresaPersonal,
	obtenerFirmaPersonal,
	actualizarFirmaPersonal,
	eliminarFirmaPersonal,
	listarSectoresPersonal,
	agregarSectorPersonal,
	quitarSectorPersonal,
	listarCodigosFacturacionPersonal,
	crearCodigoFacturacionPersonal,
	actualizarCodigoFacturacionPersonal,
	eliminarCodigoFacturacionPersonal,
	actualizarAdicionalesPersonal,
};
