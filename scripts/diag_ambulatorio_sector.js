/**
 * Diagnóstico puntual: ¿por qué un sector de atención a demanda (ej. EMERGENCIA
 * GENERAL) muestra miles de turnos de agenda y casi ninguna visita "a demanda"?
 *
 * Solo lectura.
 *
 * Uso:
 *   node scripts/diag_ambulatorio_sector.js --empresa 1 --dias 30
 *   node scripts/diag_ambulatorio_sector.js --empresa 1 --dias 30 --sector EME
 */
require('dotenv').config();
const db = require('../src/models/db');
const { runWithTenant } = require('../src/context/tenantContext');
const { convertirFechaAClarion, fechaIsoOffsetArgentina } = require('../src/utils/dateUtils');

function arg(nombre, defecto = null) {
	const i = process.argv.indexOf(`--${nombre}`);
	if (i === -1 || i === process.argv.length - 1) return defecto;
	return process.argv[i + 1];
}

const DIAS = Math.max(1, Number(arg('dias', 30)) || 30);
const ID_EMPRESA = Number(arg('empresa', 0)) || null;
const SECTOR = arg('sector', null);

function titulo(t) {
	console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);
}

async function q(label, sql) {
	console.log(`\n--- ${label} ---`);
	try {
		const rows = await db.executeQuery(sql);
		if (!rows.length) {
			console.log('(sin filas)');
			return [];
		}
		console.table(rows);
		return rows;
	} catch (e) {
		console.log(`ERROR: ${e.message}`);
		return null;
	}
}

async function listarEmpresas() {
	titulo('EMPRESAS DISPONIBLES');
	try {
		const rows = await db.executePlatformQuery(
			`SELECT IDEMPRESA, DESCRIPCION FROM Empresas ORDER BY IDEMPRESA`,
		);
		console.table(rows);
	} catch (e) {
		console.log(`No se pudo listar Empresas: ${e.message}`);
	}
}

