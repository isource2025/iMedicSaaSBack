/**
 * Catálogo de plataforma en MySQL (Railway) cuando AUTH_DB=1.
 * Super Admin, conexiones tenant y metadatos SaaS.
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const { encrypt } = require('../utils/dbCrypto');
const { PACKS_PRINCIPALES } = require('../utils/empresaModulos');

function q(name) {
	return `\`${String(name).replace(/`/g, '``')}\``;
}

async function mysqlQuery(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function mysqlExec(sql, params = []) {
	const pool = await getAuthCentralPool();
	await pool.query(sql, params);
}

function assertMysql() {
	if (!isAuthCentralEnabled()) {
		const e = new Error('MySQL auth central no está habilitado');
		e.statusCode = 503;
		throw e;
	}
}

const NUMERIC_MYSQL_TYPES = new Set([
	'int',
	'bigint',
	'smallint',
	'tinyint',
	'mediumint',
	'decimal',
	'numeric',
	'float',
	'double',
]);

let empresasNumericColsCache = null;
let empresasColsCache = null;

/** Todas las columnas de Empresas (lowercase) para features opcionales (ej. TipoServidor). */
async function getEmpresasCols() {
	if (empresasColsCache) return empresasColsCache;
	const rows = await mysqlQuery(
		`SELECT COLUMN_NAME AS col, DATA_TYPE AS tipo
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Empresas'`,
	);
	empresasColsCache = new Set(rows.map((r) => String(r.col).toLowerCase()));
	empresasNumericColsCache = new Set(
		rows
			.filter((r) => NUMERIC_MYSQL_TYPES.has(String(r.tipo).toLowerCase()))
			.map((r) => String(r.col).toLowerCase()),
	);
	return empresasColsCache;
}

/** Columnas numéricas reales de Empresas (para no mandar '' a un INT). */
async function getEmpresasNumericCols() {
	if (empresasNumericColsCache) return empresasNumericColsCache;
	await getEmpresasCols();
	return empresasNumericColsCache;
}

/** Normaliza TipoServidor a 'NUBE' | 'FISICO' (default FISICO). */
function normalizeTipoServidor(v) {
	return String(v || '').trim().toUpperCase() === 'NUBE' ? 'NUBE' : 'FISICO';
}

/**
 * Ajusta un valor según el tipo real de la columna:
 * '' / null en columna numérica → null; numérico → Number.
 */
function coerceValor(col, valor, numericCols) {
	const esNumerica = numericCols.has(String(col).toLowerCase());
	if (!esNumerica) return valor;
	if (valor == null || valor === '') return null;
	const n = Number(valor);
	return Number.isFinite(n) ? n : null;
}

function mapEmpresaRow(r) {
	return {
		IDEMPRESA: r.IDEMPRESA,
		DESCRIPCION: r.DESCRIPCION,
		calle: r.calle,
		calle_nro: r.calle_nro,
		Depto: r.Depto,
		piso: r.piso,
		localidad: r.localidad,
		Provincia: r.Provincia,
		Nro_CUIT: r.Nro_CUIT,
		Nro_IngBrutos: r.Nro_IngBrutos,
		IdTipoIVA: r.IdTipoIVA,
		TEEmpresa: r.TEEmpresa,
		Email: r.Email,
		DbServer: r.DbServer,
		DbPort: r.DbPort,
		DbInstance: r.DbInstance,
		DbName: r.DbName,
		DbUser: r.DbUser,
		DbPasswordEnc: r.DbPasswordEnc,
		DbPassword: r.DbPassword,
		TipoServidor: normalizeTipoServidor(r.TipoServidor),
		CantUsuarios: r.CantUsuarios,
	};
}

