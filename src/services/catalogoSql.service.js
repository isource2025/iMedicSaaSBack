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
	return {
		name,
		as: opts.as || name,
		type: opts.type || 'VarChar',
		length: opts.length,
		editable: opts.editable,
		/** Parte de la clave compuesta: editable al crear, no al editar. */
		keyPart: Boolean(opts.keyPart),
	};
}

const KEY_SEP = '::';

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
		id: 'ocupacion',
		title: 'Ocupaciones',
		table: 'imOcupacion',
		permiso: 'ADMISION.TABLA.VER',
		match: ['ocupacion'],
		key: 'Valor',
		keyType: 'Int',
		identity: true,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
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
		match: ['tipo de medicamento'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 4,
		columns: [col('Valor', { editable: false }), col('Descripcion', { length: 40 })],
	},
	{
		id: 'convenios',
		title: 'Convenios',
		table: 'imClientesConvenios',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['convenio'],
		key: 'Clave',
		keyParts: [
			{ name: 'Valor', as: 'Cliente', type: 'Int' },
			{ name: 'Codigo', as: 'Codigo', type: 'Int' },
		],
		columns: [
			col('Valor', { as: 'Cliente', type: 'Int', keyPart: true }),
			col('Codigo', { type: 'Int', keyPart: true }),
			col('Descripcion', { length: 40 }),
			col('TipoValor', { type: 'TinyInt' }),
			col('CatProfesional', { type: 'TinyInt' }),
			col('MultiConvenio', { type: 'TinyInt' }),
		],
	},
	{
		id: 'nomenclador-nacional',
		title: 'Nomenclador Nacional',
		table: 'imNomenclador',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['nomenclador nacional'],
		key: 'IDPractica',
		keyType: 'Int',
		columns: [
			col('IDPractica', { type: 'Int' }),
			col('Descripcion', { length: 255 }),
			col('Tipo', { length: 1 }),
			col('Letra', { length: 1 }),
			col('Valor', { type: 'TinyInt' }),
			col('SubValor', { type: 'TinyInt' }),
			col('Practica', { type: 'TinyInt' }),
			col('Complejidad', { type: 'Int' }),
		],
		orderBy: 'Descripcion',
	},
	{
		id: 'nomenclador-modulos',
		title: 'Nomenclador de Módulos',
		table: 'imModuladas',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['nomenclador de modulo'],
		key: 'IDPractica',
		keyType: 'Int',
		columns: [
			col('IDPractica', { type: 'Int' }),
			col('Descripcion', { length: 300 }),
			col('Tipo', { length: 1 }),
			col('Letra', { length: 1 }),
			col('Valor', { type: 'TinyInt' }),
			col('SubValor', { type: 'TinyInt' }),
			col('Practica', { type: 'TinyInt' }),
		],
		orderBy: 'Descripcion',
	},
	{
		id: 'vademecum',
		title: 'Vademecum',
		table: 'imVademecum',
		permiso: 'FACTURACION.TABLA.VER',
		match: ['vademecum'],
		key: 'Troquel',
		keyType: 'Int',
		columns: [
			col('Troquel', { type: 'Int' }),
			col('Nombre', { length: 45 }),
			col('Descripcion', { length: 50 }),
			col('Presentacion', { length: 45 }),
			col('Laboratorio', { length: 16 }),
			col('CodigoBarra', { length: 14 }),
			col('Precio', { type: 'Float' }),
		],
		orderBy: 'Nombre',
		listTop: 3000,
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
		id: 'camas',
		title: 'Camas',
		table: 'imHabitacionCamas',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['camas'],
		key: 'Clave',
		keyParts: [
			{ name: 'ValorSector', as: 'Sector', type: 'VarChar', length: 4 },
			{ name: 'ValorHabitacionCama', as: 'Cama', type: 'VarChar', length: 4 },
		],
		columns: [
			col('ValorSector', { as: 'Sector', length: 4, keyPart: true }),
			col('ValorHabitacionCama', { as: 'Cama', length: 4, keyPart: true }),
			col('ValorEstadoCama', { as: 'Estado', length: 1 }),
			col('Tipo', { length: 20 }),
			col('Observaciones', { length: 304 }),
			col('NumeroVisita', { type: 'Int' }),
		],
		orderBy: 'ValorSector, ValorHabitacionCama',
	},
	{
		id: 'frecuencia-admin',
		title: 'Frecuencia de administrar',
		table: 'imFrecuenciasAdmin',
		permiso: 'INTERNACION.TABLA.VER',
		match: ['frecuencia'],
		key: 'Valor',
		keyType: 'VarChar',
		keyLength: 20,
		columns: [
			col('Valor', { length: 20 }),
			col('Intervalo', { type: 'Int' }),
			col('Dias', { type: 'Int' }),
		],
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

/** Prefiere el match más específico (más largo) para evitar "Camas" vs "Estado de Camas". */
function porEtiqueta(texto) {
	const n = normalizar(texto);
	const hits = CATALOGOS.filter((c) => c.match.every((m) => n.includes(m)));
	if (!hits.length) return null;
	hits.sort((a, b) => b.match.join(' ').length - a.match.join(' ').length);
	return hits[0];
}

function selectList(def) {
	return def.columns.map((c) => `[${c.name}] AS [${c.as}]`).join(', ');
}

function aliasDeColumna(def, name) {
	const c = def.columns.find((x) => x.name === name);
	return c?.as || name;
}

function conClaveCompuesta(def, rows) {
	if (!def.keyParts?.length) return rows || [];
	return (rows || []).map((r) => ({
		...r,
		[def.key]: def.keyParts.map((p) => String(r[p.as] ?? r[p.name] ?? '').trim()).join(KEY_SEP),
	}));
}

function partirClave(def, clave) {
	if (!def.keyParts?.length) return null;
	const parts = String(clave || '').split(KEY_SEP);
	if (parts.length !== def.keyParts.length) throw errorHttp('Clave compuesta inválida', 400);
	return parts.map((v, i) => {
		const p = def.keyParts[i];
		if (p.type === 'Int' || p.type === 'TinyInt') {
			const n = Number(v);
			if (!Number.isFinite(n)) throw errorHttp('Clave inválida', 400);
			return { value: Math.trunc(n), type: p.type };
		}
		return { value: String(v).trim(), type: 'VarChar', length: p.length || 40 };
	});
}

function whereClave(def, clave, params) {
	if (def.keyParts?.length) {
		const vals = partirClave(def, clave);
		const clauses = def.keyParts.map((p, i) => {
			const idx = params.length;
			params.push(vals[i]);
			return `[${p.name}] = @p${idx}`;
		});
		return clauses.join(' AND ');
	}
	params.push(paramDe(def, clave));
	return `[${def.key}] = @p${params.length - 1}`;
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
		const n = Number(raw);
		return {
			value: Number.isFinite(n) ? (c.type === 'Float' ? n : Math.trunc(n)) : 0,
			type: c.type === 'Float' ? 'Float' : c.type,
		};
	}
	return { value: String(raw ?? '').slice(0, c.length || 200), type: 'VarChar', length: c.length || 200 };
}

