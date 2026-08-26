/**
 * Política única para responder errores desde los controllers.
 *
 * Los servicios marcan las reglas de negocio con `error.statusCode` (400, 404,
 * 409). Esas son las que el usuario tiene que leer tal cual: "la cama destino no
 * está disponible", "la visita ya tiene egreso". Lo inesperado sigue siendo 500
 * con el texto genérico del controller, y el detalle técnico viaja aparte en el
 * campo `error` para poder diagnosticarlo sin mostrarle SQL a nadie.
 */

function codigoNegocio(error) {
	const s = Number(error?.statusCode);
	return Number.isFinite(s) && s >= 400 && s < 500 ? s : null;
}

/** Status HTTP a devolver: el de la regla de negocio, o 500. */
function statusDeError(error) {
	const s = Number(error?.statusCode);
	if (Number.isFinite(s) && s >= 400 && s < 600) return s;
	return 500;
}

/** Mensaje para el usuario: el de la regla de negocio, o el genérico del controller. */
function mensajeDeError(error, mensajeGenerico) {
	if (!codigoNegocio(error)) return mensajeGenerico;
	const m = String(error?.message || '').trim();
	return m || mensajeGenerico;
}

module.exports = { statusDeError, mensajeDeError };
