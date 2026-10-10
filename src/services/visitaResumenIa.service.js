/**
 * Resumen corto de la visita (trazabilidad) con IA.
 * Usa el mismo expediente que la epicrisis con IA; si no hay OpenAI configurado
 * arma un resumen determinístico con los datos disponibles.
 */
const epicrisisIa = require('./epicrisisIa.service');
const botOpenai = require('./botOpenai.service');

const AVISO_IA =
	'Resumen generado con IA a partir de la historia clínica. Es orientativo: no reemplaza la lectura de los registros ni el juicio clínico.';

function txt(v, max = 220) {
	const s = String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

function fecha(v) {
	const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(v, 20);
}

function lista(v, max) {
	return (Array.isArray(v) ? v : [])
		.map((x) => txt(x, 260))
		.filter(Boolean)
		.slice(0, max);
}

function resumenPlantilla(d) {
	const p = d.paciente || {};
	const evo = d.evolucionesMedicas || [];
	const ultima = [...evo].sort((a, b) =>
		`${b.FechaEv || ''} ${b.HoraEv || ''}`.localeCompare(`${a.FechaEv || ''} ${a.HoraEv || ''}`),
	)[0];
	const dx = txt(p.DiagnosticoDescripcion || p.DxVisita || p.Diagnostico, 120);
	const egreso = d.egreso && (d.egreso.FechaEgresoISO || Number(d.egreso.FechaEgreso) > 0);

	const resumen = [
		`${txt(p.ApellidoYNombre, 80) || 'Paciente'}${p.EdadAnios != null ? `, ${p.EdadAnios} años` : ''}, ingresó el ${fecha(p.FechaAdmision)}${dx ? ` con diagnóstico de ${dx}` : ''}.`,
		`Registra ${evo.length} evolución(es) médica(s), ${(d.indicaciones || []).length} indicación(es) y ${(d.controles || []).length} control(es) de enfermería.`,
		egreso ? `Egresó el ${fecha(d.egreso.FechaEgresoISO)}.` : 'La internación sigue en curso.',
	].join(' ');

	const puntos = [];
	if (ultima) puntos.push(`Última evolución (${fecha(ultima.FechaEv)}): ${txt(ultima.Evolucion, 200)}`);
	(d.interconsultas || []).slice(0, 2).forEach((ic) =>
		puntos.push(
			`Interconsulta a ${txt(ic.ServicioDescripcion || ic.Especialidad, 40) || 'otro servicio'}: ${txt(ic.Respuesta, 140) || 'sin respuesta'}`,
		),
	);
	const conResultado = (d.estudios || []).filter((e) => txt(e.ResultadoEstudio));
	if (conResultado.length) puntos.push(`${conResultado.length} estudio(s) con resultado cargado.`);

	const pendientes = [];
	const sinResp = (d.interconsultas || []).filter((ic) => !txt(ic.Respuesta)).length;
	if (sinResp) pendientes.push(`${sinResp} interconsulta(s) sin respuesta.`);
	const sinRes = (d.estudios || []).length - conResultado.length;
	if (sinRes > 0) pendientes.push(`${sinRes} estudio(s) sin resultado.`);

	return { resumen, puntos, pendientes };
}

async function generarResumenVisita(numeroVisita) {
	const nv = Number(numeroVisita);
	if (!Number.isFinite(nv) || nv <= 0) {
		const err = new Error('numeroVisita inválido');
		err.statusCode = 400;
		throw err;
	}
	const dossier = await epicrisisIa.reunirExpediente(nv);
	if (!dossier) {
		const err = new Error('No se encontró la visita');
		err.statusCode = 404;
		throw err;
	}
	const base = { generadoEn: new Date().toISOString(), aviso: AVISO_IA };

	if (!botOpenai.isConfigured()) {
		return {
			...base,
			...resumenPlantilla(dossier),
			generadoConIA: false,
			fuente: 'plantilla',
			aviso: 'IA no configurada en el servidor: se muestra un resumen automático con los datos de la visita.',
		};
	}

	const system = [
		'Sos un médico de planta que resume una internación para un colega que la tiene que entender en 20 segundos.',
		'Escribí en español argentino, tono clínico, frases cortas. Usá SOLO datos del expediente; no inventes nada.',
		'Respondé JSON con:',
		'- resumen: 2 a 4 oraciones (máx. 450 caracteres) con quién es el paciente, por qué ingresó, cómo evolucionó y en qué estado está (internado o egresado y cómo).',
		'- puntos: 3 a 6 hitos clave en orden cronológico (diagnósticos, estudios relevantes, interconsultas, cambios de tratamiento, traslados). Cada uno de máx. 140 caracteres, empezando con la fecha dd/mm si la hay.',
		'- pendientes: 0 a 4 cosas abiertas o alertas (estudios sin resultado, interconsultas sin respuesta, valores alterados, indicaciones suspendidas relevantes). Máx. 120 caracteres cada una. Lista vacía si no hay.',
	].join('\n');

	try {
		const json = await botOpenai.chatJson({
			system,
			messages: [{ role: 'user', content: `Resumí esta visita:\n\n${epicrisisIa.buildContextText(dossier)}` }],
			temperature: 0.2,
			maxTokens: 900,
		});
		return {
			...base,
			resumen: txt(json.resumen, 700),
			puntos: lista(json.puntos, 6),
			pendientes: lista(json.pendientes, 4),
			generadoConIA: true,
			fuente: 'openai',
			modelo: botOpenai.getModel(),
		};
	} catch (e) {
		return {
			...base,
			...resumenPlantilla(dossier),
			generadoConIA: false,
			fuente: 'plantilla_fallback',
			aviso: `IA no disponible (${e.message}). Se muestra un resumen automático con los datos de la visita.`,
		};
	}
}

module.exports = { generarResumenVisita };
