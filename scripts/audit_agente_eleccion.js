/**
 * Auditoría: turno 2 con candidatos Gómez ya en estado (caso producción).
 * Verifica qué herramienta usa la IA y si queda profesional confirmado.
 *
 *   node scripts/audit_agente_eleccion.js
 */
require('dotenv').config();
const { runWithTenant } = require('../src/context/tenantContext');
const botConversacion = require('../src/services/botConversacion.service');
const botSesionIa = require('../src/services/botSesionIa.service');
const botAgente = require('../src/services/botAgente.service');
const botOpenai = require('../src/services/botOpenai.service');

const EMPRESA = Number(process.env.BOT_EMPRESA_ID || 1);
const TELEFONO = process.env.SIM_TELEFONO || '5493790000888';
const REPETICIONES = Number(process.env.AUDIT_REPS || 3);

const CANDIDATOS_GOMEZ = [
	{ matricula: 395, nombre: 'GOMEZ RINESSI JUAN F.', especialidadNombre: null },
	{ matricula: 549, nombre: 'GOMEZ MARTA E.', especialidadNombre: 'ODONTOLOGÍA' },
];

const MSG_TURNO2 = 'Es decir, disculpame, era con Gómez Marta, de Odontología.';

async function prepararSesion(idConversacion) {
	try {
		await botConversacion.resetConversacionPorTelefono(TELEFONO);
	} catch (_) {}

	await botConversacion.registrarMensajeEntrante({
		telefonoWhatsApp: TELEFONO,
		contenido: 'Hola, quiero un turno con el Dr. Gómez',
		idConversacion,
	});
	await botConversacion.registrarMensajeSaliente({
		idConversacion,
		contenido:
			'1. *GOMEZ RINESSI JUAN F.* — Sin especialidad\n2. *GOMEZ MARTA E.* — ODONTOLOGÍA\n\n¿Con quién te gustaría agendar?',
		origen: 'BOT',
	});

	await botConversacion.guardarContextoBot(idConversacion, {
		agente: {
			...botAgente.estadoInicial(),
			candidatosProfesionales: CANDIDATOS_GOMEZ,
		},
	});
}

async function correrUna(rep) {
	const idConversacion = botConversacion.idDesdeTelefono(TELEFONO);
	await prepararSesion(idConversacion);

	await botConversacion.registrarMensajeEntrante({
		telefonoWhatsApp: TELEFONO,
		contenido: MSG_TURNO2,
		idConversacion,
	});

	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const historial = await botSesionIa.listarMensajesParaIa(idConversacion, { limit: 24 });

	// Interceptar tools vía diag: re-ejecutamos con hook mínimo
	const toolsUsadas = [];
	const original = botOpenai.chatConHerramientas.bind(botOpenai);
	botOpenai.chatConHerramientas = async (opts) => {
		const out = await original(opts);
		for (const tc of out.toolCalls || []) {
			toolsUsadas.push(tc.function?.name);
		}
		return out;
	};

	let r;
	try {
		r = await botAgente.responder({
			idConversacion,
			conv,
			telefonoWhatsApp: TELEFONO,
			historial,
			textoEntrada: MSG_TURNO2,
		});
	} finally {
		botOpenai.chatConHerramientas = original;
	}

	const convFinal = await botConversacion.obtenerConversacion(idConversacion);
	const estado = botAgente.leerEstado(convFinal);
	const ok =
		Number(estado.profesional?.matricula) === 549 &&
		!estado.candidatosProfesionales?.length;

	return {
		rep,
		ok,
		toolsUsadas,
		profesional: estado.profesional?.nombre || null,
		matricula: estado.profesional?.matricula || null,
		candidatosRestantes: estado.candidatosProfesionales?.length || 0,
		respuesta: (r.texto || '').slice(0, 120),
	};
}

(async () => {
	console.log(`Modelo: ${botOpenai.getModel()}`);
	console.log(`Caso: 2 Gómez en estado → "${MSG_TURNO2}"`);
	console.log(`Repeticiones: ${REPETICIONES}\n`);

	await runWithTenant(EMPRESA, async () => {
		const resultados = [];
		for (let i = 1; i <= REPETICIONES; i++) {
			const r = await correrUna(i);
			resultados.push(r);
			console.log(
				`#${r.rep} ${r.ok ? 'OK' : 'FALLO'} | tools: [${r.toolsUsadas.join(', ')}] | prof: ${r.profesional} (${r.matricula}) | cand: ${r.candidatosRestantes}`,
			);
			console.log(`    → ${r.respuesta}...\n`);
		}

		const okCount = resultados.filter((x) => x.ok).length;
		const usoConfirmar = resultados.filter((x) =>
			x.toolsUsadas.includes('confirmar_profesional_elegido'),
		).length;
		const usoListarEsp = resultados.filter((x) =>
			x.toolsUsadas.includes('listar_profesionales_de_especialidad'),
		).length;

		console.log('--- RESUMEN ---');
		console.log(`Éxito (Gómez Marta matrícula 549): ${okCount}/${REPETICIONES}`);
		console.log(`Usó confirmar_profesional_elegido: ${usoConfirmar}/${REPETICIONES}`);
		console.log(`Usó listar_profesionales_de_especialidad (bug viejo): ${usoListarEsp}/${REPETICIONES}`);
		process.exit(okCount === REPETICIONES ? 0 : 1);
	});
})().catch((e) => {
	console.error(e);
	process.exit(2);
});
