/**
 * Códigos de imSectores.Valor (CIRA, CM1) y ValorServicio anexado (CIR, CLI).
 * Igualdad exacta recortada: no hay stems CIRUGIA→CIR ni prefijos CIRA≈CIR.
 */

function fold(v) {
	return String(v || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Z0-9]+/gi, ' ')
		.trim()
		.toUpperCase()
		.replace(/\s+/g, ' ');
}

function compact(v) {
	return fold(v).replace(/\s+/g, '');
}

function codesRelated(a, b) {
	const x = compact(a);
	const y = compact(b);
	return Boolean(x && y && x === y);
}

function itemBandejaCoincideReceptor(itemValor, receptor) {
	return codesRelated(itemValor, receptor);
}

function sectorUsuarioCoincideServicio(userSec, srv) {
	const id = compact(userSec?.idSector);
	const v = compact(srv?.valor);
	const vs = compact(srv?.valorServicio);
	if (id && (id === v || id === vs)) return true;
	const desc = fold(userSec?.descripcion);
	const d = fold(srv?.descripcion);
	if (desc && d && desc === d) return true;
	return false;
}

module.exports = {
	fold,
	codesRelated,
	itemBandejaCoincideReceptor,
	sectorUsuarioCoincideServicio,
};
