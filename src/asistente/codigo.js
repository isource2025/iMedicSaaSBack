/**
 * Lectura acotada del código (estilo Cursor).
 * Nunca recorre todo src: manifiesto primero, después pocos archivos del proceso.
 */
const fs = require('fs');
const path = require('path');
const manifiesto = require('./manifiesto');
const recortar = require('./recortar');

const SRC = path.resolve(__dirname, '..');
const PERMITIDAS = new Set(['controllers', 'services', 'routes']);
const BLOQUEADO = /(?:^|[/\\])(?:config|\.env|auth|password|secret|jwt|super-admin)(?:[/\\]|$|\.)/i;
const MAX_ARCHIVOS = 8;
const MAX_HITS = 12;
const MAX_HITS_POR_ARCHIVO = 4;
const MAX_SNIPPET = 180;
const MAX_LEER = 7000;

const STOP = new Set([
	'que',
	'para',
	'con',
	'una',
	'uno',
	'unos',
	'unas',
	'los',
	'las',
	'del',
	'por',
	'como',
	'dar',
	'des',
	'hacer',
	'este',
	'esta',
	'esto',
	'necesito',
	'quiero',
	'podes',
	'puede',
	'puedo',
	'tengo',
	'algo',
	'todo',
	'todos',
	'simple',
	'consulta',
	'pedido',
	'usuario',
	'the',
	'and',
	'from',
]);

function normalizarRel(p) {
	return String(p || '')
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.replace(/^src\//, '');
}

function resolverRel(rel) {
	const n = normalizarRel(rel);
	if (!n || n.includes('\0') || n.split('/').some((s) => s === '..' || s === '.')) return null;
	if (BLOQUEADO.test(n)) return null;
	const top = n.split('/')[0];
	if (!PERMITIDAS.has(top)) return null;
	if (!/\.js$/i.test(n)) return null;
	const abs = path.resolve(SRC, ...n.split('/'));
	const relSafe = path.relative(SRC, abs);
	if (relSafe.startsWith('..') || path.isAbsolute(relSafe)) return null;
	if (BLOQUEADO.test(relSafe.replace(/\\/g, '/'))) return null;
	return { abs, rel: relSafe.replace(/\\/g, '/') };
}

function cuerpoFuncion(src, nombre) {
	if (!src || !nombre || !/^[A-Za-z_$][\w$]*$/.test(nombre)) return null;
	const re = new RegExp(
		`(?:(?:const|let|var)\\s+${nombre}\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(|(?:async\\s+)?function\\s+${nombre}\\s*\\(|exports\\.${nombre}\\s*=)`,
	);
	const m = re.exec(src);
	if (!m) return null;
	return src.slice(m.index, m.index + MAX_LEER);
}

function listarJs(dirRel, acc = []) {
	const abs = path.join(SRC, dirRel);
	if (!fs.existsSync(abs)) return acc;
	for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
		const rel = `${dirRel}/${ent.name}`.replace(/\\/g, '/');
		if (BLOQUEADO.test(rel)) continue;
		if (ent.isDirectory()) listarJs(rel, acc);
		else if (ent.isFile() && /\.js$/i.test(ent.name)) acc.push(rel);
	}
	return acc;
}

function normalizar(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function partesIdentificador(s) {
	return normalizar(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2'))
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3 && !STOP.has(w));
}

function tokensDe(texto) {
	const q = String(texto || '').trim();
	const deFrase = normalizar(q)
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3 && !STOP.has(w));
	const deCamel = /^[A-Za-z_][\w]*$/.test(q) ? partesIdentificador(q) : [];
	return [...new Set([...deFrase, ...deCamel])];
}

function puntuarNombre(rel, tokens) {
	const partes = partesIdentificador(path.basename(rel, '.js'));
	const blob = `${normalizar(rel)} ${partes.join(' ')}`;
	let s = 0;
	for (const t of tokens) {
		if (blob.includes(t)) s += 6;
		if (partes.some((p) => p.includes(t) || t.includes(p))) s += 3;
	}
	return s;
}

function servicioHermano(controllerRel) {
	const base = path.basename(controllerRel).replace(/\.controller\.js$/i, '');
	if (!base || base === path.basename(controllerRel)) return null;
	return `services/${base}.service.js`;
}

function archivosDelManifiesto(endpoints) {
	const out = [];
	const seen = new Set();
	const push = (rel, s) => {
		const n = normalizarRel(rel);
		if (!n || seen.has(n) || !resolverRel(n)) return;
		seen.add(n);
		out.push({ rel: n, s });
	};
	for (const e of endpoints) {
		const full = manifiesto.resolver(e.metodo, e.path);
		if (!full?.controllerArchivo) continue;
		const ctrl = `controllers/${full.controllerArchivo}`;
		push(ctrl, 40);
		const svc = servicioHermano(ctrl);
		if (svc) push(svc, 28);
	}
	return out;
}

