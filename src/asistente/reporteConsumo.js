/**
 * Reporte de consumo de OpenAI a partir de imAuditoria (Modulo = ASISTENTE).
 *   - Entidad MENSAJE: cada pedido al chat, con detalle.consumo (incluye llamadas internas como la epicrisis).
 *   - Entidad CONSUMO_IA: funciones IA fuera del chat. Si origen = 'asistente' ya está dentro de un MENSAJE.
 *
 * Sin idEmpresa (null) agrega todas las empresas — uso Super Admin.
 */
const { getAuthCentralPool } = require('../config/authCentralDb');
const auditoria = require('../services/auditoria.service');
const costos = require('./costos');
const { CATEGORIAS } = require('./consumo');

const MAX_FILAS = 50000;
const DIA_MS = 24 * 60 * 60 * 1000;

function fechaIso(v, porDefecto) {
	const s = String(v || '').trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : porDefecto;
}

function rango(desde, hasta) {
	const hoy = new Date();
	const iso = (d) => d.toISOString().slice(0, 10);
	const h = fechaIso(hasta, iso(hoy));
	const d = fechaIso(desde, iso(new Date(new Date(`${h}T00:00:00Z`).getTime() - 29 * DIA_MS)));
	const dias = Math.max(1, Math.round((new Date(`${h}T00:00:00Z`) - new Date(`${d}T00:00:00Z`)) / DIA_MS) + 1);
	return { desde: d, hasta: h, dias };
}

function percentil(ordenados, p) {
	if (!ordenados.length) return 0;
	const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
	return ordenados[Math.max(0, i)];
}

function parse(detalle) {
	try {
		return detalle ? JSON.parse(detalle) : null;
	} catch {
		return null;
	}
}

function acumulador() {
	return { pedidos: 0, llamadas: 0, entrada: 0, cacheadas: 0, salida: 0, usd: 0 };
}

function sumar(a, c) {
	a.llamadas += Number(c.llamadas || 0) + Number(c.llamadasExternas || 0);
	a.entrada += Number(c.tokens?.entrada || 0);
	a.cacheadas += Number(c.tokens?.cacheadas || 0);
	a.salida += Number(c.tokens?.salida || 0);
	a.usd += Number(c.costoUsd || 0);
}

function cerrar(a) {
	return {
		pedidos: a.pedidos,
		llamadas: a.llamadas,
		tokens: { entrada: a.entrada, cacheadas: a.cacheadas, salida: a.salida, total: a.entrada + a.salida },
		costoUsd: costos.redondear(a.usd),
		promedioUsd: a.pedidos ? costos.redondear(a.usd / a.pedidos) : 0,
	};
}

function empresaIdOpcional(idEmpresa) {
	if (idEmpresa == null || idEmpresa === '' || idEmpresa === 'todas') return null;
	const n = Number(idEmpresa);
	return Number.isFinite(n) ? n : null;
}

function whereConsumo({ idEmpresa, desde, hasta, actor, q }) {
	const where = [
		"a.Modulo = 'ASISTENTE'",
		"((a.Entidad = 'MENSAJE' AND a.Accion IN ('MENSAJE','MENSAJE_ERROR')) OR a.Entidad = 'CONSUMO_IA')",
		'a.Fecha >= ?',
		'a.Fecha < DATE_ADD(?, INTERVAL 1 DAY)',
	];
	const params = [desde, hasta];
	const emp = empresaIdOpcional(idEmpresa);
	if (emp != null) {
		where.unshift('a.IdEmpresa = ?');
		params.unshift(emp);
	}
	if (actor != null && actor !== '') {
		where.push('a.Actor = ?');
		params.push(Number(actor));
	}
	const busqueda = String(q || '').trim();
	if (busqueda) {
		where.push('a.Detalle LIKE ?');
		params.push(`%${busqueda.slice(0, 200)}%`);
	}
	return { sql: where.join(' AND '), params };
}

const SELECT_FILA = `a.IdAuditoria AS id, a.IdEmpresa AS idEmpresa, a.IdEntidad AS idConversacion,
            a.Entidad AS entidad, a.Accion AS accion, a.Actor AS actor, a.Ip AS ip,
            DATE_FORMAT(a.Fecha, '%Y-%m-%d %H:%i:%s') AS fecha, a.Detalle AS detalle,
            p.ApellidoNombre AS actorNombre,
            COALESCE(e.DESCRIPCION, CONCAT('Empresa ', a.IdEmpresa)) AS empresaNombre`;

const JOINS = `FROM imAuditoria a
     LEFT JOIN imPersonal p ON p.IdEmpresa = a.IdEmpresa AND p.Valor = a.Actor
     LEFT JOIN Empresas e ON e.IDEMPRESA = a.IdEmpresa`;

