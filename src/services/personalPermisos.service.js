/**
 * Overrides de permisos por persona (auth central / MySQL).
 *
 * Efectivos = (unión de plantillas de roles ∪ GRANT) − DENY.
 * La tabla se crea al primer uso (CREATE IF NOT EXISTS). Si no hay auth
 * central o falla la lectura, se comporta como “sin overrides” (los roles
 * siguen funcionando).
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');
const { esPermisoRestringido } = require('../utils/permisosDescripciones');
const matriz = require('../utils/permisos');
const v = require('../utils/rolesValidacion');

const CACHE_TTL_MS = 15 * 1000;
const EFECTOS = new Set(['GRANT', 'DENY']);

const DDL = `
  CREATE TABLE IF NOT EXISTS \`imPersonalPermisosOverride\` (
    \`IdEmpresa\` INT NOT NULL,
    \`Valor\` INT NOT NULL,
    \`Codigo\` VARCHAR(120) NOT NULL,
    \`Efecto\` ENUM('GRANT','DENY') NOT NULL,
    \`FechaModificacion\` DATETIME NOT NULL,
    \`ModificadoPor\` INT NULL,
    PRIMARY KEY (\`IdEmpresa\`, \`Valor\`, \`Codigo\`),
    KEY \`IX_imPersonalPermisosOverride_Personal\` (\`IdEmpresa\`, \`Valor\`)
  ) ENGINE = InnoDB
`;

const cache = new Map(); // "emp|vp" -> { grants, denies, expira }
let tablaLista = false;

function error(statusCode, mensaje) {
	const e = new Error(mensaje);
	e.statusCode = statusCode;
	return e;
}

function clave(idEmpresa, valor) {
	return `${Number(idEmpresa)}|${Number(valor)}`;
}

function invalidar(idEmpresa, valor) {
	if (idEmpresa == null) {
		cache.clear();
		return;
	}
	if (valor == null) {
		const pref = `${Number(idEmpresa)}|`;
		for (const k of cache.keys()) if (k.startsWith(pref)) cache.delete(k);
		return;
	}
	cache.delete(clave(idEmpresa, valor));
}

async function consultar(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

async function asegurarTabla() {
	if (tablaLista || !isAuthCentralEnabled()) return tablaLista;
	try {
		await consultar(DDL);
		tablaLista = true;
	} catch (e) {
		console.warn('[personalPermisos] no se pudo asegurar la tabla:', e.message);
		tablaLista = false;
	}
	return tablaLista;
}

const codigosValidos = () => new Set(matriz.todosLosCodigos().map((c) => c.codigo));

/**
 * Lee grants/denies. Nunca lanza hacia arriba por tabla ausente: {} vacío.
 * @returns {Promise<{ grants: string[], denies: string[] }>}
 */
async function listarOverrides(idEmpresa, valorPersonal) {
	const vacio = { grants: [], denies: [] };
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	if (!isAuthCentralEnabled() || !Number.isFinite(emp) || emp <= 0 || !Number.isFinite(vp)) {
		return vacio;
	}

	const k = clave(emp, vp);
	const hit = cache.get(k);
	if (hit && hit.expira > Date.now()) {
		return { grants: [...hit.grants], denies: [...hit.denies] };
	}

	if (!(await asegurarTabla())) return vacio;

	let rows;
	try {
		rows = await consultar(
			`SELECT Codigo AS codigo, Efecto AS efecto
       FROM imPersonalPermisosOverride
       WHERE IdEmpresa = ? AND Valor = ?`,
			[emp, vp],
		);
	} catch (e) {
		console.warn('[personalPermisos] listar:', e.message);
		return vacio;
	}

	const validos = codigosValidos();
	const grants = [];
	const denies = [];
	for (const r of rows) {
		const c = String(r.codigo || '');
		const efecto = String(r.efecto || '').toUpperCase();
		if (!validos.has(c) || esPermisoRestringido(c) || !EFECTOS.has(efecto)) continue;
		if (efecto === 'GRANT') grants.push(c);
		else denies.push(c);
	}

	cache.set(k, { grants, denies, expira: Date.now() + CACHE_TTL_MS });
	return { grants: [...grants], denies: [...denies] };
}

/** Aplica grants/denies sobre un Set o array de códigos base. */
function aplicar(base, grants, denies) {
	const out = new Set(Array.isArray(base) ? base : [...(base || [])]);
	for (const c of grants || []) out.add(c);
	for (const c of denies || []) out.delete(c);
	return [...out];
}

/**
 * Diff: qué guardar para que aplicar(base, grants, denies) === efectivos.
 * Ignora códigos inválidos/restringidos.
 */
