const auditoria = require('./auditoria');

/** Tope de la versión de prueba. 0 = sin límite. */
const LIMITE_PRUEBA = 15;

/** Roles sin tope de prueba (admin de clínica / plataforma). */
const ROLES_EXENTOS_DEFAULT = Object.freeze(['ADMIN', 'SUPER_ADMIN']);

const memoria = new Map();
let contarMensajes = (args) => auditoria.contarMensajes(args);

function limiteActual() {
	const raw = process.env.ASISTENTE_CUOTA_MENSAJES;
	if (raw == null || String(raw).trim() === '') return LIMITE_PRUEBA;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return LIMITE_PRUEBA;
	return Math.floor(n);
}

function desdeCuota() {
	const raw = String(process.env.ASISTENTE_CUOTA_DESDE || '').trim();
	return raw || '2026-10-28';
}

function clave(idEmpresa, actor) {
	return `${Number(idEmpresa) || 0}:${actor == null || actor === '' ? 'anon' : actor}`;
}

/** Exentos: ADMIN / SUPER_ADMIN, o lista en ASISTENTE_CUOTA_EXENTOS_ROLES / ASISTENTE_CUOTA_EXENTOS (empresa:actor). */
function esExento(req) {
	const rol = String(req?.rolNombre || '')
		.trim()
		.toUpperCase();
	const rolesEnv = String(process.env.ASISTENTE_CUOTA_EXENTOS_ROLES || '')
		.split(',')
		.map((s) => s.trim().toUpperCase())
		.filter(Boolean);
	const roles = rolesEnv.length ? rolesEnv : ROLES_EXENTOS_DEFAULT;
	if (rol && roles.includes(rol)) return true;

	const actor = req?.valorPersonal;
	const emp = Number(req?.idEmpresa) || 0;
	if (actor == null || actor === '') return false;
	const lista = String(process.env.ASISTENTE_CUOTA_EXENTOS || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const yo = `${emp}:${actor}`;
	return lista.some((x) => x === yo || x === String(actor));
}

function estadoDesde(usados, limite = limiteActual()) {
	const u = Math.max(0, Number(usados) || 0);
	if (limite <= 0) {
		return { limite: 0, usados: u, restantes: null, limitada: false, prueba: false };
	}
	const restantes = Math.max(0, limite - u);
	return { limite, usados: u, restantes, limitada: restantes <= 0, prueba: true };
}

function mensajeTope(limite) {
	return `Llegaste al límite de ${limite} mensajes de la versión de prueba.`;
}

async function usadosDe(req) {
	const k = clave(req.idEmpresa, req.valorPersonal);
	const mem = memoria.get(k) || 0;
	let db = 0;
	try {
		db = await contarMensajes({
			idEmpresa: req.idEmpresa,
			actor: req.valorPersonal,
			desde: desdeCuota(),
		});
	} catch {
		db = 0;
	}
	return Math.max(mem, Number(db) || 0);
}

async function estadoDe(req) {
	if (esExento(req)) return estadoDesde(await usadosDe(req), 0);
	return estadoDesde(await usadosDe(req));
}

async function exigir(req) {
	const estado = await estadoDe(req);
	if (estado.limitada) {
		const err = new Error(mensajeTope(estado.limite));
		err.statusCode = 429;
		err.cuota = estado;
		throw err;
	}
	return estado;
}

function consumir(req) {
	const k = clave(req.idEmpresa, req.valorPersonal);
	memoria.set(k, (memoria.get(k) || 0) + 1);
}

async function exigirCuota(req, res, next) {
	try {
		req.asistenteCuota = await exigir(req);
		next();
	} catch (err) {
		const status = err.statusCode || 500;
		return res.status(status).json({
			success: false,
			mensaje: err.message || 'No se pudo validar la cuota del asistente',
			cuota: err.cuota || null,
		});
	}
}

function _reiniciarMemoria() {
	memoria.clear();
}

function _setContarMensajes(fn) {
	contarMensajes = fn || ((args) => auditoria.contarMensajes(args));
}

module.exports = {
	LIMITE_PRUEBA,
	ROLES_EXENTOS_DEFAULT,
	limiteActual,
	esExento,
	estadoDesde,
	estadoDe,
	exigir,
	exigirCuota,
	consumir,
	mensajeTope,
	_reiniciarMemoria,
	_setContarMensajes,
};