async function leerFilas(filtros) {
	const pool = await getAuthCentralPool();
	const w = whereConsumo(filtros);
	const params = [...w.params, MAX_FILAS];
	const [rows] = await pool.query(
		`SELECT a.IdEmpresa AS idEmpresa, a.Entidad AS entidad, a.Accion AS accion, a.Actor AS actor,
            DATE_FORMAT(a.Fecha, '%Y-%m-%d') AS dia, a.Detalle AS detalle,
            p.ApellidoNombre AS actorNombre,
            COALESCE(e.DESCRIPCION, CONCAT('Empresa ', a.IdEmpresa)) AS empresaNombre
     ${JOINS}
     WHERE ${w.sql}
     ORDER BY a.Fecha
     LIMIT ?`,
		params,
	);
	return rows || [];
}

/** Una fila por mensaje (y por epicrisis IA generada desde la pantalla), más nuevo primero. */
function filaMensaje(f) {
	const d = parse(f.detalle) || {};
	const c = d.consumo || null;
	const desdeAsistente = f.entidad === 'CONSUMO_IA' && d.origen === 'asistente';
	return {
		id: Number(f.id),
		idEmpresa: f.idEmpresa == null ? null : Number(f.idEmpresa),
		empresaNombre: String(f.empresaNombre || '').trim() || null,
		idConversacion: f.idConversacion || d.idConversacion || null,
		fecha: f.fecha,
		actor: f.actor == null ? null : Number(f.actor),
		nombre: String(f.actorNombre || '').trim(),
		tipo: f.entidad === 'CONSUMO_IA' ? f.accion : 'CHAT',
		error: f.accion === 'MENSAJE_ERROR' ? d.error || 'Error' : null,
		pregunta: d.pregunta || null,
		respuesta: d.respuesta || null,
		agente: d.agente || null,
		modo: d.modo || null,
		ruta: d.ruta || null,
		ip: f.ip || null,
		herramientas: Array.isArray(d.herramientas) ? d.herramientas : [],
		modelo: c?.modelo || null,
		llamadas: c ? Number(c.llamadas || 0) + Number(c.llamadasExternas || 0) : 0,
		tokens: c?.tokens || null,
		costoUsd: c ? Number(c.costoUsd || 0) : null,
		incluidoEnChat: desdeAsistente,
		ms: c?.ms ?? null,
		consumo: c || null,
	};
}

async function listarMensajes({ idEmpresa, desde, hasta, actor, q, limite, pagina }) {
	const r = rango(desde, hasta);
	if (!(await auditoria.esquemaListo())) return { ...r, disponible: false, filas: [], total: 0 };
	const lim = Math.min(Math.max(Number(limite) || 50, 1), 200);
	const pag = Math.max(Number(pagina) || 1, 1);
	const pool = await getAuthCentralPool();
	const w = whereConsumo({ idEmpresa, desde: r.desde, hasta: r.hasta, actor, q });
	const [[cuenta]] = await pool.query(`SELECT COUNT(*) AS total FROM imAuditoria a WHERE ${w.sql}`, w.params);
	const [rows] = await pool.query(
		`SELECT ${SELECT_FILA}
     ${JOINS}
     WHERE ${w.sql}
     ORDER BY a.Fecha DESC, a.IdAuditoria DESC
     LIMIT ? OFFSET ?`,
		[...w.params, lim, (pag - 1) * lim],
	);
	return {
		...r,
		disponible: true,
		total: Number(cuenta?.total || 0),
		pagina: pag,
		limite: lim,
		filas: (rows || []).map(filaMensaje),
	};
}

async function obtenerMensaje(idAuditoria) {
	if (!(await auditoria.esquemaListo())) return null;
	const id = Number(idAuditoria);
	if (!Number.isFinite(id) || id <= 0) return null;
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(
		`SELECT ${SELECT_FILA}
     ${JOINS}
     WHERE a.IdAuditoria = ? AND a.Modulo = 'ASISTENTE'
     LIMIT 1`,
		[id],
	);
	const row = rows?.[0];
	return row ? filaMensaje(row) : null;
}

