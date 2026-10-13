/**
 * Arma el turno: Soporte va siempre (capa base) y se le suman los paquetes de los
 * módulos que aparecen en el mensaje, la pantalla, el foco o el turno anterior.
 * Barato: reglas, sin LLM propio. Ante la duda se cargan más paquetes, nunca menos.
 */
const soporte = require('./soporte');
const internacion = require('./internacion');

const AGENTES = Object.freeze({
	SOPORTE: soporte,
	INTERNACION: internacion,
});

const BASE = 'SOPORTE';

const RUTA_A_AGENTE = Object.freeze({
	DASHBOARD: 'SOPORTE',
	USUARIO: 'SOPORTE',
	PLATAFORMA: 'SOPORTE',
	INTERNACION: 'INTERNACION',
	ADMISION: 'ADMISION',
	TURNOS: 'TURNOS',
	ALMACEN: 'ALMACEN',
	FACTURACION: 'FACTURACION',
	REPORTES: 'FACTURACION',
	CONFIGURACION: 'PERSONAL',
});

/** «dónde está Sanabria» / «dónde quedó Gómez»: un paciente, no una pantalla. */
const DONDE_ESTA_PERSONA =
	/\bd[oó]nde\s+(?:est[aá]|qued[oó]|se\s+encuentra)\s+(?!(?:la|el|los|las|lo|mi|mis|tu|un|una|ese|esa|este|esta|eso|esto)\b)[a-zñáéíóú]{3,}/i;

/** «cómo está Gómez», «cómo sigue la de la 105»: estado de un paciente. */
const COMO_ESTA_PERSONA = /\bc[oó]mo\s+(?:est[aá]|sigue|evoluciona|viene)\s+\S{2,}/i;
/** «el de la 105», «la de la cama 3», «lo del de la 12». */
const EL_DE_LA_CAMA = /\b(?:el|la|del)\s+de\s+la\s+(?:cama\s+)?\d+/i;

const REGLAS = Object.freeze([
	{
		id: 'INTERNACION',
		re: /\b(internad|internar|internaci|egres|externar|alta m[eé]dica|dar de alta a|cama|traslad|reubic|movimiento|estudio|ecodoppler|tomograf|rx\b|radiograf|laboratorio|evoluci|indicaci|epicrisis|interconsulta|protocolo|procedimiento|signos vitales|medicaci|dieta|balance h[ií]drico|enfermer|historia cl[ií]nica|hc de ingreso|pase de guardia|visita\s*\d|n[uú]mero de visita)/i,
		extra: [DONDE_ESTA_PERSONA, COMO_ESTA_PERSONA, EL_DE_LA_CAMA],
	},
	{
		id: 'ADMISION',
		re: /\b(admit|admisi[oó]n|nuevo ingreso|paciente nuevo|padr[oó]n|renaper|cobertura|obra social)/i,
	},
	{
		id: 'TURNOS',
		re: /\b(turno|agenda|sobreturno|slot)/i,
	},
	{
		id: 'ALMACEN',
		re: /\b(stock|almac[eé]n|art[ií]culo|proveedor|solicitud de provis|orden de provis)/i,
	},
	{
		id: 'FACTURACION',
		re: /\b(factur|convenio|rendici[oó]n|liquidaci|ocupaci[oó]n estad)/i,
	},
	{
		id: 'PERSONAL',
		re: /\b(personal|empleado|matr[ií]cula|dar de alta un m[eé]dico|alta de personal)\b/i,
	},
]);

/**
 * Pedidos de ayuda: cómo se usa, dónde está una pantalla, qué es algo, o algo que no anda.
 * Con esto el turno se presenta como ayuda aunque el mensaje nombre un módulo.
 */
// `\b` de JS no toma «ó» como letra: al final de palabras con tilde va FIN.
const FIN = '(?![a-zñáéíóú])';

const AYUDA = [
	// «cómo + verbo» es ayuda; «cómo está / sigue / evoluciona Gómez» es una pregunta clínica.
	/\bc[oó]mo\s+(?!(?:est[aá]|sigue|siguen|evoluciona|viene|va|van|qued[oó])(?![a-zñáéíóú]))[a-zñáéíóú]{2,}/i,
	/\bd[oó]nde\s+(?:est[aá]n?\s+(?:la|el|los|las)\b|queda|encuentro|abro|se\s+(?:carga|ve|hace|cambia))/i,
	/\bpara\s+qu[eé]\s+sirve|\bqu[eé]\s+(?:es|significa|quiere\s+decir)\b/i,
	/\b(?:llevame|navega|pantallas?|manual|tutorial|paso a paso)\b/i,
	/\bno\s+(?:me\s+)?(?:deja|puedo|anda|funciona|aparece|aparecen|veo|encuentro|carga|guarda|abre|sale)\b/i,
	/\bpor\s*qu[eé]\s+(?:no|me|est[aá]|aparece|sale)\b/i,
	new RegExp(`\\b(?:error|falla|fall[oó]|se\\s+trab[oó]|se\\s+colg[oó]|se\\s+me\\s+borr[oó]|bloquead[oa]|en\\s+gris|deshabilitad[oa])${FIN}`, 'i'),
	new RegExp(`\\b(?:permisos?|contrase[nñ]a|clave|usuario|sesi[oó]n)${FIN}`, 'i'),
];

