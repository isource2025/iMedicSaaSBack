/**
 * Lecturas clínicas para el modelo: limpia, ordena (lo reciente primero) y, si no
 * entran en el presupuesto, arma un resumen calculado acá (no por el modelo) con
 * los registros más recientes. Lo que sale con `resumido` lleva aviso en el chat.
 */

/** Chars que ve el modelo por lectura; bastante menos que el corte genérico de recortar (9000). */
const PRESUPUESTO_LECTURA = 3600;
/**
 * Entre todas las lecturas clínicas de un mismo turno: si el modelo parte el pedido en
 * varias llamadas (una por sección), cada una siguiente recibe menos lugar.
 */
const PRESUPUESTO_TURNO = 6000;
const MIN_LECTURA = 900;

function presupuestoDelTurno(ctx) {
	const usado = ctx?.lecturaUsada || 0;
	return Math.max(MIN_LECTURA, Math.min(PRESUPUESTO_LECTURA, PRESUPUESTO_TURNO - usado));
}

function consumirDelTurno(ctx, out) {
	if (ctx) ctx.lecturaUsada = (ctx.lecturaUsada || 0) + JSON.stringify(out ?? null).length;
}
const MAX_FILAS = 60;
const MIN_TEXTO = 120;
const TEXTO_ULTIMOS = 220;

/** Ids internos, auditoría y binarios: no aportan al análisis y el modelo los repetiría. */
const CLAVE_RUIDO =
	/^(id[a-z_]|id$|_propio$|operador|horacarga$|numerovisita$|profesional$|matricula$|codoperador$|cargadopor$|status$|factura$|autorizada$|troquel$|nro[a-z]*$|codigo$)|clarion$|fullname$|usuario|base64|blob|archivo|ruta|path|url|hash|token|mime|bytes|tamano|size/i;
const CLAVE_LEGIBLE = /nombre|descripcion|titulo/i;
const URL = /^\s*https?:\/\//i;

const largo = (x) => JSON.stringify(x ?? null).length;

function esRuido(clave) {
	return !CLAVE_LEGIBLE.test(clave) && CLAVE_RUIDO.test(clave);
}

function vacio(v) {
	return v == null || (typeof v === 'string' && !v.trim());
}

/** Los float de SQL llegan como 35.70000076293945. */
function redondear(n) {
	return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

/**
 * Saca vacíos, URLs y ruido; acorta textos a maxTexto.
 * opts: omitir (claves), conservar (claves que pasan aunque parezcan ruido), sinCeros.
 * estado.acortado queda en true si algún texto se cortó.
 */
function compactar(valor, maxTexto, prof = 0, opts = {}, estado = {}) {
	if (vacio(valor)) return undefined;
	if (opts.sinCeros && valor === 0) return undefined;
	if (typeof valor === 'string') {
		const t = valor.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
		if (URL.test(t)) return undefined;
		if (t.length <= maxTexto) return t;
		estado.acortado = true;
		return `${t.slice(0, maxTexto)}…`;
	}
	if (typeof valor === 'number') return redondear(valor);
	if (typeof valor !== 'object') return valor;
	if (prof > 3) return undefined;
	if (Array.isArray(valor)) {
		const out = valor.map((v) => compactar(v, maxTexto, prof + 1, opts, estado)).filter((v) => v !== undefined);
		return out.length ? out : undefined;
	}
	const out = {};
	for (const [k, v] of Object.entries(valor)) {
		if (opts.omitir?.includes(k)) continue;
		if (esRuido(k) && !opts.conservar?.includes(k)) continue;
		const c = compactar(v, maxTexto, prof + 1, opts, estado);
		if (c !== undefined) out[k] = c;
	}
	return Object.keys(out).length ? out : undefined;
}

function filasDe(body) {
	const data = body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? body.data : body;
	if (Array.isArray(data)) return data;
	if (data && typeof data === 'object') return [data];
	return [];
}

/** «2026-02-23 21:34» de cada fila, con la fecha clínica (no la de carga) si la hay. */
function fechadorDe(filas) {
	const claves = Object.keys(filas[0] || {}).filter((k) => !/clarion/i.test(k));
	const fecha =
		claves.find((k) => /^fecha(control|practica|solicitud|ev)?$/i.test(k)) ||
		claves.find((k) => /^fecha|^vigentedesde$/i.test(k));
	if (!fecha) return null;
	const sufijo = fecha.replace(/^fecha/i, '');
	const hora = sufijo && claves.find((k) => k.toLowerCase() === `hora${sufijo}`.toLowerCase());
	return (f) => {
		const d = String(f[fecha] ?? '').replace('T', ' ').slice(0, 16);
		const h = hora ? String(f[hora] ?? '').slice(0, 5) : '';
		return `${d}${h && !d.includes(' ') ? ` ${h}` : ''}`.trim();
	};
}

/** Cada API ordena distinto (por fecha ascendente, por medicamento…): con el recorte, primero va lo reciente. */
function recientesPrimero(filas) {
	if (filas.length < 2) return filas;
	const fechaDe = fechadorDe(filas);
	if (!fechaDe) return filas;
	return [...filas].sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)));
}

