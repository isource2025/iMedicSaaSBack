/**
 * Lee datos de iMedic para el registro ya resuelto (ficha).
 * Elige GET del manifiesto con :idVisita / :idPaciente, los sustituye y ejecuta.
 * No lista endpoints: trae los datos.
 */
const manifiesto = require('./manifiesto');
const httpInterno = require('./httpInterno');
const recortar = require('./recortar');

const HECHOS = /hecho|hechos|cumplid|realizad|respondid|resultado|informad/i;
const PENDIENTES = /pendiente/;

function idsDeFoco(foco, args) {
	const nv = Number(args.numeroVisita || foco?.numeroVisita || 0);
	const idp = Number(args.idPaciente || foco?.idPaciente || 0);
	return {
		idVisita: nv || null,
		numeroVisita: nv || null,
		idPaciente: idp || null,
		IdPaciente: idp || null,
	};
}

function completarPath(path, ids) {
	return String(path || '').replace(/:([A-Za-z]+)/g, (_, k) => {
		const v = ids[k];
		return v != null && v !== '' ? encodeURIComponent(String(v)) : `:${k}`;
	});
}

function eligeGets(texto, ids) {
	const q = String(texto || '').trim();
	const hits = manifiesto.buscar({ texto: q, metodo: 'GET', limite: 18 });
	const conId = hits.filter((e) => {
		const p = completarPath(e.path, ids);
		return !p.includes(':') && /\/visita\/|\/paciente\//i.test(e.path);
	});
	if (HECHOS.test(q)) {
		const resp = conId.filter((e) => /respondid|cumplid|resultado/i.test(`${e.path} ${e.handler}`));
		if (resp.length) return resp.slice(0, 2);
		return conId.filter((e) => !/pendientes/i.test(e.path)).slice(0, 2);
	}
	if (PENDIENTES.test(q) && !/no.*pendiente|tampoco.*pendiente/i.test(q)) {
		return hits.filter((e) => /pendientes$/i.test(e.path) && !e.path.includes(':')).slice(0, 1);
	}
	return conId.filter((e) => !/pendientes/i.test(e.path)).slice(0, 2);
}

function esHecho(item) {
	if (!item || typeof item !== 'object') return false;
	if (item.Cumplido === true || Number(item.ItemsCumplidos) > 0) return true;
	const est = String(item.EstadoWorkflow || item.Estado || item.estado || '').toUpperCase();
	return /CUMPLID|REALIZAD|HECHO|INFORMAD|RESPONDID/.test(est);
}

function filtrar(texto, data) {
	const rows = Array.isArray(data) ? data : data?.items || data?.data || null;
	if (!Array.isArray(rows) || !HECHOS.test(texto)) return data;
	const hechos = rows.filter(esHecho);
	return {
		filtro: 'hechos',
		total: hechos.length,
		items: hechos,
		aviso:
			hechos.length === 0
				? 'No hay registros cumplidos/hechos en esta visita (solo pendientes u otros estados).'
				: 'Solo cumplidos/hechos. No es la bandeja de pendientes del servicio.',
	};
}

async function consultar({ texto, numeroVisita, idPaciente }, ctx) {
	const q = String(texto || '').trim();
	if (q.length < 3) return { error: 'Indicá qué querés ver (estudios, evoluciones, indicaciones…).' };
	const ids = idsDeFoco(ctx.foco, { numeroVisita, idPaciente });
	if (!ids.numeroVisita && !ids.idPaciente) {
		return {
			pedir: 'contexto',
			aviso: 'Primero resolvé de quién (resolver_contexto). Después consulto esa ficha.',
		};
	}

	const eps = eligeGets(q, ids);
	if (!eps.length) {
		return {
			error: 'No hay un GET de visita/paciente para eso. Reformulá (estudios, evoluciones, indicaciones).',
		};
	}

	const bloques = [];
	for (const desc of eps) {
		const ep = manifiesto.resolver('GET', desc.path);
		if (!ep) continue;
		if (ep.permisos.length && !ep.permisos.some((p) => ctx.tienePermiso(ctx.permisos, p))) {
			bloques.push({ path: desc.path, error: `Sin permiso (${ep.permisos.join(' o ')})` });
			continue;
		}
		const path = completarPath(ep.path, ids);
		const r = await httpInterno.llamar({
			method: 'GET',
			path,
			headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
		});
		const raw = r.body?.data !== undefined ? r.body.data : r.body;
		bloques.push({
			path,
			handler: ep.handler,
			status: r.status,
			datos: r.status < 400 ? filtrar(q, raw) : { error: r.body?.mensaje || `HTTP ${r.status}` },
		});
	}

	return recortar.limitarJson({
		ficha: ctx.foco || null,
		consulta: q,
		bloques,
		aviso: 'Estos son los datos. Resumí al usuario; no listes endpoints.',
	});
}

module.exports = { consultar, eligeGets, completarPath, esHecho };
