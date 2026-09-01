/**
 * Publica quién está guardando para el trigger de auditoría de dbo.imHCI
 * (TR_imHCI_Auditoria, ver scripts/sql/auditoria_hci.sql).
 *
 * El trigger no puede saber el usuario de la app: todas las conexiones entran
 * con el mismo login SQL. Se lo pasamos por CONTEXT_INFO, que es por conexión,
 * así que el SET tiene que ir en el MISMO batch que el INSERT/UPDATE/DELETE:
 * el pool no garantiza la misma conexión entre dos queries.
 *
 * Formato posicional fijo (el trigger lo lee con SUBSTRING, sin TRY_CONVERT
 * porque las BD están en nivel de compatibilidad 100):
 *   'WEB:' + CodOperador(8, alineado a izquierda) + ':' + usuario + '|'
 *
 * El '|' del final no es decorativo: SQL Server devuelve CONTEXT_INFO relleno
 * con CHAR(0) hasta 128 bytes y en colación Modern_Spanish_CI_AS el CHAR(0) es
 * ignorable, así que ni REPLACE ni CHARINDEX pueden recortarlo. El terminador
 * es la única forma de saber dónde termina el nombre.
 */
const PREFIJO = 'WEB:';
const TERMINADOR = '|';
const LARGO_COD = 8;
const LARGO_USUARIO = 114;

/** Objetos que crea scripts/sql/auditoria_hci.sql. */
const TABLA_AUDITORIA = 'imHCIAuditoria';
const TRIGGER_AUDITORIA = 'TR_imHCI_Auditoria';

function etiquetaUsuario(auth) {
	const u = auth?.usuario || {};
	const nombre = [u.apellido, u.nombre].filter(Boolean).join(' ').trim();
	const username = String(u.username || '').trim();
	const etiqueta = username && nombre ? `${username} (${nombre})` : username || nombre;
	// El terminador no puede aparecer en el medio del nombre.
	return (etiqueta || 'desconocido').split(TERMINADOR).join(' ');
}

function descriptorAuditoria(auth, codOperador) {
	const cod = Number(codOperador);
	const codTexto = Number.isFinite(cod) && cod > 0 ? String(Math.trunc(cod)) : '';
	return (
		PREFIJO +
		codTexto.slice(0, LARGO_COD).padEnd(LARGO_COD, ' ') +
		':' +
		etiquetaUsuario(auth).slice(0, LARGO_USUARIO) +
		TERMINADOR
	);
}

/**
 * Devuelve el SQL con el CONTEXT_INFO adelante y agrega su parámetro al final
 * del array (no corre los índices de los parámetros ya armados).
 *
 * @param {string} sqlDml sentencia sobre dbo.imHCI
 * @param {Array} params parámetros de executeQuery, se muta agregando uno
 * @param {Object|null} auth req.auth
 * @param {number|null} codOperador imPassword.CodOperador del autor
 */
function conContextoAuditoria(sqlDml, params, auth, codOperador) {
	const indice = params.length;
	params.push({
		value: descriptorAuditoria(auth, codOperador),
		type: 'VarChar',
		length: 128,
	});
	return `DECLARE @ctxAuditoria VARBINARY(128) = CONVERT(VARBINARY(128), @param${indice});
SET CONTEXT_INFO @ctxAuditoria;
${sqlDml}`;
}

module.exports = {
	conContextoAuditoria,
	descriptorAuditoria,
	TABLA_AUDITORIA,
	TRIGGER_AUDITORIA,
};
