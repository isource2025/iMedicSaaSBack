#!/usr/bin/env node
/**
 * Inspecciona conversación WhatsApp + simula interpretación IA (sin enviar WhatsApp).
 *
 * Uso:
 *   BOT_IA_DEBUG=1 node scripts/debug_conversacion_ia.js --telefono=5493794946066
 *   node scripts/debug_conversacion_ia.js --telefono=5493794946066 --mensaje="quiero ver los profesionales"
 */
require('dotenv').config();
process.env.BOT_IA_DEBUG = '1';

const { runWithTenant } = require('../src/context/tenantContext');
const botConversacion = require('../src/services/botConversacion.service');
const botInterpretacion = require('../src/services/botInterpretacion.service');
const botSesionIa = require('../src/services/botSesionIa.service');
const botGestionTurno = require('../src/services/botGestionTurno.service');

const EMPRESA = Number(process.env.BOT_EMPRESA_ID || 1);
const telefono =
	process.argv.find((a) => a.startsWith('--telefono='))?.split('=')[1] ||
	process.env.SIM_TELEFONO ||
	'5493794946066';
const mensajeTest =
	process.argv.find((a) => a.startsWith('--mensaje='))?.split('=').slice(1).join('=') || null;

async function main() {
	console.log('══════════════════════════════════════════');
	console.log('  DEBUG conversación + IA');
	console.log(`  Empresa ${EMPRESA} | Tel ${telefono}`);
	console.log('  BOT_IA_DEBUG=1 → ver [diag:ia] en consola');
	console.log('══════════════════════════════════════════\n');

	await runWithTenant(EMPRESA, async () => {
		const id = botConversacion.idDesdeTelefono(telefono);
		const conv = await botConversacion.obtenerConversacion(id);
		const msgs = await botConversacion.listarMensajes(id, { limit: 20 });
		const iaMsgs = await botSesionIa.listarMensajesParaIa(id, { limit: 12 });
		const gestion = botGestionTurno.obtenerGestionActiva(conv);

		console.log('── Conversación ──');
		console.log('id:', id);
		console.log('pasoBot:', conv?.pasoBot || '—');
		console.log('modo:', conv?.modoControl || '—');
		console.log('idPaciente:', conv?.idPaciente || '—');
		console.log('contextoBot:', JSON.stringify(conv?.contextoBot || {}, null, 2).slice(0, 800));
		if (gestion) {
			console.log('\n── Gestión turno ──');
			console.log(botGestionTurno.resumenParaPrompt(gestion));
		}

		console.log('\n── Últimos mensajes (BD) ──');
		for (const m of msgs.slice(-12)) {
			const txt = String(m.contenido || '').slice(0, 100).replace(/\n/g, ' ');
			console.log(`  ${m.origen} [${m.estadoEntrega}] ${txt}`);
		}

		console.log('\n── Historial enviado a IA ──');
		for (const m of iaMsgs) {
			const txt = String(m.contenido || '').slice(0, 100).replace(/\n/g, ' ');
			console.log(`  ${m.origen}: ${txt}`);
		}

		const ultimoPaciente = [...msgs].reverse().find((m) => m.origen === 'PACIENTE');
		const texto = mensajeTest || ultimoPaciente?.contenido || '';
		if (!texto) {
			console.log('\n(sin mensaje para interpretar — usá --mensaje=...)');
			return;
		}

		console.log(`\n── Interpretación simulada ──\n"${texto}"\n`);
		const interp = await botInterpretacion.interpretarMensaje({
			texto,
			conv,
			idConversacion: id,
			pasoBot: conv?.pasoBot,
		});
		console.log(JSON.stringify(interp, null, 2));
		console.log(
			'\ndebesSalirFlujo:',
			botInterpretacion.debeSalirFlujo(interp, texto, conv),
		);
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
