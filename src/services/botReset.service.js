/**
 * Comandos WhatsApp de mantenimiento / testing.
 *
 * Comandos (texto exacto, mayúsc/minúsc indiferente):
 *   #IMEDIC-ZERO              → borra historial del chat de quien envía
 *   #IMEDIC-ZERO-TODO#PIN     → borra TODAS las conversaciones del tenant (requiere PIN)
 *
 * PIN: variable BOT_WHATSAPP_RESET_PIN (default dev: reset-imedic-dev)
 */
const botConversacion = require('./botConversacion.service');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const whatsappMeta = require('./whatsappMeta.service');
const diag = require('../utils/diagLog');

const CMD_CHAT = '#IMEDIC-ZERO';
const CMD_TODO_PREFIX = '#IMEDIC-ZERO-TODO#';

function normalizarTextoComando(texto) {
	return String(texto || '')
		.trim()
		.replace(/\s+/g, '')
		.toUpperCase();
}

function getResetPin() {
	return String(process.env.BOT_WHATSAPP_RESET_PIN || 'reset-imedic-dev').trim();
}

/**
 * @returns {{ tipo: 'chat'|'todo'|'none', pin?: string }}
 */
function parseComandoReset(contenido) {
	const raw = String(contenido || '').trim();
	const norm = normalizarTextoComando(raw);

	if (norm === normalizarTextoComando(CMD_CHAT)) {
		return { tipo: 'chat' };
	}

	const todoPrefix = normalizarTextoComando(CMD_TODO_PREFIX);
	if (norm.startsWith(todoPrefix)) {
		const pin = raw.slice(CMD_TODO_PREFIX.length).trim();
		return { tipo: 'todo', pin };
	}

	return { tipo: 'none' };
}

function esComandoReset(contenido) {
	return parseComandoReset(contenido).tipo !== 'none';
}

async function enviarWhatsApp(idEmpresa, telefono, texto) {
	const waCfg = await whatsappEmpresa.getConfigForEmpresa(idEmpresa);
	if (!waCfg?.phoneNumberId || !waCfg?.accessToken) {
		diag.warn('botReset', 'WhatsApp no configurado — respuesta solo en logs', { idEmpresa });
		return null;
	}
	return whatsappMeta.sendTextMessage({
		phoneNumberId: waCfg.phoneNumberId,
		accessToken: waCfg.accessToken,
		to: telefono,
		text: texto,
	});
}

/**
 * @returns {Promise<{ handled: boolean, ok?: boolean, mensaje?: string, stats?: object }>}
 */
async function procesarComandoReset({ idEmpresa, telefonoWhatsApp, contenido }) {
	const cmd = parseComandoReset(contenido);
	if (cmd.tipo === 'none') return { handled: false };

	if (cmd.tipo === 'chat') {
		const stats = await botConversacion.resetConversacionPorTelefono(telefonoWhatsApp);
		diag.line('botReset', 'Historial chat borrado', {
			telefono: botConversacion.normalizarTelefono(telefonoWhatsApp),
			...stats,
		});
		const msg =
			'🧹 *Historial borrado*\n\nTu conversación con el bot fue reiniciada. Podés empezar de cero enviando *Hola*.';
		await enviarWhatsApp(idEmpresa, telefonoWhatsApp, msg);
		return { handled: true, ok: true, mensaje: msg, stats };
	}

	if (cmd.tipo === 'todo') {
		const expected = getResetPin();
		if (!cmd.pin || cmd.pin !== expected) {
			diag.warn('botReset', 'PIN incorrecto para RESET-TODO', {
				telefono: botConversacion.normalizarTelefono(telefonoWhatsApp),
			});
			const msg = '⛔ PIN incorrecto. Uso: `#IMEDIC-ZERO-TODO#tu-pin`';
			await enviarWhatsApp(idEmpresa, telefonoWhatsApp, msg);
			return { handled: true, ok: false, mensaje: msg };
		}

		const stats = await botConversacion.resetTodasLasConversaciones();
		diag.line('botReset', 'TODAS las conversaciones borradas', stats);
		const msg = `🧹 *Reset total*\n\nSe eliminaron ${stats.conversacionesEliminadas} conversación(es) y ${stats.mensajesEliminados} mensaje(s).`;
		await enviarWhatsApp(idEmpresa, telefonoWhatsApp, msg);
		return { handled: true, ok: true, mensaje: msg, stats };
	}

	return { handled: false };
}

module.exports = {
	CMD_CHAT,
	CMD_TODO_PREFIX,
	parseComandoReset,
	esComandoReset,
	procesarComandoReset,
};
