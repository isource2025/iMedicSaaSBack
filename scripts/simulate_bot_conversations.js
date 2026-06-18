#!/usr/bin/env node
/**
 * Simulador de conversaciones del bot WhatsApp (consola, in-process).
 * Usa botResponder completo (wizard + fallbacks + humanizer) sin enviar a Meta.
 *
 * Uso:
 *   node scripts/simulate_bot_conversations.js
 *   node scripts/simulate_bot_conversations.js --all
 *   node scripts/simulate_bot_conversations.js --escenario=cancelacion
 *   node scripts/simulate_bot_conversations.js --interactive
 *   node scripts/simulate_bot_conversations.js --dni=53547773 --especialidad=oncologia --prof=1
 *
 *   node scripts/simulate_bot_conversations.js --escenario=biasi-agosto --mock-renaper
 *
 * Variables: BOT_EMPRESA_ID, SIM_DNI, SIM_TELEFONO, OPENAI_API_KEY, DB y AUTH_DB
 */
require('dotenv').config();

const ARGS = process.argv.slice(2);
const FLAG = (name) => ARGS.includes(`--${name}`);

if (FLAG('mock-renaper')) {
	const renaperService = require('../src/services/renaper.service');
	const mockHit = async (dni) => ({
		ok: true,
		data: {
			apellido: 'SIM',
			nombres: 'PACIENTE PRUEBA',
			nombreCompleto: 'SIM PACIENTE PRUEBA',
			fechaNacimiento: '2010-01-01',
			sexo: 'M',
			numeroDocumento: String(dni),
		},
		meta: { signed: false, fuente: 'sim' },
		sexoDetectado: 'M',
	});
	renaperService.searchByDni = mockHit;
	renaperService.search = async (dni) => mockHit(dni);
	console.log('[sim] RENAPER mockeado (--mock-renaper)\n');
}

// No enviar mensajes reales a Meta durante la simulación
const whatsappMeta = require('../src/services/whatsappMeta.service');
whatsappMeta.sendTextMessage = async () => ({
	messageId: `sim.dry.${Date.now()}`,
});

const readline = require('readline');
const { runWithTenant } = require('../src/context/tenantContext');
const botConversacion = require('../src/services/botConversacion.service');
const botResponder = require('../src/services/botResponder.service');
const botInterpretacion = require('../src/services/botInterpretacion.service');
const botOpenai = require('../src/services/botOpenai.service');

const ARG = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const EMPRESA = Number(ARG('empresa', process.env.BOT_EMPRESA_ID || '1'));
const DNI = ARG('dni', process.env.SIM_DNI || '53547773');
const ESPECIALIDAD = ARG('especialidad', process.env.SIM_ESPECIALIDAD || 'oncologia');
const PROFESIONAL = ARG('prof', process.env.SIM_PROF || '1');
const TELEFONO_BASE = ARG('telefono', process.env.SIM_TELEFONO || '5493794946099');
const ALLOW_BOOKING = FLAG('allow-booking');
const PAUSA_MS = Number(ARG('pausa', '400')) || 400;

