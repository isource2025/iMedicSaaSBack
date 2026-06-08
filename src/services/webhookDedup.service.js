/**
 * Idempotencia webhook Meta — procesar solo la PRIMERA señal por mensaje (wamid).
 * Evita duplicados por reintentos de Meta, carreras entre requests o GPT lento.
 */
const TTL_MS = Number(process.env.WHATSAPP_DEDUP_TTL_MS || 86_400_000); // 24h
/** @type {Map<string, number>} metaMessageId → processedAt */
const completed = new Map();
/** @type {Set<string>} en procesamiento ahora */
const processing = new Set();

function cleanupExpired() {
	const now = Date.now();
	for (const [k, ts] of completed) {
		if (now - ts > TTL_MS) completed.delete(k);
	}
}

function dedupKey(metaMessageId, fallback = null) {
	const mid = String(metaMessageId || '').trim();
	if (mid) return `wamid:${mid}`;
	if (fallback?.telefono && fallback?.timestamp) {
		return `fb:${fallback.telefono}:${fallback.timestamp}:${String(fallback.contenido || '').slice(0, 80)}`;
	}
	return null;
}

/**
 * Claim síncrono ANTES de cualquier await — solo el primero procesa.
 * @returns {{ ok: boolean, key: string|null, reason?: string }}
 */
function tryClaimIncoming(metaMessageId, fallback = null) {
	cleanupExpired();
	const key = dedupKey(metaMessageId, fallback);
	if (!key) {
		return { ok: true, key: null };
	}
	if (completed.has(key)) {
		return { ok: false, key, reason: 'already-completed' };
	}
	if (processing.has(key)) {
		return { ok: false, key, reason: 'in-flight' };
	}
	processing.add(key);
	return { ok: true, key };
}

function markCompleted(key, success = true) {
	if (!key) return;
	processing.delete(key);
	if (success) {
		completed.set(key, Date.now());
	}
}

function markFailed(key) {
	if (!key) return;
	processing.delete(key);
}

module.exports = {
	tryClaimIncoming,
	markCompleted,
	markFailed,
	dedupKey,
};