async function listarEmpresasRows(filtro = '') {
	assertMysql();
	const cols = await getEmpresasCols();
	const tipoSel = cols.has('tiposervidor') ? 'e.TipoServidor' : `'FISICO' AS TipoServidor`;
	const qstr = String(filtro || '').trim();
	let sql = `
    SELECT
      e.IDEMPRESA, e.DESCRIPCION, e.Nro_CUIT, e.localidad, e.Provincia,
      e.Email, e.TEEmpresa, e.DbServer, e.DbPort, e.DbInstance, e.DbName,
      e.DbUser, e.DbPasswordEnc, ${tipoSel},
      (SELECT COUNT(*) FROM ${q('imPersonalEmpresas')} pe WHERE pe.IdEmpresa = e.IDEMPRESA) AS CantUsuarios
    FROM ${q('Empresas')} e
  `;
	const params = [];
	if (qstr) {
		sql += ` WHERE e.DESCRIPCION LIKE ? OR CAST(e.IDEMPRESA AS CHAR) LIKE ?`;
		params.push(`%${qstr}%`, `%${qstr}%`);
	}
	sql += ` ORDER BY e.DESCRIPCION`;
	const rows = await mysqlQuery(sql, params);
	return rows.map(mapEmpresaRow);
}

async function obtenerEmpresaRow(idEmpresa) {
	assertMysql();
	const cols = await getEmpresasCols();
	const tipoSel = cols.has('tiposervidor') ? 'TipoServidor' : `'FISICO' AS TipoServidor`;
	const rows = await mysqlQuery(
		`
    SELECT IDEMPRESA, DESCRIPCION, calle, calle_nro, Depto, piso, localidad, Provincia,
           Nro_CUIT, Nro_IngBrutos, IdTipoIVA, TEEmpresa, Email,
           DbServer, DbPort, DbInstance, DbName, DbUser, DbPasswordEnc, DbPassword, ${tipoSel}
    FROM ${q('Empresas')} WHERE IDEMPRESA = ? LIMIT 1
    `,
		[Number(idEmpresa)],
	);
	return rows[0] ? mapEmpresaRow(rows[0]) : null;
}

async function siguienteIdEmpresa() {
	const rows = await mysqlQuery(`SELECT COALESCE(MAX(IDEMPRESA), 0) + 1 AS NuevoId FROM ${q('Empresas')}`);
	return Number(rows[0]?.NuevoId) || 1;
}

async function crearEmpresaRow(data) {
	assertMysql();
	const nuevoId = await siguienteIdEmpresa();
	const desc = String(data.descripcion || '').trim();
	const cols = await getEmpresasCols();
	const numericCols = await getEmpresasNumericCols();
	const val = (col, v) => coerceValor(col, v, numericCols);

	const campos = ['IDEMPRESA', 'DESCRIPCION', 'calle', 'calle_nro', 'localidad', 'Provincia', 'Nro_CUIT', 'Email', 'TEEmpresa'];
	const valores = [
		nuevoId,
		desc,
		val('calle', data.calle || ''),
		val('calle_nro', data.calle_nro),
		val('localidad', data.localidad || ''),
		val('Provincia', data.provincia),
		val('Nro_CUIT', data.cuit || ''),
		val('Email', data.email || ''),
		val('TEEmpresa', data.telefono || ''),
	];
	if (cols.has('tiposervidor')) {
		campos.push('TipoServidor');
		valores.push(normalizeTipoServidor(data.tipoServidor));
	}

	await mysqlExec(
		`INSERT INTO ${q('Empresas')} (${campos.map(q).join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`,
		valores,
	);
	return nuevoId;
}

/** Devuelve 'NUBE' | 'FISICO' para la empresa (default FISICO si no existe la columna). */
async function obtenerTipoServidor(idEmpresa) {
	assertMysql();
	const cols = await getEmpresasCols();
	if (!cols.has('tiposervidor')) return 'FISICO';
	const rows = await mysqlQuery(
		`SELECT TipoServidor FROM ${q('Empresas')} WHERE IDEMPRESA = ? LIMIT 1`,
		[Number(idEmpresa)],
	);
	return normalizeTipoServidor(rows[0]?.TipoServidor);
}

/** Actualiza el tipo de servidor de la empresa. */
async function actualizarTipoServidor(idEmpresa, tipoServidor) {
	assertMysql();
	const cols = await getEmpresasCols();
	if (!cols.has('tiposervidor')) return;
	await mysqlExec(`UPDATE ${q('Empresas')} SET TipoServidor = ? WHERE IDEMPRESA = ?`, [
		normalizeTipoServidor(tipoServidor),
		Number(idEmpresa),
	]);
}

