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
	const sqlNum = Number(error?.number ?? error?.originalError?.info?.number);
	if (sqlNum === 2627 || sqlNum === 2601) return 409;
	return 500;
}

function mensajeTecnicoCrudo(error) {
	return String(
		error?.message ||
			error?.originalError?.info?.message ||
			error?.originalError?.message ||
			'',
	).trim();
}

/**
 * Traduce errores técnicos (SQL, TDS, etc.) a texto usable en la UI.
 * Si no reconoce el patrón, devuelve null para que el caller use el genérico.
 */
function mensajeAmigableDeError(error) {
	const raw = mensajeTecnicoCrudo(error);
	const sqlNum = Number(error?.number ?? error?.originalError?.info?.number);
	const low = raw.toLowerCase();

	if (
		sqlNum === 2627 ||
		sqlNum === 2601 ||
		/violation of primary key/i.test(raw) ||
		/cannot insert duplicate key/i.test(raw) ||
		/duplicate key/i.test(raw)
	) {
		if (/imturnos/i.test(raw) || /pk_imturnos/i.test(raw)) {
			return 'Ese horario ya tiene un turno cargado. Recargá la agenda e intentá de nuevo, o elegí otro horario.';
		}
		return 'Ya existe un registro con esos datos. Revisá e intentá de nuevo.';
	}

	if (/timeout|etimeout|esocket/i.test(low)) {
		return 'La operación tardó demasiado. Intentá de nuevo en unos segundos.';
	}
	if (/login failed|econnrefused|enotfound|network/i.test(low)) {
		return 'No se pudo conectar con el servidor. Intentá de nuevo.';
	}

	return null;
}

/** Mensaje para el usuario: el de la regla de negocio, o el genérico del controller. */
function mensajeDeError(error, mensajeGenerico) {
	if (codigoNegocio(error)) {
		const m = String(error?.message || '').trim();
		return m || mensajeGenerico;
	}
	return mensajeAmigableDeError(error) || mensajeGenerico;
}

module.exports = {
	statusDeError,
	mensajeDeError,
	mensajeAmigableDeError,
};
