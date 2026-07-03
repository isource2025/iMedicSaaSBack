/**
 * Índice de Masa Corporal: peso (kg) / talla (m)²
 * @param {number|string|null|undefined} pesoKg
 * @param {number|string|null|undefined} tallaCm
 * @returns {number} IMC con 1 decimal, o 0 si no se puede calcular
 */
function calcularIMC(pesoKg, tallaCm) {
	const peso = Number(pesoKg);
	const talla = Number(tallaCm);
	if (!Number.isFinite(peso) || !Number.isFinite(talla) || peso <= 0 || talla <= 0) {
		return 0;
	}
	const tallaM = talla / 100;
	return Math.round((peso / (tallaM * tallaM)) * 10) / 10;
}

/**
 * Completa IMC en filas de imInterCtrlFrecuente si falta en BD.
 */
function enrichControlWithIMC(row) {
	if (!row || typeof row !== 'object') return row;
	const stored = Number(row.IMC);
	if (Number.isFinite(stored) && stored > 0) return row;
	const imc = calcularIMC(row.Peso, row.Talla);
	if (imc > 0) return { ...row, IMC: imc };
	return row;
}

function enrichControlesWithIMC(rows) {
	if (!Array.isArray(rows)) return rows;
	return rows.map(enrichControlWithIMC);
}

module.exports = {
	calcularIMC,
	enrichControlWithIMC,
	enrichControlesWithIMC,
};
