/**
 * Cada handler del backend es una operación del agente: nombre, JSDoc y campos
 * salen del código. El modelo llama la función; no busca rutas.
 */
const manifiesto = require('./manifiesto');

const RESERVADOS = new Set(['resumen', 'camposGenerados']);

function recurso(path) {
	return String(path || '')
		.split('/')
		.filter((s) => s && s !== 'api' && !s.startsWith(':'));
}

function aliasDe(a, b) {
	return a.handler && a.handler === b.handler && recurso(a.path)[0] === recurso(b.path)[0];
}

function mejor(a, b) {
	const puntos = (e) => {
		let s = e.especificidad || 0;
		if (e.path.includes('/visita-movimientos')) s -= 8;
		if (e.path.includes('/catalogs/')) s -= 4;
		if (e.para) s += 2;
		return s;
	};
	return puntos(a) >= puntos(b) ? a : b;
}

function paramsDePath(path) {
	return String(path || '')
		.split('/')
		.filter((s) => s.startsWith(':'))
		.map((s) => s.slice(1));
}

function tipoDe(nombre) {
	if (/^(id|page|limit|dias|valor)/i.test(nombre) || /Id$|Visita$|Valor$/.test(nombre)) return 'integer';
	return 'string';
}

function nombreUnico(e, usados) {
	let base = String(e.handler || `${e.metodo}_${recurso(e.path).join('_')}`).replace(/[^\w]/g, '');
	if (!/^[A-Za-z]/.test(base)) base = `op_${base}`;
	base = base.slice(0, 56);
	if (!usados.has(base)) {
		usados.add(base);
		return base;
	}
	const extra = recurso(e.path)[0] || e.modulo || 'x';
	let name = `${base.slice(0, 40)}_${String(extra).replace(/[^\w]/g, '').slice(0, 16)}`;
	let n = 2;
	while (usados.has(name)) name = `${base.slice(0, 48)}_${n++}`;
	usados.add(name);
	return name;
}

function camposDe(e) {
	const c = manifiesto.camposDeHandler(e.controllerArchivo, e.handler);
	return {
		body: c.body || [],
		query: c.query || [],
		path: paramsDePath(e.path),
	};
}

function schemaDe(e, campos) {
	const properties = {};
	const required = [];
	for (const k of campos.path) {
		properties[k] = { type: tipoDe(k), description: `Parámetro de ruta :${k}` };
		required.push(k);
	}
	for (const k of campos.query) {
		if (!properties[k]) properties[k] = { type: tipoDe(k) };
	}
	for (const k of campos.body.slice(0, 24)) {
		if (!properties[k]) properties[k] = { type: tipoDe(k) };
	}
	if (e.mutante) {
		properties.resumen = { type: 'string', description: 'Qué se guarda, en una frase, para la tarjeta de confirmación' };
		properties.camposGenerados = {
			type: 'array',
			items: { type: 'string' },
			description: 'Campos de texto libre que redactó el asistente',
		};
	}
	return {
		type: 'object',
		additionalProperties: false,
		properties,
		required: required.length ? required : undefined,
	};
}

function descripcionDe(e) {
	const para = e.para || e.handler;
	const verbo = e.mutante ? e.metodo : 'Consulta';
	return `${para} [${verbo}]. Operación del código (${e.handler}).`;
}

let _ops = null;
const _porNombre = new Map();

function construir() {
	const grupos = [];
	for (const e of manifiesto.obtener()) {
		if (!e.handler || e.multipart) continue;
		const i = grupos.findIndex((g) => aliasDe(g, e));
		if (i < 0) grupos.push(e);
		else grupos[i] = mejor(grupos[i], e);
	}
	const usados = new Set();
	return grupos.map((e) => {
		const campos = camposDe(e);
		const nombre = nombreUnico(e, usados);
		return {
			nombre,
			handler: e.handler,
			metodo: e.metodo,
			path: e.path,
			modulo: e.modulo,
			permisos: e.permisos,
			mutante: e.mutante,
			para: e.para,
			texto: e.texto || '',
			campos,
			ep: e,
		};
	});
}

function listar() {
	if (!_ops) {
		_ops = construir();
		_porNombre.clear();
		for (const op of _ops) _porNombre.set(op.nombre, op);
	}
	return _ops;
}

function resetear() {
	_ops = null;
	_porNombre.clear();
}

function porNombre(nombre) {
	listar();
	return _porNombre.get(nombre) || null;
}

function aHerramienta(op) {
	return {
		name: op.nombre,
		description: descripcionDe(op),
		permiso: op.permisos.length ? op.permisos : null,
		modulo: op.modulo,
		mutante: op.mutante,
		operacion: op,
		parameters: schemaDe(op.ep, op.campos),
	};
}

const VACIAS = new Set(['dar', 'del', 'las', 'los', 'una', 'uno', 'con', 'para', 'por', 'que', 'hacer', 'necesito']);

function puntuar(op, { q, palabras, modulo }) {
	const blob = op.texto;
	let s = 0;
	if (modulo && op.modulo === modulo) s += 2;
	if (q && blob.includes(q)) s += 10;
	for (const w of palabras) if (blob.includes(w)) s += 2;
	return s;
}

/**
 * Elige las operaciones del código más cercanas al pedido y al módulo de la pantalla.
 * Esto corre en el servidor: el modelo no busca rutas.
 */
function seleccionar({ texto, modulo, permisos, check, limite = 22 }) {
	const q = String(texto || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	const palabras = q.split(/[\s/_-]+/).filter((w) => w.length > 2 && !VACIAS.has(w));
	const puede = typeof check === 'function' ? check : () => true;
	return listar()
		.filter((op) => !op.permisos.length || op.permisos.some((p) => puede(permisos, p)))
		.map((op) => ({ op, s: puntuar(op, { q, palabras, modulo }) }))
		.filter((x) => x.s > 0 || (modulo && x.op.modulo === modulo))
		.sort((a, b) => b.s - a.s || a.op.nombre.localeCompare(b.op.nombre))
		.slice(0, limite)
		.map((x) => aHerramienta(x.op));
}

function httpDe(op, args) {
	const a = args && typeof args === 'object' ? args : {};
	const pathParams = new Set(op.campos.path);
	let path = op.path;
	for (const k of op.campos.path) {
		if (a[k] == null || a[k] === '') {
			const err = new Error(`Falta ${k}`);
			err.statusCode = 400;
			throw err;
		}
		path = path.replace(new RegExp(`:${k}\\b`), encodeURIComponent(String(a[k])));
	}
	const query = {};
	const body = {};
	for (const [k, v] of Object.entries(a)) {
		if (v == null || RESERVADOS.has(k) || pathParams.has(k)) continue;
		if (op.metodo === 'GET' || op.campos.query.includes(k)) query[k] = v;
		else body[k] = v;
	}
	return {
		metodo: op.metodo,
		path,
		query: Object.keys(query).length ? query : undefined,
		body: op.metodo === 'GET' ? undefined : Object.keys(body).length ? body : undefined,
		resumen: a.resumen,
		camposGenerados: a.camposGenerados,
	};
}

module.exports = {
	listar,
	resetear,
	porNombre,
	seleccionar,
	aHerramienta,
	httpDe,
};
