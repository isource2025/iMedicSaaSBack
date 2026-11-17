/**
 * Clases de paciente que usan cama / flujo de internación en el mapa.
 * I = Internado, H = Hospital de día (Vidal y tenants Clarion típicos).
 *
 * @param {string} [colExpr='v.ClasePaciente'] expresión SQL de la columna
 */
function sqlClaseConCama(colExpr = 'v.ClasePaciente') {
	return `(
		UPPER(LTRIM(RTRIM(COALESCE(${colExpr}, '')))) IN ('I', 'H')
		OR EXISTS (
			SELECT 1
			FROM dbo.imClasePaciente cp
			WHERE LTRIM(RTRIM(CAST(cp.Valor AS VARCHAR(10)))) = LTRIM(RTRIM(CAST(${colExpr} AS VARCHAR(10))))
			  AND UPPER(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(cp.Descripcion, ''))), N'Í', N'I'), N'Á', N'A'))
			      LIKE N'%HOSPITAL%DE%DIA%'
		)
	)`;
}

function claseRequiereUbicacion(valor) {
	const v = String(valor || '').trim().toUpperCase();
	return v === 'I' || v === 'H';
}

module.exports = {
	sqlClaseConCama,
	claseRequiereUbicacion,
};
