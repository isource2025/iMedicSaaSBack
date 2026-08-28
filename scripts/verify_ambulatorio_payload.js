/**
 * Ejecuta el servicio de analítica ambulatoria contra un tenant real y muestra
 * el payload que recibiría el front. Sirve para validar la clasificación
 * agenda / a demanda sin levantar el server.
 *
 * Solo lectura.
 *   node scripts/verify_ambulatorio_payload.js --empresa 1 --dias 30
 *   node scripts/verify_ambulatorio_payload.js --empresa 1 --dias 30 --sector EME
 */
require('dotenv').config();
const { runWithTenant } = require('../src/context/tenantContext');
const { fechaIsoOffsetArgentina } = require('../src/utils/dateUtils');
const svc = require('../src/services/ambulatorio.service');

function arg(n, d = null) {
	const i = process.argv.indexOf(`--${n}`);
	return i === -1 || i === process.argv.length - 1 ? d : process.argv[i + 1];
}

const DIAS = Math.max(1, Number(arg('dias', 30)) || 30);
const ID_EMPRESA = Number(arg('empresa', 1)) || 1;
const SECTOR = arg('sector', null);

(async () => {
	try {
		const data = await runWithTenant(ID_EMPRESA, () =>
			svc.obtenerAnaliticaAmbulatoria({
				fechaInicio: fechaIsoOffsetArgentina(-DIAS),
				fechaFin: fechaIsoOffsetArgentina(0),
				sector: SECTOR,
			}),
		);

		const r = data.resumen;
		console.log('\n=== PERÍODO ===');
		console.log(data.periodo, data.filtros);

		console.log('\n=== RESUMEN ===');
		console.table([
			{
				programados: r.programados,
				atendidos: r.atendidos,
				ausentes: r.ausentes,
				cancelados: r.cancelados,
				pendientes: r.pendientes,
				turnosDemanda: r.turnosDemanda,
				atendidosDemanda: r.atendidosDemanda,
				ausentismoPct: r.tasaAusentismo,
			},
		]);

		console.log('\n=== TIEMPOS (min) ===');
		console.table(
			Object.entries(r.tiempos).map(([k, v]) => ({
				metrica: k,
				muestras: v.muestras,
				promedio: v.promedio,
				p50: v.p50,
				p90: v.p90 ?? null,
			})),
		);

		console.log('\n=== CALIDAD DE DATOS ===');
		console.table([r.calidadDatos]);

		console.log('\n=== ORIGEN DE LA CONSULTA ===');
		console.table([data.porOrigen]);

		console.log('\n=== POR SECTOR (top 12) ===');
		console.table(
			data.porSector.slice(0, 12).map((s) => ({
				codigo: s.codigo,
				descripcion: s.descripcion,
				agenda: s.programados,
				conTurno: s.conTurno,
				aDemanda: s.aDemanda,
				atendidos: s.atendidos,
				ausentes: s.ausentes,
				ausentismoPct: s.tasaAusentismo,
				esperaProm: s.esperaProm,
				permanenciaProm: s.permanenciaProm,
			})),
		);

		console.log('\n=== POR ESPECIALIDAD (top 8) ===');
		console.table(
			data.porEspecialidad.slice(0, 8).map((s) => ({
				codigo: s.codigo,
				descripcion: s.descripcion,
				agenda: s.programados,
				conTurno: s.conTurno,
				aDemanda: s.aDemanda,
				ausentismoPct: s.tasaAusentismo,
				permanenciaProm: s.permanenciaProm,
			})),
		);

		console.log('\n=== POR PROFESIONAL (top 8) ===');
		console.table(
			data.porProfesional.slice(0, 8).map((s) => ({
				codigo: s.codigo,
				descripcion: s.descripcion,
				agenda: s.programados,
				conTurno: s.conTurno,
				aDemanda: s.aDemanda,
				ausentismoPct: s.tasaAusentismo,
			})),
		);

		process.exit(0);
	} catch (e) {
		console.error('Error:', e.message);
		console.error(e.stack);
		process.exit(1);
	}
})();
