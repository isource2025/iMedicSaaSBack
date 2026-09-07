/**
 * Trazabilidad de quién canceló un turno (usuario interno, paciente/portal, bot).
 * Columnas SaaS: imTurnos.OperadorCancelacion, imTurnos.OrigenCancelacion.
 * MotivoCancelacion (varchar 80) también puede traer prefijos legacy: [PACIENTE] [BOT-WA] [USUARIO].
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');

const ORIGEN_USUARIO = 'USUARIO';
const ORIGEN_PACIENTE = 'PACIENTE';
const ORIGEN_BOT = 'BOT';

const _tieneColsPorTenant = new Map();
const _tieneLogPorTenant = new Map();

function _nombreDesdeJoin(row) {
	const n = `${row?.CanceladoPorApellido || row?.OpCanApellido || ''} ${
		row?.CanceladoPorNombres || row?.OpCanNombres || ''
	}`.trim();
	if (n) return n;
	const packed = String(row?.CanceladoPorNombre || '').trim();
	return packed || null;
}

function _motivoTexto(raw) {
	if (raw == null) return '';
	return String(raw).trim();
}

/**
 * @param {object} turno fila SQL (Status, MotivoCancelacion, OrigenCancelacion, OperadorCancelacion, nombres join)
 * @returns {{ origenCancelacion: string|null, canceladoPor: string|null, motivoCancelacion: string|null }}
 */
function resolverCancelacion(turno) {
	const st = turno?.Status != null ? Number(turno.Status) : null;
	const mot = _motivoTexto(turno?.MotivoCancelacion);
	let origen = String(turno?.OrigenCancelacion || '')
		.trim()
		.toUpperCase();
	if (origen !== ORIGEN_USUARIO && origen !== ORIGEN_PACIENTE && origen !== ORIGEN_BOT) {
		origen = '';
	}
	const nombreOp = _nombreDesdeJoin(turno);
	const opCod = Number(turno?.OperadorCancelacion) || 0;

	if (!origen) {
		if (/^\[PACIENTE\]/i.test(mot) || /portal/i.test(mot)) origen = ORIGEN_PACIENTE;
		else if (/^\[BOT-WA\]/i.test(mot)) origen = ORIGEN_BOT;
		else if (/^\[USUARIO\]/i.test(mot) || opCod > 0 || nombreOp) origen = ORIGEN_USUARIO;
	}

	let canceladoPor = null;
	let motivo = mot
		.replace(/^\[PACIENTE\]\s*/i, '')
		.replace(/^\[BOT-WA\]\s*/i, '')
		.replace(/^\[USUARIO\]\s*/i, '')
		.trim();

	if (origen === ORIGEN_PACIENTE) {
		canceladoPor = motivo
			? `Paciente (portal) · ${motivo}`
			: 'Paciente (portal)';
		// El nombre del paciente ya va en canceladoPor; no lo repetimos como "motivo".
		motivo = null;
	} else if (origen === ORIGEN_BOT) {
		canceladoPor = 'Paciente (WhatsApp)';
		if (!motivo) motivo = 'Cancelado vía WhatsApp';
	} else if (origen === ORIGEN_USUARIO) {
		canceladoPor = nombreOp || 'Usuario del sistema';
	}

	if (st !== 1) {
		return {
			origenCancelacion: null,
			canceladoPor: null,
			motivoCancelacion: mot || null,
		};
	}

	return {
		origenCancelacion: origen || null,
		canceladoPor,
		motivoCancelacion: motivo || null,
	};
}

function motivoParaPersistir(origen, motivo) {
	const rest = _motivoTexto(motivo).slice(0, 70);
	if (origen === ORIGEN_PACIENTE) {
		return rest ? `[PACIENTE] ${rest}`.slice(0, 80) : '[PACIENTE]';
	}
	if (origen === ORIGEN_BOT) {
		return rest ? `[BOT-WA] ${rest}`.slice(0, 80) : '[BOT-WA]';
	}
	if (origen === ORIGEN_USUARIO) {
		return rest ? rest.slice(0, 80) : null;
	}
	return rest ? rest.slice(0, 80) : null;
}