async function actualizarEmpresaRow(idEmpresa, data) {
	assertMysql();
	const numericCols = await getEmpresasNumericCols();
	const val = (col, v) => coerceValor(col, v, numericCols);
	await mysqlExec(
		`
    UPDATE ${q('Empresas')} SET
      DESCRIPCION = ?, calle = ?, calle_nro = ?, localidad = ?, Provincia = ?,
      Nro_CUIT = ?, Email = ?, TEEmpresa = ?
    WHERE IDEMPRESA = ?
    `,
		[
			String(data.descripcion || '').trim(),
			val('calle', data.calle || ''),
			val('calle_nro', data.calle_nro),
			val('localidad', data.localidad || ''),
			val('Provincia', data.provincia),
			val('Nro_CUIT', data.cuit || ''),
			val('Email', data.email || ''),
			val('TEEmpresa', data.telefono || ''),
			Number(idEmpresa),
		],
	);
}

async function guardarConexionEmpresa(idEmpresa, data) {
	assertMysql();
	const id = Number(idEmpresa);
	const sets = [];
	const params = [];

	const add = (col, val) => {
		sets.push(`${q(col)} = ?`);
		params.push(val);
	};

	if (data.dbServer !== undefined) add('DbServer', data.dbServer || null);
	if (data.dbPort !== undefined) add('DbPort', data.dbPort != null ? Number(data.dbPort) : null);
	if (data.dbInstance !== undefined) add('DbInstance', data.dbInstance || null);
	if (data.dbName !== undefined) add('DbName', data.dbName || null);
	if (data.dbUser !== undefined) add('DbUser', data.dbUser || null);

	if (data.dbPassword != null && String(data.dbPassword).trim() !== '') {
		add('DbPassword', String(data.dbPassword));
		add('DbPasswordEnc', encrypt(String(data.dbPassword)));
	} else if (data.dbPasswordEnc !== undefined && data.dbPasswordEnc != null) {
		add('DbPasswordEnc', data.dbPasswordEnc);
	}

	if (!sets.length) return obtenerEmpresaRow(id);

	params.push(id);
	await mysqlExec(`UPDATE ${q('Empresas')} SET ${sets.join(', ')} WHERE IDEMPRESA = ?`, params);
	return obtenerEmpresaRow(id);
}

async function eliminarEmpresa(idEmpresa) {
	assertMysql();
	const id = Number(idEmpresa);
	const exists = await mysqlQuery(`SELECT 1 FROM ${q('Empresas')} WHERE IDEMPRESA = ? LIMIT 1`, [id]);
	if (!exists.length) {
		const e = new Error('Empresa no encontrada');
		e.statusCode = 404;
		throw e;
	}
	for (const table of [
		'EmpresasModuloPack',
		'EmpresasOnboarding',
		'EmpresasSuscripcion',
		'imPersonalEmpresas',
	]) {
		try {
			await mysqlExec(`DELETE FROM ${q(table)} WHERE IdEmpresa = ?`, [id]);
		} catch (err) {
			console.warn(`[platformMysql] eliminarEmpresa ${table}:`, err.message);
		}
	}
	await mysqlExec(`DELETE FROM ${q('Empresas')} WHERE IDEMPRESA = ?`, [id]);
	return { ok: true, idEmpresa: id };
}

async function obtenerPacks(idEmpresa) {
	assertMysql();
	const rows = await mysqlQuery(
		`SELECT CodigoPack FROM ${q('EmpresasModuloPack')} WHERE IdEmpresa = ? AND Activo = 1 ORDER BY CodigoPack`,
		[Number(idEmpresa)],
	);
	return rows.map((r) => String(r.CodigoPack));
}

async function actualizarPacks(idEmpresa, packsActivos) {
	assertMysql();
	const validos = new Set(PACKS_PRINCIPALES.map((p) => p.codigo));
	const activos = (packsActivos || []).filter((c) => validos.has(String(c).toUpperCase()));
	const id = Number(idEmpresa);
	await mysqlExec(`DELETE FROM ${q('EmpresasModuloPack')} WHERE IdEmpresa = ?`, [id]);
	for (const codigo of activos) {
		await mysqlExec(
			`INSERT INTO ${q('EmpresasModuloPack')} (IdEmpresa, CodigoPack, Activo, FechaAlta) VALUES (?, ?, 1, NOW())`,
			[id, codigo],
		);
	}
	return activos;
}

