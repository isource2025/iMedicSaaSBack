/**
 * Empata el sector de login (imSectores / imPersonalSectores)
 * con el servicio receptor de pedidos (imServicios.Valor en IdSectorReceptor).
 * Los códigos no siempre coinciden (ECO vs ECOG, ECOGRAFÍA vs ECOGRAFIA).
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

const STEMS = [
	{ keys: ['ECOGRAF', 'ULTRASON', 'ECOG', 'ECHO'], stem: 'ECO' },
	{ keys: ['ECOCARDIO'], stem: 'ECO' },
	{ keys: ['OFTAL', 'OFTALMO'], stem: 'OFTAL' },
	{ keys: ['CARDIO'], stem: 'CARDIO' },
	{ keys: ['LABORATOR'], stem: 'LAB' },
	{ keys: ['RADIOLOG', 'RAYOS'], stem: 'RX' },
	{ keys: ['TOMOGRAF'], stem: 'TOMO' },
	{ keys: ['RESONAN'], stem: 'RMN' },
	{ keys: ['ENDOSCOP'], stem: 'ENDOS' },
	{ keys: ['KINESIO', 'FISIOTER', 'REHABILIT'], stem: 'KINE' },
	{ keys: ['NUTRIC'], stem: 'NUTRI' },
	{ keys: ['HEMOTER'], stem: 'HEMO' },
	{ keys: ['CIRUG'], stem: 'CIR' },
	{ keys: ['GUARDIA', 'EMERGENC'], stem: 'GUARDIA' },
	{ keys: ['CUIDADOS INTENS', 'TERAPIA INTENS'], stem: 'UTI' },
];

function clinicalStem(valor, descripcion) {
	const blob = `${fold(valor)} ${fold(descripcion)}`.trim();
	if (!blob) return '';
	for (const { keys, stem } of STEMS) {
		if (keys.some((k) => blob.includes(k))) return stem;
	}
	const code = fold(valor).replace(/\s+/g, '');
	if (code.length >= 3) return code;
	return '';
}

function codesRelated(a, b) {
	const x = fold(a).replace(/\s+/g, '');
	const y = fold(b).replace(/\s+/g, '');
	if (!x || !y) return false;
	if (x === y) return true;
	const min = Math.min(x.length, y.length);
	if (min < 3) return false;
	return x.startsWith(y) || y.startsWith(x);
}

function itemBandejaCoincideReceptor(itemValor, receptor) {
	return codesRelated(itemValor, receptor);
}

function sectorUsuarioCoincideServicio(userSec, srv) {
	const id = fold(userSec?.idSector).replace(/\s+/g, '');
	const desc = fold(userSec?.descripcion);
	const v = fold(srv?.valor).replace(/\s+/g, '');
	const d = fold(srv?.descripcion);
	if (!v && !d) return false;
	if (id && v && id === v) return true;
	if (desc && d && desc === d) return true;
	if (desc && d && desc.length >= 4 && d.length >= 4 && (desc.includes(d) || d.includes(desc))) {
		return true;
	}
	if (codesRelated(id, v)) return true;
	const s1 = clinicalStem(userSec?.idSector, userSec?.descripcion);
	const s2 = clinicalStem(srv?.valor, srv?.descripcion);
	if (s1 && s2 && s1 === s2) return true;
	return false;
}

module.exports = {
	fold,
	clinicalStem,
	codesRelated,
	itemBandejaCoincideReceptor,
	sectorUsuarioCoincideServicio,
};
