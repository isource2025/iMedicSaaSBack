/**
 * Manual operativo de la plataforma: el contenido vive en ./manual/*.js (un archivo por área)
 * y acá se indexa en memoria con BM25 sobre raíces de palabras y sinónimos.
 * El modelo busca acá para responder "cómo hago X", "dónde está Y" o "por qué no me deja".
 */
const { MODULOS } = require('../utils/permisos');
const { tienePermiso: tienePermisoBase } = require('../services/permisos.service');
const rutasFront = require('./rutasFront');

const ARTICULOS = Object.freeze(
	[
		require('./manual/internacion'),
		require('./manual/historiaClinica'),
		require('./manual/admision'),
		require('./manual/turnos'),
		require('./manual/almacenFacturacion'),
		require('./manual/configuracion'),
	].flat(),
);

const STOP = new Set(
	(
		'a al algo como con cual cuando de del desde donde el ella en es esa ese esta este esto hace hacer hay ' +
		'la las le les lo los mas me mi mis muy no o para pero por porque puedo que quiero se si sin sobre su sus ' +
		'te tengo tu un una uno y ya yo necesito tenes podes deberia sirve ver usar uso haces hago ' +
		'deja dejo anda andan funciona funcionan aca aqui ahi alla'
	).split(' '),
);

/** Palabras del usuario → términos que usa el manual. */
const SINONIMOS = {
	internar: 'admision ingreso',
	ingresar: 'admision ingreso',
	alta: 'egreso',
	externar: 'egreso',
	cita: 'turno',
	doy: 'dar asignar',
	dar: 'asignar',
	sacar: 'asignar',
	reprogramar: 'cambiar turno',
	reagendar: 'cambiar turno',
	mover: 'traslado',
	pasar: 'traslado',
	clave: 'contrasena',
	password: 'contrasena',
	pass: 'contrasena',
	rol: 'permiso',
	acceso: 'permiso',
	habilitar: 'permiso',
	usuario: 'personal usuario',
	medicamento: 'medicacion',
	remedio: 'medicacion',
	droga: 'medicacion',
	placa: 'rx estudio',
	radiografia: 'rx estudio',
	analisis: 'laboratorio',
	resultado: 'laboratorio estudio',
	deslogueo: 'sesion',
	desloguea: 'sesion',
	echo: 'sesion',
	pdf: 'exportar imprimir',
	imprimir: 'pdf',
	borrar: 'eliminar',
	borre: 'eliminar',
	borro: 'eliminar desaparecio',
	desaparecio: 'no aparece periodo',
	nota: 'evolucion',
	presion: 'signos vitales control',
	fiebre: 'temperatura control',
	comida: 'dieta',
	insumo: 'insumos stock',
	pedido: 'solicitud bandeja',
	whatsapp: 'conversaciones bot',
	horario: 'configuracion agenda horarios',
	licencia: 'ausencia',
	vacaciones: 'ausencia licencia',
	medico: 'profesional',
	doctor: 'profesional medico',
	enfermera: 'enfermeria',
	enfermero: 'enfermeria',
};

function normalizar(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ñ/g, 'n');
}

const SUFIJOS = [
	'aciones', 'iciones', 'amientos', 'imientos', 'amiento', 'imiento', 'ciones', 'acion', 'icion', 'cion',
	'ando', 'iendo', 'adas', 'ados', 'idas', 'idos', 'ada', 'ado', 'ida', 'ido', 'ar', 'er', 'ir', 'es', 'as', 'os', 'a', 'e', 'o', 's',
];

/** Raíz aproximada: saca un sufijo flexivo y corta a 5 letras ("evoluciones", "evolucionar" → "evolu"). */
function raiz(palabra) {
	let w = palabra;
	for (const s of SUFIJOS) {
		if (w.length - s.length >= 3 && w.endsWith(s)) {
			w = w.slice(0, -s.length);
			break;
		}
	}
	return w.slice(0, 5);
}

function palabras(s) {
	return normalizar(s)
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 2 && !STOP.has(w));
}

function tokens(s) {
	return palabras(s).map(raiz);
}

const PESO = { titulo: 3, tags: 3, sintoma: 2, texto: 1, pasos: 1, causa: 1, comoLlegar: 1 };

function camposDe(a) {
	const problemas = a.problemas || [];
	return {
		titulo: a.titulo,
		tags: (a.tags || []).join(' '),
		texto: a.texto,
		pasos: (a.pasos || []).join(' '),
		sintoma: problemas.map((p) => p.sintoma).join(' '),
		causa: problemas.map((p) => p.causa).join(' '),
		comoLlegar: a.comoLlegar,
	};
}

function construirIndice(articulos) {
	const docs = articulos.map((a) => {
		const tf = new Map();
		let largo = 0;
		for (const [campo, txt] of Object.entries(camposDe(a))) {
			const peso = PESO[campo] || 1;
			for (const t of tokens(txt)) {
				tf.set(t, (tf.get(t) || 0) + peso);
				largo += peso;
			}
		}
		const frases = (a.tags || []).map(normalizar).filter((t) => t.includes(' '));
		return { a, tf, largo, frases };
	});
	const df = new Map();
	for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
	const promedio = docs.reduce((s, d) => s + d.largo, 0) / Math.max(1, docs.length);
	return { docs, df, promedio, n: docs.length };
}

