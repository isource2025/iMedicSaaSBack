/**
 * Fuente única de sectores de pedidos: los resueltos en el login (JWT).
 * No reconsultar imPersonalSectores en cada API.
 */

function _norm(v) {
	return String(v || '').trim();
}

function normalizeSectorRows(raw) {
	const seen = new Set();
	const out = [];
	for (const s of raw || []) {
		const valor = _norm(s.valor || s.idSector || s.IdSector);
		if (!valor) continue;
		const k = valor.toUpperCase();
		if (seen.has(k)) continue;
		seen.add(k);
		out.push({
			valor,
			descripcion: _norm(s.descripcion || s.descripcionSector) || valor,
			valorServicio: _norm(s.valorServicio || s.ValorServicio),
			descripcionServicio: _norm(s.descripcionServicio),
			prefijos: Array.isArray(s.prefijos) ? s.prefijos : [],
		});
	}
	return out;
}

function sectoresFromDecoded(decoded) {
	return normalizeSectorRows(decoded?.sectores);
}

function compactSectoresJwt(rows) {
	return normalizeSectorRows(rows).map((s) => ({
		idSector: s.valor,
		descripcion: s.descripcion,
		valorServicio: s.valorServicio,
	}));
}

function codigosDeSector(item) {
	const seen = new Set();
	const out = [];
	const add = (c) => {
		const v = _norm(c);
		if (!v) return;
		const k = v.toUpperCase();
		if (seen.has(k)) return;
		seen.add(k);
		out.push(v);
	};
	add(item?.valor);
	add(item?.valorServicio);
	return out;
}

function codigosDeRows(rows) {
	const seen = new Set();
	const out = [];
	for (const r of rows || []) {
		for (const c of codigosDeSector(r)) {
			const k = c.toUpperCase();
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(c);
		}
	}
	return out;
}

function idSectorSesion(req) {
	return String(req?.idSector || req?.auth?.idSector || '').trim();
}

function sectorEnSesion(rows, code) {
	const u = _norm(code).toUpperCase();
	if (!u) return false;
	return (rows || []).some((r) =>
		codigosDeSector(r).some((c) => c.toUpperCase() === u),
	);
}

function codigosParaFiltro(rows, code) {
	const u = _norm(code);
	if (!u) return codigosDeRows(rows);
	const hit = (rows || []).find((r) =>
		codigosDeSector(r).some((c) => c.toUpperCase() === u.toUpperCase()),
	);
	if (hit) return codigosDeSector(hit);
	return [u];
}

module.exports = {
	normalizeSectorRows,
	sectoresFromDecoded,
	compactSectoresJwt,
	codigosDeSector,
	codigosDeRows,
	sectorEnSesion,
	codigosParaFiltro,
	idSectorSesion,
};
