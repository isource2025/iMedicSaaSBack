/**
 * Resuelve a qué registro de iMedic se refiere el pedido.
 * No es un módulo clínico: usa el manifiesto (GET de búsqueda) y, si aplica,
 * las consultas que el propio código usa para ubicar ocupaciones.
 */
const manifiesto = require('./manifiesto');
const httpInterno = require('./httpInterno');
const clinica = require('./clinica');
const ficha = require('./ficha');
const recortar = require('./recortar');

function terminoDe(texto) {
	return String(texto || '')
		.replace(/\s+/g, ' ')
		.replace(
			/^(donde|dónde)\s+(esta|está)\s+(internad[oa]\s+)?(el|la|los|las)?\s*/i,
			'',
		)
		.replace(/^(busc[áa]e?\s+|ubic[áa]\s+|quien\s+es\s+)/i, '')
		.replace(/[?.!,;:]+$/g, '')
		.trim();
}

function queryDe(ep, termino) {
	const campos = manifiesto.camposDeHandler(ep.controllerArchivo, ep.handler).query || [];
	const q = {};
	if (campos.includes('searchTerm')) q.searchTerm = termino;
	else if (campos.includes('search')) q.search = termino;
	else if (campos.includes('termino')) q.termino = termino;
	else if (campos.includes('q')) q.q = termino;
	else if (campos.includes('nombre')) q.nombre = termino;
	else q.searchTerm = termino;
	return q;
}

function esBusqueda(e) {
	const blob = `${e.path} ${e.handler} ${e.para || ''}`.toLowerCase();
	return /search|buscar|lista/.test(blob) && !/catalog|disposicion/.test(blob);
}

function listaDe(body) {
	if (Array.isArray(body)) return body;
	if (Array.isArray(body?.data)) return body.data;
	if (Array.isArray(body?.items)) return body.items;
	if (Array.isArray(body?.internaciones)) return body.internaciones;
	if (body?.data && typeof body.data === 'object' && !Array.isArray(body.data)) return [body.data];
	if (body && typeof body === 'object' && (body.NumeroVisita || body.IdPaciente || body.ApellidoYNombre)) {
		return [body];
	}
	return [];
}

async function getPermitido(ep, ctx) {
	if (!ep.permisos.length) return true;
	return ep.permisos.some((p) => ctx.tienePermiso(ctx.permisos, p));
}

async function resolverContexto({ texto }, ctx) {
	const termino = terminoDe(texto);
	if (termino.length < 2) return { error: 'Indicá a quién o qué buscás (nombre, DNI, código, visita).' };

	const fichas = [];
	const vistos = new Set();
	const push = (f) => {
		if (!f) return;
		const key = `${f.tipo}:${f.numeroVisita || f.idPaciente || f.documento || f.nombre || JSON.stringify(f).slice(0, 40)}`;
		if (vistos.has(key)) return;
		vistos.add(key);
		fichas.push(ficha.recortarFicha(f) || f);
	};

	const gets = manifiesto
		.buscar({ texto: termino, metodo: 'GET', limite: 15 })
		.filter((e) => esBusqueda(e) && !String(e.path).includes(':'));

	for (const desc of gets.slice(0, 3)) {
		const ep = manifiesto.resolver(desc.metodo, desc.path);
		if (!ep || !(await getPermitido(ep, ctx))) continue;
		try {
			const r = await httpInterno.llamar({
				method: 'GET',
				path: ep.path,
				query: queryDe(ep, termino),
				headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
			});
			if (r.status >= 400) continue;
			const tipo = (ep.modulo || 'registro').toLowerCase();
			for (const item of listaDe(r.body).slice(0, 8)) push(ficha.deApi(item, tipo));
		} catch {
			/* siguiente endpoint */
		}
	}

	try {
		const intern = await clinica.buscarInternacion({ termino }, ctx);
		for (const i of intern.internaciones || []) push(ficha.deInternacion(i));
		if (!fichas.length && intern.aviso) {
			return {
				total: 0,
				fichas: (intern.egresadas || []).map((e) => ficha.deInternacion(e)),
				aviso: intern.aviso,
			};
		}
	} catch {
		/* sin SQL de ocupación */
	}

	return recortar.limitarJson({
		total: fichas.length,
		fichas,
		aviso: fichas.length
			? 'Ficha completa del sistema. Respondé con todos los datos; no armes otro SQL para un campo suelto.'
			: 'No hubo coincidencias. Pedí otro dato (DNI, visita, código).',
	});
}

module.exports = { resolverContexto, terminoDe };