function parseOnboardingConfigJson(raw) {
	if (!raw) return { sectoresDefecto: [] };
	try {
		const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return {
			sectoresDefecto: Array.isArray(o?.sectoresDefecto) ? o.sectoresDefecto.map(String) : [],
		};
	} catch {
		return { sectoresDefecto: [] };
	}
}

async function obtenerOnboarding(idEmpresa) {
	assertMysql();
	const rows = await mysqlQuery(
		`SELECT PasoActual, Completado, Notas, FechaInicio, FechaCompletado, ConfigJson
     FROM ${q('EmpresasOnboarding')} WHERE IdEmpresa = ? LIMIT 1`,
		[Number(idEmpresa)],
	);
	if (!rows.length) {
		return { pasoActual: 'DATOS', completado: false, notas: '', sectoresDefecto: [] };
	}
	const r = rows[0];
	const cfg = parseOnboardingConfigJson(r.ConfigJson);
	return {
		pasoActual: r.PasoActual || 'DATOS',
		completado: !!r.Completado,
		notas: r.Notas || '',
		fechaInicio: r.FechaInicio,
		fechaCompletado: r.FechaCompletado,
		sectoresDefecto: cfg.sectoresDefecto,
	};
}

async function upsertOnboarding(idEmpresa, data) {
	assertMysql();
	const id = Number(idEmpresa);
	const exists = await mysqlQuery(
		`SELECT IdEmpresa, ConfigJson FROM ${q('EmpresasOnboarding')} WHERE IdEmpresa = ? LIMIT 1`,
		[id],
	);

	let configJson = null;
	if (data.sectoresDefecto !== undefined) {
		const prev = exists.length ? parseOnboardingConfigJson(exists[0].ConfigJson) : { sectoresDefecto: [] };
		configJson = JSON.stringify({
			...prev,
			sectoresDefecto: (data.sectoresDefecto || []).map(String),
		});
	}

	if (exists.length) {
		const sets = ['PasoActual = ?', 'Completado = ?', 'Notas = ?'];
		const params = [
			data.pasoActual || 'DATOS',
			data.completado ? 1 : 0,
			data.notas || '',
		];
		if (data.completado) {
			sets.push('FechaCompletado = NOW()');
		}
		if (configJson !== null) {
			sets.push('ConfigJson = ?');
			params.push(configJson);
		}
		params.push(id);
		await mysqlExec(
			`UPDATE ${q('EmpresasOnboarding')} SET ${sets.join(', ')} WHERE IdEmpresa = ?`,
			params,
		);
	} else {
		await mysqlExec(
			`
      INSERT INTO ${q('EmpresasOnboarding')}
        (IdEmpresa, PasoActual, Completado, Notas, FechaInicio, ConfigJson)
      VALUES (?, ?, ?, ?, NOW(), ?)
      `,
			[
				id,
				data.pasoActual || 'DATOS',
				data.completado ? 1 : 0,
				data.notas || '',
				configJson || '{"sectoresDefecto":[]}',
			],
		);
	}
	return obtenerOnboarding(id);
}

async function obtenerSuscripcion(idEmpresa) {
	assertMysql();
	const rows = await mysqlQuery(
		`SELECT \`Plan\`, Estado, ImporteMensual, Moneda, FechaInicio, FechaProximoCobro, MetodoPago, Notas
     FROM ${q('EmpresasSuscripcion')} WHERE IdEmpresa = ? LIMIT 1`,
		[Number(idEmpresa)],
	);
	if (!rows.length) {
		return { plan: 'STARTER', estado: 'PRUEBA', importeMensual: null, moneda: 'ARS' };
	}
	const r = rows[0];
	return {
		plan: r.Plan || 'STARTER',
		estado: r.Estado || 'PRUEBA',
		importeMensual: r.ImporteMensual != null ? Number(r.ImporteMensual) : null,
		moneda: r.Moneda || 'ARS',
		fechaInicio: r.FechaInicio,
		fechaProximoCobro: r.FechaProximoCobro,
		metodoPago: r.MetodoPago || '',
		notas: r.Notas || '',
	};
}

