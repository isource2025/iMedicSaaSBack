/**
 * Transcripción de audios de WhatsApp con Groq (Whisper).
 *
 * Flujo:
 *   1. Meta Cloud API entrega el audio como media id → se descarga el binario.
 *   2. El binario se envía a Groq /audio/transcriptions (whisper-large-v3-turbo).
 *   3. El texto transcripto se guarda como contenido del mensaje, con un marcador
 *      liviano (AUDIO_PREFIX) para que el front muestre una pequeña referencia de
 *      que el mensaje original fue un audio. El bot consume el texto sin el marcador.
 */
const axios = require('axios');
const FormData = require('form-data');
const whatsappEmpresa = require('./whatsappEmpresa.service');
const diag = require('../utils/diagLog');

/** Marcador para identificar transcripciones de audio (mic emoji + espacio). */
const AUDIO_PREFIX = '\u{1F3A4} ';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

function groqApiKey() {
	return String(process.env.GROQ_API_KEY || '').trim();
}

function transcripcionHabilitada() {
	if (process.env.BOT_AUDIO_TRANSCRIBE === '0' || process.env.BOT_AUDIO_TRANSCRIBE === 'false') {
		return false;
	}
	return Boolean(groqApiKey());
}

function modeloWhisper() {
	return String(process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo').trim();
}

function idiomaTranscripcion() {
	return String(process.env.GROQ_TRANSCRIBE_LANG || 'es').trim();
}

function maxBytesAudio() {
	const mb = Number(process.env.BOT_AUDIO_MAX_MB || 25);
	return (Number.isFinite(mb) && mb > 0 ? mb : 25) * 1024 * 1024;
}

/** Marca un texto como proveniente de un audio. */
function marcarTranscripcionAudio(texto) {
	return `${AUDIO_PREFIX}${String(texto || '').trim()}`.trim();
}

/** True si el contenido almacenado corresponde a un audio transcripto. */
function esTranscripcionAudio(texto) {
	return String(texto || '').startsWith(AUDIO_PREFIX.trimEnd());
}

/** Devuelve el texto sin el marcador de audio (para que lo consuma el bot). */
function quitarMarcadorAudio(texto) {
	const s = String(texto || '');
	if (!esTranscripcionAudio(s)) return s;
	return s.slice(AUDIO_PREFIX.trimEnd().length).replace(/^\s+/, '');
}

function extensionDesdeMime(mimeType) {
	const mime = String(mimeType || '').toLowerCase();
	if (mime.includes('ogg')) return 'ogg';
	if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
	if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
	if (mime.includes('wav')) return 'wav';
	if (mime.includes('webm')) return 'webm';
	if (mime.includes('flac')) return 'flac';
	return 'ogg';
}

/**
 * Descarga el binario de un media de WhatsApp Cloud API.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function descargarMediaMeta({ mediaId, accessToken }) {
	const id = String(mediaId || '').trim();
	const token = String(accessToken || '').trim();
	if (!id) {
		const err = new Error('mediaId requerido para descargar audio');
		err.code = 'AUDIO_SIN_MEDIA_ID';
		throw err;
	}
	if (!token) {
		const err = new Error('accessToken requerido para descargar audio de Meta');
		err.code = 'AUDIO_SIN_TOKEN';
		throw err;
	}

	const version = whatsappEmpresa.graphVersion();
	const metaUrl = `https://graph.facebook.com/${version}/${id}`;
	const metaResp = await axios.get(metaUrl, {
		headers: { Authorization: `Bearer ${token}` },
		timeout: Number(process.env.BOT_AUDIO_DOWNLOAD_TIMEOUT_MS || 20_000),
	});

	const fileUrl = metaResp.data?.url;
	const mimeType = metaResp.data?.mime_type || 'audio/ogg';
	if (!fileUrl) {
		const err = new Error('Meta no devolvió URL del audio');
		err.code = 'AUDIO_SIN_URL';
		throw err;
	}

	const binResp = await axios.get(fileUrl, {
		headers: { Authorization: `Bearer ${token}` },
		responseType: 'arraybuffer',
		maxContentLength: maxBytesAudio(),
		maxBodyLength: maxBytesAudio(),
		timeout: Number(process.env.BOT_AUDIO_DOWNLOAD_TIMEOUT_MS || 20_000),
	});

	return { buffer: Buffer.from(binResp.data), mimeType };
}

/**
 * Transcribe un buffer de audio con Groq Whisper.
 * @returns {Promise<string>} texto transcripto (puede ser vacío)
 */
async function transcribirBuffer({ buffer, mimeType }) {
	if (!buffer || !buffer.length) return '';
	const apiKey = groqApiKey();
	if (!apiKey) {
		const err = new Error('GROQ_API_KEY no configurada');
		err.code = 'AUDIO_SIN_API_KEY';
		throw err;
	}

	const form = new FormData();
	form.append('file', buffer, {
		filename: `audio.${extensionDesdeMime(mimeType)}`,
		contentType: mimeType || 'audio/ogg',
	});
	form.append('model', modeloWhisper());
	form.append('response_format', 'text');
	form.append('temperature', '0');
	const lang = idiomaTranscripcion();
	if (lang) form.append('language', lang);

	const resp = await axios.post(GROQ_URL, form, {
		headers: {
			...form.getHeaders(),
			Authorization: `Bearer ${apiKey}`,
		},
		timeout: Number(process.env.GROQ_TRANSCRIBE_TIMEOUT_MS || 45_000),
		maxContentLength: Infinity,
		maxBodyLength: Infinity,
	});

	if (typeof resp.data === 'string') return resp.data.trim();
	return String(resp.data?.text || '').trim();
}

/**
 * Descarga + transcribe un audio de Meta. No lanza: ante error devuelve null y loguea.
 * @returns {Promise<string|null>} texto transcripto, o null si no se pudo.
 */
async function transcribirAudioMeta({ mediaId, accessToken, mimeType }) {
	if (!transcripcionHabilitada()) return null;
	try {
		const media = await descargarMediaMeta({ mediaId, accessToken });
		const texto = await transcribirBuffer({
			buffer: media.buffer,
			mimeType: media.mimeType || mimeType,
		});
		return texto || null;
	} catch (err) {
		diag.warn('audio', 'Transcripción de audio falló', {
			mediaId,
			error: err.message,
			code: err.code || err.response?.status || null,
		});
		console.warn('[audioTranscripcion] Falló transcripción:', err.message);
		return null;
	}
}

module.exports = {
	AUDIO_PREFIX,
	transcripcionHabilitada,
	marcarTranscripcionAudio,
	esTranscripcionAudio,
	quitarMarcadorAudio,
	descargarMediaMeta,
	transcribirBuffer,
	transcribirAudioMeta,
};
