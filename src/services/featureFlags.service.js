/**
 * Flags de funcionalidad por empresa (auth central, MySQL en Railway).
 *
 * Viven en la base central —no en variables de entorno— para que TODAS las
 * instancias del backend vean el mismo valor y una funcionalidad se pueda
 * activar clínica por clínica.
 *
 * Falla cerrado: sin tabla, sin conexión o ante cualquier error, una flag está
 * APAGADA. Una flag nunca se activa por accidente.
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');

const FLAG_ROLES_PERSONALIZADOS = 'ROLES_PERSONALIZADOS';
const CACHE_MS = 30 * 1000;

const DDL_TABLA = `
    CREATE TABLE IF NOT EXISTS \`imFeatureFlags\` (
      \`IdEmpresa\` INT NOT NULL,
      \`Flag\` VARCHAR(50) NOT NULL,
      \`Activo\` TINYINT(1) NOT NULL DEFAULT 0,
      \`FechaModificacion\` DATETIME NOT NULL,
      \`ModificadoPor\` INT NULL,
      PRIMARY KEY (\`IdEmpresa\`, \`Flag\`)
    ) ENGINE = InnoDB
  `;

const cache = new Map(); // "empresa:FLAG" -> { valor, expira }

async function consultarPool(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows;
}

const clave = (idEmpresa, flag) => `${Number(idEmpresa)}:${String(flag).toUpperCase()}`;

function normalizarFlag(flag) {
	const f = String(flag || '').trim().toUpperCase();
	if (!/^[A-Z0-9_]{3,50}$/.test(f)) throw new Error('Nombre de flag inválido');
	return f;
}

/** ¿Está activa la flag para la empresa? Nunca lanza: ante cualquier problema, false. */
async function habilitada(idEmpresa, flag) {
	const e = Number(idEmpresa);
	if (!Number.isFinite(e) || e <= 0) return false;
	if (!isAuthCentralEnabled()) return false;
	const k = clave(e, flag);
	const hit = cache.get(k);
	if (hit && hit.expira > Date.now()) return hit.valor;

	let valor = false;
	try {
		const rows = await consultarPool(
			'SELECT Activo FROM imFeatureFlags WHERE IdEmpresa = ? AND Flag = ? LIMIT 1',
			[e, String(flag).toUpperCase()],
		);
		valor = rows.length > 0 && Number(rows[0].Activo) === 1;
	} catch (err) {
		// Tabla inexistente o base caída: flag apagada.
		valor = false;
	}
	cache.set(k, { valor, expira: Date.now() + CACHE_MS });
	return valor;
}

/**
 * Activa o desactiva una flag. `consultar` permite inyectar la conexión (scripts).
 * Exige que la tabla exista: no la crea (la instala el script de esquema).
 */
async function establecer(idEmpresa, flag, activo, { actor = null, consultar = consultarPool } = {}) {
	const e = Number(idEmpresa);
	if (!Number.isInteger(e) || e <= 0) throw new Error('Empresa inválida');
	const f = normalizarFlag(flag);
	await consultar(
		`INSERT INTO imFeatureFlags (IdEmpresa, Flag, Activo, FechaModificacion, ModificadoPor)
     VALUES (?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE Activo = VALUES(Activo), FechaModificacion = NOW(), ModificadoPor = VALUES(ModificadoPor)`,
		[e, f, activo ? 1 : 0, actor],
	);
	cache.delete(clave(e, f));
}

/** Empresas con la flag activa (para reportes). */
async function empresasHabilitadas(flag, { consultar = consultarPool } = {}) {
	const rows = await consultar('SELECT IdEmpresa FROM imFeatureFlags WHERE Flag = ? AND Activo = 1 ORDER BY IdEmpresa', [
		normalizarFlag(flag),
	]);
	return rows.map((r) => Number(r.IdEmpresa));
}

/** Sólo para tests. */
function _reiniciarCache() {
	cache.clear();
}

module.exports = {
	FLAG_ROLES_PERSONALIZADOS,
	DDL_TABLA,
	habilitada,
	establecer,
	empresasHabilitadas,
	_reiniciarCache,
};
