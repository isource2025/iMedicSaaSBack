/**
 * Smoke test servicios bot sobre imBotChat (sin HTTP).
 */
require('dotenv').config();

// Forzar recarga de módulo sin cache de tablesChecked
delete require.cache[require.resolve('../src/services/botConversacion.service')];
const botConversacion = require('../src/services/botConversacion.service');

(async () => {
	await botConversacion.checkConversationTables();
	const list = await botConversacion.listarConversaciones({ limit: 10 });
	const total = await botConversacion.contarMensajesNoLeidos();
	console.log('\n=== SMOKE imBotChat ===');
	console.log('Almacenamiento:', list.almacenamiento);
	console.log('Conversaciones:', list.conversaciones.length);
	console.log('No leídos (sum):', total);
	if (list.conversaciones.length) {
		const id = list.conversaciones[0].idConversacion;
		const msgs = await botConversacion.listarMensajes(id, { limit: 5 });
		console.log(`Mensajes ${id}:`, msgs.length);
	}
	console.log('OK');
	process.exit(0);
})().catch((e) => {
	console.error('SMOKE FAIL:', e.message);
	process.exit(1);
});
