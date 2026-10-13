/**
 * Manifiesto de endpoints derivado del código: lee `app.js` (montajes) y
 * `routes/*.js` (método, path, permisos, handler). Se recalcula al arrancar,
 * así el asistente ve cualquier ruta nueva sin tocar este módulo.
 */
const fs = require('fs');
const path = require('path');
const { descripcionPermiso, descripcionSubmodulo } = require('../utils/permisosDescripciones');

const SRC = path.join(__dirname, '..');
const RUTAS_DIR = path.join(SRC, 'routes');
const CONTROLLERS_DIR = path.join(SRC, 'controllers');
const METODOS = ['get', 'post', 'put', 'delete', 'patch'];

/** Prefijos que el asistente nunca toca (auth, plataforma, integraciones). */
const PREFIJOS_EXCLUIDOS = [
	'/api/auth',
	'/api/health',
	'/api/super-admin',
	'/api/integrations',
	'/api/admin/bot',
	'/api/webhook',
	'/api/asistente',
	'/api/turnero/display',
	'/api/analytics/events',
	'/api/admin/users',
];

/** Se pueden leer (p. ej. para elegir el rol de un alta de personal) pero nunca modificar. */
const PREFIJOS_SOLO_LECTURA = ['/api/permisos', '/api/roles'];

/** Credenciales de acceso: no se cargan desde el chat. */
const CAMPOS_CREDENCIAL = /password|contrase|clave|nombrered|crearusuario|token|secret/i;

/** Paths que, aunque estén en un prefijo permitido, no se exponen. */
const PATRONES_EXCLUIDOS = [/\/password\b/i, /\/cuenta\b/i, /\/firma\b/i, /sync-desde-fisico/i, /reparar-/i];

