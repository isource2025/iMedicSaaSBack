const { decryptTrySecrets } = require('./dbCrypto');

function pickField(row, ...names) {
	if (!row) return undefined;
	const map = {};
	for (const [k, v] of Object.entries(row)) {
		map[String(k).toLowerCase()] = v;
	}
	for (const name of names) {
		const v = map[String(name).toLowerCase()];
		if (v != null && v !== '') return v;
	}
	return undefined;
}

/** Normaliza claves de fila Empresas (MySQL / SQL Server). */
function normalizeEmpresaRow(row) {
	if (!row) return null;
	return {
		IDEMPRESA: pickField(row, 'IDEMPRESA', 'idEmpresa', 'IdEmpresa'),
		DESCRIPCION: pickField(row, 'DESCRIPCION', 'descripcion'),
		DbServer: pickField(row, 'DbServer', 'dbserver'),
		DbPort: pickField(row, 'DbPort', 'dbport'),
		DbInstance: pickField(row, 'DbInstance', 'dbinstance'),
		DbName: pickField(row, 'DbName', 'dbname'),
		DbUser: pickField(row, 'DbUser', 'dbuser'),
		DbPassword: pickField(row, 'DbPassword', 'dbpassword'),
		DbPasswordEnc: pickField(row, 'DbPasswordEnc', 'dbpasswordenc'),
	};
}

/**
 * Contraseña SQL desde fila Empresas: DbPasswordEnc (cifrado) es la fuente principal.
 */
function resolvePasswordFromEmpresaRow(row) {
	if (!row) return '';

	const enc = pickField(row, 'DbPasswordEnc', 'dbpasswordenc');
	if (enc) {
		try {
			return decryptTrySecrets(enc, 'DbPasswordEnc/tenant');
		} catch (err) {
			const e = new Error(
				'DbPasswordEnc no se pudo descifrar. En Railway configurá PLATFORM_DB_SECRET con el mismo valor usado al cifrar (scripts/setup_empresa_conexion.js o Super Admin).',
			);
			e.code = 'TENANT_DB_DECRYPT_FAILED';
			throw e;
		}
	}

	const plain = pickField(row, 'DbPassword', 'dbpassword');
	if (plain != null && String(plain).trim() !== '') {
		return String(plain).trim();
	}

	return '';
}

/** ¿La fila Empresas tiene datos suficientes para conectar sin .env? */
function empresaRowHasSqlConnection(row) {
	const n = normalizeEmpresaRow(row);
	if (!n) return false;
	const server = String(n.DbServer || '').trim();
	const database = String(n.DbName || '').trim();
	const user = String(n.DbUser || '').trim();
	const password = resolvePasswordFromEmpresaRow(n);
	return !!(server && database && user && password);
}

module.exports = {
	pickField,
	normalizeEmpresaRow,
	resolvePasswordFromEmpresaRow,
	empresaRowHasSqlConnection,
};
