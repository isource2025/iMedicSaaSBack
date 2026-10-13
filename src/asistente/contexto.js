const permisosService = require('../services/permisos.service');
const matriz = require('../utils/permisos');
const { extractTokenFromRequest } = require('../middlewares/authJwt.middleware');

const ROLES_MATRIZ = new Set([
	'ADMIN',
	'SUPER_ADMIN',
	'MEDICO',
	'ADMINISTRATIVO',
	'ENFERMERO',
	'CARGA_HC',
	'PANEL_DATOS',
]);

async function permisosDeReq(req) {
	try {
		const r = await permisosService.permisosDeUsuario(req.valorPersonal);
		const permisos = Array.isArray(r) ? r : r?.permisos || [];
		if (permisos.length) return permisos;
	} catch (e) {
		console.warn('[asistente] permisosDeUsuario:', e.message);
	}
	const rn = req.rolNombre ? String(req.rolNombre).trim().toUpperCase() : '';
	if (rn && (ROLES_MATRIZ.has(rn) || rn)) return matriz.permisosDeRol(rn);
	return [];
}

function moduloDeRuta(ruta) {
	const p = String(ruta || '').split('?')[0];
	if (!p) return null;
	if (p.startsWith('/dashboard/super-admin')) return 'PLATAFORMA';
	if (p.startsWith('/dashboard/turnos')) return 'TURNOS';
	if (p.startsWith('/dashboard/patients') || p.startsWith('/dashboard/admission')) return 'ADMISION';
	if (p.startsWith('/dashboard/beds') || p.startsWith('/dashboard/visita')) return 'INTERNACION';
	if (p.startsWith('/dashboard/billing') || p.startsWith('/dashboard/reports/facturacion')) {
		return 'FACTURACION';
	}
	if (p.startsWith('/dashboard/almacen')) return 'ALMACEN';
	if (p.startsWith('/dashboard/personal') || p.startsWith('/dashboard/configuracion')) {
		return 'CONFIGURACION';
	}
	if (p.startsWith('/dashboard/reports')) return 'REPORTES';
	if (p.startsWith('/dashboard/profile')) return 'USUARIO';
	if (p === '/dashboard' || p === '/dashboard/') return 'DASHBOARD';
	return null;
}

function extraerEntidadesRuta(ruta) {
	const p = String(ruta || '').split('?')[0];
	const cama = p.match(/^\/dashboard\/beds\/([^/]+)/);
	const visita = p.match(/^\/dashboard\/visita\/([^/]+)/);
	return {
		idCama: cama && cama[1] !== 'tables' && cama[1] !== 'analytics' ? cama[1] : null,
		numeroVisita: visita ? visita[1] : null,
	};
}

