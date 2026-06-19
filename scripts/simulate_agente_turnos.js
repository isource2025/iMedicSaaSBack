/**
 * Simulación local del nuevo agente IA de turnos (sin Meta/WhatsApp real).
 * Usa BD real (.env) + OpenAI. Reproduce el caso reportado del audio.
 *
 *   node scripts/simulate_agente_turnos.js
 */
require('dotenv').config();
const { runWithTenant } = require('../src/context/tenantContext');
const botConversacion = require('../src/services/botConversacion.service');
const botSesionIa = require('../src/services/botSesionIa.service');
const botAgente = require('../src/services/botAgente.service');

const EMPRESA = Number(process.env.BOT_EMPRESA_ID || 1);
const TELEFONO = process.env.SIM_TELEFONO || '5493790000777';
const DNI = process.env.SIM_DNI || '53547773';

const GUION = process.env.SIM_GUION === 'gomez_marta'
	? [
			'Hola, buenas noches. Quiero un turno con el Dr. Gómez, ¿puede ser?',
			'Es decir, disculpame, era con Gómez Marta, de Odontología.',
		]
	: [
			'Hola, buenas. Quiero un turno con el Dr. Gómez, ¿puede ser?',
			// la respuesta del bot definirá si hay que elegir; respondemos genérico
			'El primero que aparezca está bien',
			'El jueves de la semana que viene si puede ser',
			`Dale, el DNI es ${DNI}`,
			'Sí, confirmo',
			'Sí, lo confirmo, gracias',
		];

async function turno(idConversacion, texto) {
	await botConversacion.registrarMensajeEntrante({
		telefonoWhatsApp: TELEFONO,
		contenido: texto,
		idConversacion,
	});
	const conv = await botConversacion.obtenerConversacion(idConversacion);
	const historial = await botSesionIa.listarMensajesParaIa(idConversacion, { limit: 24 });
	const r = await botAgente.responder({
		idConversacion,
		conv,
		telefonoWhatsApp: TELEFONO,
		historial,
		textoEntrada: texto,
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
		}
		await botConversacion.finalizarTrasReservaExitosa(idConversacion);
	}
	return r;
}

(async () => {
	await runWithTenant(EMPRESA, async () => {
		const idConversacion = botConversacion.idDesdeTelefono(TELEFONO);
		// limpiar conversación previa
		try {
			await botConversacion.resetConversacionPorTelefono(TELEFONO);
		} catch (e) {
			console.warn('reset previo:', e.message);
		}

		for (const texto of GUION) {
			console.log('\n👤 PACIENTE:', texto);
			const r = await turno(idConversacion, texto);
			console.log('🤖 BOT:', r.texto || `(sin respuesta: ${r.motivo})`);
			if (r.ticket) console.log('🎫 COMPROBANTE:\n' + r.ticket);
			if (r.finalizar) console.log('— gestión finalizada (turno reservado) —');
		}
	});
	process.exit(0);
})().catch((err) => {
	console.error('ERROR SIM:', err);
	process.exit(1);
});