function esAyuda(texto) {
	const t = String(texto || '');
	return AYUDA.some((re) => re.test(t));
}

function porId(id) {
	return AGENTES[id] || null;
}

function listo(id) {
	return Boolean(AGENTES[id]?.LISTO);
}

function listos() {
	return Object.keys(AGENTES).filter(listo);
}

function estado() {
	const ids = ['SOPORTE', 'INTERNACION', 'ADMISION', 'TURNOS', 'ALMACEN', 'FACTURACION', 'PERSONAL'];
	return ids.map((id) => ({ id, listo: listo(id) }));
}

function todasHerramientas() {
	const out = [];
	const seen = new Set();
	for (const ag of Object.values(AGENTES)) {
		for (const h of ag.HERRAMIENTAS || []) {
			if (seen.has(h.name)) continue;
			seen.add(h.name);
			out.push(h);
		}
	}
	return out;
}

/** Módulos que nombra el mensaje, en el orden de REGLAS. */
function dominiosDelTexto(texto) {
	const t = String(texto || '').trim();
	return REGLAS.filter((r) => r.re.test(t) || (r.extra || []).some((re) => re.test(t))).map((r) => r.id);
}

/**
 * @param {{ texto?: string, moduloRuta?: string, agenteActivo?: string, paquetesActivos?: string[], foco?: object }} opts
 * @returns {{ id: string, pedido: string, ayuda: boolean, paquetes: string[], avisos: string[], aviso: string|null, agente: object }}
 */
function resolver({ texto, moduloRuta, agenteActivo, paquetesActivos, foco } = {}) {
	const ayuda = esAyuda(texto);
	const delTexto = dominiosDelTexto(texto);
	const candidatos = new Set(delTexto);
	const porPantalla = RUTA_A_AGENTE[String(moduloRuta || '').toUpperCase()];
	if (porPantalla) candidatos.add(porPantalla);
	if (!delTexto.length) {
		// Sin cambio de tema, el turno sigue con lo que venía cargado.
		const previos = Array.isArray(paquetesActivos) && paquetesActivos.length ? paquetesActivos : [agenteActivo];
		for (const p of previos) if (p) candidatos.add(p);
		if (foco?.numeroVisita) candidatos.add('INTERNACION');
	}
	candidatos.delete(BASE);

	const paquetes = [BASE, ...[...candidatos].filter(listo)];
	const avisos = ayuda ? [] : delTexto.filter((id) => id !== BASE && !listo(id));
	const pedido = ayuda ? BASE : delTexto[0] || paquetes[1] || BASE;
	const id = listo(pedido) ? pedido : BASE;
	return {
		id,
		pedido,
		ayuda,
		paquetes,
		avisos,
		aviso: avisos[0] || null,
		agente: AGENTES[id],
	};
}

/** Módulo al que apunta el pedido (Soporte si es ayuda). */
function clasificar(opts = {}) {
	return resolver(opts).pedido;
}

/** Instrucciones del turno: capa de Soporte + la de cada paquete cargado. */
function instrucciones(ruta = {}) {
	const paquetes = ruta.paquetes?.length ? ruta.paquetes : [BASE];
	const extras = paquetes.filter((id) => id !== BASE).map(porId).filter(Boolean);
	return [
		soporte.instrucciones({
			avisos: ruta.avisos || (ruta.aviso ? [ruta.aviso] : []),
			ayuda: Boolean(ruta.ayuda),
			paquetes,
		}),
		...extras.map((ag) => `\n## Módulo ${ag.ID}\n${ag.instrucciones()}`),
	].join('\n');
}

module.exports = {
	AGENTES,
	BASE,
	RUTA_A_AGENTE,
	esAyuda,
	dominiosDelTexto,
	clasificar,
	resolver,
	instrucciones,
	porId,
	listos,
	estado,
	todasHerramientas,
};