function agregar(filas, { dias }) {
	const total = acumulador();
	const porUsuario = new Map();
	const porEmpresa = new Map();
	const porDia = new Map();
	const porModelo = new Map();
	const porHerramienta = new Map();
	const otras = new Map();
	const composicion = Object.fromEntries(CATEGORIAS.map((c) => [c, { tokens: 0, costoUsd: 0 }]));
	const costosPedido = [];
	let sinMedir = 0;
	let errores = 0;
	let yaIncluidas = 0;

	const de = (mapa, clave, init) => {
		if (!mapa.has(clave)) mapa.set(clave, init());
		return mapa.get(clave);
	};

	for (const f of filas) {
		const d = parse(f.detalle);
		const c = d?.consumo;
		if (f.entidad === 'CONSUMO_IA') {
			if (d?.origen === 'asistente') {
				yaIncluidas += 1;
				continue;
			}
			if (!c) continue;
			const o = de(otras, f.accion, acumulador);
			o.pedidos += 1;
			sumar(o, c);
		} else if (!c) {
			sinMedir += 1;
			continue;
		}
		if (f.accion === 'MENSAJE_ERROR') errores += 1;

		total.pedidos += 1;
		sumar(total, c);
		costosPedido.push(Number(c.costoUsd || 0));

		const u = de(porUsuario, `${f.idEmpresa ?? 'x'}:${f.actor ?? 'sin_actor'}`, () => ({
			...acumulador(),
			actor: f.actor,
			nombre: String(f.actorNombre || '').trim(),
			idEmpresa: f.idEmpresa == null ? null : Number(f.idEmpresa),
			empresaNombre: String(f.empresaNombre || '').trim() || null,
		}));
		u.pedidos += 1;
		sumar(u, c);

		const emp = de(porEmpresa, f.idEmpresa ?? 'sin', () => ({
			...acumulador(),
			idEmpresa: f.idEmpresa == null ? null : Number(f.idEmpresa),
			nombre: String(f.empresaNombre || '').trim() || `Empresa ${f.idEmpresa ?? '?'}`,
		}));
		emp.pedidos += 1;
		sumar(emp, c);

		const dd = de(porDia, f.dia, acumulador);
		dd.pedidos += 1;
		sumar(dd, c);

		const m = de(porModelo, c.modelo || 'desconocido', acumulador);
		m.pedidos += 1;
		sumar(m, c);

		for (const h of c.porHerramienta || []) {
			const x = de(porHerramienta, h.nombre, () => ({ nombre: h.nombre, veces: 0, pedidos: 0, costoUsd: 0 }));
			x.veces += Number(h.veces || 0);
			x.pedidos += 1;
			x.costoUsd += Number(h.costoUsd || 0);
		}
		for (const cat of CATEGORIAS) {
			const k = c.composicionEntrada?.[cat];
			if (!k) continue;
			composicion[cat].tokens += Number(k.tokens || 0);
			composicion[cat].costoUsd += Number(k.costoUsd || 0);
		}
	}

	costosPedido.sort((a, b) => a - b);
	const totalComp = CATEGORIAS.reduce((s, cat) => s + composicion[cat].tokens, 0) || 1;
	const ars = costos.cotizacionArs();
	const proyeccionUsd = (total.usd / dias) * 30;

	return {
		totales: {
			...cerrar(total),
			p50Usd: costos.redondear(percentil(costosPedido, 50)),
			p95Usd: costos.redondear(percentil(costosPedido, 95)),
			maxUsd: costos.redondear(costosPedido[costosPedido.length - 1] || 0),
			llamadasPorPedido: total.pedidos ? Math.round((total.llamadas / total.pedidos) * 10) / 10 : 0,
			pctCache: total.entrada ? Math.round((total.cacheadas / total.entrada) * 1000) / 10 : 0,
			errores,
			costoArs: ars ? Math.round(total.usd * ars * 100) / 100 : null,
			empresas: porEmpresa.size,
		},
		proyeccionMensual: {
			costoUsd: costos.redondear(proyeccionUsd),
			costoArs: ars ? Math.round(proyeccionUsd * ars * 100) / 100 : null,
			base: `promedio diario de ${dias} día(s) × 30`,
		},
		porEmpresa: [...porEmpresa.values()]
			.map((e) => ({ idEmpresa: e.idEmpresa, nombre: e.nombre, ...cerrar(e) }))
			.sort((a, b) => b.costoUsd - a.costoUsd),
		porUsuario: [...porUsuario.values()]
			.map((u) => ({
				actor: u.actor,
				nombre: u.nombre,
				idEmpresa: u.idEmpresa,
				empresaNombre: u.empresaNombre,
				...cerrar(u),
			}))
			.sort((a, b) => b.costoUsd - a.costoUsd),
		porDia: [...porDia.entries()].map(([dia, a]) => ({ dia, ...cerrar(a) })),
		porModelo: [...porModelo.entries()].map(([modelo, a]) => ({ modelo, ...cerrar(a) })),
		porHerramienta: [...porHerramienta.values()]
			.map((h) => ({
				...h,
				costoUsd: costos.redondear(h.costoUsd),
				promedioUsd: h.pedidos ? costos.redondear(h.costoUsd / h.pedidos) : 0,
			}))
			.sort((a, b) => b.costoUsd - a.costoUsd),
		composicionEntrada: Object.fromEntries(
			CATEGORIAS.map((cat) => [
				cat,
				{
					tokens: Math.round(composicion[cat].tokens),
					pct: Math.round((composicion[cat].tokens / totalComp) * 1000) / 10,
					costoUsd: costos.redondear(composicion[cat].costoUsd),
				},
			]),
		),
		otrasFuncionesIa: [...otras.entries()].map(([accion, a]) => ({ accion, ...cerrar(a) })),
		notas: {
			pedidosSinMedir: sinMedir,
			consumosInternosYaIncluidos: yaIncluidas,
			truncado: filas.length >= MAX_FILAS,
		},
	};
}

async function generar({ idEmpresa, desde, hasta, actor, q }) {
	const r = rango(desde, hasta);
	if (!(await auditoria.esquemaListo())) {
		return { ...r, disponible: false, mensaje: 'La tabla de auditoría no está instalada' };
	}
	const filas = await leerFilas({ idEmpresa, desde: r.desde, hasta: r.hasta, actor, q });
	return { ...r, disponible: true, ...agregar(filas, r) };
}

module.exports = { generar, listarMensajes, obtenerMensaje, agregar, rango, filaMensaje, empresaIdOpcional };