function caberEnChars(lista, max) {
	let out = lista;
	while (out.length > 1 && largo(out) > max) out = out.slice(0, -1);
	return out;
}

/** Por ítem (medicamento, práctica, profesional): veces, cantidad y última fecha. Más reciente primero. */
function resumenAgrupado(filas, cfg, fechaDe) {
	const grupos = new Map();
	for (const f of filas) {
		const clave = cfg.por.map((k) => f[k]).find((v) => !vacio(v));
		const nombre = clave == null ? 'Sin descripción' : String(clave).trim();
		let g = grupos.get(nombre);
		if (!g) {
			g = { nombre, veces: 0, ...(cfg.sumar ? { cantidad: 0 } : {}), ultima: fechaDe?.(f) || undefined };
			grupos.set(nombre, g);
		}
		g.veces += 1;
		if (cfg.sumar) g.cantidad += Number(f[cfg.sumar]) || 0;
	}
	const items = [...grupos.values()];
	const masFrecuentes =
		items.length > 5
			? [...items]
					.sort((a, b) => b.veces - a.veces)
					.slice(0, 5)
					.map((g) => `${g.nombre} (${g.veces})`)
			: undefined;
	return { totalItems: grupos.size, orden: 'items: por última vez, el más reciente primero', masFrecuentes, items };
}

/** Controles: por variable, último valor (con fecha), mínimo, máximo y cuántas veces se midió. */
function resumenNumerico(filas, cfg, sec, fechaDe) {
	const valores = {};
	for (const f of filas) {
		for (const [k, v] of Object.entries(f)) {
			if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
			if (esRuido(k) || sec.omitir?.includes(k)) continue;
			const x = redondear(v);
			const nombre = cfg.etiquetas?.[k] || k;
			const c = valores[nombre];
			if (!c) valores[nombre] = { ultimo: x, fecha: fechaDe?.(f) || undefined, min: x, max: x, n: 1 };
			else {
				c.min = Math.min(c.min, x);
				c.max = Math.max(c.max, x);
				c.n += 1;
			}
		}
	}
	// Casi siempre todas las variables salen del mismo control: la fecha va una vez.
	const fechas = new Set(Object.values(valores).map((c) => c.fecha));
	let fechaUltimo;
	if (fechas.size === 1) {
		fechaUltimo = [...fechas][0];
		for (const c of Object.values(valores)) delete c.fecha;
	}
	const notas = cfg.notas
		? filas
				.filter((f) => !vacio(f[cfg.notas]))
				.slice(0, 4)
				.map((f) => ({ fecha: fechaDe?.(f) || undefined, texto: compactar(f[cfg.notas], 200) }))
		: undefined;
	return { ...(fechaUltimo ? { fechaUltimo } : {}), valores, ...(notas?.length ? { notas } : {}) };
}

function resumirFilas(filas, sec, fechaDe) {
	const cfg = sec.resumen;
	if (!cfg) return undefined;
	if (cfg.tipo === 'numericos') return resumenNumerico(filas, cfg, sec, fechaDe);
	if (cfg.tipo === 'agrupar') return resumenAgrupado(filas, cfg, fechaDe);
	return undefined;
}

/** Saca del final de la lista más larga del resumen hasta que entre. */
function recortarResumen(resumen, max) {
	if (!resumen) return resumen;
	for (let i = 0; i < 500 && largo(resumen) > max; i++) {
		const listas = [resumen.items, resumen.notas].filter((l) => Array.isArray(l) && l.length > 1);
		if (listas.length) {
			listas.sort((a, b) => largo(b) - largo(a))[0].pop();
			continue;
		}
		const claves = Object.keys(resumen.valores || {});
		if (claves.length > 1) {
			delete resumen.valores[claves[claves.length - 1]];
			continue;
		}
		break;
	}
	return resumen;
}