async function diagnosticar() {
	const hastaIso = fechaIsoOffsetArgentina(0);
	const desdeIso = fechaIsoOffsetArgentina(-DIAS);
	const desdeC = convertirFechaAClarion(desdeIso);
	const hastaC = convertirFechaAClarion(hastaIso);

	titulo(`VENTANA ${desdeIso} → ${hastaIso} (${DIAS} días) | empresa ${ID_EMPRESA}`);

	await q(
		'imTurnos: TODAS las columnas',
		`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS Largo
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_NAME = 'imTurnos'
		 ORDER BY ORDINAL_POSITION`,
	);

	await q(
		'imTurnos: TipoTurno x Status (¿el walk-in se marca distinto?)',
		`SELECT
		   t.TipoTurno, t.Status, COUNT(*) AS Turnos,
		   SUM(CASE WHEN ISNULL(t.NumeroVisita,0) > 0 THEN 1 ELSE 0 END) AS ConVisita
		 FROM dbo.imTurnos t
		 WHERE t.FechaAsignada BETWEEN ${desdeC} AND ${hastaC}
		   AND ISNULL(t.IDPaciente,0) > 0
		 GROUP BY t.TipoTurno, t.Status
		 ORDER BY Turnos DESC`,
	);

	await q(
		'imTurnos: ¿HoraAsignada == Horallegada? (turno creado al momento de llegar = walk-in)',
		`SELECT
		   '[' + ISNULL(LTRIM(RTRIM(t.Sector)),'NULL') + ']' AS Sector,
		   COUNT(*) AS Turnos,
		   SUM(CASE WHEN t.HoraAsignada = t.Horallegada THEN 1 ELSE 0 END) AS AsignadaIgualLlegada,
		   SUM(CASE WHEN ISNULL(t.Horallegada,0) = 0 THEN 1 ELSE 0 END) AS SinLlegada,
		   SUM(CASE WHEN ISNULL(t.HoraIngreso,0) > 0 THEN 1 ELSE 0 END) AS ConIngreso,
		   SUM(CASE WHEN ISNULL(t.HoraSalida,0) > 0 THEN 1 ELSE 0 END) AS ConSalida
		 FROM dbo.imTurnos t
		 WHERE t.FechaAsignada BETWEEN ${desdeC} AND ${hastaC}
		   AND ISNULL(t.IDPaciente,0) > 0
		 GROUP BY LTRIM(RTRIM(t.Sector))
		 ORDER BY Turnos DESC`,
	);

	await q(
		'imVisita: ClasePaciente x sector, separando con/sin turno',
		`SELECT TOP 30
		   '[' + ISNULL(LTRIM(RTRIM(v.VALORSECTOR)), 'NULL') + ']' AS Sector,
		   '[' + ISNULL(LTRIM(RTRIM(v.CLASEPACIENTE)),'NULL') + ']' AS Clase,
		   COUNT(*) AS Visitas,
		   SUM(CASE WHEN tt.NumeroVisita IS NULL THEN 1 ELSE 0 END) AS SinTurno
		 FROM dbo.imVisita v
		 LEFT JOIN (
		   SELECT DISTINCT NumeroVisita FROM dbo.imTurnos WHERE ISNULL(NumeroVisita,0) > 0
		 ) tt ON tt.NumeroVisita = v.NUMEROVISITA
		 WHERE v.FECHAADMISIONS >= '${desdeIso}'
		   AND v.FECHAADMISIONS < DATEADD(DAY, 1, '${hastaIso}')
		 GROUP BY LTRIM(RTRIM(v.VALORSECTOR)), LTRIM(RTRIM(v.CLASEPACIENTE))
		 ORDER BY COUNT(*) DESC`,
	);

	if (SECTOR) {
		await q(
			`imTurnos: muestra cruda del sector ${SECTOR}`,
			`SELECT TOP 25
			   t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.IDPaciente,
			   t.Status, t.TipoTurno, t.NumeroVisita, t.Profesional, t.Especialidad,
			   t.Horallegada, t.HoraIngreso, t.HoraSalida
			 FROM dbo.imTurnos t
			 WHERE t.FechaAsignada BETWEEN ${desdeC} AND ${hastaC}
			   AND LTRIM(RTRIM(ISNULL(t.Sector,''))) = '${SECTOR}'
			 ORDER BY t.FechaAsignada DESC, t.HoraAsignada`,
		);

		await q(
			`imVisita: muestra cruda del sector ${SECTOR}`,
			`SELECT TOP 25
			   v.NUMEROVISITA, v.IDPACIENTE, v.FECHAADMISIONS, v.CLASEPACIENTE,
			   v.VALORSECTOR, v.DOCTORADMISOR, v.ESTADO,
			   v.ESTADOAMBULATORIO, v.ORIGENADMISION, v.TIPOADMISION
			 FROM dbo.imVisita v
			 WHERE v.FECHAADMISIONS >= '${desdeIso}'
			   AND v.FECHAADMISIONS < DATEADD(DAY, 1, '${hastaIso}')
			   AND LTRIM(RTRIM(ISNULL(v.VALORSECTOR,''))) = '${SECTOR}'
			 ORDER BY v.FECHAADMISIONS DESC`,
		);
	}

	await q(
		'Cruce ClaseA por sector (lo que alimenta hoy la columna "A demanda")',
		`SELECT TOP 25
		   '[' + ISNULL(LTRIM(RTRIM(v.VALORSECTOR)), 'NULL') + ']' AS Sector,
		   COUNT(*) AS TotalClaseA,
		   SUM(CASE WHEN tt.NumeroVisita IS NOT NULL THEN 1 ELSE 0 END) AS ConTurno,
		   SUM(CASE WHEN tt.NumeroVisita IS NULL THEN 1 ELSE 0 END) AS ADemanda
		 FROM dbo.imVisita v
		 LEFT JOIN (
		   SELECT DISTINCT NumeroVisita FROM dbo.imTurnos WHERE ISNULL(NumeroVisita,0) > 0
		 ) tt ON tt.NumeroVisita = v.NUMEROVISITA
		 WHERE UPPER(LTRIM(RTRIM(ISNULL(v.CLASEPACIENTE,'')))) = 'A'
		   AND v.FECHAADMISIONS >= '${desdeIso}'
		   AND v.FECHAADMISIONS < DATEADD(DAY, 1, '${hastaIso}')
		 GROUP BY LTRIM(RTRIM(v.VALORSECTOR))
		 ORDER BY COUNT(*) DESC`,
	);
}

(async () => {
	try {
		if (!ID_EMPRESA) {
			await listarEmpresas();
			console.log('\nPasá --empresa <id> para el diagnóstico completo.');
			process.exit(0);
		}
		await runWithTenant(ID_EMPRESA, diagnosticar);
		process.exit(0);
	} catch (e) {
		console.error('\nError general:', e.message);
		process.exit(1);
	}
})();
