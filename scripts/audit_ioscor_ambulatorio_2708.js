require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.railway.local'), override: true });
require('dotenv').config();
/**
 * Audita ambulatorio 27/08 para IOSCOR (o empresa indicada).
 * Uso:
 *   node scripts/audit_ioscor_ambulatorio_2708.js
 *   node scripts/audit_ioscor_ambulatorio_2708.js --empresa 100 --fecha 2026-08-27
 */
const platformMysql = require('../src/services/platformMysql.service');
const { runWithTenant } = require('../src/context/tenantContext');
const { convertirFechaAClarion } = require('../src/utils/dateUtils');
const { executeQuery } = require('../src/models/db');
const ambulatorioService = require('../src/services/ambulatorio.service');

function arg(n, d = null) {
	const i = process.argv.indexOf(`--${n}`);
	return i === -1 || i === process.argv.length - 1 ? d : process.argv[i + 1];
}

async function main() {
	const fecha = String(arg('fecha', '2026-08-27')).slice(0, 10);
	let idEmpresa = Number(arg('empresa', 0)) || 0;

	console.log('=== Buscando empresas en plataforma MySQL ===');
	const empresas = await platformMysql.listarEmpresasRows('IOSCOR');
	console.table(
		empresas.map((e) => ({
			id: e.IDEMPRESA,
			desc: e.DESCRIPCION,
			db: e.DbName,
			server: e.DbServer,
			tipo: e.TipoServidor,
		})),
	);

	if (!idEmpresa) {
		const match =
			empresas.find((e) => /poli/i.test(String(e.DESCRIPCION || ''))) ||
			empresas.find((e) => /ioscor/i.test(String(e.DESCRIPCION || ''))) ||
			empresas[0];
		if (!match) throw new Error('No se encontró empresa IOSCOR en plataforma');
		idEmpresa = Number(match.IDEMPRESA);
	}

	const emp = empresas.find((e) => Number(e.IDEMPRESA) === idEmpresa) || (await platformMysql.obtenerEmpresaRow(idEmpresa));
	console.log('\nEmpresa seleccionada:', idEmpresa, emp?.DESCRIPCION);
	console.log('Conexión SQL:', emp?.DbServer, emp?.DbName, 'user=', emp?.DbUser);

	const clarion = convertirFechaAClarion(fecha);
	console.log(`\nFecha ${fecha} → Clarion ${clarion}`);

	await runWithTenant(idEmpresa, async () => {
		console.log('\n=== Payload analítica ambulatoria ===');
		const data = await ambulatorioService.obtenerAnaliticaAmbulatoria({
			fechaInicio: fecha,
			fechaFin: fecha,
			graciaMin: 120,
		});
		const r = data.resumen;
		console.table([
			{
				programados: r.programados,
				turnosDemanda: r.turnosDemanda,
				totalAtencionesUI: r.programados + r.turnosDemanda,
				atendidosAgenda: r.atendidos,
				atendidosDemanda: r.atendidosDemanda,
				atendidosTotal: r.atendidos + r.atendidosDemanda,
				ausentes: r.ausentes,
				enCurso: r.enCurso,
				cancelados: r.cancelados,
				ausentismo: r.tasaAusentismo,
			},
		]);
		console.log('porOrigen (imVisita):', data.porOrigen);

		console.log('\n=== Distribución Status / TipoTurno en imTurnos ===');
		const dist = await executeQuery(
			`
			SELECT
				ISNULL(TipoTurno, 0) AS TipoTurno,
				Status,
				COUNT(*) AS N,
				SUM(CASE WHEN ISNULL(NumeroVisita,0) > 0 THEN 1 ELSE 0 END) AS ConVisita,
				SUM(CASE WHEN ISNULL(HoraSalida,0) > 0 THEN 1 ELSE 0 END) AS ConSalida,
				SUM(CASE WHEN ISNULL(HoraIngreso,0) > 0 THEN 1 ELSE 0 END) AS ConIngreso
			FROM dbo.imTurnos
			WHERE FechaAsignada = @p0 AND ISNULL(IDPaciente, 0) > 0
			GROUP BY ISNULL(TipoTurno, 0), Status
			ORDER BY TipoTurno, Status
			`,
			[{ value: clarion, type: 'Int' }],
		);
		console.table(dist);

		console.log('\n=== Criterio Admin Turnos: Status IN (2,3) o etiquetas atendido/sobreturno ===');
		const adminLike = await executeQuery(
			`
			SELECT
				COUNT(*) AS Total,
				SUM(CASE WHEN ISNULL(TipoTurno,0)=0 THEN 1 ELSE 0 END) AS Agenda,
				SUM(CASE WHEN ISNULL(TipoTurno,0)<>0 THEN 1 ELSE 0 END) AS Demanda,
				SUM(CASE WHEN Status IN (2,3) THEN 1 ELSE 0 END) AS StatusAtendido,
				SUM(CASE WHEN Status IN (2,3) AND ISNULL(TipoTurno,0)=0 THEN 1 ELSE 0 END) AS AgendaStatusAtendido,
				SUM(CASE WHEN Status IN (2,3) AND ISNULL(TipoTurno,0)<>0 THEN 1 ELSE 0 END) AS DemandaStatusAtendido,
				SUM(CASE WHEN ISNULL(NumeroVisita,0)>0 THEN 1 ELSE 0 END) AS ConVisita,
				SUM(CASE WHEN ISNULL(NumeroVisita,0)>0 AND ISNULL(TipoTurno,0)=0 THEN 1 ELSE 0 END) AS AgendaConVisita,
				SUM(CASE WHEN ISNULL(NumeroVisita,0)>0 AND ISNULL(TipoTurno,0)<>0 THEN 1 ELSE 0 END) AS DemandaConVisita
			FROM dbo.imTurnos
			WHERE FechaAsignada = @p0 AND ISNULL(IDPaciente, 0) > 0
			`,
			[{ value: clarion, type: 'Int' }],
		);
		console.table(adminLike);

		console.log('\n=== Visitas ambulatorias ClasePaciente=A ese día ===');
		const visitas = await executeQuery(
			`
			SELECT
				COUNT(*) AS VisitasA,
				SUM(CASE WHEN tt.TipoTurnoMin = 0 THEN 1 ELSE 0 END) AS ConAgenda,
				SUM(CASE WHEN tt.TipoTurnoMin IS NULL OR tt.TipoTurnoMin <> 0 THEN 1 ELSE 0 END) AS ADemanda
			FROM dbo.imVisita v
			LEFT JOIN (
				SELECT NumeroVisita, MIN(ISNULL(TipoTurno, 0)) AS TipoTurnoMin
				FROM dbo.imTurnos
				WHERE ISNULL(NumeroVisita, 0) > 0
				GROUP BY NumeroVisita
			) tt ON tt.NumeroVisita = v.NUMEROVISITA
			WHERE CAST(v.FechaAdmisionS AS DATE) = @p0
			  AND UPPER(LTRIM(RTRIM(ISNULL(v.ClasePaciente, '')))) = 'A'
			`,
			[{ value: fecha, type: 'VarChar', length: 10 }],
		);
		console.table(visitas);

		console.log('\n=== Detalle turnos del día (Status, Tipo, Visita) ===');
		const detalle = await executeQuery(
			`
			SELECT
				IdTurno,
				ISNULL(TipoTurno,0) AS TipoTurno,
				Status,
				ISNULL(NumeroVisita,0) AS NumeroVisita,
				LTRIM(RTRIM(Sector)) AS Sector,
				Profesional,
				CASE
					WHEN Status = 1 THEN 'CANCELADO'
					WHEN Status IN (2,3) OR ISNULL(HoraSalida,0)>0 OR ISNULL(NumeroVisita,0)>0 THEN 'ATENDIDO'
					WHEN ISNULL(HoraIngreso,0)>0 THEN 'EN_CONSULTORIO'
					ELSE 'OTRO'
				END AS EstadoAnalitica
			FROM dbo.imTurnos
			WHERE FechaAsignada = @p0 AND ISNULL(IDPaciente, 0) > 0
			ORDER BY TipoTurno, Status, IdTurno
			`,
			[{ value: clarion, type: 'Int' }],
		);
		console.table(detalle);

		const atendidosAnalitica = detalle.filter((d) => d.EstadoAnalitica === 'ATENDIDO');
		console.log(
			`\nAtendidos por lógica analítica: ${atendidosAnalitica.length} (agenda=${atendidosAnalitica.filter((d) => Number(d.TipoTurno) === 0).length}, demanda=${atendidosAnalitica.filter((d) => Number(d.TipoTurno) !== 0).length})`,
		);
		console.log(
			`Status IN (2,3) como admin: ${detalle.filter((d) => [2, 3].includes(Number(d.Status))).length}`,
		);
	});
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
