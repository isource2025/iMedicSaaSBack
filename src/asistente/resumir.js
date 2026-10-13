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
	// items va por última vez: sin esto, el modelo toma el primero como «el más pedido».
	const masFrecuentes =
		items.length > 1
			? [...items]
					.sort((a, b) => b.veces - a.veces)
					.slice(0, 5)
					.map((g) => `${g.nombre} (${g.veces})`)
			: undefined;
	return { totalItems: grupos.size, orden: 'items: por última vez, el más reciente primero', masFrecuentes, items };
}

/** «138MG/DL.», «HGT 80», «165  MG / DL» → el primer número; null si no hay uno de 2 a 4 cifras. */
function numeroEnTexto(v) {
	const m = String(v ?? '').match(/\d+/);
	return m && m[0].length >= 2 && m[0].length <= 4 ? Number(m[0]) : null;
}

/** [clave, valor] medidos de un control: los numéricos distintos de 0 y los de cfg.textoNumerico. */
function lecturasDe(f, cfg, sec) {
	const out = [];
	for (const [k, v] of Object.entries(f)) {
		if (cfg.textoNumerico?.[k]) {
			const x = numeroEnTexto(v);
			if (x != null) out.push([k, x]);
			continue;
		}
		if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
		if (esRuido(k) || sec.omitir?.includes(k)) continue;
		out.push([k, redondear(v)]);
	}
	return out;
}

function rango(min, max) {
	return min === max ? min : `${min}–${max}`;
}

/** Por día (lo reciente primero): mínimo–máximo de cada variable con nombre corto. */
function porDiaDe(filas, cfg, sec, fechaDe) {
	const dias = new Map();
	for (const f of filas) {
		const dia = String(fechaDe(f) || '').slice(0, 10);
		if (!dia) continue;
		let d = dias.get(dia);
		if (!d) dias.set(dia, (d = {}));
		for (const [k, x] of lecturasDe(f, cfg, sec)) {
			const corto = cfg.porDia[k];
			if (!corto) continue;
			const c = d[corto];
			d[corto] = c ? [Math.min(c[0], x), Math.max(c[1], x)] : [x, x];
		}
	}
	return [...dias]
		.filter(([, d]) => Object.keys(d).length)
		.map(([fecha, d]) => ({ fecha, ...Object.fromEntries(Object.entries(d).map(([k, [a, b]]) => [k, rango(a, b)])) }));
}

/** Controles con algún valor fuera de cfg.fueraDeRango ([mínimo normal, máximo normal]), lo reciente primero. */
function fueraDeRangoDe(filas, cfg, sec, fechaDe) {
	const lista = [];
	const porVariable = {};
	for (const f of filas) {
		const cuando = fechaDe?.(f) || '';
		const fuera = [];
		for (const [k, x] of lecturasDe(f, cfg, sec)) {
			const r = cfg.fueraDeRango[k];
			const bajo = r?.[0] != null && x < r[0];
			const alto = r?.[1] != null && x > r[1];
			if (!bajo && !alto) continue;
			fuera.push(`${cfg.porDia?.[k] || k} ${x}`);
			const v = (porVariable[k] ||= { dias: new Set() });
			v.dias.add(cuando.slice(0, 10));
			if (alto && (!v.alto || x > v.alto.x)) v.alto = { x, cuando };
			if (bajo && (!v.bajo || x < v.bajo.x)) v.bajo = { x, cuando };
		}
		if (fuera.length) lista.push(`${cuando}: ${fuera.join(', ')}`.trim());
	}
	return { lista, porVariable };
}

const DIA_MS = 24 * 60 * 60 * 1000;

/** ['2026-02-14','2026-02-15','2026-02-16','2026-02-22'] → «del 2026-02-14 al 2026-02-16 y el 2026-02-22». */
function tramos(dias) {
	const orden = [...dias].filter(Boolean).sort();
	const out = [];
	for (const d of orden) {
		const ultimo = out[out.length - 1];
		if (ultimo && Date.parse(d) - Date.parse(ultimo[1]) <= DIA_MS) ultimo[1] = d;
		else out.push([d, d]);
	}
	const txt = out.map(([a, b]) => (a === b ? `el ${a}` : `del ${a} al ${b}`));
	return txt.length > 1 ? `${txt.slice(0, -1).join(', ')} y ${txt[txt.length - 1]}` : txt[0];
}

/**
 * Una frase por variable, armada acá para que el modelo no saque cuentas: en qué días se
 * salió de rango, el peor valor con fecha y cómo estuvo el último día con registros.
 */
function tendenciaDe(cfg, porVariable, porDia) {
	const ultimoDia = porDia?.[0];
	const out = {};
	for (const [k, corto] of Object.entries(cfg.porDia)) {
		const medido = porDia?.some((d) => d[corto] != null);
		if (!medido) continue;
		const v = porVariable[k];
		const hoy = ultimoDia?.[corto] != null ? `; último día (${ultimoDia.fecha}): ${ultimoDia[corto]}` : '';
		if (!v) {
			out[corto] = `en rango todos los días${hoy}`;
			continue;
		}
		const peor = [v.alto && `máximo ${v.alto.x} el ${v.alto.cuando}`, v.bajo && `mínimo ${v.bajo.x} el ${v.bajo.cuando}`].filter(Boolean).join(', ');
		out[corto] = `fuera de rango ${tramos(v.dias)} (${peor})${hoy}`;
	}
	return out;
}

const MAX_FUERA_DE_RANGO = 12;

/**
 * Controles: por variable, último valor (con fecha), mínimo, máximo y cuántas veces se midió;
 * con cfg.porDia, la evolución día por día, y con cfg.fueraDeRango, cuándo se salió de lo normal.
 */
function resumenNumerico(filas, cfg, sec, fechaDe) {
	const valores = {};
	for (const f of filas) {
		for (const [k, x] of lecturasDe(f, cfg, sec)) {
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
	const porDia = cfg.porDia && fechaDe ? porDiaDe(filas, cfg, sec, fechaDe) : undefined;
	const fuera = cfg.fueraDeRango ? fueraDeRangoDe(filas, cfg, sec, fechaDe) : undefined;
	return {
		...(fechaUltimo ? { fechaUltimo } : {}),
		valores,
		...(fuera && porDia?.length ? { tendencia: tendenciaDe(cfg, fuera.porVariable, porDia), criterio: cfg.criterio } : {}),
		...(porDia?.length ? { porDia } : {}),
		...(fuera
			? {
					fueraDeRango: fuera.lista.length ? fuera.lista.slice(0, MAX_FUERA_DE_RANGO) : 'ninguno',
					...(fuera.lista.length > MAX_FUERA_DE_RANGO ? { fueraDeRangoTotal: fuera.lista.length } : {}),
				}
			: {}),
		...(notas?.length ? { notas } : {}),
	};
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
		const listas = [resumen.items, resumen.notas, resumen.porDia, resumen.fueraDeRango].filter((l) => Array.isArray(l) && l.length > 1);
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
	let textoResto = sec.textoResto || (resumen || sec.maxTextoPrimero ? corto : maxTexto);
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
		// sinDescartar (las últimas N pedidas): tampoco se descartan registros; se acortan primero los viejos.
		const entran = !sec.sinDescartar || registros.length >= Math.min(filas.length, MAX_FILAS);
		if ((entran && largo(registros) <= resto) || Math.max(textoPrimero, textoResto) <= MIN_TEXTO) break;
		if (sec.sinDescartar && textoResto > MIN_TEXTO) {
			textoResto = Math.max(MIN_TEXTO, Math.floor(textoResto / 2));
			continue;
		}
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
