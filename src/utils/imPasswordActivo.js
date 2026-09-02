/**
 * Semántica Clarion imPassword.MarcadeBaja:
 * - Vacío / NULL → operador activo (sin marca de baja)
 * - Cualquier valor (incl. "0") → dado de baja
 */

function isNumericSqlType(t) {
	return ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money'].includes(
		String(t || '').toLowerCase(),
	);
}

function normalizarMarcadeBaja(raw) {
	if (raw == null) return '';
	return String(raw).trim();
}

/** Operador activo si MarcadeBaja está vacío. */
function esOperadorActivo(marcadeBaja) {
	return normalizarMarcadeBaja(marcadeBaja) === '';
}

/** Condición SQL Server para filtrar operadores activos (sin marca de baja). */
function sqlImPasswordSinMarcaBaja(alias = 'pw') {
	const a = String(alias || 'pw').replace(/[^a-zA-Z0-9_]/g, '') || 'pw';
	return `(LTRIM(RTRIM(CAST(ISNULL(${a}.MarcadeBaja, '') AS VARCHAR(20)))) = '')`;
}

/** Valor para INSERT/UPDATE de alta (activo). meta: { tipo } de la columna, si se conoce. */
function valorMarcadeBajaAlta(meta) {
	if (meta && isNumericSqlType(meta.tipo)) return null;
	return '';
}

/** Literal embebido en INSERT dinámico SQL Server. meta: { tipo } de la columna, si se conoce. */
function sqlLiteralMarcadeBajaAlta(meta) {
	if (meta && isNumericSqlType(meta.tipo)) return 'NULL';
	return "N''";
}

module.exports = {
	isNumericSqlType,
	normalizarMarcadeBaja,
	esOperadorActivo,
	sqlImPasswordSinMarcaBaja,
	valorMarcadeBajaAlta,
	sqlLiteralMarcadeBajaAlta,
};
