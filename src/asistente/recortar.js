/**
 * Acota lo que vuelve de las APIs antes de mandarlo al modelo.
 * Evita prompts enormes e inyección de texto clínico innecesario.
 */

const MAX_ITEMS = 25;
const MAX_CHARS = 9000;

function pick(obj, campos) {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
	const out = {};
	for (const c of campos) {
		if (obj[c] !== undefined) out[c] = obj[c];
		const lower = Object.keys(obj).find((k) => k.toLowerCase() === String(c).toLowerCase());
		if (lower && out[c] === undefined) out[c] = obj[lower];
	}
	if (obj._propio !== undefined) out._propio = obj._propio;
	return out;
}

function lista(items, campos) {
	const arr = Array.isArray(items) ? items : [];
	const fmt = (it) => (campos ? pick(it, campos) : it);
	const out = {
		total: arr.length,
		items: arr.slice(0, MAX_ITEMS).map(fmt),
		truncado: arr.length > MAX_ITEMS,
	};
	if (arr.some((it) => it && it._propio !== undefined)) {
		out.propios = arr.filter((it) => it && it._propio).length;
		const cortados = arr.slice(MAX_ITEMS).filter((it) => it && it._propio);
		if (cortados.length) out.propiosFueraDeMuestra = cortados.slice(0, 10).map(fmt);
	}
	return out;
}

function limitarJson(valor, max = MAX_CHARS) {
	const raw = JSON.stringify(valor ?? {});
	if (raw.length <= max) return valor;
	return {
		truncado: true,
		aviso: `Respuesta recortada (${raw.length} chars). Acotá la consulta (TOP, filtros o columnas).`,
		muestra: raw.slice(0, max),
	};
}

function deApi(resp, camposItem) {
	if (!resp) return { error: 'Sin respuesta' };
	const { status, body } = resp;
	if (status >= 400) {
		return {
			error: body?.mensaje || body?.message || `HTTP ${status}`,
			status,
		};
	}
	const data = body?.data !== undefined ? body.data : body;
	if (Array.isArray(data)) return limitarJson({ success: true, status, ...lista(data, camposItem) });
	if (data && typeof data === 'object' && Array.isArray(data.items)) {
		return limitarJson({
			success: true,
			status,
			...lista(data.items, camposItem),
			pagination: data.pagination || body?.pagination || null,
		});
	}
	if (data && typeof data === 'object') {
		return limitarJson({
			success: true,
			status,
			item: camposItem ? pick(data, camposItem) : data,
			pagination: body?.pagination || null,
		});
	}
	return limitarJson({ success: true, status, data });
}

module.exports = { pick, lista, limitarJson, deApi, MAX_ITEMS, MAX_CHARS };