function txt(v, max) {
	return String(v ?? '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

/** Lo que el front reporta de la pantalla visible, acotado y sin formato libre. */
function pantallaDeBody(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const lista = (v, n, m) => (Array.isArray(v) ? v.slice(0, n).map((x) => txt(x, m)).filter(Boolean) : []);
	const campos = Array.isArray(raw.campos)
		? raw.campos.slice(0, 30).flatMap((c) => {
				const id = txt(c?.id, 12);
				if (!/^c\d{1,4}$/.test(id)) return [];
				return [
					{
						id,
						etiqueta: txt(c.etiqueta, 80) || id,
						tipo: txt(c.tipo, 20) || 'text',
						multilinea: Boolean(c.multilinea),
						valor: txt(c.valor, 400),
						vacio: !String(c.valor ?? '').trim(),
						foco: Boolean(c.foco),
					},
				];
			})
		: [];
	const internadoDe = (x) => {
		const nv = Number(x?.numeroVisita);
		if (!Number.isFinite(nv) || nv <= 0) return null;
		return {
			numeroVisita: nv,
			paciente: txt(x.paciente, 80) || null,
			documento: txt(x.documento, 20) || null,
			sector: txt(x.sector, 12) || null,
			cama: txt(x.cama, 12) || null,
		};
	};
	const internadosVisibles = Array.isArray(raw.internadosVisibles)
		? raw.internadosVisibles.slice(0, 40).map(internadoDe).filter(Boolean)
		: [];
	const internado = internadoDe(raw.internado) || internadosVisibles[0] || null;
	const errores = Array.isArray(raw.errores)
		? raw.errores.slice(0, 5).flatMap((e) => {
				const path = txt(e?.path, 120);
				if (!/^\/[\w\-/:.]*$/.test(path)) return [];
				const status = Number(e.status);
				const metodo = txt(e.metodo, 6).toUpperCase();
				return [
					{
						metodo: /^(GET|POST|PUT|PATCH|DELETE)$/.test(metodo) ? metodo : 'GET',
						path,
						status: Number.isInteger(status) && status >= 0 && status < 600 ? status : 0,
						mensaje: txt(e.mensaje, 200),
						haceSeg: Math.max(0, Math.min(86400, Number(e.haceSeg) || 0)),
					},
				];
			})
		: [];
	return {
		url: txt(raw.url, 300),
		titulo: txt(raw.titulo, 120),
		seccion: txt(raw.seccion, 60) || null,
		encabezados: lista(raw.encabezados, 8, 80),
		pestanas: lista(raw.pestanas, 12, 40),
		pestanaActiva: txt(raw.pestanaActiva, 60) || null,
		seleccion: txt(raw.seleccion, 1500) || null,
		resumenVisible: txt(raw.resumenVisible, 1500) || null,
		campos,
		internado,
		internadosVisibles,
		errores,
		alertas: lista(raw.alertas, 5, 200),
		deshabilitados: lista(raw.deshabilitados, 10, 140),
	};
}

/** Permisos agrupados por módulo, para que el modelo sepa qué puede y qué no. */
let accionesMatriz;
/** «MOD.SUB» → cantidad de acciones que define la matriz (para escribir «todas»). */
function accionesDeMatriz() {
	if (!accionesMatriz) {
		accionesMatriz = new Map();
		for (const { codigo } of matriz.todosLosCodigos()) {
			const [m, s] = String(codigo).split('.');
			const k = `${m}.${s}`;
			accionesMatriz.set(k, (accionesMatriz.get(k) || 0) + 1);
		}
	}
	return accionesMatriz;
}

/** Una línea por módulo: «INTERNACION: CAMAS VER · EVOLUCIONES todas». */
function resumenPermisos(permisos) {
	const modulos = new Map();
	for (const p of permisos || []) {
		const partes = String(p).split('.');
		const mod = partes[0];
		const sub = partes.length >= 3 ? partes[1] : '';
		const accion = partes.length >= 3 ? partes.slice(2).join('.') : partes[1] || 'todo';
		if (!modulos.has(mod)) modulos.set(mod, new Map());
		const subs = modulos.get(mod);
		if (!subs.has(sub)) subs.set(sub, new Set());
		subs.get(sub).add(accion);
	}
	const total = accionesDeMatriz();
	return [...modulos.entries()]
		.map(([mod, subs]) => {
			const partes = [...subs.entries()].map(([sub, acciones]) => {
				const completas = sub && acciones.size > 1 && acciones.size >= (total.get(`${mod}.${sub}`) || Infinity);
				const txt = completas ? 'todas' : [...acciones].join('/');
				return sub ? `${sub} ${txt}` : txt;
			});
			return `${mod}: ${partes.join(' · ')}`;
		})
		.join('\n')
		.slice(0, 8000);
}

function credencialesDeReq(req) {
	return {
		token: extractTokenFromRequest(req),
		headers: {
			authorization: req.headers?.authorization,
			cookie: req.headers?.cookie,
			'user-agent': req.headers?.['user-agent'],
		},
	};
}

module.exports = {
	permisosDeReq,
	moduloDeRuta,
	extraerEntidadesRuta,
	credencialesDeReq,
	pantallaDeBody,
	resumenPermisos,
};
