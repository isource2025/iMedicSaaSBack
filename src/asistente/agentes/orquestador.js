/**
 * Elige el especialista. Barato: reglas + sticky. Sin LLM propio.
 */
const soporte = require('./soporte');
const internacion = require('./internacion');

const AGENTES = Object.freeze({
	SOPORTE: soporte,
	INTERNACION: internacion,
});

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

const REGLAS = Object.freeze([
	{
		id: 'INTERNACION',
		re: /\b(internad|internar|internaci|egres|externar|cama|sector|traslad|reubic|movimiento|estudio|ecodoppler|tomograf|evoluci|indicaci|epicrisis|interconsulta|protocolo|procedimiento|visita\s*\d|n[uú]mero de visita)/i,
	},
	{
		id: 'ADMISION',
		re: /\b(admit|admisión|admision|nueva admisión|nuevo ingreso|paciente nuevo|padron|padrón)\b/i,
	},
	{
		id: 'TURNOS',
		re: /\b(turno|agenda|sobreturno|slot)\b/i,
	},
	{
		id: 'ALMACEN',
		re: /\b(stock|almacén|almacen|artículo|articulo|proveedor|solicitud de provis|orden de provis)\b/i,
	},
	{
		id: 'FACTURACION',
		re: /\b(factur|convenio|rendici[oó]n|liquidaci|ocupación estad|ocupacion estad)\b/i,
	},
	{
		id: 'PERSONAL',
		re: /\b(personal|empleado|matrícula|matricula|dar de alta un m[eé]dico|alta de personal)\b/i,
	},
]);

const SOPORTE_PRIMERO =
	/\b(c[oó]mo (hago|uso|cargo|abro)|d[oó]nde (est[aá] la|queda|encuentro|abro)|para qu[eé] sirve|llevame|navega|pantallas?|manual)\b/i;

function porId(id) {
	return AGENTES[id] || null;
}

function listos() {
	return Object.keys(AGENTES).filter((id) => AGENTES[id].LISTO);
}

function estado() {
	const ids = ['SOPORTE', 'INTERNACION', 'ADMISION', 'TURNOS', 'ALMACEN', 'FACTURACION', 'PERSONAL'];
	return ids.map((id) => ({ id, listo: Boolean(AGENTES[id]?.LISTO) }));
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

function clasificar({ texto, moduloRuta, agenteActivo } = {}) {
	const t = String(texto || '').trim();
	if (SOPORTE_PRIMERO.test(t)) return 'SOPORTE';
	for (const r of REGLAS) {
		if (r.re.test(t)) return r.id;
	}
	if (agenteActivo && (AGENTES[agenteActivo]?.LISTO || agenteActivo === 'SOPORTE')) return agenteActivo;
	const porPantalla = RUTA_A_AGENTE[String(moduloRuta || '').toUpperCase()];
	return porPantalla || 'SOPORTE';
}

function resolver(opts = {}) {
	const pedido = clasificar(opts);
	const ag = AGENTES[pedido];
	if (ag?.LISTO) {
		return { id: pedido, pedido, aviso: null, agente: ag };
	}
	return {
		id: 'SOPORTE',
		pedido,
		aviso: pedido,
		agente: AGENTES.SOPORTE,
	};
}

module.exports = {
	AGENTES,
	RUTA_A_AGENTE,
	clasificar,
	resolver,
	porId,
	listos,
	estado,
	todasHerramientas,
};