function extraerArgumentos(src, inicio) {
	let prof = 0;
	let comilla = null;
	for (let i = inicio; i < src.length; i++) {
		const c = src[i];
		if (comilla) {
			if (c === '\\') i++;
			else if (c === comilla) comilla = null;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') comilla = c;
		else if (c === '(') prof++;
		else if (c === ')') {
			prof--;
			if (prof === 0) return src.slice(inicio + 1, i);
		}
	}
	return src.slice(inicio + 1);
}

function codigosEn(texto) {
	const out = [];
	const re = /['"`]([A-Z_]+(?:\.[A-Z_]+){0,2})['"`]/g;
	for (let m; (m = re.exec(texto)); ) out.push(m[1]);
	return out;
}

/** Lee el objeto literal de `requirePropietario({ ... })`. */
function configPropietario(texto) {
	const str = (k) => {
		const m = new RegExp(`\\b${k}\\s*:\\s*['"\`]([\\w.]+)['"\`]`).exec(texto);
		return m ? m[1] : undefined;
	};
	const bool = (k) => {
		const m = new RegExp(`\\b${k}\\s*:\\s*(true|false)\\b`).exec(texto);
		return m ? m[1] === 'true' : undefined;
	};
	const cfg = {
		tabla: str('tabla'),
		pkCol: str('pkCol'),
		autorCol: str('autorCol'),
		pkParam: str('pkParam') || 'id',
	};
	if (!cfg.tabla || !cfg.pkCol || !cfg.autorCol) return null;
	for (const k of ['failSafe', 'autorEsMatricula', 'permitirAdmin']) {
		const v = bool(k);
		if (v !== undefined) cfg[k] = v;
	}
	return cfg;
}

function leerMontajes() {
	const appSrc = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
	const requires = new Map();
	const reReq = /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]\.\/routes\/([^'"]+?)(?:\.js)?['"]\s*\)/g;
	for (let m; (m = reReq.exec(appSrc)); ) requires.set(m[1], `${m[2]}.js`);

	const montajes = [];
	const reUse = /app\.use\(\s*['"]([^'"]+)['"]\s*,([^;]*?)\)\s*;/g;
	for (let m; (m = reUse.exec(appSrc)); ) {
		const prefijo = m[1];
		const ids = m[2].split(',').map((s) => s.trim());
		const routerVar = ids[ids.length - 1];
		const archivo = requires.get(routerVar);
		if (archivo) montajes.push({ prefijo, archivo });
	}
	return montajes;
}

function analizarArchivoRutas(archivo) {
	const full = path.join(RUTAS_DIR, archivo);
	if (!fs.existsSync(full)) return [];
	const src = fs.readFileSync(full, 'utf8');

	const alias = new Map();
	const reAlias = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(requirePermiso|requireAnyPermiso)\s*\(/g;
	for (let m; (m = reAlias.exec(src)); ) {
		const args = extraerArgumentos(src, m.index + m[0].length - 1);
		alias.set(m[1], codigosEn(args));
	}

	const aliasPropietario = new Map();
	const reAliasProp = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*requirePropietario\s*\(/g;
	for (let m; (m = reAliasProp.exec(src)); ) {
		const cfg = configPropietario(extraerArgumentos(src, m.index + m[0].length - 1));
		if (cfg) aliasPropietario.set(m[1], cfg);
	}

	const controllers = new Map();
	const reCtrl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]\.\.\/controllers\/([^'"]+?)(?:\.js)?['"]\s*\)/g;
	for (let m; (m = reCtrl.exec(src)); ) controllers.set(m[1], `${m[2]}.js`);

	const permisosGlobales = [];
	const reUse = /router\.use\s*\(/g;
	for (let m; (m = reUse.exec(src)); ) {
		const args = extraerArgumentos(src, m.index + m[0].length - 1);
		const directos = [];
		const reP = /require(?:Any)?Permiso\s*\(/g;
		for (let p; (p = reP.exec(args)); ) {
			directos.push(...codigosEn(extraerArgumentos(args, p.index + p[0].length - 1)));
		}
		permisosGlobales.push(...directos);
	}

	const rutas = [];
	const reRuta = new RegExp(`router\\.(${METODOS.join('|')})\\s*\\(`, 'g');
	for (let m; (m = reRuta.exec(src)); ) {
		const args = extraerArgumentos(src, m.index + m[0].length - 1);
		const p = /^\s*(['"`])(.*?)\1/.exec(args);
		if (!p) continue;

		const permisos = [];
		const reP = /require(?:Any)?Permiso\s*\(/g;
		for (let x; (x = reP.exec(args)); ) {
			permisos.push(...codigosEn(extraerArgumentos(args, x.index + x[0].length - 1)));
		}
		for (const [nombre, codigos] of alias) {
			if (new RegExp(`\\b${nombre}\\b`).test(args)) permisos.push(...codigos);
		}

		let propietario = null;
		const inline = /requirePropietario\s*\(/.exec(args);
		if (inline) propietario = configPropietario(extraerArgumentos(args, inline.index + inline[0].length - 1));
		if (!propietario) {
			for (const [nombre, cfg] of aliasPropietario) {
				if (new RegExp(`(^|[^\\w$])${nombre.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(args)) {
					propietario = cfg;
					break;
				}
			}
		}

		const multipart = /\bupload\w*\.(single|array|fields|any)\s*\(/.test(args);
		const handlerMatch = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\)?\s*,?\s*$/.exec(args.trim());
		let controllerArchivo = null;
		let handler = null;
		if (handlerMatch && controllers.has(handlerMatch[1])) {
			controllerArchivo = controllers.get(handlerMatch[1]);
			handler = handlerMatch[2];
		}

		rutas.push({
			metodo: m[1].toUpperCase(),
			ruta: p[2],
			permisos: [...new Set(permisos.length ? permisos : permisosGlobales)],
			propietario,
			multipart,
			controllerArchivo,
			handler,
		});
	}
	return rutas;
}

const _ctrlCache = new Map();
function leerController(archivo) {
	if (!archivo) return null;
	if (_ctrlCache.has(archivo)) return _ctrlCache.get(archivo);
	const full = path.join(CONTROLLERS_DIR, archivo);
	const src = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
	_ctrlCache.set(archivo, src);
	return src;
}

function cuerpoHandler(src, handler) {
	if (!src || !handler) return null;
	const re = new RegExp(
		`(?:const|let|var)\\s+${handler}\\s*=\\s*async|async\\s+function\\s+${handler}\\s*\\(|exports\\.${handler}\\s*=`,
	);
	const m = re.exec(src);
	if (!m) return null;
	return src.slice(m.index, m.index + 4000);
}

const SERVICES_DIR = path.join(SRC, 'services');
const _svcCache = new Map();
function leerService(archivo) {
	if (_svcCache.has(archivo)) return _svcCache.get(archivo);
	const full = path.join(SERVICES_DIR, archivo);
	const src = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
	_svcCache.set(archivo, src);
	return src;
}

/** Cuerpo y nombre del primer parámetro de una función del archivo. */
function funcionConParam(src, nombre) {
	const re = new RegExp(
		`(?:async\\s+)?function\\s+${nombre}\\s*\\(\\s*([A-Za-z_$][\\w$]*)|(?:const|let)\\s+${nombre}\\s*=\\s*(?:async\\s*)?\\(\\s*([A-Za-z_$][\\w$]*)|\\b${nombre}\\s*:\\s*async\\s*\\(\\s*([A-Za-z_$][\\w$]*)`,
	);
	const m = re.exec(src);
	if (!m) return null;
	return { param: m[1] || m[2] || m[3], cuerpo: src.slice(m.index, m.index + 5000) };
}

function propsDe(cuerpo, variable, set) {
	const esc = variable.replace(/\$/g, '\\$');
	const re = new RegExp(`\\b${esc}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
	for (let m; (m = re.exec(cuerpo)); ) set.add(m[1]);
}

/**
 * Cuando el controller pasa el body entero al service (`svc.crear(req.body)`),
 * los campos reales se leen allá (y en helpers como `normalizarInput(data)`).
 */
function camposEnService(ctrlSrc, cuerpoCtrl, aliasBody, set) {
	const servicios = new Map();
	const reSvc = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]\.\.\/services\/([^'"]+?)(?:\.js)?['"]\s*\)/g;
	for (let m; (m = reSvc.exec(ctrlSrc)); ) servicios.set(m[1], `${m[2]}.js`);
	const reLlamada = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(\s*([A-Za-z_$][\w$.]*)\s*[,)]/g;
	for (let m; (m = reLlamada.exec(cuerpoCtrl)); ) {
		if (!servicios.has(m[1]) || !aliasBody.has(m[3])) continue;
		const src = leerService(servicios.get(m[1]));
		const fn = src && funcionConParam(src, m[2]);
		if (!fn) continue;
		propsDe(fn.cuerpo, fn.param, set);
		const reHelper = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\(\\s*${fn.param.replace(/\$/g, '\\$')}\\s*\\)`, 'g');
		for (let h; (h = reHelper.exec(fn.cuerpo)); ) {
			const helper = funcionConParam(src, h[1]);
			if (helper) propsDe(helper.cuerpo, helper.param, set);
		}
	}
}

/** Campos que el handler lee de body/query (heurística sobre el código). */
function camposDeHandler(controllerArchivo, handler) {
	const ctrlSrc = leerController(controllerArchivo);
	const cuerpo = cuerpoHandler(ctrlSrc, handler);
	if (!cuerpo) return { body: [], query: [] };
	const body = new Set();
	const query = new Set();

	const aliasBody = new Set(['req.body']);
	const reAliasBody = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*req\.body\b/g;
	for (let m; (m = reAliasBody.exec(cuerpo)); ) aliasBody.add(m[1]);

	for (const a of aliasBody) {
		const esc = a.replace('.', '\\.');
		const reProp = new RegExp(`${esc}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
		for (let m; (m = reProp.exec(cuerpo)); ) body.add(m[1]);
	}
	const reDestrBody = /\{\s*([^}]+)\}\s*=\s*req\.body/g;
	for (let m; (m = reDestrBody.exec(cuerpo)); ) {
		for (const part of m[1].split(',')) {
			const k = part.split(/[:=]/)[0].trim();
			if (k) body.add(k);
		}
	}
	camposEnService(ctrlSrc, cuerpo, aliasBody, body);
	for (const k of [...body]) if (CAMPOS_CREDENCIAL.test(k)) body.delete(k);
	const reQuery = /req\.query\??\.([A-Za-z_$][\w$]*)/g;
	for (let m; (m = reQuery.exec(cuerpo)); ) query.add(m[1]);
	const reDestrQuery = /\{\s*([^}]+)\}\s*=\s*req\.query/g;
	for (let m; (m = reDestrQuery.exec(cuerpo)); ) {
		for (const part of m[1].split(',')) {
			const k = part.split(/[:=]/)[0].trim();
			if (k) query.add(k);
		}
	}
	return { body: [...body].slice(0, 40), query: [...query].slice(0, 20) };
}

function unirPath(prefijo, ruta) {
	const r = ruta === '/' ? '' : ruta;
	return `${prefijo.replace(/\/+$/, '')}${r.startsWith('/') || !r ? r : `/${r}`}` || '/';
}

function aRegex(patron) {
	const partes = patron.split('/').map((seg) => {
		if (seg.startsWith(':')) return '[^/]+';
		return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	});
	return new RegExp(`^${partes.join('/')}/?$`);
}

function excluido(fullPath) {
	if (PREFIJOS_EXCLUIDOS.some((p) => fullPath === p || fullPath.startsWith(`${p}/`))) return true;
	return PATRONES_EXCLUIDOS.some((re) => re.test(fullPath));
}

function moduloDe(permisos, fullPath) {
	const p = permisos.find(Boolean);
	if (p) return p.split('.')[0];
	return fullPath.split('/')[2] || 'OTRO';
}

let _manifiesto = null;

function construir() {
	const montajes = leerMontajes();
	const endpoints = [];
	const vistos = new Set();
	for (const { prefijo, archivo } of montajes) {
		for (const r of analizarArchivoRutas(archivo)) {
			const full = unirPath(prefijo, r.ruta);
			if (excluido(full)) continue;
			if (r.metodo !== 'GET' && PREFIJOS_SOLO_LECTURA.some((p) => full === p || full.startsWith(`${p}/`))) continue;
			const key = `${r.metodo} ${full}`;
			if (vistos.has(key)) continue;
			vistos.add(key);
			const modulo = moduloDe(r.permisos, full);
			const para = textoDelEndpoint(r);
			endpoints.push({
				id: key,
				metodo: r.metodo,
				path: full,
				regex: aRegex(full),
				permisos: r.permisos,
				modulo,
				mutante: r.metodo !== 'GET',
				propietario: r.propietario,
				multipart: r.multipart,
				archivo,
				controllerArchivo: r.controllerArchivo,
				handler: r.handler,
				para,
				texto: normalizar(
					[
						full,
						r.handler,
						palabrasDeIdentificador(r.handler),
						archivo,
						r.permisos.join(' '),
						para,
						...r.permisos.map((p) => {
							const [mod, sub] = String(p).split('.');
							return `${descripcionPermiso(p)} ${descripcionSubmodulo(mod, sub)}`;
						}),
					].join(' '),
				),
				especificidad: full.split('/').filter((s) => s && !s.startsWith(':')).length,
			});
		}
	}
	return endpoints;
}

function obtener() {
	if (!_manifiesto) _manifiesto = construir();
	return _manifiesto;
}

function resetear() {
	_manifiesto = null;
	_ctrlCache.clear();
	_svcCache.clear();
}

/** Valores de los `:param` de un patrón aplicados a un path concreto. */
function paramsDe(ep, pathConcreto) {
	const pat = ep.path.split('/');
	const real = String(pathConcreto || '').split('?')[0].replace(/\/+$/, '').split('/');
	const out = {};
	pat.forEach((seg, i) => {
		if (seg.startsWith(':')) out[seg.slice(1)] = decodeURIComponent(real[i] || '');
	});
	return out;
}

/** Busca el endpoint que corresponde a un método + path concreto. */
function resolver(metodo, pathConcreto) {
	const m = String(metodo || 'GET').toUpperCase();
	const p = String(pathConcreto || '').split('?')[0];
	const candidatos = obtener().filter((e) => e.metodo === m && e.regex.test(p));
	candidatos.sort((a, b) => b.especificidad - a.especificidad);
	return candidatos[0] || null;
}

function normalizar(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function palabrasDeIdentificador(s) {
	return String(s || '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[\W_]+/g, ' ')
		.toLowerCase()
		.trim();
}

/** Primer párrafo del JSDoc del handler: se indexa y se muestra a la IA. */
function comentarioDeHandler(controllerArchivo, handler) {
	const src = leerController(controllerArchivo);
	if (!src || !handler) return '';
	const re = new RegExp(
		`(?:(?:const|let|var)\\s+${handler}\\s*=|async\\s+function\\s+${handler}\\s*\\(|exports\\.${handler}\\s*=)`,
	);
	const m = re.exec(src);
	if (!m) return '';
	const doc = /\/\*\*([\s\S]*?)\*\/\s*$/.exec(src.slice(Math.max(0, m.index - 600), m.index));
	if (!doc) return '';
	return doc[1]
		.replace(/^\s*\*\s?/gm, '')
		.replace(/@\w+[^\n]*/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 240);
}

function textoDelEndpoint(r) {
	return comentarioDeHandler(r.controllerArchivo, r.handler) || descripcionPermiso(r.permisos[0]) || '';
}

function buscar({ texto, modulo, metodo, limite = 25 }) {
	const q = normalizar(texto);
	const palabras = q.split(/[\s/_-]+/).filter((w) => w.length > 2);
	const mod = modulo ? String(modulo).toUpperCase() : null;
	const met = metodo ? String(metodo).toUpperCase() : null;
	return obtener()
		.filter((e) => (!mod || e.modulo === mod) && (!met || e.metodo === met))
		.map((e) => {
			const blob = e.texto || '';
			let s = 0;
			if (q && blob.includes(q)) s += 10;
			for (const w of palabras) if (blob.includes(w)) s += 2;
			if (!q) s = 1;
			return { e, s };
		})
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.slice(0, limite)
		.map(({ e }) => describir(e));
}

function describir(e, conCampos = false) {
	const out = {
		metodo: e.metodo,
		path: e.path,
		permisos: e.permisos,
		modulo: e.modulo,
		mutante: e.mutante,
		handler: e.handler,
		para: e.para || undefined,
	};
	if (e.propietario) out.soloAutor = 'Solo el profesional que cargó el registro (o un admin clínico) puede modificarlo';
	if (e.multipart) out.nota = 'Requiere archivo (multipart): no disponible desde el chat';
	if (conCampos) out.campos = camposDeHandler(e.controllerArchivo, e.handler);
	return out;
}

function resumenModulos() {
	const cont = new Map();
	for (const e of obtener()) cont.set(e.modulo, (cont.get(e.modulo) || 0) + 1);
	return [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([modulo, endpoints]) => ({ modulo, endpoints }));
}

module.exports = {
	obtener,
	resetear,
	CAMPOS_CREDENCIAL,
	PREFIJOS_SOLO_LECTURA,
	resolver,
	paramsDe,
	buscar,
	describir,
	camposDeHandler,
	resumenModulos,
	excluido,
	PREFIJOS_EXCLUIDOS,
};
