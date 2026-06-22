/**
 * Chat interactivo por consola — prueba el agente IA en tiempo real con traza completa.
 *
 *   npm run bot:consola
 *
 * Comandos: /estado /reset /salir
 */
require('dotenv').config();

process.env.BOT_CONVERSACIONES_MEMORIA = process.env.BOT_CONVERSACIONES_MEMORIA ?? '1';

const readline = require('readline');
const { runWithTenant } = require('../src/context/tenantContext');
const botConversacion = require('../src/services/botConversacion.service');
const botSesionIa = require('../src/services/botSesionIa.service');
const botAgente = require('../src/services/botAgente.service');

const EMPRESA = Number(process.env.BOT_EMPRESA_ID || 1);
const TELEFONO = process.env.BOT_CONSOLA_TEL || '5493790000999';

function banner() {
	console.log('');
	console.log('╔══════════════════════════════════════════════════════════════════╗');
	console.log('║  iMedic — Consola interactiva del agente de turnos (WhatsApp)   ║');
	console.log('╚══════════════════════════════════════════════════════════════════╝');
	console.log(`  Empresa: ${EMPRESA}  |  Tel simulado: ${TELEFONO}`);
	console.log('  Traza IA: siempre ON ([agente-trace])  |  Sin cola (respuesta inmediata)');
	console.log('  Escribí como paciente. Comandos: /estado /reset /salir');
	console.log('');
}

async function enviarTurno(idConversacion, linea) {
	await botConversacion.registrarMensajeEntrante({
		telefonoWhatsApp: TELEFONO,
		contenido: linea,
		idConversacion,
		nombreContacto: 'Consola Test',
	});

	const convAct = await botConversacion.obtenerConversacion(idConversacion);
	const hist = await botSesionIa.listarMensajesParaIa(idConversacion, { limit: 24 });
	const r = await botAgente.responder({
		idConversacion,
		conv: convAct,
		telefonoWhatsApp: TELEFONO,
		historial: hist,
		textoEntrada: linea,
	});

	if (r.respondido && r.texto) {
		await botConversacion.registrarMensajeSaliente({
			idConversacion,
			contenido: r.texto,
			origen: 'BOT',
		});
	}

	if (r.finalizar) {
		if (r.ticket) {
			await botConversacion.registrarMensajeSaliente({
				idConversacion,
				contenido: r.ticket,
				origen: 'BOT',
			});
			console.log('\n🎫 COMPROBANTE:\n' + r.ticket + '\n');
		}
		await botConversacion.finalizarTrasReservaExitosa(idConversacion);
	}

	return r;
}

async function main() {
	await runWithTenant(EMPRESA, async () => {
		const idConversacion = botConversacion.idDesdeTelefono(TELEFONO);

		try {
			await botConversacion.resetConversacionPorTelefono(TELEFONO);
		} catch {
			/* ok */
		}

		banner();

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: '👤 tú › ',
		});

		rl.prompt();

		rl.on('line', async (line) => {
			const texto = String(line || '').trim();
			rl.pause();

			try {
				if (!texto) {
					rl.prompt();
					rl.resume();
					return;
				}
				if (texto === '/salir' || texto === '/exit') {
					console.log('Chau.');
					process.exit(0);
				}
				if (texto === '/reset') {
					await botConversacion.resetConversacionPorTelefono(TELEFONO);
					console.log('✓ Conversación reseteada.\n');
					rl.prompt();
					rl.resume();
					return;
				}
				if (texto === '/estado') {
					const conv = await botConversacion.obtenerConversacion(idConversacion);
					console.log('\n' + JSON.stringify(botAgente.leerEstado(conv), null, 2) + '\n');
					rl.prompt();
					rl.resume();
					return;
				}

				const r = await enviarTurno(idConversacion, texto);
				if (!r.respondido) {
					console.log(`\n⚠ Sin respuesta: ${r.motivo || '?'}\n`);
				}
			} catch (err) {
				console.error('\n✗ Error:', err.message, '\n');
			}

			rl.prompt();
			rl.resume();
		});

		rl.on('close', () => process.exit(0));
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