/**
 * Filas (ya ordenadas, lo reciente primero) → lo que ve el modelo.
 * sec: maxTexto, maxTextoPrimero (el registro más reciente con más texto), parteResumen,
 * resumen ({tipo:'agrupar'|'numericos'}), y las opts de compactar.
 */
function presentar(filas, sec, presupuesto = PRESUPUESTO_LECTURA) {
	const base = { total: filas.length };
	if (!filas.length) return { ...base, registros: [] };
	const maxTexto = sec.maxTexto || 400;

	const estado = {};
	const completos = filas.slice(0, MAX_FILAS).map((f) => compactar(f, maxTexto, 0, sec, estado)).filter(Boolean);
	if (filas.length <= MAX_FILAS && largo(completos) <= presupuesto) {
		return estado.acortado
			? { ...base, registros: completos, resumido: true, nota: 'Textos largos acortados.' }
			: { ...base, registros: completos };
	}

	const fechaDe = fechadorDe(filas);
	const resumen = resumirFilas(filas, sec, fechaDe);
	const rango = fechaDe ? { desde: fechaDe(filas[filas.length - 1]) || undefined, hasta: fechaDe(filas[0]) || undefined } : {};
	if (resumen && sec.soloResumen) {
		recortarResumen(resumen, presupuesto);
		return { ...base, ...rango, resumido: true, resumen, registros: [], nota: `Resumen de los ${filas.length} registros.` };
	}
	if (resumen) recortarResumen(resumen, Math.floor(presupuesto * (sec.parteResumen ?? 0.65)));
	const resto = Math.max(MIN_TEXTO * 2, presupuesto - (resumen ? largo(resumen) : 0));
	const corto = Math.min(maxTexto, TEXTO_ULTIMOS);
	let textoPrimero = sec.maxTextoPrimero || (resumen ? corto : maxTexto);
	let textoResto = resumen || sec.maxTextoPrimero ? corto : maxTexto;
	let registros;
	for (;;) {
		registros = caberEnChars(
			filas
				.slice(0, MAX_FILAS)
				.map((f, i) => compactar(f, i === 0 ? textoPrimero : textoResto, 0, sec))
				.filter(Boolean),
			resto,
		);
		// Un solo registro largo (HC de ingreso, epicrisis) no se descarta: se acortan sus textos.
		if (largo(registros) <= resto || Math.max(textoPrimero, textoResto) <= MIN_TEXTO) break;
		textoPrimero = Math.max(MIN_TEXTO, Math.floor(textoPrimero / 2));
		textoResto = Math.max(MIN_TEXTO, Math.floor(textoResto / 2));
	}
	return {
		...base,
		...rango,
		resumido: true,
		resumen,
		registros,
		nota: resumen
			? `Resumen de los ${filas.length} registros + los ${registros.length} más recientes.`
			: `Se muestran ${registros.length} de ${filas.length} registros (los más recientes, textos acortados).`,
	};
}

/**
 * Último resguardo sobre varias secciones: registros con muchos campos (HC de ingreso)
 * pueden pasarse aunque los textos estén acortados. Se recorta el resumen o los
 * registros de la sección más grande; si queda un solo registro, sus últimos campos.
 */
function recortarAlTope(secciones, tope) {
	for (let i = 0; i < 500 && largo(secciones) > tope; i++) {
		const mayor = secciones.filter((s) => s.registros?.length || s.resumen).sort((a, b) => largo(b) - largo(a))[0];
		if (!mayor) return;
		mayor.resumido = true;
		if (mayor.resumen && largo(mayor.resumen) > largo(mayor.registros || [])) {
			const antes = largo(mayor.resumen);
			recortarResumen(mayor.resumen, antes - 200);
			if (largo(mayor.resumen) >= antes) delete mayor.resumen;
			continue;
		}
		if (mayor.registros.length > 1) {
			mayor.registros.pop();
			continue;
		}
		const unico = mayor.registros[0];
		const claves = Object.keys(unico || {});
		if (claves.length <= 1) {
			mayor.registros = [];
			continue;
		}
		delete unico[claves[claves.length - 1]];
	}
}

module.exports = {
	PRESUPUESTO_LECTURA,
	PRESUPUESTO_TURNO,
	presupuestoDelTurno,
	consumirDelTurno,
	MAX_FILAS,
	compactar,
	filasDe,
	fechadorDe,
	recientesPrimero,
	caberEnChars,
	presentar,
	recortarAlTope,
};
