/**
 * Auditoría general del sistema (auth central, MySQL en Railway).
 *
 * UNA sola tabla para TODO el historial de cambios: `imAuditoria`.
 * Cada módulo se distingue con banderas, no con tablas propias:
 *   - Modulo    : área funcional         (ROLES, INTERNACION, ADMISION, ...)
 *   - Entidad   : qué se modificó         (ROL, PERSONAL, CAMA, ...)
 *   - IdEntidad : cuál (id como texto)
 *   - Accion    : qué pasó                (CREAR, EDITAR, ELIMINAR, ...)
 *   - Actor     : quién lo hizo (Valor de imPersonal)
 *   - Detalle   : JSON con el antes/después
 *
 * Para auditar un módulo nuevo alcanza con llamar a `registrar` con su `modulo`;
 * no hay que crear tablas ni migraciones.
 *
 * El esquema es aditivo e idempotente y se crea bajo demanda (`asegurarEsquema`).
 */
const { getAuthCentralPool, isAuthCentralEnabled } = require('../config/authCentralDb');

const REVISAR_CADA_MS = 60 * 1000;
const LIMITE_MAXIMO = 500;

let listo = false;
let ultimoChequeo = 0;
let enCurso = null;

async function consultar(sql, params = []) {
	const pool = await getAuthCentralPool();
	const [rows] = await pool.query(sql, params);
	return rows || [];
}

// ─── Esquema ────────────────────────────────────────────────────────────────

/** ¿Existe la tabla? Sólo lee information_schema. Reconsulta como máximo 1 vez por minuto. */
async function esquemaListo() {
	if (!isAuthCentralEnabled()) return false;
	if (listo) return true;
	const ahora = Date.now();
	if (ultimoChequeo && ahora - ultimoChequeo < REVISAR_CADA_MS) return false;
	ultimoChequeo = ahora;
	try {
		const rows = await consultar(
			`SELECT 1 AS ok FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imAuditoria' LIMIT 1`,
		);
		listo = rows.length > 0;
	} catch (e) {
		console.warn('[auditoria] no se pudo verificar el esquema:', e.message);
		listo = false;
	}
	return listo;
}

async function crearTabla() {
	await consultar(`
    CREATE TABLE IF NOT EXISTS \`imAuditoria\` (
      \`IdAuditoria\` BIGINT NOT NULL AUTO_INCREMENT,
      \`IdEmpresa\` INT NOT NULL,
      \`Modulo\` VARCHAR(30) NOT NULL,
      \`Entidad\` VARCHAR(40) NOT NULL,
      \`IdEntidad\` VARCHAR(64) NULL,
      \`Accion\` VARCHAR(30) NOT NULL,
      \`Actor\` INT NULL,
      \`Fecha\` DATETIME NOT NULL,
      \`Ip\` VARCHAR(45) NULL,
      \`Detalle\` MEDIUMTEXT NULL,
      PRIMARY KEY (\`IdAuditoria\`),
      KEY \`IX_imAuditoria_Entidad\` (\`IdEmpresa\`, \`Modulo\`, \`Entidad\`, \`IdEntidad\`, \`Fecha\`),
      KEY \`IX_imAuditoria_Fecha\` (\`IdEmpresa\`, \`Fecha\`),
      KEY \`IX_imAuditoria_Actor\` (\`IdEmpresa\`, \`Actor\`, \`Fecha\`)
    ) ENGINE = InnoDB
  `);
}

/** Crea la tabla si falta. Seguro de llamar varias veces y en paralelo. */
async function asegurarEsquema() {
	if (!isAuthCentralEnabled()) {
		const e = new Error('La auditoría requiere la autenticación central');
		e.statusCode = 409;
		throw e;
	}
	if (listo) return true;
	if (!enCurso) {
		enCurso = crearTabla()
			.then(() => {
				listo = true;
				return true;
			})
			.finally(() => {
				enCurso = null;
			});
	}
	return enCurso;
}

// ─── Escritura ──────────────────────────────────────────────────────────────

function texto(v, max) {
	return String(v ?? '').trim().toUpperCase().slice(0, max);
}

/**
 * Registra un evento. Con `conn` (transacción abierta) el evento forma parte de
 * la transacción: si la auditoría falla, el cambio se revierte.
 *
 * @param {object|null} conn conexión mysql2 con transacción, o null
 * @param {object} e
 * @param {number} e.idEmpresa
 * @param {string} e.modulo
 * @param {string} e.entidad
 * @param {string|number} [e.idEntidad]
 * @param {string} e.accion
 * @param {number|null} [e.actor]
 * @param {object|null} [e.detalle]
 * @param {string|null} [e.ip]
 */
