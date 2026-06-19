/**
 * Auditoría turno 1: ¿busca profesional y guarda candidatos?
 *   node scripts/audit_agente_turno1.js
 */
require('dotenv').config();
const { runWithTenant } = require('../src/context/tenantContext');
const botConversacion = require('../src/services/botConversacion.service');
const botSesionIa = require('../src/services/botSesionIa.service');
const botAgente = require('../src/services/botAgente.service');
const botOpenai = require('../src/services/botOpenai.service');

const EMPRESA = Number(process.env.BOT_EMPRESA_ID || 1);
const TELEFONO = process.env.SIM_TELEFONO || '5493790000999';
const REPETICIONES = Number(process.env.AUDIT_REPS || 3);
const MSG = 'Hola, buenas noches. Quiero un turno con el Dr. Gómez, ¿puede ser?';

(async () => {
	console.log(`Modelo: ${botOpenai.getModel()}`);
	console.log(`Turno 1: "${MSG}"\n`);

	await runWithTenant(EMPRESA, async () => {
		for (let rep = 1; rep <= REPETICIONES; rep++) {
			const idConversacion = botConversacion.idDesdeTelefono(TELEFONO);
			try {
				await botConversacion.resetConversacionPorTelefono(TELEFONO);
			} catch (_) {}

			await botConversacion.registrarMensajeEntrante({
				telefonoWhatsApp: TELEFONO,
				contenido: MSG,
				idConversacion,
			});
			const conv = await botConversacion.obtenerConversacion(idConversacion);
			const historial = await botSesionIa.listarMensajesParaIa(idConversacion, { limit: 24 });

			const toolsUsadas = [];
			const original = botOpenai.chatConHerramientas.bind(botOpenai);
			botOpenai.chatConHerramientas = async (opts) => {
				const out = await original(opts);
				for (const tc of out.toolCalls || []) toolsUsadas.push(tc.function?.name);
				return out;
			};

			let r;
			try {
				r = await botAgente.responder({
					idConversacion,
					conv,
					telefonoWhatsApp: TELEFONO,
					historial,
					textoEntrada: MSG,
				});
			} finally {
				botOpenai.chatConHerramientas = original;
			}

			const convFinal = await botConversacion.obtenerConversacion(idConversacion);
			const estado = botAgente.leerEstado(convFinal);
			const cand = estado.candidatosProfesionales?.length || 0;
			const prof = estado.profesional?.matricula || null;
			const ok = cand >= 2 || prof != null;

			console.log(
				`#${rep} ${ok ? 'OK' : 'FALLO'} | endpoint obligatorio vía clasificador | candidatos: ${cand} | prof fijado: ${prof || 'no'}`,
			);
			console.log(`    → ${(r.texto || '').slice(0, 100)}...\n`);
		}
	});
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(2);
});
