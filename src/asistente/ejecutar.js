const catalogo = require('./catalogo');
const manual = require('./manual');
const httpInterno = require('./httpInterno');
const recortar = require('./recortar');
const pendientes = require('./pendientes');
const manifiesto = require('./manifiesto');
const sqlLectura = require('./sql');
const clinica = require('./clinica');
const autoria = require('./autoria');
const marca = require('./marca');
const rutasFront = require('./rutasFront');
const codigo = require('./codigo');
const hidratar = require('./hidratar');
const resolver = require('./resolver');
const consultar = require('./consultar');
const ficha = require('./ficha');
const sesion = require('./sesion');
const diagnostico = require('./diagnostico');

const PATH_PERMITIDO = /^\/dashboard(\/|$)/;

function pathConocido(path) {
	const p = String(path || '').split('?')[0];
	if (!PATH_PERMITIDO.test(p)) return false;
	if (p.startsWith('/dashboard/super-admin')) return false;
	return rutasFront.existe(p);
}

function armarUrl(path, query) {
	const base = String(path || '');
	if (!query || typeof query !== 'object') return base;
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v == null || v === '') continue;
		params.append(k, String(v));
	}
	const qs = params.toString();
	return qs ? `${base}?${qs}` : base;
}

function agregarLink(ctx, href, etiqueta) {
	if (!href || !pathConocido(href)) return;
	if (ctx.navegaciones.some((n) => n.href === href)) return;
	ctx.navegaciones.push({ path: href.split('?')[0], href, motivo: etiqueta || null });
}

function crearPendiente(ctx, { herramienta, args, http, resumen, detalle, link, generativo }) {
	const item = pendientes.crear({
		idEmpresa: ctx.idEmpresa,
		valorPersonal: ctx.valorPersonal,
		herramienta,
		args,
		http,
		resumen,
		detalle,
		link,
		generativo,
	});
	ctx.pendientes.push({
		id: item.id,
		herramienta,
		metodo: http?.method || null,
		resumen: item.resumen,
		detalle: item.detalle,
		link: item.link,
		generativo: item.generativo.length > 0,
		expira: item.expira,
	});
	return {
		requiereConfirmacion: true,
		idPendiente: item.id,
		resumen: item.resumen,
		aviso: 'NO se ejecutó todavía. El usuario tiene que tocar Confirmar en la tarjeta del chat.',
	};
}

function prepararInsercion(args, ctx) {
	const campos = ctx.pantalla?.campos || [];
	const campo = campos.find((c) => c.id === String(args.campoId || ''));
	if (!campo) {
		return {
			error: campos.length
				? `No hay un campo ${args.campoId} en la pantalla. Campos visibles: ${campos.map((c) => `${c.id} (${c.etiqueta})`).join(', ')}`
				: 'No veo campos editables en la pantalla actual. Pedile al usuario que abra el formulario.',
		};
	}
	const texto = String(args.texto || '').trim();
	if (!texto) return { error: 'El texto a escribir está vacío' };
	const modo = args.modo === 'agregar' ? 'agregar' : 'reemplazar';
	const item = pendientes.crear({
		idEmpresa: ctx.idEmpresa,
		valorPersonal: ctx.valorPersonal,
		herramienta: 'escribir_en_campo',
		tipo: 'insercion',
		args: { campoId: campo.id },
		resumen: `${modo === 'agregar' ? 'Agregar en' : 'Escribir en'} «${campo.etiqueta}»`,
		detalle: texto,
		insercion: { campoId: campo.id, etiqueta: campo.etiqueta, multilinea: campo.multilinea, texto, modo, ruta: ctx.pantalla?.url || null },
	});
	ctx.inserciones.push({
		id: item.id,
		campoId: campo.id,
		etiqueta: campo.etiqueta,
		texto,
		modo,
		motivo: args.motivo || null,
	});
	return {
		requiereConfirmacion: true,
		idInsercion: item.id,
		aviso: 'El texto NO se escribió todavía: el usuario lo revisa y toca Aplicar. Al aplicarlo queda marcado como generado con IA y validado por él.',
	};
}