function elegirArchivos(tokens, carpeta, delManifiesto) {
	const ranked = new Map();
	const sumar = (rel, s) => {
		if (!rel || s <= 0) return;
		const n = normalizarRel(rel);
		if (!resolverRel(n)) return;
		ranked.set(n, Math.max(ranked.get(n) || 0, s));
	};
	for (const a of delManifiesto) sumar(a.rel, a.s);

	const top = carpeta ? normalizarRel(carpeta).split('/')[0] : null;
	const dirs = top && PERMITIDAS.has(top) ? [top] : [...PERMITIDAS];
	if (tokens.length) {
		for (const d of dirs) {
			for (const rel of listarJs(d)) sumar(rel, puntuarNombre(rel, tokens));
		}
	}

	const topDir = top && PERMITIDAS.has(top) ? `${top}/` : null;
	return [...ranked.entries()]
		.filter(([rel, s]) => s > 0 && (!topDir || rel.startsWith(topDir)))
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_ARCHIVOS)
		.map(([rel]) => rel);
}

function hitsEnArchivo(rel, re) {
	const resolved = resolverRel(rel);
	if (!resolved) return [];
	let src;
	try {
		src = fs.readFileSync(resolved.abs, 'utf8');
	} catch {
		return [];
	}
	const lineas = src.split(/\r?\n/);
	const hits = [];
	for (let i = 0; i < lineas.length; i++) {
		if (!re.test(lineas[i])) continue;
		hits.push({
			archivo: rel,
			linea: i + 1,
			snippet: lineas[i].trim().slice(0, MAX_SNIPPET),
		});
		if (hits.length >= MAX_HITS_POR_ARCHIVO) break;
	}
	return hits;
}

function buscar({ texto, carpeta, modulo } = {}) {
	const q = String(texto || '').trim();
	if (q.length < 3) return { error: 'Escribí al menos 3 caracteres para buscar en el código' };
	const tokens = tokensDe(q);
	if (!tokens.length) {
		return {
			error: 'Reformulá a 2–4 términos del proceso (ej. egreso, admision, evolucion). No busco la frase completa.',
		};
	}

	const re = (() => {
		try {
			const partes = [...new Set([q, ...tokens])].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			return new RegExp(partes.join('|'), 'i');
		} catch {
			return null;
		}
	})();
	if (!re) return { error: 'Patrón inválido' };

	const endpoints = manifiesto.buscar({
		texto: tokens.join(' '),
		modulo,
		limite: 8,
	});
	const archivos = elegirArchivos(tokens, carpeta, archivosDelManifiesto(endpoints));
	const hits = [];
	for (const rel of archivos) {
		if (hits.length >= MAX_HITS) break;
		hits.push(...hitsEnArchivo(rel, re).slice(0, MAX_HITS - hits.length));
	}

	return recortar.limitarJson({
		acotado: true,
		archivosRevisados: archivos.length,
		archivos,
		endpoints: endpoints.map((e) => ({
			metodo: e.metodo,
			path: e.path,
			handler: e.handler,
			modulo: e.modulo,
			mutante: e.mutante,
			para: e.para,
		})),
		total: hits.length,
		hits,
		truncado: hits.length >= MAX_HITS,
		aviso:
			archivos.length || endpoints.length
				? 'Búsqueda acotada al proceso. Si no encaja, buscá con otros 2–4 términos; no recorro todo el código.'
				: 'No acoté archivos. Probá términos del proceso (egreso, admision, cama) o leé el handler con método+path.',
	});
}

function leer({ archivo, handler, metodo, path: apiPath } = {}) {
	if (metodo && apiPath) {
		const ep = manifiesto.resolver(metodo, apiPath);
		if (!ep) {
			return {
				error: `No hay ${String(metodo).toUpperCase()} ${apiPath} en el manifiesto. No inventes el path.`,
			};
		}
		const desc = manifiesto.describir(ep, true);
		const resolved = ep.controllerArchivo ? resolverRel(`controllers/${ep.controllerArchivo}`) : null;
		let codigo = null;
		if (resolved && fs.existsSync(resolved.abs)) {
			const src = fs.readFileSync(resolved.abs, 'utf8');
			codigo = (ep.handler && cuerpoFuncion(src, ep.handler)) || src.slice(0, MAX_LEER);
		}
		return recortar.limitarJson({
			endpoint: desc,
			archivo: resolved ? resolved.rel : null,
			handler: ep.handler || null,
			codigo: codigo ? String(codigo).slice(0, MAX_LEER) : null,
			aviso: ep.mutante
				? 'Escritura: armá el body con estos campos y usá llamar_api. No se ejecuta hasta Confirmar.'
				: undefined,
		});
	}

	const resolved = resolverRel(archivo);
	if (!resolved) {
		return {
			error: 'Archivo no permitido. Solo controllers/, services/ y routes/ (sin auth, config ni secretos).',
		};
	}
	if (!fs.existsSync(resolved.abs)) return { error: `No existe ${resolved.rel}` };
	const src = fs.readFileSync(resolved.abs, 'utf8');
	const codigo = handler ? cuerpoFuncion(src, handler) : src;
	if (handler && !codigo) return { error: `No encontré la función ${handler} en ${resolved.rel}` };
	return recortar.limitarJson({
		archivo: resolved.rel,
		handler: handler || null,
		codigo: String(codigo || '').slice(0, MAX_LEER),
	});
}

module.exports = {
	buscar,
	leer,
	resolverRel,
	SRC,
	PERMITIDAS,
	MAX_ARCHIVOS,
};
