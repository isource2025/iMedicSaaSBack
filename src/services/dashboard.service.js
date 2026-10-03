/**
 * Agregado del panel de inicio: una sola request devuelve todo lo que la
 * página /dashboard pedía en ~10 llamadas separadas (cada una con su propio
 * viaje browser→API, auth, permisos y tenant).
 *
 * Cada sección se resuelve en paralelo y se devuelve como
 *   { ok: true, data } | { ok: false, error }
 * para que un fallo puntual (p. ej. agenda ambulatoria) no tire el resto.
 *
 * Las secciones se filtran por permiso del usuario (mismos códigos que las
 * rutas individuales) para no filtrar datos que el usuario no podría ver.
 */
const bedsService = require('./beds.service');
const indicadoresService = require('./indicadores.service');
const visitaMovimientosService = require('./visitaMovimientos.service');
const ambulatorioService = require('./ambulatorio.service');
const permisosService = require('./permisos.service');

/** Permisos por sección (espejo de indicadores.routes / beds.routes / visitaMovimientos.routes). */
const PERMISO_SECCION = {
	camasTotal: 'INTERNACION.CAMAS.VER',
	camasEstado: 'INTERNACION.CAMAS.VER',
	camasAnalitica: 'INTERNACION.CAMAS.VER',
	pacientesHoy: 'DASHBOARD.INICIO.VER',
	ambulatorioHoy: 'DASHBOARD.INICIO.VER',
	actividad: 'INTERNACION.MOVIMIENTOS.VER',
	pacientes: 'ADMISION.PACIENTES.VER',
};

function fechaIso(d) {
	return d.toISOString().slice(0, 10);
}

/** Rango por defecto: últimos 30 días (igual que el dashboard del front). */
function rangoPorDefecto() {
	const fin = new Date();
	const inicio = new Date(fin.getTime() - 30 * 24 * 60 * 60 * 1000);
	return { fechaInicio: fechaIso(inicio), fechaFin: fechaIso(fin) };
}

async function seccion(fn) {
	try {
		return { ok: true, data: await fn() };
	} catch (e) {
		return { ok: false, error: e?.message || 'Error' };
	}
}

/**
 * @param {object} opts
 * @param {string[]} opts.permisos       permisos del usuario (req.permisos)
 * @param {string}   [opts.fechaInicio]  YYYY-MM-DD
 * @param {string}   [opts.fechaFin]     YYYY-MM-DD
 * @param {number}   [opts.limiteActividad=10]
 * @param {number|string} [opts.graciaMin]
 * @param {string[]} [opts.incluir]      subconjunto de secciones; por defecto todas
 */
async function obtenerResumenDashboard(opts = {}) {
	const permisos = Array.isArray(opts.permisos) ? opts.permisos : [];
	const puede = (sec) => permisosService.tienePermiso(permisos, PERMISO_SECCION[sec]);
	const rango = rangoPorDefecto();
	const fechaInicio = opts.fechaInicio || rango.fechaInicio;
	const fechaFin = opts.fechaFin || rango.fechaFin;
	const limiteActividad = Math.min(50, Math.max(1, Number(opts.limiteActividad) || 10));
	const incluir = new Set(
		Array.isArray(opts.incluir) && opts.incluir.length ? opts.incluir : Object.keys(PERMISO_SECCION),
	);

	const tareas = {};
	const omitidas = [];

	const programar = (nombre, fn) => {
		if (!incluir.has(nombre)) return;
		if (!puede(nombre)) {
			omitidas.push(nombre);
			return;
		}
		tareas[nombre] = seccion(fn);
	};

	programar('camasTotal', () => bedsService.obtenerTotalCamas());
	programar('pacientesHoy', () => indicadoresService.obtenerResumenPacientesHoy());
	programar('ambulatorioHoy', () => ambulatorioService.obtenerResumenAmbulatorioHoy(opts.graciaMin));
	programar('actividad', () => visitaMovimientosService.obtenerMovimientosRecientes(limiteActividad));

	// Camas: estado actual (barato) separado de la analítica de 30 días (2 queries pesadas),
	// así el panel de inicio puede pedir sólo lo que muestra.
	programar('camasEstado', () => indicadoresService.obtenerEstadoActualCamas());
	programar('camasAnalitica', async () => {
		const [resumen, porFecha] = await Promise.all([
			indicadoresService.obtenerResumenOcupacionCamas(fechaInicio, fechaFin),
			indicadoresService.obtenerOcupacionCamasPorFecha(fechaInicio, fechaFin),
		]);
		return { resumen, porFecha };
	});

	// Pacientes (ingresos): una sola query; resumen y serie se derivan en memoria.
	programar('pacientes', async () => {
		const indicadores = await indicadoresService.obtenerIndicadores('Ingresos', fechaInicio, fechaFin);
		return {
			indicadores,
			resumen: indicadoresService.resumenDesdeFilas(indicadores, fechaInicio, fechaFin),
			porFecha: indicadoresService.porFechaDesdeFilas(indicadores),
		};
	});

	const nombres = Object.keys(tareas);
	const resultados = await Promise.all(nombres.map((n) => tareas[n]));
	const secciones = {};
	nombres.forEach((n, i) => {
		secciones[n] = resultados[i];
	});

	return {
		periodo: { fechaInicio, fechaFin },
		omitidas,
		secciones,
		generadoEn: new Date().toISOString(),
	};
}

module.exports = { obtenerResumenDashboard, PERMISO_SECCION };