function recordarFoco(ctx, item) {
	if (!item) return;
	ctx.foco = item;
	if (ctx.conv) sesion.guardarFoco(ctx.conv, item);
}

async function resolverYFoco(args, ctx) {
	const out = await resolver.resolverContexto(args, ctx);
	if (out.fichas?.length === 1) recordarFoco(ctx, out.fichas[0]);
	else if (out.fichas?.length > 1) ctx.candidatos = out.fichas;
	return { ...out, texto: ficha.textoLista(out.fichas, resolver.terminoDe(args.texto || args.termino)) };
}

async function ejecutarPlataforma(nombre, args, ctx) {
	if (nombre === 'buscar_en_manual') {
		const hits = manual.buscar(args.pregunta || '', 5);
		return hits.length
			? { articulos: hits }
			: { articulos: [], aviso: 'No encontré un artículo. Probá listar_pantallas.' };
	}
	if (nombre === 'listar_pantallas') {
		const lista = manual.pantallasDesdePermisos(ctx.permisos);
		const f = String(args.filtro || '').trim().toLowerCase();
		const filtrada = f
			? lista.filter(
					(x) =>
						x.pantalla.toLowerCase().includes(f) ||
						x.modulo.toLowerCase().includes(f) ||
						x.path.toLowerCase().includes(f),
				)
			: lista;
		return { pantallas: filtrada.slice(0, 40), total: filtrada.length };
	}
	if (nombre === 'navegar') {
		const path = String(args.path || '').trim();
		if (!pathConocido(path)) {
			return {
				error: 'Ruta no permitida o desconocida. Usá listar_pantallas para ver paths válidos.',
				path,
			};
		}
		const href = armarUrl(path, args.query);
		agregarLink(ctx, href, args.motivo);
		return { ok: true, href, motivo: args.motivo || null };
	}
	if (nombre === 'escribir_en_campo') return prepararInsercion(args, ctx);
	if (nombre === 'diagnosticar') return diagnostico.diagnosticar(args, ctx);
	if (nombre === 'consultar') return consultar.consultar(args, ctx);
	if (nombre === 'resolver_contexto') return resolverYFoco(args, ctx);
	if (nombre === 'buscar_codigo') return codigo.buscar(args);
	if (nombre === 'leer_codigo') return codigo.leer(args);
	return { error: `Herramienta de plataforma desconocida: ${nombre}` };
}

async function ejecutarSql(nombre, args, ctx) {
	if (!sqlLectura.puedeUsarSql(ctx.req?.rolNombre, ctx.permisos)) {
		return { error: 'Tu rol no tiene habilitadas consultas SQL desde el asistente.' };
	}
	if (nombre === 'listar_tablas') return sqlLectura.listarTablas(args.filtro);
	if (nombre === 'describir_tabla') return sqlLectura.describirTabla(args.tabla);
	const r = await sqlLectura.ejecutarLectura(args.sql);
	if (r.error) return r;
	ctx.consultas.push({ sql: args.sql, motivo: args.motivo || null, total: r.total });
	return recortar.limitarJson(
		{ ...r, filas: r.filas.slice(0, 80), filasDevueltas: Math.min(r.filas.length, 80) },
		16000,
	);
}