function normalizarOrigen(origen, { codOperador, motivo } = {}) {
	const o = String(origen || '')
		.trim()
		.toUpperCase();
	if (o === ORIGEN_PACIENTE || o === ORIGEN_BOT || o === ORIGEN_USUARIO) return o;
	const mot = _motivoTexto(motivo);
	if (/^\[PACIENTE\]/i.test(mot) || /portal/i.test(mot)) return ORIGEN_PACIENTE;
	if (/^\[BOT-WA\]/i.test(mot)) return ORIGEN_BOT;
	if (Number(codOperador) > 0) return ORIGEN_USUARIO;
	return ORIGEN_USUARIO;
}

async function ensureColumnasCancelacion() {
	const key = getTenantId() ?? 'plataforma';
	if (_tieneColsPorTenant.has(key)) return _tieneColsPorTenant.get(key);
	const probe = (async () => {
		try {
			await executeQuery(`
				IF COL_LENGTH('dbo.imTurnos', 'OperadorCancelacion') IS NULL
					ALTER TABLE dbo.imTurnos ADD OperadorCancelacion INT NULL;
			`);
			await executeQuery(`
				IF COL_LENGTH('dbo.imTurnos', 'OrigenCancelacion') IS NULL
					ALTER TABLE dbo.imTurnos ADD OrigenCancelacion VARCHAR(12) NULL;
			`);
			return true;
		} catch (e) {
			try {
				const rows = await executeQuery(`
					SELECT CASE WHEN COL_LENGTH('dbo.imTurnos', 'OperadorCancelacion') IS NULL THEN 0 ELSE 1 END AS ok
				`);
				return Number(rows?.[0]?.ok) === 1;
			} catch {
				return false;
			}
		}
	})();
	_tieneColsPorTenant.set(key, probe);
	return probe;
}

async function tieneTurnosLog() {
	const key = getTenantId() ?? 'plataforma';
	if (_tieneLogPorTenant.has(key)) return _tieneLogPorTenant.get(key);
	const probe = executeQuery(
		`SELECT CASE WHEN OBJECT_ID('dbo.imTurnosLog', 'U') IS NULL THEN 0 ELSE 1 END AS Existe`,
	)
		.then((rows) => Number(rows?.[0]?.Existe) === 1)
		.catch(() => false);
	_tieneLogPorTenant.set(key, probe);
	return probe;
}

const SQL_CANCELACION_COLS = `
		        t.OperadorCancelacion, t.OrigenCancelacion,
		        opCan.Apellido AS OpCanApellido, opCan.Nombres AS OpCanNombres`;

const SQL_CANCELACION_JOIN = `
		 LEFT JOIN dbo.imPassword opCan
		   ON t.OperadorCancelacion IS NOT NULL AND t.OperadorCancelacion > 0
		  AND (opCan.CodOperador = t.OperadorCancelacion OR opCan.ValorPersonal = t.OperadorCancelacion)`;

const SQL_CANCELACION_COLS_NULL = `
		        CAST(NULL AS INT) AS OperadorCancelacion,
		        CAST(NULL AS VARCHAR(12)) AS OrigenCancelacion,
		        CAST(NULL AS VARCHAR(80)) AS OpCanApellido,
		        CAST(NULL AS VARCHAR(80)) AS OpCanNombres`;

module.exports = {
	ORIGEN_USUARIO,
	ORIGEN_PACIENTE,
	ORIGEN_BOT,
	resolverCancelacion,
	motivoParaPersistir,
	normalizarOrigen,
	ensureColumnasCancelacion,
	tieneTurnosLog,
	SQL_CANCELACION_COLS,
	SQL_CANCELACION_JOIN,
	SQL_CANCELACION_COLS_NULL,
};