function esColumnaClave(def, c) {
	if (def.keyParts?.length) return def.keyParts.some((p) => p.name === c.name);
	return c.name === def.key;
}

async function listar(id) {
	const def = porId(id);
	const order = def.orderBy || '2';
	const top = def.listTop > 0 ? `TOP (${Number(def.listTop)}) ` : '';
	const rows = await executeQuery(
		`SELECT ${top}${selectList(def)} FROM dbo.[${def.table}] ORDER BY ${order}`,
	);
	return { def, rows: conClaveCompuesta(def, rows) };
}

async function crear(id, body = {}) {
	const def = porId(id);
	const params = [];

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

	const names = [];
	const placeholders = [];

	for (const c of def.columns) {
		const raw = body[c.as] ?? body[c.name];
		if (esColumnaClave(def, c) && (raw == null || String(raw).trim() === '')) {
			throw errorHttp(`El campo ${c.as} es obligatorio`, 400);
		}
		names.push(`[${c.name}]`);
		placeholders.push(`@p${params.length}`);
		params.push(paramCampo(c, raw ?? ''));
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
		if (esColumnaClave(def, c)) continue;
		sets.push(`[${c.name}] = @p${params.length}`);
		params.push(paramCampo(c, body[c.as] ?? body[c.name] ?? ''));
	}
	if (!sets.length) throw errorHttp('Nada para actualizar', 400);
	const where = whereClave(def, clave, params);
	await executeQuery(`UPDATE dbo.[${def.table}] SET ${sets.join(', ')} WHERE ${where}`, params);
	return listar(id);
}

async function borrar(id, clave) {
	const def = porId(id);
	const params = [];
	const where = whereClave(def, clave, params);
	await executeQuery(`DELETE FROM dbo.[${def.table}] WHERE ${where}`, params);
	return listar(id);
}

function columnasUi(def) {
	const cols = def.columns.map((c) => {
		let editable = c.editable !== false;
		if (def.identity && c.name === def.key) editable = false;
		if (c.keyPart) editable = true;
		return {
			key: c.as,
			label: c.as === 'Descripcion' ? 'Descripción' : c.as,
			editable,
		};
	});
	if (def.keyParts?.length) {
		cols.unshift({ key: def.key, label: 'Clave', editable: false });
	}
	return cols;
}

function keyFieldDe(def) {
	if (def.keyParts?.length) return def.key;
	return def.columns.find((c) => c.name === def.key)?.as || def.key || 'Valor';
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
	keyFieldDe,
};