async function ejecutarApiGenerica(nombre, args, ctx) {
	if (nombre === 'buscar_endpoints') {
		const texto = String(args.texto || '').trim();
		if (texto.length < 3) {
			return { error: 'Pasá 2–4 términos del proceso (ej. egreso, admision). No busco la frase vacía ni todo el manifiesto.' };
		}
		const hits = manifiesto.buscar({ texto, modulo: args.modulo, metodo: args.metodo, limite: 10 });
		const visibles = hits.filter(
			(e) => !e.permisos.length || e.permisos.some((p) => ctx.tienePermiso(ctx.permisos, p)),
		);
		return { total: visibles.length, endpoints: visibles, modulos: manifiesto.resumenModulos().slice(0, 15) };
	}

	const metodo = String(args.metodo || 'GET').toUpperCase();
	const path = String(args.path || '').trim();
	if (!path.startsWith('/api/')) return { error: 'El path tiene que empezar con /api/' };
	const ep = manifiesto.resolver(metodo, path);
	if (!ep && manifiesto.excluido(path)) {
		return { error: `No existe (o no está habilitado para el asistente) ${metodo} ${path}.`, noOfrecer: true };
	}
	if (!ep) {
		const parecidos = manifiesto
			.buscar({ texto: path.replace(/\/\d+/g, ' ').replace(/^\/api\//, ''), limite: 8 })
			.filter((e) => !e.permisos.length || e.permisos.some((p) => ctx.tienePermiso(ctx.permisos, p)))
			.map((e) => `${e.metodo} ${e.path}`);
		return {
			error: `No existe ${metodo} ${path}. No lo inventes: buscar_codigo o buscar_endpoints con términos del proceso, después leer_codigo del handler.`,
			parecidos,
		};
	}

	if (nombre === 'describir_endpoint') return manifiesto.describir(ep, true);

	if (ep.multipart) return { error: 'Ese endpoint requiere subir un archivo: hacelo desde la pantalla.' };
	if (ep.permisos.length && !ep.permisos.some((p) => ctx.tienePermiso(ctx.permisos, p))) {
		return { error: `Sin permiso (${ep.permisos.join(' o ')}).` };
	}
	if (ep.mutante && !ep.permisos.length) {
		return { error: 'Endpoint de escritura sin permiso declarado: no se ejecuta desde el asistente.' };
	}

	const http = { method: metodo, path, query: args.query || undefined, body: args.body || undefined };
	if (ep.mutante && args.body && typeof args.body === 'object') {
		const credenciales = Object.keys(args.body).filter((k) => manifiesto.CAMPOS_CREDENCIAL.test(k));
		if (credenciales.length) {
			return {
				error: `No cargo credenciales de acceso desde el chat (${credenciales.join(', ')}). Sacalas del body; el usuario crea la cuenta desde la ficha del personal.`,
			};
		}
	}
	if (ep.mutante) {
		const hid = await hidratar.hidratar({ ep, args, ctx });
		if (hid.pedir) {
			return {
				pedir: hid.pedir,
				aviso: hid.aviso,
				faltan: hid.faltan,
				opciones: hid.opciones,
				ficha: hid.ficha,
			};
		}
		if (hid.ok) {
			args = { ...args, body: hid.body, resumen: hid.resumen };
			http.body = hid.body;
		}
		const propiedad = await autoria.verificar(ep, path, ctx.req);
		if (!propiedad.ok) {
			return {
				error: propiedad.mensaje,
				codigoError: propiedad.codigoError || null,
				noOfrecer: true,
				sugerencia:
					propiedad.codigoError === 'REGISTRO_AJENO'
						? 'Ese registro lo cargó otro profesional. No lo ofrezcas: buscá entre los registros con _propio: true o explicale al usuario que solo puede modificar lo que cargó él.'
						: undefined,
			};
		}
		const actual = metodo === 'POST' ? null : await registroActual(ep, path, ctx);
		const cuerpo = args.body ? JSON.stringify(args.body, null, 2).slice(0, 3000) : '';
		const detalle = [actual ? `Registro actual:\n${actual}` : '', cuerpo ? `${metodo === 'DELETE' ? '' : 'Datos a enviar:\n'}${cuerpo}` : '']
			.filter(Boolean)
			.join('\n\n');
		return crearPendiente(ctx, {
			herramienta: 'llamar_api',
			args,
			http,
			resumen: String(args.resumen || '').trim() || resumenPorDefecto(metodo, ep),
			detalle: detalle || null,
			link: linkDeBody(path, args.body) || pantallaDeApi(path),
			generativo: marca.camposMarcables(args.body, args.camposGenerados),
		});
	}
	const resp = await httpInterno.llamar({
		...http,
		headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
	});
	autoria.anotar(resp.body, ctx.req);
	const data = resp.body?.data !== undefined ? resp.body.data : resp.body;
	const item = Array.isArray(data) ? data[0] : data;
	if (item && typeof item === 'object' && resp.status < 400) {
		const f = ficha.deApi(item, ep.modulo);
		if (f && (f.numeroVisita || f.idPaciente || f.documento || f.nombre)) recordarFoco(ctx, f);
	}
	return recortar.deApi(resp);
}

/** Para PUT/DELETE: lo que hay hoy en ese registro, así la tarjeta muestra qué se pisa o borra. */
async function registroActual(ep, path, ctx) {
	const get = manifiesto.resolver('GET', path);
	if (!get || get.path !== ep.path) return null;
	if (get.permisos.length && !get.permisos.some((p) => ctx.tienePermiso(ctx.permisos, p))) return null;
	try {
		const r = await httpInterno.llamar({
			method: 'GET',
			path,
			headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
		});
		if (r.status >= 400) return null;
		const data = r.body?.data !== undefined ? r.body.data : r.body;
		return JSON.stringify(data, null, 2).slice(0, 1500);
	} catch {
		return null;
	}
}

const VERBO = { POST: 'Crear un registro', PUT: 'Modificar un registro', PATCH: 'Modificar un registro', DELETE: 'Eliminar un registro' };

function resumenPorDefecto(metodo, ep) {
	const modulo = ep?.modulo ? ` de ${String(ep.modulo).toLowerCase()}` : '';
	return `${VERBO[metodo] || 'Guardar cambios'}${modulo}`;
}

const PANTALLA_POR_API = [
	['/api/personal', '/dashboard/personal'],
	['/api/patients', '/dashboard/patients'],
	['/api/roles', '/dashboard/configuracion/permisos'],
];

function pantallaDeApi(path) {
	const hit = PANTALLA_POR_API.find(([api]) => path === api || path.startsWith(`${api}/`));
	return hit && rutasFront.existe(hit[1]) ? hit[1] : null;
}

function linkDeBody(path, body) {
	const nv = body && (body.numeroVisita ?? body.NumeroVisita ?? body.IdVisita ?? body.idVisita);
	if (!nv) return null;
	const seccion = clinica.seccionDeApi(path);
	return seccion ? clinica.linkSeccion(nv, seccion) : null;
}

/** El link ya va como botón de navegación: si el modelo lo ve, lo escribe como URL inventada. */
function sinLinks(out) {
	if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
	const { link, ...resto } = out;
	if (Array.isArray(resto.internaciones)) {
		resto.internaciones = resto.internaciones.map((i) => {
			if (!i || typeof i !== 'object') return i;
			const { link: _l, ...sin } = i;
			return sin;
		});
	}
	return resto;
}

async function ejecutarRun(def, args, ctx) {
	const out = await def.run(args, ctx);
	if (out && out.http && typeof out.http.status === 'number') {
		autoria.anotar(out.http.body, ctx.req);
		const base = recortar.deApi(out.http, def.campos);
		if (out.link) agregarLink(ctx, out.link, def.name.replace(/^ver_/, '').replace(/_/g, ' '));
		return base;
	}
	if (out?.link) agregarLink(ctx, out.link, def.name.replace(/_/g, ' '));
	if (Array.isArray(out?.internaciones)) {
		for (const i of out.internaciones.slice(0, 3)) {
			agregarLink(ctx, i.link, `${i.paciente || 'Visita'} · ${i.numeroVisita}`);
		}
	}
	return recortar.limitarJson(sinLinks(out));
}

async function ejecutarPreparar(def, args, ctx) {
	const prep = await def.preparar(args, ctx);
	if (prep?.error || prep?.pedir) {
		for (const i of prep.internaciones || []) {
			if (i.link) agregarLink(ctx, i.link, i.paciente || `Visita ${i.numeroVisita}`);
		}
		if (prep.link) agregarLink(ctx, prep.link, prep.internacion?.paciente || 'Abrir ficha');
		return sinLinks(prep);
	}
	if (prep.link) agregarLink(ctx, prep.link, 'Abrir ficha');
	return crearPendiente(ctx, {
		herramienta: def.name,
		args,
		http: prep.http,
		resumen: prep.resumen,
		detalle: prep.detalle,
		link: prep.link,
		generativo: prep.generativo,
	});
}

async function ejecutarHttp(def, args, ctx) {
	if (typeof def.http !== 'function') {
		return { error: `La herramienta ${def.name} no tiene binding HTTP` };
	}
	const spec = def.http(args);
	if (def.mutante) {
		const propiedad = await autoria.verificar(manifiesto.resolver(spec.method, spec.path), spec.path, ctx.req);
		if (!propiedad.ok) return { error: propiedad.mensaje, codigoError: propiedad.codigoError || null, noOfrecer: true };
		return crearPendiente(ctx, {
			herramienta: def.name,
			args,
			http: spec,
			resumen: typeof def.resumen === 'function' ? def.resumen(args) : def.name,
		});
	}
	const resp = await httpInterno.llamar({
		method: spec.method,
		path: spec.path,
		query: spec.query,
		body: spec.body,
		headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
	});
	autoria.anotar(resp.body, ctx.req);
	return recortar.deApi(resp, def.campos);
}

/**
 * @param {string} nombre
 * @param {object} args
 * @param {object} ctx
 */
async function ejecutar(nombre, args, ctx) {
	const def = catalogo.porNombre(nombre);
	if (!def) return { error: `Herramienta desconocida: ${nombre}` };
	if (!ctx.consultas) ctx.consultas = [];
	if (!ctx.inserciones) ctx.inserciones = [];

	if (!catalogo.permitido(def, ctx.permisos, ctx.tienePermiso)) {
		const lista = Array.isArray(def.permiso) ? def.permiso.join(' o ') : def.permiso;
		return { error: `Sin permiso (${lista}). El usuario no puede hacer esto.` };
	}
	if (catalogo.bloqueadaPorAgente(def)) {
		return { error: 'Eso todavía no está habilitado desde el asistente: se hace en la pantalla.', noOfrecer: true };
	}

	const a = args || {};
	let resultado;
	try {
		if (def.sql) resultado = await ejecutarSql(nombre, a, ctx);
		else if (def.operacion) {
			const http = require('./operaciones').httpDe(def.operacion, a);
			resultado = await ejecutarApiGenerica('llamar_api', http, ctx);
		} else if (def.modulo === 'API') resultado = await ejecutarApiGenerica(nombre, a, ctx);
		else if (def.plataforma) resultado = await ejecutarPlataforma(nombre, a, ctx);
		else if (typeof def.preparar === 'function') resultado = await ejecutarPreparar(def, a, ctx);
		else if (typeof def.run === 'function') resultado = await ejecutarRun(def, a, ctx);
		else resultado = await ejecutarHttp(def, a, ctx);
	} catch (err) {
		resultado = { error: err.message || 'Error ejecutando la herramienta', status: err.statusCode || undefined };
	}
	if (resultado && (resultado.resumido || resultado.truncado === true)) ctx.resumido = true;
	if (Array.isArray(ctx.traza)) {
		ctx.traza.push({
			nombre,
			args: recortar.limitarJson(a, 1200),
			resultado: recortar.limitarJson(resultado, 6000),
		});
	}
	return resultado;
}

module.exports = {
	ejecutar,
	pathConocido,
	armarUrl,
};