let indice = null;
function idx() {
	if (!indice) indice = construirIndice(ARTICULOS);
	return indice;
}

/** Términos de la pregunta con su peso: los propios valen 1, los sinónimos 0.5. */
function terminosDe(pregunta) {
	const out = new Map();
	const sumar = (t, w) => out.set(t, Math.max(out.get(t) || 0, w));
	for (const w of palabras(pregunta)) {
		sumar(raiz(w), 1);
		const extra = SINONIMOS[w];
		if (extra) for (const t of tokens(extra)) sumar(t, 0.5);
	}
	return out;
}

const K1 = 1.2;
const B = 0.75;

function bm25(doc, terminos, { df, promedio, n }) {
	let s = 0;
	for (const [t, w] of terminos) {
		const f = doc.tf.get(t);
		if (!f) continue;
		const idf = Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
		s += w * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.largo) / promedio)));
	}
	return s;
}

/** "/dashboard/beds/12?seccion=evoluciones" → { base: '/dashboard/beds', seccion: 'evoluciones' }. */
function pantallaDe(ruta) {
	const [p, qs = ''] = String(ruta || '').split('?');
	let base = p.replace(/\/+$/, '') || '';
	if (/^\/dashboard\/(?:beds\/\d+|visita\/\d+)$/.test(base)) base = '/dashboard/beds';
	const seccion = new URLSearchParams(qs).get('seccion') || null;
	return { base, seccion };
}

function accesible(art, { permisos, tienePermiso } = {}) {
	if (!art.permisos?.length) return true;
	if (typeof tienePermiso === 'function') return art.permisos.some((c) => tienePermiso(c));
	if (Array.isArray(permisos)) return art.permisos.some((c) => tienePermisoBase(permisos, c));
	return null;
}

/**
 * Busca artículos por relevancia. Prioriza la pantalla actual (opts.ruta) y marca
 * `accesible` según los permisos del usuario (no filtra: el usuario puede preguntar
 * por algo que todavía no tiene habilitado).
 */
function buscar(pregunta, limite = 4, opts = {}) {
	const ix = idx();
	const terminos = terminosDe(pregunta);
	const { base, seccion } = pantallaDe(opts.ruta);
	if (!terminos.size && !seccion) return [];
	const q = normalizar(pregunta);
	const ranked = [];
	for (const d of ix.docs) {
		let s = bm25(d, terminos, ix);
		const enSeccion = Boolean(seccion) && d.a.path === base && d.a.seccion === seccion;
		if (!s && !enSeccion) continue;
		s += d.frases.filter((f) => q.includes(f)).length * 1.5;
		// La sección abierta responde las preguntas genéricas («cómo cargo», «no me deja»).
		if (enSeccion) s = s * 3 + 1;
		else if (base && d.a.path === base) s *= 1.2;
		ranked.push({ a: d.a, s });
	}
	ranked.sort((x, y) => y.s - x.s);
	const tope = ranked[0]?.s || 0;
	return ranked
		.filter((r) => r.s >= tope * 0.35)
		.slice(0, limite)
		.map(({ a }) => {
			const acc = accesible(a, opts);
			return acc === null ? { ...a } : { ...a, accesible: acc };
		});
}

/** Versión compacta para el modelo: el primero completo, el resto resumido, dentro de un tope de caracteres. */
function paraModelo(articulos, maxChars = 3500) {
	const out = [];
	let usados = 0;
	for (const [i, a] of articulos.entries()) {
		const item = {
			id: a.id,
			titulo: a.titulo,
			comoLlegar: a.comoLlegar,
			path: a.path + (a.seccion ? `?seccion=${a.seccion}` : ''),
			texto: a.texto,
		};
		if (a.accesible !== undefined) item.accesible = a.accesible;
		if (a.accesible === false) item.permisos = a.permisos;
		if (i < 2) {
			if (a.pasos?.length) item.pasos = a.pasos;
			if (a.problemas?.length) item.problemas = a.problemas;
		}
		const largo = JSON.stringify(item).length;
		if (out.length && usados + largo > maxChars) break;
		out.push(item);
		usados += largo;
	}
	return out;
}

function pantallasDesdePermisos(permisos) {
	const set = new Set(Array.isArray(permisos) ? permisos : []);
	const out = [];
	for (const mod of MODULOS) {
		if (mod.id === 'PLATAFORMA' && ![...set].some((p) => p.startsWith('PLATAFORMA.'))) continue;
		for (const sub of mod.submodulos) {
			if (!sub.path || !rutasFront.existe(sub.path)) continue;
			const visible = [...set].some((p) => p.startsWith(`${mod.id}.${sub.id}.`));
			if (!visible) continue;
			out.push({
				modulo: mod.label,
				pantalla: sub.label,
				path: sub.path,
			});
		}
	}
	return out;
}

module.exports = {
	ARTICULOS,
	buscar,
	paraModelo,
	pantallasDesdePermisos,
	_interno: { normalizar, raiz, tokens, terminosDe, pantallaDe },
};