async function registrar(conn, { idEmpresa, modulo, entidad, idEntidad, accion, actor, detalle, ip }) {
	const m = texto(modulo, 30);
	const en = texto(entidad, 40);
	const a = texto(accion, 30);
	if (!m || !en || !a) throw new Error('Auditoría: módulo, entidad y acción son obligatorios');
	if (!Number.isFinite(Number(idEmpresa)) || Number(idEmpresa) < 0) {
		throw new Error('Auditoría: empresa inválida');
	}
	const sql = `INSERT INTO imAuditoria (IdEmpresa, Modulo, Entidad, IdEntidad, Accion, Actor, Fecha, Ip, Detalle)
               VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?)`;
	const params = [
		Number(idEmpresa),
		m,
		en,
		idEntidad == null ? null : String(idEntidad).slice(0, 64),
		a,
		actor == null || !Number.isFinite(Number(actor)) ? null : Number(actor),
		ip ? String(ip).slice(0, 45) : null,
		detalle == null ? null : JSON.stringify(detalle),
	];
	if (conn) await conn.query(sql, params);
	else await consultar(sql, params);
}

/**
 * Igual que `registrar`, pero NUNCA lanza: para hechos que no deben fallar por
 * la auditoría (o si todavía no existe la tabla). Devuelve true si se registró.
 */
async function registrarSeguro(evento) {
	try {
		if (!(await esquemaListo())) return false;
		await registrar(null, evento);
		return true;
	} catch (e) {
		console.warn('[auditoria] no se pudo registrar:', e.message);
		return false;
	}
}

// ─── Lectura ────────────────────────────────────────────────────────────────

/**
 * Historial filtrable. Siempre acotado a una empresa.
 * @returns {Promise<Array<{id,modulo,entidad,idEntidad,accion,actor,actorNombre,fecha,ip,detalle}>>}
 */
async function listar({ idEmpresa, modulo, entidad, idEntidad, actor, limite = 100 }) {
	if (!(await esquemaListo())) return [];
	const where = ['a.IdEmpresa = ?'];
	const params = [Number(idEmpresa)];
	if (modulo) {
		where.push('a.Modulo = ?');
		params.push(texto(modulo, 30));
	}
	if (entidad) {
		where.push('a.Entidad = ?');
		params.push(texto(entidad, 40));
	}
	if (idEntidad != null && idEntidad !== '') {
		where.push('a.IdEntidad = ?');
		params.push(String(idEntidad));
	}
	if (actor != null && actor !== '') {
		where.push('a.Actor = ?');
		params.push(Number(actor));
	}
	params.push(Math.min(Math.max(Number(limite) || 100, 1), LIMITE_MAXIMO));

	const rows = await consultar(
		`SELECT a.IdAuditoria AS id, a.Modulo AS modulo, a.Entidad AS entidad, a.IdEntidad AS idEntidad,
            a.Accion AS accion, a.Actor AS actor, a.Fecha AS fecha, a.Ip AS ip, a.Detalle AS detalle,
            p.ApellidoNombre AS actorNombre
     FROM imAuditoria a
     LEFT JOIN imPersonal p ON p.IdEmpresa = a.IdEmpresa AND p.Valor = a.Actor
     WHERE ${where.join(' AND ')}
     ORDER BY a.Fecha DESC, a.IdAuditoria DESC
     LIMIT ?`,
		params,
	);
	return rows.map((r) => {
		let detalle = null;
		try {
			detalle = r.detalle ? JSON.parse(r.detalle) : null;
		} catch (_) {
			detalle = null;
		}
		return {
			id: Number(r.id),
			modulo: r.modulo,
			entidad: r.entidad,
			idEntidad: r.idEntidad,
			accion: r.accion,
			actor: r.actor == null ? null : Number(r.actor),
			actorNombre: String(r.actorNombre || '').trim(),
			fecha: r.fecha,
			ip: r.ip || null,
			detalle,
		};
	});
}

/** Sólo para tests. */
function _reiniciarCache() {
	listo = false;
	ultimoChequeo = 0;
	enCurso = null;
}

module.exports = { esquemaListo, asegurarEsquema, registrar, registrarSeguro, listar, _reiniciarCache };
