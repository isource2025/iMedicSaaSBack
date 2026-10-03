/**
 * Cache en memoria con TTL y deduplicación de llamadas en vuelo.
 *
 * Pensado para datos que se releen en cada request (fila Empresas, roles del
 * usuario, sesión) o agregados caros que no cambian por segundo (analítica de
 * 30 días). Un solo proceso: si la API corre en varias instancias cada una
 * tiene su propio cache; los TTL son cortos justamente por eso.
 */

class TtlCache {
	/**
	 * @param {{ ttlMs: number, max?: number, nombre?: string }} opts
	 */
	constructor({ ttlMs, max = 5000, nombre = 'cache' }) {
		this.ttlMs = Math.max(0, Number(ttlMs) || 0);
		this.max = max;
		this.nombre = nombre;
		/** @type {Map<string, { valor: any, expira: number }>} */
		this.map = new Map();
		/** @type {Map<string, Promise<any>>} */
		this.enVuelo = new Map();
	}

	get(key) {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		if (hit.expira <= Date.now()) {
			this.map.delete(key);
			return undefined;
		}
		return hit.valor;
	}

	has(key) {
		return this.get(key) !== undefined;
	}

	set(key, valor, ttlMs = this.ttlMs) {
		if (ttlMs <= 0) return valor;
		if (this.map.size >= this.max) {
			// Descarta la entrada más vieja (orden de inserción del Map).
			const primera = this.map.keys().next().value;
			if (primera !== undefined) this.map.delete(primera);
		}
		this.map.set(key, { valor, expira: Date.now() + ttlMs });
		return valor;
	}

	delete(key) {
		this.map.delete(key);
		this.enVuelo.delete(key);
	}

	/** Borra todas las claves que empiezan con `prefijo`. */
	deletePrefix(prefijo) {
		for (const k of [...this.map.keys()]) {
			if (k.startsWith(prefijo)) this.map.delete(k);
		}
		for (const k of [...this.enVuelo.keys()]) {
			if (k.startsWith(prefijo)) this.enVuelo.delete(k);
		}
	}

	clear() {
		this.map.clear();
		this.enVuelo.clear();
	}

	/**
	 * Devuelve el valor cacheado o ejecuta `cargar()` una sola vez aunque haya
	 * N llamadas concurrentes con la misma clave (todas esperan la misma promesa).
	 * @template T
	 * @param {string} key
	 * @param {() => Promise<T>} cargar
	 * @param {number} [ttlMs]
	 * @returns {Promise<T>}
	 */
	async getOrLoad(key, cargar, ttlMs = this.ttlMs) {
		const hit = this.get(key);
		if (hit !== undefined) return hit;
		const pendiente = this.enVuelo.get(key);
		if (pendiente) return pendiente;
		const p = (async () => {
			try {
				const valor = await cargar();
				if (valor !== undefined) this.set(key, valor, ttlMs);
				return valor;
			} finally {
				this.enVuelo.delete(key);
			}
		})();
		this.enVuelo.set(key, p);
		return p;
	}
}

module.exports = { TtlCache };
