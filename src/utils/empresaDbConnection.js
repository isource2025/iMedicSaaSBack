const { decrypt } = require('./dbCrypto');

/**
 * Contraseña SQL desde fila Empresas: DbPassword (texto) tiene prioridad sobre DbPasswordEnc.
 */
function resolvePasswordFromEmpresaRow(row) {
	if (!row) return '';

	const plain = row.DbPassword ?? row.dbpassword;
	if (plain != null && String(plain).trim() !== '') {
		return String(plain).trim();
	}

	if (row.DbPasswordEnc) {
		try {
			return decrypt(row.DbPasswordEnc);
		} catch {
			const err = new Error(
				'DbPasswordEnc no se pudo descifrar. Usá columna DbPassword en texto o el mismo PLATFORM_DB_SECRET del cifrado.',
			);
			err.code = 'TENANT_DB_DECRYPT_FAILED';
			throw err;
		}
	}

	return '';
}

/** ¿La fila Empresas tiene datos suficientes para conectar sin .env? */
function empresaRowHasSqlConnection(row) {
	if (!row) return false;
	const server = String(row.DbServer || '').trim();
	const database = String(row.DbName || '').trim();
	const user = String(row.DbUser || '').trim();
	const password = resolvePasswordFromEmpresaRow(row);
	return !!(server && database && user && password);
}

module.exports = {
	resolvePasswordFromEmpresaRow,
	empresaRowHasSqlConnection,
};