const C = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	cyan: '\x1b[36m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	magenta: '\x1b[35m',
	blue: '\x1b[34m',
	red: '\x1b[31m',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function telParaEscenario(key) {
	const suffix = String(key).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 9000;
	return TELEFONO_BASE.replace(/\d{4}$/, String(6000 + suffix).padStart(4, '0'));
}

function sustituirVars(texto) {
	return texto
		.replace(/\{dni\}/g, DNI)
		.replace(/\{esp\}/g, ESPECIALIDAD)
		.replace(/\{prof\}/g, PROFESIONAL);
}

function fmtSesion(conv) {
	const s = conv?.contextoBot?.sesionInterpretacion;
	const g = conv?.contextoBot?.gestionTurno;
	const partes = [];
	if (g && !['completada', 'cancelada'].includes(g.estado)) {
		partes.push(`${C.cyan}gestión${C.reset}=${g.estado}`);
		if (g.profesional?.nombre) partes.push(`prof=${g.profesional.nombre}`);
		if (g.preferenciaHorario?.resumen) partes.push(`pref=${g.preferenciaHorario.resumen}`);
	}
	if (s?.ultimaIntencion) {
		partes.push(`${C.magenta}intención${C.reset}=${s.ultimaIntencion}`);
		partes.push(`${C.dim}frustración=${s.frustracion ?? 0} tono=${s.ultimoTono || '—'}${C.reset}`);
	}
	if (!partes.length) return `${C.dim}(sin sesión/gestión)${C.reset}`;
	return partes.join(' | ');
}

function printBloque({ rol, texto, extra }) {
	const tag = rol === 'PACIENTE' ? `${C.blue}PACIENTE${C.reset}` : `${C.green}BOT${C.reset}`;
	console.log(`\n${tag}: ${texto}`);
	if (extra) console.log(`  ${C.dim}${extra}${C.reset}`);
}

async function enviarMensajeSimulado({ idConversacion, telefono, nombre, texto }) {
	const antes = await botConversacion.listarMensajes(idConversacion, { limit: 50 });
	const metaId = `sim.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

	await botConversacion.registrarMensajeEntrante({
		telefonoWhatsApp: telefono,
		idConversacion,
		nombreContacto: nombre,
		contenido: texto,
		metaMessageId: metaId,
	});

	printBloque({ rol: 'PACIENTE', texto });

	const resultado = await botResponder.responderMensajeEntrante({
		idEmpresa: EMPRESA,
		telefonoWhatsApp: telefono,
		idConversacion,
		contenidoUltimo: texto,
		metaMessageIdEntrante: metaId,
	});

	const despues = await botConversacion.listarMensajes(idConversacion, { limit: 50 });
	const nuevos = despues.slice(antes.length).filter((m) => m.origen === 'BOT');

	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const ctx = conv?.contextoBot?.tipo || conv?.contextoBot?.turnoSugerido ? 'turno_sugerido' : null;

	console.log(`  ${fmtSesion(conv)}`);
	console.log(
		`  ${C.dim}paso→${conv?.pasoBot || '—'} ctx=${ctx || conv?.contextoBot?.tipo || '—'} respondido=${resultado.respondido}${resultado.motivo ? ` (${resultado.motivo})` : ''}${C.reset}`,
	);

	if (nuevos.length) {
		for (const m of nuevos) {
			printBloque({ rol: 'BOT', texto: m.contenido });
		}
	} else if (resultado.texto) {
		printBloque({ rol: 'BOT', texto: resultado.texto });
	} else if (!resultado.respondido) {
		printBloque({
			rol: 'BOT',
			texto: `[sin respuesta: ${resultado.motivo || 'desconocido'}]`,
			extra: 'fallback',
		});
	}

	return { resultado, conv };
}

async function prepararConversacion(telefono, nombre = 'Paciente Sim') {
	await botConversacion.checkConversationTables();
	await botConversacion.resetConversacionPorTelefono(telefono);
	const conv = await botConversacion.obtenerOCrearConversacion({
		telefonoWhatsApp: telefono,
		nombreContacto: nombre,
	});
	return conv.idConversacion;
}

/** Pasos comunes hasta tener un turno sugerido en CONFIRMAR. */
function pasosHastaTurno() {
	return [
		{ texto: 'Hola' },
		{ texto: '{dni}' },
		{ texto: 'Sí' },
		{ texto: '{esp}' },
		{ texto: '{prof}' },
	];
}

async function correrEscenario(def) {
	const telefono = telParaEscenario(def.id);
	console.log(`\n${'═'.repeat(60)}`);
	console.log(`${C.bold}${C.cyan}ESCENARIO: ${def.nombre}${C.reset}`);
	console.log(`${C.dim}${def.descripcion}${C.reset}`);
	console.log(
		`${C.dim}tel=${telefono} dni=${DNI} esp=${ESPECIALIDAD} prof=${PROFESIONAL}${C.reset}`,
	);
	console.log('═'.repeat(60));

	const idConv = await runWithTenant(EMPRESA, () => prepararConversacion(telefono, 'Paciente Sim'));

	for (const paso of def.pasos) {
		if (paso.skip && !ALLOW_BOOKING) {
			console.log(
				`\n${C.yellow}⏭ Omitido:${C.reset} "${sustituirVars(paso.texto)}" (usar --allow-booking para confirmar turno real)`,
			);
			continue;
		}
		await runWithTenant(EMPRESA, () =>
			enviarMensajeSimulado({
				idConversacion: idConv,
				telefono,
				nombre: 'Paciente Sim',
				texto: sustituirVars(paso.texto),
			}),
		);
		if (PAUSA_MS > 0) await sleep(PAUSA_MS);
	}
}

function escenarios() {
	const hastaTurno = pasosHastaTurno();
	return [
		{
			id: 'saludo',
			nombre: '1. Saludo inicial',
			descripcion: 'Paciente saluda → debe pedir DNI.',
			pasos: [{ texto: 'Hola' }, { texto: 'Buenas tardes' }],
		},
		{
			id: 'identificacion',
			nombre: '2. Identificación (DNI + confirmación)',
			descripcion: 'Hola → DNI → confirmar identidad.',
			pasos: [{ texto: 'Hola, quiero un turno' }, { texto: '{dni}' }, { texto: 'Sí' }],
		},
		{
			id: 'especialidad_turno',
			nombre: '3. Especialidad → profesional',
			descripcion: 'Tras identificar, elige especialidad y profesional.',
			pasos: [...hastaTurno.slice(0, 4)],
		},
		{
			id: 'turno_sugerido',
			nombre: '4. Turno sugerido (hasta CONFIRMAR)',
			descripcion: 'Flujo completo hasta propuesta de turno.',
			pasos: [...hastaTurno],
		},
		{
			id: 'rechazo',
			nombre: '5. Rechazo de turno (buscar otro)',
			descripcion: 'Rechaza el turno ofrecido; debe buscar siguiente sin salir.',
			pasos: [...hastaTurno, { texto: 'No' }, { texto: 'prefiero otro día' }],
		},
		{
			id: 'cancelacion',
			nombre: '6. Cancelar gestión (salir del flujo)',
			descripcion: 'Paciente no quiere turno → debe cerrar sin loop.',
			pasos: [...hastaTurno, { texto: 'No quiero ningún turno' }],
		},
		{
			id: 'saludo_en_confirmacion',
			nombre: '7. Saludo durante confirmación',
			descripcion: 'En paso CONFIRMAR, "Hola" no debe repetir todo el turno.',
			pasos: [...hastaTurno, { texto: 'Hola' }, { texto: 'Buenas tardes' }],
		},
		{
			id: 'confirmacion',
			nombre: '8. Confirmar turno (⚠️ reserva real)',
			descripcion: 'Confirma turno → crea reserva en BD. Solo con --allow-booking.',
			pasos: [...hastaTurno, { texto: 'Sí', skip: true }, { texto: 'Gracias' }],
		},
		{
			id: 'biasi-agosto',
			nombre: '9. Audio De Biasi + agosto (orquestador)',
			descripcion:
				'Pedido con médico y mes → gestión con profesional+preferencia → DNI → turno mismo médico.',
			pasos: [
				{ texto: 'turno con de biasi para agosto' },
				{ texto: '{dni}' },
				{ texto: 'Sí' },
			],
		},
	];
}

async function modoInteractivo() {
	const telefono = ARG('telefono', TELEFONO_BASE);
	const idConv = await runWithTenant(EMPRESA, () => prepararConversacion(telefono, 'Interactivo'));

	console.log(`\n${C.bold}Modo interactivo${C.reset} — escribí mensajes (vacío=salir, /reset=reiniciar)`);
	console.log(`${C.dim}empresa=${EMPRESA} tel=${telefono}${C.reset}\n`);

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const preguntar = (q) => new Promise((res) => rl.question(q, res));

	while (true) {
		const linea = (await preguntar(`${C.blue}Tú> ${C.reset}`)).trim();
		if (!linea) break;
		if (linea === '/reset') {
			await runWithTenant(EMPRESA, () => prepararConversacion(telefono, 'Interactivo'));
			console.log(`${C.yellow}Conversación reiniciada.${C.reset}\n`);
			continue;
		}
		await runWithTenant(EMPRESA, () =>
			enviarMensajeSimulado({
				idConversacion: idConv,
				telefono,
				nombre: 'Interactivo',
				texto: linea,
			}),
		);
	}
	rl.close();
}

async function main() {
	console.log('╔══════════════════════════════════════════════════════════╗');
	console.log('║  Simulador conversaciones bot WhatsApp — iMedic          ║');
	console.log('╚══════════════════════════════════════════════════════════╝');
	console.log(`Empresa: ${EMPRESA}`);
	console.log(
		`GPT: ${botOpenai.isConfigured() ? 'ON' : 'OFF'} | Humanizer: ${botInterpretacion.humanizarHabilitado() ? 'ON' : 'OFF'}`,
	);
	console.log(`DNI: ${DNI} | Especialidad: ${ESPECIALIDAD} | Prof: ${PROFESIONAL}`);

	if (FLAG('interactive')) {
		await modoInteractivo();
		return;
	}

	const todos = escenarios();
	const idEsc = ARG('escenario', null);
	const lista = FLAG('all')
		? todos
		: idEsc
			? todos.filter((e) => e.id === idEsc)
			: [todos.find((e) => e.id === 'cancelacion') || todos[5]];

	if (!lista.length) {
		console.error(`Escenario no encontrado: ${idEsc}`);
		console.log('Disponibles:', todos.map((e) => e.id).join(', '));
		process.exit(1);
	}

	for (const esc of lista) {
		await runWithTenant(EMPRESA, () => correrEscenario(esc));
	}

	console.log(`\n${C.green}${C.bold}Simulación finalizada.${C.reset}`);
	console.log(`${C.dim}Tip: node scripts/simulate_bot_conversations.js --all`);
	console.log(`     node scripts/simulate_bot_conversations.js --interactive`);
	console.log(`     node scripts/simulate_bot_conversations.js --escenario=rechazo --prof=1${C.reset}\n`);
}

main().catch((e) => {
	console.error(`\n${C.red}FATAL:${C.reset}`, e.message);
	if (e.stack) console.error(e.stack);
	process.exit(1);
});
