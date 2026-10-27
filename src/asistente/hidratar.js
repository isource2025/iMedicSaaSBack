/**
 * Completa cualquier escritura con lo que ya sabe iMedic:
 * ficha de contexto + campos que lee el handler + catálogos reales.
 * No es un flujo por pantalla: el mismo paso vale para egreso, evolución, personal, cama…
 */
const manifiesto = require('./manifiesto');
const fichaMod = require('./ficha');
const clinica = require('./clinica');
const httpInterno = require('./httpInterno');

function hoyIso() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function horaAhora() {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function esFecha(campo) {
	return /^fecha/i.test(campo) && !/egreso|ingreso/i.test(campo) ? true : /^fecha/i.test(campo);
}

function esHora(campo) {
	return /^hora/i.test(campo);
}

function esCatalogo(campo) {
	return /disposicionEgreso|^disposicion$|clasePaciente|ValorEstadoCama|tipoAtencion/i.test(campo);
}

function esIdentidad(campo) {
	return /^(id|numero)/i.test(campo) || /(Visita|Paciente|Cama|Documento)$/i.test(campo);
}

function vacio(v) {
	return v == null || v === '';
}

function catalogoParaCampo(campo, modulo) {
	const texto = String(campo || '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/Egreso|Ingreso/g, '')
		.trim();
	const hits = manifiesto.buscar({ texto: texto || campo, metodo: 'GET', modulo, limite: 10 });
	return (
		hits.find((e) => /catalog|disposicion|clase|estado/i.test(`${e.path} ${e.handler} ${e.para || ''}`)) ||
		hits.find((e) => !e.mutante && /\/api\//.test(e.path))
	);
}

function filasCatalogo(body) {
	const rows = Array.isArray(body) ? body : body?.data || body?.items || [];
	if (!Array.isArray(rows)) return [];
	return rows
		.map((d) => ({
			Valor: d.Valor ?? d.valor ?? d.id ?? d.codigo ?? d.Codigo,
			Descripcion: String(d.Descripcion || d.descripcion || d.nombre || d.label || '').trim(),
		}))
		.filter((d) => d.Valor != null && d.Descripcion);
}

async function leerCatalogo(ep, ctx) {
	if (!ep?.path || ep.path.includes(':')) return [];
	const r = await httpInterno.llamar({
		method: 'GET',
		path: ep.path,
		headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
	});
	if (r.status >= 400) return [];
	const data = r.body?.data !== undefined ? r.body.data : r.body;
	if (Array.isArray(data)) return filasCatalogo(data);
	if (data && typeof data === 'object') {
		const clave = Object.keys(data).find((k) => Array.isArray(data[k]));
		if (clave) return filasCatalogo(data[clave]);
	}
	return filasCatalogo(r.body);
}

function valorPedido(body, campo) {
	if (!body || typeof body !== 'object') return '';
	const aliases = [campo, campo.replace(/Egreso$/, ''), 'motivo', 'disposicion', 'tipo'];
	for (const k of aliases) {
		if (!vacio(body[k])) return body[k];
	}
	return '';
}

/**
 * @returns {{ ok: true, body: object, resumen?: string } | { pedir: string, aviso: string, opciones?: object[], faltan: string[], body: object }}
 */
async function hidratar({ ep, args, ctx }) {
	const campos = manifiesto.camposDeHandler(ep.controllerArchivo, ep.handler);
	const body = { ...(args.body && typeof args.body === 'object' ? args.body : {}) };
	const ids = fichaMod.idsDe(ctx.foco);
	for (const [k, v] of Object.entries(ids)) {
		if (vacio(body[k])) body[k] = v;
	}

	const faltan = [];
	const pedidos = [];

	for (const campo of campos.body || []) {
		if (/^(Profecional|Operador|idOperador|IdProfecional|matriculaSolicitante|CrearUsuario|Password)$/i.test(campo)) {
			delete body[campo];
			continue;
		}
		if (vacio(body[campo]) && esFecha(campo)) body[campo] = hoyIso();
		if (vacio(body[campo]) && esHora(campo)) body[campo] = horaAhora();

		if (esCatalogo(campo)) {
			const pedido = valorPedido(body, campo);
			const catEp = catalogoParaCampo(campo, ep.modulo);
			let lista = [];
			if (catEp && ctx) {
				try {
					lista = await leerCatalogo(catEp, ctx);
				} catch {
					lista = [];
				}
			}
			if (lista.length) {
				const resuelta = clinica.resolverDisposicion(lista, pedido);
				if (!resuelta || resuelta.ambiguo) {
					pedidos.push({
						campo,
						aviso: (resuelta && resuelta.aviso) || `Elegí un valor de catálogo para ${campo}.`,
						opciones: (resuelta && resuelta.opciones) || lista,
					});
					delete body[campo];
					continue;
				}
				body[campo] = resuelta.Valor;
				body[`_${campo}Texto`] = resuelta.Descripcion;
			} else if (vacio(body[campo]) && pedido === '') {
				faltan.push(campo);
			}
		} else if (
			ctx.foco &&
			vacio(body[campo]) &&
			esIdentidad(campo) &&
			!/diagnostico/i.test(campo)
		) {
			faltan.push(campo);
		}
	}

	if (pedidos.length || faltan.length) {
		const p = pedidos[0];
		return {
			pedir: p ? p.campo : faltan[0],
			aviso: p
				? p.aviso
				: `Faltan datos que el handler exige: ${faltan.join(', ')}. Pedilos; no inventes el valor.`,
			opciones: p ? p.opciones : undefined,
			faltan: [...new Set([...faltan, ...pedidos.map((x) => x.campo)])],
			body,
			ficha: ctx.foco || null,
		};
	}

	for (const k of Object.keys(body)) {
		if (k.startsWith('_')) delete body[k];
	}

	const quien = ctx.foco ? fichaMod.tituloDe(ctx.foco) : null;
	return {
		ok: true,
		body,
		resumen:
			String(args.resumen || '').trim() ||
			`${ep.metodo} ${ep.path}${quien ? ` · ${quien}` : ''}`,
	};
}

module.exports = { hidratar, catalogoParaCampo, esCatalogo };
