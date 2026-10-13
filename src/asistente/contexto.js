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
	};
}

/** Permisos agrupados por módulo, para que el modelo sepa qué puede y qué no. */
function resumenPermisos(permisos) {
	const grupos = new Map();
	for (const p of permisos || []) {
		const partes = String(p).split('.');
		const clave = partes.length >= 3 ? `${partes[0]}.${partes[1]}` : partes[0];
		const accion = partes.length >= 3 ? partes.slice(2).join('.') : partes[1] || 'todo';
		if (!grupos.has(clave)) grupos.set(clave, new Set());
		grupos.get(clave).add(accion);
	}
	return [...grupos.entries()]
		.map(([clave, acciones]) => `${clave}: ${[...acciones].join('/')}`)
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
