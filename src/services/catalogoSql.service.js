/**
 * CRUD genérico sobre catálogos Clarion. El id de la URL elige un registro
 * de CATALOGOS: nunca se interpola un nombre de tabla que venga del cliente.
 */
const { executeQuery } = require('../models/db');

function errorHttp(mensaje, statusCode) {
	const err = new Error(mensaje);
	err.statusCode = statusCode;
	return err;
}

function col(name, opts = {}) {
	return { name, as: opts.as || name, type: opts.type || 'VarChar', length: opts.length, editable: opts.editable };
}

const CATALOGOS = [
	{
		id: 'lugar-episodio',
		title: 'Lugares de episodio',
		table: 'imLugarEpisodio',
		permiso: 'ADMISION.TABLA.VER',
		match: ['lugar', 'episodio'],
		key: 'IdLugarEpisodio',
		keyType: 'Int',
		identity: true,
		columns: [col('IdLugarEpisodio', { as: 'Valor', editable: false }), col('Descripcion', { length: 150 })],
	},
	{
		id: 'centro-asistencial',
		title: 'Centros asistenciales',
		table: 'imCentroAsistencial',
		permiso: 'ADMISION.TABLA.VER',
		match: ['centro'],
		key: 'Valor',
		keyType: 'Int',
		identity: true,
		columns: [
			col('Valor', { editable: false }),
			col('RazonSocial', { as: 'Descripcion', length: 40 }),
			col('Domicilio', { length: 40 }),
			col('Telefono1', { length: 15 }),
			col('email', { length: 60 }),
		],
	},
	{
		id: 'categorias-medico',
		title: 'Categoría del médico',
		table: 'imCategorias',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['categoria'],
		key: 'Valor',
		keyType: 'TinyInt',
		columns: [
			col('Valor', { editable: false }),
			col('Descripcion', { length: 20 }),
			col('Porcentaje', { type: 'Float' }),
		],
	},
	{
		id: 'clases-medico',
		title: 'Clases de médicos',
		table: 'imClases',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['clases de medico'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 3,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 20 })],
	},
	{
		id: 'especialidad-medica',
		title: 'Especialidad médica',
		table: 'imEspecialidad',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['especialidad'],
		key: 'Valor',
		keyType: 'Int',
		identity: true,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'funciones-medicas',
		title: 'Funciones médicas',
		table: 'imFunciones',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['funcion'],
		key: 'Valor',
		keyType: 'TinyInt',
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'letras-practicas',
		title: 'Letras de prácticas médicas',
		table: 'imNomencladorTipoLetra',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['letra'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 1,
		columns: [
			col('Valor', { editable: false }),
			col('Descripcion', { length: 60 }),
			col('CodigoIoscor', { length: 60 }),
		],
	},
	{
		id: 'tipo-medicamento',
		title: 'Tipo de medicamentos',
		table: 'imVadeTipoMed',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['medicamento'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 4,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'estado-cama',
		title: 'Estado de camas',
		table: 'imEstadoCama',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['estado de cama'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 1,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 20 })],
	},
	{
		id: 'sectores',
		title: 'Sectores',
		table: 'imSectores',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['sector'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 4,
		columns: [
			col('Valor', { editable: false }),
			col('Descripcion', { length: 40 }),
			col('ValorServicio', { length: 4 }),
			col('AmbInt', { length: 1 }),
		],
	},
	{
		id: 'servicios',
		title: 'Servicios',
		table: 'imServicios',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['servicio'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 4,
		columns: [
			col('Valor', { editable: false }),
			col('Descripcion', { length: 40 }),
			col('PrefijosPractica', { length: 40 }),
		],
	},
	{
		id: 'tipo-dieta',
		title: 'Tipo de dieta',
		table: 'imTipoDieta',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['dieta'],
		key: 'Valor',
		keyType: 'TinyInt',
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'tipo-indicacion',
		title: 'Tipo de indicación',
		table: 'imInterTipoIndicacion',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['indicacion'],
		key: 'Valor',
		keyType: 'Int',
		identity: true,
		columns: [
			col('Valor', { editable: false }),
			col('Descripcion', { length: 30 }),
			col('Tipo', { length: 1 }),
		],
	},
	{
		id: 'tipo-control',
		title: 'Tipo de controles',
		table: 'imInterTipoControles',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['tipo de control'],
		key: 'Valor',
		keyType: 'Int',
		identity: true,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 60 })],
	},
	{
		id: 'tipo-alergeno',
		title: 'Tipo de alérgeno',
		table: 'imTipoAlergeno',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['alergeno'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 2,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'severidad-alergia',
		title: 'Severidad de alergia',
		table: 'imSeveridadAlergia',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['severidad'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 2,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'estado-clinico-alergia',
		title: 'Estado clínico de alergia',
		table: 'imEstadoClinicoAlergia',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['estado clinico'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 1,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'agente-causante',
		title: 'Agentes causantes',
		table: 'imAgenteCausante',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['agente'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 2,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 20 })],
	},
	{
		id: 'dispositivo-alerta',
		title: 'Dispositivo identificatorio',
		table: 'imDispositivoAlerta',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['dispositivo'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 1,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'tipo-unidad-medida',
		title: 'Tipo unidad medida',
		table: 'imTipoUnidadMedida',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['unidad'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 20,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 30 })],
	},
];