async function upsertSuscripcion(idEmpresa, data) {
	assertMysql();
	const id = Number(idEmpresa);
	const exists = await mysqlQuery(
		`SELECT IdEmpresa FROM ${q('EmpresasSuscripcion')} WHERE IdEmpresa = ? LIMIT 1`,
		[id],
	);
	const params = [
		data.plan || 'STARTER',
		data.estado || 'PRUEBA',
		data.importeMensual ?? null,
		data.moneda || 'ARS',
		data.fechaProximoCobro || null,
		data.metodoPago || '',
		data.notas || '',
	];
	if (exists.length) {
		await mysqlExec(
			`
      UPDATE ${q('EmpresasSuscripcion')} SET
        \`Plan\` = ?, Estado = ?, ImporteMensual = ?, Moneda = ?,
        FechaProximoCobro = ?, MetodoPago = ?, Notas = ?
      WHERE IdEmpresa = ?
      `,
			[...params, id],
		);
	} else {
		await mysqlExec(
			`
      INSERT INTO ${q('EmpresasSuscripcion')}
        (IdEmpresa, \`Plan\`, Estado, ImporteMensual, Moneda, FechaInicio, FechaProximoCobro, MetodoPago, Notas)
      VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?, ?)
      `,
			[id, ...params],
		);
	}
	return obtenerSuscripcion(id);
}

async function listarConfigPlataforma() {
	assertMysql();
	const rows = await mysqlQuery(
		`SELECT Clave, Valor, Descripcion FROM ${q('imPlataformaConfig')} ORDER BY Clave`,
	);
	return rows.map((r) => ({
		clave: r.Clave,
		valor: r.Valor,
		descripcion: r.Descripcion || '',
	}));
}

async function guardarConfigPlataforma(clave, valor) {
	assertMysql();
	const k = String(clave || '').trim();
	await mysqlExec(
		`
    INSERT INTO ${q('imPlataformaConfig')} (Clave, Valor, FechaMod)
    VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE Valor = VALUES(Valor), FechaMod = NOW()
    `,
		[k, valor],
	);
	return listarConfigPlataforma();
}

async function contarUsuariosAuth() {
	assertMysql();
	const rows = await mysqlQuery(`SELECT COUNT(DISTINCT ValorPersonal) AS c FROM ${q('imPassword')}`);
	return Number(rows[0]?.c) || 0;
}

async function aplicarMigracionInfra() {
	assertMysql();
	const fs = require('fs');
	const path = require('path');
	const sqlPath = path.join(__dirname, '../../scripts/sql/migrate_auth_infra_mysql.sql');
	const raw = fs.readFileSync(sqlPath, 'utf8');
	const statements = raw
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s && !s.startsWith('--'));
	for (const stmt of statements) {
		await mysqlExec(stmt);
	}
	return { ok: true, statements: statements.length };
}

async function aplicarMigracionPlataforma() {
	assertMysql();
	const fs = require('fs');
	const path = require('path');
	const sqlPath = path.join(__dirname, '../../scripts/sql/setup_platform_mysql.sql');
	const raw = fs.readFileSync(sqlPath, 'utf8');
	// Quitar líneas de comentario antes de separar por ';' para no descartar
	// sentencias cuyo bloque arranca con comentarios (ej. CREATE EmpresasOnboarding).
	const sinComentarios = raw
		.split(/\r?\n/)
		.filter((linea) => !linea.trim().startsWith('--'))
		.join('\n');
	const statements = sinComentarios
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const stmt of statements) {
		await mysqlExec(stmt);
	}
	return { ok: true, statements: statements.length };
}

module.exports = {
	listarEmpresasRows,
	obtenerEmpresaRow,
	crearEmpresaRow,
	actualizarEmpresaRow,
	obtenerTipoServidor,
	actualizarTipoServidor,
	guardarConexionEmpresa,
	eliminarEmpresa,
	obtenerPacks,
	actualizarPacks,
	obtenerOnboarding,
	upsertOnboarding,
	obtenerSuscripcion,
	upsertSuscripcion,
	listarConfigPlataforma,
	guardarConfigPlataforma,
	contarUsuariosAuth,
	aplicarMigracionInfra,
	aplicarMigracionPlataforma,
};
