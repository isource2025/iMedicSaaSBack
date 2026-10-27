/**
 * Intención del mensaje, por reglas (sin LLM). Decide cuánto se le manda al modelo:
 * las tools de carga solo si el mensaje pide cargar algo (o venía una carga en curso),
 * y si una sola tool alcanza para responder sin una segunda llamada al modelo.
 * Ante la duda se manda más: un falso positivo cuesta tokens, uno negativo una vuelta extra.
 */
const FIN = '(?![a-zñáéíóú])';

const CARGA = new RegExp(
	[
		'\\b(?:carg|registr|anot[aáeé]|indic(?!aci)|ped[ií](?:le|me|r|s)|ped[ií]' + FIN,
		'solicit[aáeé]|egres[aáeé]|externa|dar\\s+de\\s+alta\\s+a|d[aá]le\\s+(?:el\\s+)?alta|alta\\s+m[eé]dica',
		'traslad|mov[eé]|pas[aá]l[oa]|asign|revert|deshac|borr|elimin|edit|correg|modific|cambi[aá]|agreg|sum[aá]le',
		'prepar|redact|escrib|hac[eé](?:le|me)?\\s+(?:la|una|el|un)\\b|evolucion[aá]' + FIN + '|volv[eé]\\s+a\\s+internar)',
	].join('|'),
	'i',
);

const CLINICO = /\b(estudio|evoluci|indicaci|signo|laborator|resumen|resumi|historia|hc\b|interconsult|medicaci|dieta|balance|epicrisis|protocolo|movimiento|traslad|c[oó]mo\s+(?:est[aá]|sigue|viene))/i;
const VARIOS = /\s(?:y|e|tambi[eé]n|adem[aá]s)\s|[,;?].+\S/i;

const UBICAR = new RegExp(
	`^\\s*(?:¿\\s*)?(?:d[oó]nde\\s+(?:est[aá]|qued[oó])|en\\s+qu[eé]\\s+(?:cama|sector)|qu[eé]\\s+cama\\s+tiene|busc[aá](?:me)?|ubic[aá](?:me)?|est[aá]\\s+internad[oa])${FIN}`,
	'i',
);
const NAVEGAR = new RegExp(`^\\s*(?:llev[aá]me|abr[ií](?:me)?|and[aá]\\s+a|ir\\s+a|quiero\\s+ir\\s+a|mostrame\\s+la\\s+pantalla)${FIN}`, 'i');

/** Qué tools de carga nombra el pedido (lo dictado después de «:» no cuenta). */
const TIPOS_CARGA = [
	{ re: /evoluci|evolucion[aá]/i, tools: ['preparar_evolucion', 'editar_evolucion', 'eliminar_evolucion'] },
	{ re: /hc\s+de\s+ingreso|historia\s+cl[ií]nica\s+de\s+ingreso|anamnesis|\bingreso\b/i, tools: ['preparar_hc_ingreso'] },
	{ re: /indic(?!aci[oó]n(?:es)?\s+de\s+estudio)|control(?:es)?\b|dieta|medida/i, tools: ['preparar_indicacion'] },
	{ re: /estudio|\brx\b|radiograf|\btac?\b|\btc\b|tomograf|ecograf|\beco\b|ecodoppler|resonancia|\brmn?\b|laborator|hemograma|\becg\b|electrocardiograma|an[aá]lisis/i, tools: ['solicitar_estudios'] },
	{ re: /interconsult/i, tools: ['solicitar_interconsulta'] },
	{ re: /protocolo|procedimiento|punci[oó]n|cat[eé]ter|cirug[ií]a|v[ií]a\s+central|intubaci/i, tools: ['preparar_protocolo'] },
	{ re: /epicrisis/i, tools: ['preparar_epicrisis'] },
	{ re: /egres|externa|\balta\b/i, tools: ['preparar_egreso'] },
	{ re: /traslad|mov[eé]|pas[aá]l[oa]|\bcama\b|reubic/i, tools: ['trasladar_cama', 'asignar_cama'] },
	{ re: /revert|deshac|volv[eé]\s+a\s+internar/i, tools: ['revertir_egreso'] },
];

function cargasDe(t) {
	const pedido = texto(t).split(':')[0];
	const tools = TIPOS_CARGA.filter((x) => x.re.test(pedido)).flatMap((x) => x.tools);
	return tools.length ? [...new Set(tools)] : null;
}

function texto(t) {
	return String(t || '').trim();
}

function pideCarga(t) {
	return CARGA.test(texto(t));
}

/** Un solo pedido, sin otra pregunta pegada. Lo dictado después de «:» no cuenta («evolucioná a X: estable, afebril»). */
function simple(t) {
	const pedido = texto(t).split(':')[0];
	return !VARIOS.test(pedido.replace(/\?\s*$/, ''));
}

function soloUbicar(t) {
	const s = texto(t);
	return UBICAR.test(s) && simple(s) && !CLINICO.test(s) && !pideCarga(s);
}

function soloNavegar(t) {
	const s = texto(t);
	return NAVEGAR.test(s) && simple(s) && !pideCarga(s.replace(NAVEGAR, ''));
}

/**
 * @param {{ texto: string, ayuda?: boolean, cargaEnCurso?: boolean }} opts
 * cargaEnCurso: el turno anterior usó una tool de carga (el usuario contesta un motivo, un paciente…).
 */
function clasificar({ texto: t, ayuda = false, cargaEnCurso = false } = {}) {
	const carga = pideCarga(t);
	const escribe = cargaEnCurso || (carga && !ayuda);
	return {
		escribe,
		// null = todas las de carga (no se sabe cuál, o hay una en curso).
		cargas: escribe && !cargaEnCurso ? cargasDe(t) : null,
		soloUbicar: !ayuda && soloUbicar(t),
		soloNavegar: soloNavegar(t),
		cargaSimple: carga && simple(t),
	};
}

module.exports = { clasificar, pideCarga, cargasDe, soloUbicar, soloNavegar, simple };
