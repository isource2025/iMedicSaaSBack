/**
 * Contrato de identidad: qué clave de persona guarda cada columna de autor.
 *
 * En Clarion una persona tiene tres números independientes y cada columna guarda uno:
 *   - operador:  imPassword.CodOperador (la cuenta que operó)
 *   - ficha:     imPersonal.Valor = imPassword.ValorPersonal (el profesional)
 *   - matricula: imPersonal.Matricula (agenda)
 * El mismo número puede ser una clave de una persona y otra clave de otra persona, por eso
 * la web graba exactamente la clave de la columna, sin sustituir una por otra.
 * Medido sobre las filas que graba el escritorio en las bases de los clientes.
 */
const { sqlApplyNombrePersona } = require('../utils/sqlNombrePersona');
const {
	resolveCodOperador,
	resolveValorPersonal,
	resolveMatricula,
} = require('../utils/sessionIdentity');

const OPERADOR = 'operador';
const FICHA = 'ficha';
const MATRICULA = 'matricula';

const COLUMNAS = Object.freeze({
	'imInterIndMedicas.OperadorCarga': OPERADOR,
	'imInterIndMedicas.ProfesionalAsiste': FICHA,
	'imInterCtrlFrecuente.OperadorCarga': OPERADOR,
	'imInterCtrlFrecuente.Profesional': FICHA,
	'imInterCtrlMedicamento.OperadorCarga': OPERADOR,
	'imInterCtrlMedicamento.Profesional': FICHA,
	'imInterCtrlDieta.OperadorCarga': OPERADOR,
	'imInterCtrlDieta.Profesional': FICHA,
	'imInterCtrlEvolucion.OperadorCarga': OPERADOR,
	'imInterCtrlEvolucion.Profesional': FICHA,
	'imBalanceHidrico.Profesional': FICHA,
	'imHCI.IdProfecional': OPERADOR,
	'imHCEvolucion.Profecional': FICHA,
	'imHCEpicrisis.Profecional': FICHA,
	'imVisita.OPERADOR': OPERADOR,
	'imVisita.OperadorEgreso': OPERADOR,
	'imVisita.DOCTORADMISOR': FICHA,
	'imVisita.DOCTORASISTIENDO': FICHA,
	'imVisitaMovimiento.Operador': OPERADOR,
	'imVisitaFamiliarCercano.Operador': OPERADOR,
	'imVisiNovedades.CodOperador': OPERADOR,
	'imPacientes.Operador': OPERADOR,
	'imTurnos.CodOperador': OPERADOR,
	'imTurnos.OperadorLlegada': OPERADOR,
	'imTurnos.OperadorIngreso': OPERADOR,
	'imTurnos.OperadorCancelacion': OPERADOR,
	'imTurnos.Profesional': MATRICULA,
	'imFacPracticas.CodOperador': OPERADOR,
	'imFacProfesionales.CodOperador': OPERADOR,
	'imFacProfesionales.Matricula': FICHA,
	'imProtocolosResultados.CodOperador': OPERADOR,
	'HCProtocolosPtes.IdOperador': OPERADOR,
	'imPedidosEstudios.ValorProfesional': FICHA,
	'imSolicitudesEstudios.ValorProfesional': FICHA,
	'imPedidosEstudiosToma.CodOperador': OPERADOR,
	'imPedidosEstudiosToma.Matricula': MATRICULA,
	'imPedidosEstudiosAdjuntos.IdOperador': OPERADOR,
	'imRendiciones.OperGraba': OPERADOR,
	'imRendiciones.OperCierre': OPERADOR,
	'imPersonalHorarios.Matricula': MATRICULA,
	'imPersonalNoHorarios.Matricula': MATRICULA,
	'imAuditoria.Actor': FICHA,
	'imNotificaciones.ValorPersonal': FICHA,
});

/**
 * Orden de lectura por clave.
 *
 * La clave de la columna va primero. Las demás solo corren si esa clave no
 * identifica a nadie (filas viejas de la web). Si el número es a la vez el
 * CodOperador de A y la ficha de B, gana la clave de la columna: es lo que
 * Clarion grabó y lo único que no choca con las escrituras nuevas.
 */
const ORDEN_LECTURA = Object.freeze({
	[OPERADOR]: ['operador', 'valor', 'matricula'],
	[FICHA]: ['valor', 'matricula', 'operador'],
	[MATRICULA]: ['matricula'],
});

/** Sin excepciones: una excepción volvería a mostrar a la persona equivocada. */
const ORDEN_LECTURA_COLUMNA = Object.freeze({});

function claveDe(columna) {
	const clave = COLUMNAS[columna];
	if (!clave) throw new Error(`Contrato de identidad: la columna "${columna}" no tiene clave asignada`);
	return clave;
}

const MENSAJE_FALTA = {
	[OPERADOR]: 'La sesión no tiene CodOperador: no se puede registrar la acción',
	[FICHA]: 'La cuenta no está vinculada a una ficha de personal: no se puede registrar la acción',
	[MATRICULA]: 'Tu ficha de personal no tiene matrícula: no se puede registrar la acción',
};

/**
 * Identidad de la sesión para grabar. `para(columna)` devuelve la clave que esa columna
 * guarda; si la sesión no la tiene, error 400 en vez de sustituirla por otra.
 */
function firma(req) {
	const valores = {
		[OPERADOR]: resolveCodOperador(req),
		[FICHA]: resolveValorPersonal(req),
		[MATRICULA]: resolveMatricula(req),
	};
	return {
		codOperador: valores[OPERADOR],
		valorPersonal: valores[FICHA],
		matricula: valores[MATRICULA],
		para(columna) {
			const clave = claveDe(columna);
			const v = valores[clave];
			if (v == null) {
				const e = new Error(MENSAJE_FALTA[clave]);
				e.statusCode = 400;
				throw e;
			}
			return v;
		},
	};
}

function ordenDeLectura(columna) {
	return ORDEN_LECTURA_COLUMNA[columna] || ORDEN_LECTURA[claveDe(columna)];
}

/**
 * Firma para un handler HTTP: si falta la clave, responde 400 y devuelve null.
 * @returns {ReturnType<typeof firma> | null}
 */
function firmarORechazar(req, res) {
	try {
		return firma(req);
	} catch (e) {
		if (e.statusCode) {
			res.status(e.statusCode).json({ success: false, mensaje: e.message });
			return null;
		}
		throw e;
	}
}

/** OUTER APPLY con el nombre del autor de `columna`, leído con la clave del contrato. */
function sqlAutor(columna, expresion, alias) {
	return sqlApplyNombrePersona(expresion, alias, ordenDeLectura(columna));
}

module.exports = {
	OPERADOR,
	FICHA,
	MATRICULA,
	COLUMNAS,
	ORDEN_LECTURA,
	claveDe,
	firma,
	firmarORechazar,
	ordenDeLectura,
	sqlAutor,
};
