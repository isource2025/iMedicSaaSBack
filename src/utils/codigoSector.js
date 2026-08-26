/**
 * Normalización de códigos de sector, cama y servicio en el borde de lectura.
 *
 * En la base estos códigos viven en columnas CHAR, así que vuelven con relleno
 * de espacios: "UTI " en lugar de "UTI". SQL Server ignora esos espacios al
 * comparar, por eso las consultas funcionan igual y no hay que salir a poner
 * LTRIM(RTRIM()) en cada WHERE. JavaScript no los ignora: 'UTI ' !== 'UTI', y de
 * ahí salen los ids compuestos tipo "UTI -03" y los filtros que no matchean.
 *
 * La regla es una sola: se recortan al salir de la base, una vez, y el resto de
 * la app los trata como texto limpio.
 */

const CAMPOS_CODIGO = [
	'ValorSector',
	'valorSector',
	'IdSector',
	'idSector',
	'Sector',
	'sector',
	'ValorHabitacionCama',
	'valorHabitacionCama',
	'ValorServicio',
	'valorServicio',
];

/** Un código suelto. */
function codigo(valor) {
	return String(valor ?? '').trim();
}

/** Recorta los códigos de una fila de la base. Devuelve la misma fila. */
function normalizarFila(fila, campos = CAMPOS_CODIGO) {
	if (!fila || typeof fila !== 'object') return fila;
	for (const campo of campos) {
		const v = fila[campo];
		if (typeof v === 'string') fila[campo] = v.trim();
	}
	return fila;
}

/** Recorta los códigos de un conjunto de filas. Devuelve el mismo arreglo. */
function normalizarFilas(filas, campos = CAMPOS_CODIGO) {
	if (!Array.isArray(filas)) return filas;
	for (const fila of filas) normalizarFila(fila, campos);
	return filas;
}

module.exports = { codigo, normalizarFila, normalizarFilas, CAMPOS_CODIGO };