function normalizar(texto) {
	return String(texto || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

function porId(id) {
	const def = CATALOGOS.find((c) => c.id === id);
	if (!def) throw errorHttp(`Catálogo "${id}" no existe`, 404);
	return def;
}

function porEtiqueta(texto) {
	const n = normalizar(texto);
	return CATALOGOS.find((c) => c.match.every((m) => n.includes(m))) || null;
}

function selectList(def) {
	return def.columns.map((c) => `[${c.name}] AS [${c.as}]`).join(', ');
}

function paramDe(def, valor) {
	if (def.keyType === 'Int' || def.keyType === 'TinyInt') {
		const n = Number(valor);
		if (!Number.isFinite(n)) throw errorHttp('Clave inválida', 400);
		return { value: Math.trunc(n), type: def.keyType };
	}
	return { value: String(valor).trim(), type: 'VarChar', length: def.keyLength || 40 };
}

function paramCampo(c, raw) {
	if (c.type === 'Float' || c.type === 'Int' || c.type === 'TinyInt') {
		return { value: Number(raw) || 0, type: c.type === 'Float' ? 'Float' : c.type };
	}
	return { value: String(raw ?? '').slice(0, c.length || 200), type: 'VarChar', length: c.length || 200 };
}

async function listar(id) {
	const def = porId(id);
	const rows = await executeQuery(`SELECT ${selectList(def)} FROM dbo.[${def.table}] ORDER BY 2`);
	return { def, rows: rows || [] };
}

async function crear(id, body = {}) {
	const def = porId(id);
	const params = [];
	const names = [];
	const placeholders = [];

	if (def.identity) {
		const extraNames = def.columns.filter((c) => c.name !== def.key);
		const extraParams = extraNames.map((c, i) => {
			params.push(paramCampo(c, body[c.as] ?? body[c.name] ?? ''));
			return { name: `[${c.name}]`, ph: `@p${i}` };
		});
		const colsSql = [`[${def.key}]`, ...extraParams.map((x) => x.name)].join(', ');
		const valsSql = ['@nid', ...extraParams.map((x) => x.ph)].join(', ');
		await executeQuery(
			`
			SET XACT_ABORT ON;
			BEGIN TRANSACTION;
			DECLARE @nid int;
			SELECT @nid = ISNULL(MAX([${def.key}]), 0) + 1
			FROM dbo.[${def.table}] WITH (UPDLOCK, HOLDLOCK);
			INSERT INTO dbo.[${def.table}] (${colsSql}) VALUES (${valsSql});
			COMMIT;
			`,
			params,
		);
		return listar(id);
	}

	const keyCol = def.columns.find((c) => c.name === def.key);
	const raw = body[keyCol?.as || def.key] ?? body[def.key];
	if (raw == null || String(raw).trim() === '') throw errorHttp('El valor es obligatorio', 400);
	names.push(`[${def.key}]`);
	placeholders.push(`@p${params.length}`);
	params.push(paramDe(def, raw));

	for (const c of def.columns) {
		if (c.name === def.key) continue;
		names.push(`[${c.name}]`);
		placeholders.push(`@p${params.length}`);
		params.push(paramCampo(c, body[c.as] ?? body[c.name] ?? ''));
	}

	await executeQuery(
		`INSERT INTO dbo.[${def.table}] (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
		params,
	);
	return listar(id);
}

async function actualizar(id, clave, body = {}) {
	const def = porId(id);
	const sets = [];
	const params = [];
	for (const c of def.columns) {
		if (c.name === def.key) continue;
		sets.push(`[${c.name}] = @p${params.length}`);
		params.push(paramCampo(c, body[c.as] ?? body[c.name] ?? ''));
	}
	if (!sets.length) throw errorHttp('Nada para actualizar', 400);
	params.push(paramDe(def, clave));
	await executeQuery(
		`UPDATE dbo.[${def.table}] SET ${sets.join(', ')} WHERE [${def.key}] = @p${params.length - 1}`,
		params,
	);
	return listar(id);
}

async function borrar(id, clave) {
	const def = porId(id);
	await executeQuery(`DELETE FROM dbo.[${def.table}] WHERE [${def.key}] = @p0`, [paramDe(def, clave)]);
	return listar(id);
}

function columnasUi(def) {
	return def.columns.map((c) => ({
		key: c.as,
		label: c.as === 'Descripcion' ? 'Descripción' : c.as,
		editable: c.editable !== false && c.name !== def.key,
	}));
}

module.exports = {
	CATALOGOS,
	porId,
	porEtiqueta,
	listar,
	crear,
	actualizar,
	borrar,
	columnasUi,
};
