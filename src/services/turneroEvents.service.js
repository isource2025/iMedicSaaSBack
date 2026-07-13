/**
 * Eventos SSE en memoria para pantallas de turnero (por publicToken).
 */
const listeners = new Map();

function subscribe(publicToken, res) {
	const key = String(publicToken || '').trim();
	if (!key) return () => {};
	if (!listeners.has(key)) listeners.set(key, new Set());
	const set = listeners.get(key);
	set.add(res);
	return () => {
		set.delete(res);
		if (set.size === 0) listeners.delete(key);
	};
}

function publish(publicToken, event, data) {
	const key = String(publicToken || '').trim();
	const set = listeners.get(key);
	if (!set || !set.size) return;
	const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const res of set) {
		try {
			res.write(payload);
		} catch {
			set.delete(res);
		}
	}
}

function publishConfig(publicToken, config) {
	publish(publicToken, 'config', { config });
}

function publishLlamado(publicToken, llamado) {
	publish(publicToken, 'llamado', { llamado });
}

module.exports = {
	subscribe,
	publish,
	publishConfig,
	publishLlamado,
};
