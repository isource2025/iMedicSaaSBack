/**
 * Prepara un valor para res.json: BigInt, Buffer, ciclos y surrogate
 * inválidos tiran TypeError y el detalle de admisión termina en 500.
 */
const MAX_BUFFER_AS_TEXT = 200 * 1024;

function looksBinary(buf) {
	if (!buf || buf.length < 4) return false;
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
	if (buf[0] === 0xff && buf[1] === 0xd8) return true;
	if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true;
	if (buf[0] === 0x50 && buf[1] === 0x4b) return true;
	return false;
}

function bufferToJsonValue(buf) {
	if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
	if (buf.length > MAX_BUFFER_AS_TEXT || looksBinary(buf)) return null;
	return buf.toString('latin1');
}

function sanitizeString(s) {
	return String(s).replace(/[\uD800-\uDFFF]/g, '');
}

function jsonSafe(value, seen) {
	if (value == null) return value;
	const t = typeof value;
	if (t === 'bigint') {
		const n = Number(value);
		return Number.isSafeInteger(n) ? n : String(value);
	}
	if (t === 'string') return sanitizeString(value);
	if (t === 'number' || t === 'boolean') return value;
	if (t === 'function' || t === 'symbol') return undefined;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}
	if (Buffer.isBuffer(value)) return bufferToJsonValue(value);
	if (t !== 'object') return sanitizeString(value);

	if (value.type === 'Buffer' && Array.isArray(value.data)) {
		try {
			return bufferToJsonValue(Buffer.from(value.data));
		} catch {
			return null;
		}
	}

	const bag = seen || new WeakSet();
	if (bag.has(value)) return null;
	bag.add(value);

	if (Array.isArray(value)) {
		return value.map((v) => jsonSafe(v, bag)).filter((v) => v !== undefined);
	}

	const out = {};
	for (const [k, v] of Object.entries(value)) {
		if (v === undefined) continue;
		const sv = jsonSafe(v, bag);
		if (sv !== undefined) out[k] = sv;
	}
	return out;
}

module.exports = { jsonSafe };
