/**
 * ¿Qué señal distingue un turno programado de una atención a demanda?
 * Candidatos: TipoTurno, HoraAsignada == Horallegada, FechaCarga == FechaAsignada.
 *
 * Solo lectura.
 *   node scripts/diag_tipoturno.js --empresa 1 --dias 30
 */
require('dotenv').config();
const db = require('../src/models/db');
const { runWithTenant } = require('../src/context/tenantContext');
const { convertirFechaAClarion, fechaIsoOffsetArgentina } = require('../src/utils/dateUtils');

function arg(n, d = null) {
	const i = process.argv.indexOf(`--${n}`);
	return i === -1 || i === process.argv.length - 1 ? d : process.argv[i + 1];
}

const DIAS = Math.max(1, Number(arg('dias', 30)) || 30);
const ID_EMPRESA = Number(arg('empresa', 1)) || 1;

async function q(label, sql) {
	console.log(`\n--- ${label} ---`);
	try {
		const rows = await db.executeQuery(sql);
		if (!rows.length) return console.log('(sin filas)');
		console.table(rows);
		return rows;
	} catch (e) {
		console.log(`ERROR: ${e.message}`);
	}
}

async function run() {
	const hastaIso = fechaIsoOffsetArgentina(0);
	const desdeIso = fechaIsoOffsetArgentina(-DIAS);
	const desdeC = convertirFechaAClarion(desdeIso);
	const hastaC = convertirFechaAClarion(hastaIso);
	const rango = `t.FechaAsignada BETWEEN ${desdeC} AND ${hastaC} AND ISNULL(t.IDPaciente,0) > 0`;

	console.log(`\nVentana ${desdeIso} → ${hastaIso} | empresa ${ID_EMPRESA}\n`);

	await q(
		'TipoTurno y FechaCarga por sector — ¿cuál separa agenda de demanda?',
		`SELECT TOP 40
		   '[' + ISNULL(LTRIM(RTRIM(t.Sector)),'NULL') + ']' AS Sector,
		   MAX(s.Descripcion) AS Descripcion,
		   MAX(s.AmbInt) AS AmbInt,
		   COUNT(*) AS Turnos,
		   SUM(CASE WHEN t.TipoTurno = 0 THEN 1 ELSE 0 END) AS Tipo0,
		   SUM(CASE WHEN t.TipoTurno = 1 THEN 1 ELSE 0 END) AS Tipo1,
		   SUM(CASE WHEN t.FechaCarga = t.FechaAsignada THEN 1 ELSE 0 END) AS CargadoMismoDia,
		   SUM(CASE WHEN t.HoraAsignada = t.Horallegada THEN 1 ELSE 0 END) AS AsignadaIgualLlegada
		 FROM dbo.imTurnos t
		 LEFT JOIN dbo.imSectores s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(ISNULL(t.Sector,'')))
		 WHERE ${rango}
		 GROUP BY LTRIM(RTRIM(t.Sector))
		 ORDER BY COUNT(*) DESC`,
	);

	await q(
		'Correlación TipoTurno vs HoraAsignada=Horallegada (global)',
		`SELECT
		   t.TipoTurno,
		   COUNT(*) AS Turnos,
		   SUM(CASE WHEN t.HoraAsignada = t.Horallegada THEN 1 ELSE 0 END) AS AsignadaIgualLlegada,
		   SUM(CASE WHEN t.FechaCarga = t.FechaAsignada THEN 1 ELSE 0 END) AS CargadoMismoDia,
		   CAST(AVG(CASE WHEN ISNULL(t.Horallegada,0) > 0 AND ISNULL(t.HoraAsignada,0) > 0
		            THEN (t.Horallegada - t.HoraAsignada) / 6000.0 END) AS DECIMAL(10,1)) AS DifMinProm
		 FROM dbo.imTurnos t
		 WHERE ${rango}
		 GROUP BY t.TipoTurno`,
	);

	await q(
		'Anticipación real: días entre carga y fecha del turno, por TipoTurno',
		`SELECT
		   t.TipoTurno,
		   SUM(CASE WHEN t.FechaAsignada - t.FechaCarga <= 0 THEN 1 ELSE 0 END) AS MismoDiaOAntes,
		   SUM(CASE WHEN t.FechaAsignada - t.FechaCarga BETWEEN 1 AND 7 THEN 1 ELSE 0 END) AS Entre1y7dias,
		   SUM(CASE WHEN t.FechaAsignada - t.FechaCarga > 7 THEN 1 ELSE 0 END) AS MasDe7dias
		 FROM dbo.imTurnos t
		 WHERE ${rango} AND ISNULL(t.FechaCarga,0) > 0
		 GROUP BY t.TipoTurno`,
	);

	await q(
		'Cobertura de sellos: ¿alguien marca HoraIngreso en este hospital?',
		`SELECT
		   COUNT(*) AS Turnos,
		   SUM(CASE WHEN ISNULL(t.Horallegada,0) > 0 THEN 1 ELSE 0 END) AS ConLlegada,
		   SUM(CASE WHEN ISNULL(t.HoraIngreso,0) > 0 THEN 1 ELSE 0 END) AS ConIngreso,
		   SUM(CASE WHEN ISNULL(t.HoraSalida,0) > 0 THEN 1 ELSE 0 END) AS ConSalida,
		   SUM(CASE WHEN ISNULL(t.OperadorLlegada,0) > 0 THEN 1 ELSE 0 END) AS OperadorLlegada,
		   SUM(CASE WHEN ISNULL(t.OperadorIngreso,0) > 0 THEN 1 ELSE 0 END) AS OperadorIngreso
		 FROM dbo.imTurnos t
		 WHERE ${rango}`,
	);

	await q(
		'Si midiéramos HoraAsignada → HoraSalida (permanencia), ¿hay datos sanos?',
		`WITH X AS (
		   SELECT
		     '[' + ISNULL(LTRIM(RTRIM(t.Sector)),'NULL') + ']' AS Sector,
		     t.TipoTurno,
		     (t.HoraSalida - t.HoraAsignada) / 6000.0 AS Min
		   FROM dbo.imTurnos t
		   WHERE ${rango} AND ISNULL(t.HoraSalida,0) > 0 AND ISNULL(t.HoraAsignada,0) > 0
		 )
		 SELECT TOP 15
		   Sector,
		   COUNT(*) AS Muestras,
		   SUM(CASE WHEN Min BETWEEN 0 AND 480 THEN 1 ELSE 0 END) AS EnRango,
		   CAST(AVG(CASE WHEN Min BETWEEN 0 AND 480 THEN Min END) AS DECIMAL(10,1)) AS PromMin
		 FROM X
		 GROUP BY Sector
		 ORDER BY COUNT(*) DESC`,
	);
}

(async () => {
	try {
		await runWithTenant(ID_EMPRESA, run);
		process.exit(0);
	} catch (e) {
		console.error('Error:', e.message);
		process.exit(1);
	}
})();