function diff(base, efectivos) {
	const validos = codigosValidos();
	const baseSet = new Set(
		(base || []).filter((c) => validos.has(c) && !esPermisoRestringido(c)),
	);
	const effSet = new Set(
		(efectivos || []).filter((c) => validos.has(String(c)) && !esPermisoRestringido(String(c))),
	);
	const grants = [...effSet].filter((c) => !baseSet.has(c)).sort();
	const denies = [...baseSet].filter((c) => !effSet.has(c)).sort();
	return { grants, denies };
}

/**
 * Valida grant/deny del actor. Los denies sobre la base propia no requieren
 * “tener” el permiso (es quitarle al otro); los grants sí.
 */
function validarEscritura({ grants, denies, permisosActor, base }) {
	const errores = [];
	const validos = codigosValidos();
	const actor = permisosActor ? new Set(permisosActor) : null;
	const baseSet = new Set(base || []);

	for (const c of grants || []) {
		if (!validos.has(c)) errores.push(`Permiso desconocido: ${c}`);
		else if (esPermisoRestringido(c)) errores.push(`El permiso ${c} no se puede otorgar individualmente`);
		else if (actor && !actor.has(c)) errores.push(`No podés otorgar el permiso ${c} porque no lo tenés`);
	}
	for (const c of denies || []) {
		if (!validos.has(c)) errores.push(`Permiso desconocido: ${c}`);
		else if (esPermisoRestringido(c)) errores.push(`El permiso ${c} no se puede denegar individualmente`);
		else if (!baseSet.has(c)) {
			// deny de algo que no está en la base: se ignora al persistir
		} else if (actor && !actor.has(c)) {
			// Quitar un permiso al otro exige haberlo tenido (evitar quitar cosas que no entendés)
			errores.push(`No podés quitar el permiso ${c} porque no lo tenés`);
		}
	}
	return { ok: errores.length === 0, errores };
}

/**
 * Reemplaza overrides de una persona por el diff base↔efectivos.
 * @param {object} p
 * @param {number} p.idEmpresa
 * @param {number} p.valorPersonal
 * @param {string[]} p.base permisos de la unión de roles (sin overrides)
 * @param {string[]} p.efectivos permiso deseado
 * @param {{ valorPersonal?: number, permisos?: string[] }} p.actor
 */
async function guardarDesdeEfectivos({ idEmpresa, valorPersonal, base, efectivos, actor }) {
	const emp = Number(idEmpresa);
	const vp = Number(valorPersonal);
	if (!isAuthCentralEnabled()) throw error(409, 'Los overrides de permisos requieren autenticación central');
	if (!Number.isFinite(emp) || emp <= 0) throw error(400, 'Empresa inválida');
	if (!Number.isFinite(vp) || vp <= 0) throw error(400, 'Personal inválido');
	if (!(await asegurarTabla())) throw error(503, 'No se pudo preparar la tabla de overrides');

	const { grants, denies } = diff(base, efectivos);
	const check = validarEscritura({
		grants,
		denies,
		permisosActor: actor?.permisos,
		base,
	});
	if (!check.ok) throw error(400, check.errores.join('. '));

	const pool = await getAuthCentralPool();
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		await conn.query(`DELETE FROM imPersonalPermisosOverride WHERE IdEmpresa = ? AND Valor = ?`, [
			emp,
			vp,
		]);
		const filas = [
			...grants.map((c) => [emp, vp, c, 'GRANT', actor?.valorPersonal ?? null]),
			...denies.map((c) => [emp, vp, c, 'DENY', actor?.valorPersonal ?? null]),
		];
		if (filas.length) {
			await conn.query(
				`INSERT INTO imPersonalPermisosOverride
           (IdEmpresa, Valor, Codigo, Efecto, FechaModificacion, ModificadoPor)
         VALUES ?`,
				[filas.map((f) => [f[0], f[1], f[2], f[3], new Date(), f[4]])],
			);
		}
		await conn.commit();
	} catch (e) {
		try {
			await conn.rollback();
		} catch (_) {
			/* ya cerrada */
		}
		throw e;
	} finally {
		conn.release();
	}

	invalidar(emp, vp);
	return { grants, denies, efectivos: aplicar(base, grants, denies) };
}

/** Sólo para tests. */
function _reiniciar() {
	cache.clear();
	tablaLista = false;
}

module.exports = {
	DDL,
	listarOverrides,
	aplicar,
	diff,
	validarEscritura,
	guardarDesdeEfectivos,
	asegurarTabla,
	invalidar,
	_reiniciar,
	// expuesto para tests de validación sin tocar BD
	_codigosValidos: codigosValidos,
	ID_ROL_PERSONALIZADO_MIN: v.ID_ROL_PERSONALIZADO_MIN,
};
