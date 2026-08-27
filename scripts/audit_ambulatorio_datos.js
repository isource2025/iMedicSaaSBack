/**
 * Auditoría de datos para la analítica ambulatoria (card "Actividad Ambulatoria"
 * + /dashboard/turnos/analytics).
 *
 * Responde, sobre los últimos N días (default 90):
 *  1. ¿Existen imTurnos / imTurnosLog / imVisita / imSectores y con qué columnas clave?
 *  2. ¿Qué valores de Status aparecen realmente? (¿hay Status=2 legacy?)
 *  3. ¿Qué % de turnos atendidos tiene Horallegada / HoraIngreso marcados?
 *     → decide si el bloque de tiempos es publicable como KPI.
 *  4. ¿Cuántas cancelaciones viven en imTurnosLog y no en imTurnos?
 *  5. ¿Qué proporción de visitas ClasePaciente='A' no tiene turno asociado?
 *  6. ¿Los intervalos calculados caen dentro del rango sano [-240, 480] minutos?
 *  7. ¿Hay índices sobre imTurnos.FechaAsignada? (costo de rangos anuales)
 *
 * Solo lectura. No modifica nada.
 *
 * Uso:
 *   node scripts/audit_ambulatorio_datos.js
 *   node scripts/audit_ambulatorio_datos.js --dias 180
 *   node scripts/audit_ambulatorio_datos.js --empresa 1 --dias 90
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

const DIAS = Math.max(1, Number(arg('dias', 90)) || 90);
const ID_EMPRESA = Number(arg('empresa', 0)) || null;

/** Clarion TIME = centésimas de segundo + 1 → minutos entre dos sellos. */
const MIN = (a, b) => `((${b} - ${a}) / 6000.0)`;
/** Clarion DATE = días desde 1800-12-28. */
const FECHA = (col) => `DATEADD(DAY, ${col}, '1800-12-28')`;

let hayHallazgosCriticos = false;

function titulo(texto) {
	console.log('\n============================================================');
	console.log(texto);
	console.log('============================================================');
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

async function existeTabla(nombre) {
	const rows = await db.executeQuery(
		`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${nombre}'`,
	);
	return Number(rows[0]?.n || 0) > 0;
}

async function auditar() {
	const hastaIso = fechaIsoOffsetArgentina(0);
	const desdeIso = fechaIsoOffsetArgentina(-DIAS);
	const desdeClarion = convertirFechaAClarion(desdeIso);
	const hastaClarion = convertirFechaAClarion(hastaIso);

	titulo('AUDITORÍA AMBULATORIO — parámetros');
	console.log(`Ventana        : ${desdeIso} → ${hastaIso} (${DIAS} días)`);
	console.log(`Clarion        : ${desdeClarion} → ${hastaClarion}`);
	console.log(`Empresa (ALS)  : ${ID_EMPRESA ?? '(sin tenant — BD plataforma)'}`);

	const rango = `t.FechaAsignada BETWEEN ${desdeClarion} AND ${hastaClarion}`;

	// ── 1. Presencia de tablas y columnas clave ──────────────────────────────
	titulo('1. Tablas y columnas requeridas');

	const tablas = ['imTurnos', 'imTurnosLog', 'imVisita', 'imSectores', 'imPersonal'];
	const presencia = {};
	for (const t of tablas) {
		presencia[t] = await existeTabla(t);
		console.log(`  ${presencia[t] ? '[OK]' : '[!!]'} ${t}`);
		if (!presencia[t] && t !== 'imTurnosLog') hayHallazgosCriticos = true;
	}

	if (!presencia.imTurnos) {
		console.log('\n[!!] Sin imTurnos no hay nada que auditar. Abortando.');
		return;
	}

	await q(
		'imTurnos: columnas usadas por la analítica',
		`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_NAME = 'imTurnos'
		   AND COLUMN_NAME IN ('IdTurno','FechaAsignada','HoraAsignada','IDPaciente','Profesional',
		                       'Sector','Horallegada','HoraIngreso','HoraSalida','Especialidad',
		                       'Status','TipoTurno','NumeroVisita','MotivoCancelacion',
		                       'OperadorLlegada','OperadorIngreso')
		 ORDER BY COLUMN_NAME`,
	);

	await q(
		'imVisita: columnas usadas por la analítica',
		`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
		 FROM INFORMATION_SCHEMA.COLUMNS
		 WHERE TABLE_NAME = 'imVisita'
		   AND COLUMN_NAME IN ('NumeroVisita','IdPaciente','FechaAdmisionS','ClasePaciente',
		                       'ValorSector','DoctorAsistiendo','Contrato')
		 ORDER BY COLUMN_NAME`,
	);

	// ── 2. Distribución de Status ────────────────────────────────────────────
	titulo('2. Distribución real de Status (¿existe el Status=2 legacy?)');

	const statuses = await q(
		`imTurnos: Status en los últimos ${DIAS} días (solo slots con paciente)`,
		`SELECT t.Status,
		        COUNT(*) AS Turnos,
		        SUM(CASE WHEN t.HoraSalida > 0 THEN 1 ELSE 0 END) AS ConHoraSalida,
		        SUM(CASE WHEN t.NumeroVisita > 0 THEN 1 ELSE 0 END) AS ConNumeroVisita
		 FROM dbo.imTurnos t
		 WHERE ${rango} AND ISNULL(t.IDPaciente, 0) > 0
		 GROUP BY t.Status
		 ORDER BY t.Status`,
	);

	const legacy2 = (statuses || []).find((r) => Number(r.Status) === 2);
	if (legacy2) {
		hayHallazgosCriticos = true;
		console.log(
			`\n[!!] Status=2 presente (${legacy2.Turnos} turnos). El servicio debe tratarlo como ATENDIDO.`,
		);
	} else {
		console.log('\n[OK] No aparece Status=2 en la ventana auditada.');
	}

	// ── 3. Cobertura de marcado (llegada / ingreso) ──────────────────────────
	titulo('3. Cobertura de marcado — decide si los tiempos son publicables');

	const cobertura = await q(
		'Turnos atendidos: ¿tienen llegada e ingreso marcados?',
		`SELECT
		   COUNT(*) AS Atendidos,
		   SUM(CASE WHEN ISNULL(t.Horallegada,0) > 0 THEN 1 ELSE 0 END) AS ConLlegada,
		   SUM(CASE WHEN ISNULL(t.HoraIngreso,0) > 0 THEN 1 ELSE 0 END) AS ConIngreso,
		   SUM(CASE WHEN ISNULL(t.Horallegada,0) > 0 AND ISNULL(t.HoraIngreso,0) > 0 THEN 1 ELSE 0 END) AS ConAmbos,
		   CAST(100.0 * SUM(CASE WHEN ISNULL(t.Horallegada,0) > 0 AND ISNULL(t.HoraIngreso,0) > 0 THEN 1 ELSE 0 END)
		        / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS PctConAmbos
		 FROM dbo.imTurnos t
		 WHERE ${rango}
		   AND ISNULL(t.IDPaciente,0) > 0
		   AND (t.Status IN (2,3) OR ISNULL(t.HoraSalida,0) > 0 OR ISNULL(t.NumeroVisita,0) > 0)`,
	);

	const pct = Number(cobertura?.[0]?.PctConAmbos ?? 0);
	if (cobertura?.length) {
		if (pct >= 70) {
			console.log(`\n[OK] Cobertura ${pct}% — los tiempos son publicables como KPI.`);
		} else if (pct >= 30) {
			console.log(
				`\n[!] Cobertura ${pct}% — publicar los tiempos SIEMPRE junto al indicador de cobertura.`,
			);
		} else {
			hayHallazgosCriticos = true;
			console.log(
				`\n[!!] Cobertura ${pct}% — los tiempos son ruido. Mostrar el bloque degradado ("datos insuficientes").`,
			);
		}
	}

	await q(
		'Cobertura de marcado por mes (¿mejora o empeora en el tiempo?)',
		`SELECT
		   FORMAT(${FECHA('t.FechaAsignada')}, 'yyyy-MM') AS Mes,
		   COUNT(*) AS Atendidos,
		   CAST(100.0 * SUM(CASE WHEN ISNULL(t.Horallegada,0) > 0 THEN 1 ELSE 0 END)
		        / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS PctLlegada,
		   CAST(100.0 * SUM(CASE WHEN ISNULL(t.HoraIngreso,0) > 0 THEN 1 ELSE 0 END)
		        / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS PctIngreso
		 FROM dbo.imTurnos t
		 WHERE ${rango}
		   AND ISNULL(t.IDPaciente,0) > 0
		   AND (t.Status IN (2,3) OR ISNULL(t.HoraSalida,0) > 0 OR ISNULL(t.NumeroVisita,0) > 0)
		 GROUP BY FORMAT(${FECHA('t.FechaAsignada')}, 'yyyy-MM')
		 ORDER BY Mes`,
	);

	await q(
		'Trazabilidad de operador (columnas SaaS OperadorLlegada / OperadorIngreso)',
		`SELECT
		   SUM(CASE WHEN ISNULL(t.OperadorLlegada,0) > 0 THEN 1 ELSE 0 END) AS ConOperadorLlegada,
		   SUM(CASE WHEN ISNULL(t.OperadorIngreso,0) > 0 THEN 1 ELSE 0 END) AS ConOperadorIngreso,
		   COUNT(*) AS Total
		 FROM dbo.imTurnos t
		 WHERE ${rango} AND ISNULL(t.IDPaciente,0) > 0`,
	);

	// ── 4. Cancelaciones repartidas en dos tablas ────────────────────────────
	titulo('4. Cancelaciones — imTurnos vs imTurnosLog');

	await q(
		'imTurnos: cancelados vivos en la ventana',
		`SELECT COUNT(*) AS CanceladosEnImTurnos
		 FROM dbo.imTurnos t
		 WHERE ${rango} AND t.Status = 1`,
	);

	if (presencia.imTurnosLog) {
		await q(
			'imTurnosLog: volumen total y en la ventana',
			`SELECT
			   (SELECT COUNT(*) FROM dbo.imTurnosLog) AS TotalHistorico,
			   (SELECT COUNT(*) FROM dbo.imTurnosLog t WHERE ${rango}) AS EnVentana,
			   (SELECT COUNT(*) FROM dbo.imTurnosLog t WHERE ${rango} AND t.Status = 1) AS CanceladosEnVentana`,
		);

		await q(
			'imTurnosLog: ¿hay IdTurno duplicados contra imTurnos? (obliga a deduplicar)',
			`SELECT COUNT(*) AS IdTurnoEnAmbasTablas
			 FROM dbo.imTurnosLog l
			 WHERE EXISTS (SELECT 1 FROM dbo.imTurnos t2 WHERE t2.IdTurno = l.IdTurno)
			   AND l.FechaAsignada BETWEEN ${desdeClarion} AND ${hastaClarion}`,
		);
	} else {
		console.log('\n[!] imTurnosLog no existe en este tenant — la unión de cancelados se omite.');
	}

	// ── 5. Visitas ambulatorias con y sin turno ──────────────────────────────
	titulo("5. Visitas ClasePaciente='A' — origen AGENDA vs ESPONTANEO");

	if (presencia.imVisita) {
		await q(
			`Visitas ambulatorias en los últimos ${DIAS} días`,
			`SELECT
			   COUNT(*) AS TotalAmbulatorias,
			   SUM(CASE WHEN tt.NumeroVisita IS NOT NULL THEN 1 ELSE 0 END) AS ConTurno_AGENDA,
			   SUM(CASE WHEN tt.NumeroVisita IS NULL THEN 1 ELSE 0 END) AS SinTurno_ESPONTANEO,
			   CAST(100.0 * SUM(CASE WHEN tt.NumeroVisita IS NULL THEN 1 ELSE 0 END)
			        / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS PctEspontaneo
			 FROM dbo.imVisita v
			 LEFT JOIN (
			   SELECT DISTINCT NumeroVisita FROM dbo.imTurnos WHERE ISNULL(NumeroVisita,0) > 0
			 ) tt ON tt.NumeroVisita = v.NumeroVisita
			 WHERE LTRIM(RTRIM(UPPER(ISNULL(v.ClasePaciente, '')))) = 'A'
			   AND v.FechaAdmisionS >= '${desdeIso}'
			   AND v.FechaAdmisionS < DATEADD(DAY, 1, '${hastaIso}')`,
		);

		await q(
			'imVisita: distribución de ClasePaciente en la ventana (validar que A = ambulatorio)',
			`SELECT TOP 10
			   LTRIM(RTRIM(ISNULL(v.ClasePaciente, '(null)'))) AS ClasePaciente,
			   COUNT(*) AS Visitas
			 FROM dbo.imVisita v
			 WHERE v.FechaAdmisionS >= '${desdeIso}'
			   AND v.FechaAdmisionS < DATEADD(DAY, 1, '${hastaIso}')
			 GROUP BY LTRIM(RTRIM(ISNULL(v.ClasePaciente, '(null)')))
			 ORDER BY Visitas DESC`,
		);

		await q(
			'Turnos atendidos SIN NumeroVisita (rompen la reconciliación)',
			`SELECT COUNT(*) AS AtendidosSinVisita
			 FROM dbo.imTurnos t
			 WHERE ${rango}
			   AND ISNULL(t.IDPaciente,0) > 0
			   AND (t.Status IN (2,3) OR ISNULL(t.HoraSalida,0) > 0)
			   AND ISNULL(t.NumeroVisita,0) = 0`,
		);
	}

	// ── 6. Sanidad de los intervalos ─────────────────────────────────────────
	titulo('6. Intervalos calculados — ¿el rango sano [-240, 480] min es correcto?');

	await q(
		'Espera en sala (HoraIngreso - Horallegada): distribución',
		`WITH X AS (
		   SELECT ${MIN('t.Horallegada', 't.HoraIngreso')} AS Minutos
		   FROM dbo.imTurnos t
		   WHERE ${rango}
		     AND ISNULL(t.Horallegada,0) > 0
		     AND ISNULL(t.HoraIngreso,0) > 0
		 )
		 SELECT
		   COUNT(*) AS Muestras,
		   SUM(CASE WHEN Minutos BETWEEN -240 AND 480 THEN 1 ELSE 0 END) AS DentroDeRango,
		   SUM(CASE WHEN Minutos < -240 OR Minutos > 480 THEN 1 ELSE 0 END) AS Descartadas,
		   CAST(MIN(Minutos) AS DECIMAL(10,1)) AS MinMinutos,
		   CAST(MAX(Minutos) AS DECIMAL(10,1)) AS MaxMinutos,
		   CAST(AVG(CASE WHEN Minutos BETWEEN -240 AND 480 THEN Minutos END) AS DECIMAL(10,1)) AS PromedioSano
		 FROM X`,
	);

	await q(
		'Espera en sala: percentiles (validar que PERCENTILE_CONT funciona en este SQL Server)',
		`WITH X AS (
		   SELECT ${MIN('t.Horallegada', 't.HoraIngreso')} AS Minutos
		   FROM dbo.imTurnos t
		   WHERE ${rango}
		     AND ISNULL(t.Horallegada,0) > 0
		     AND ISNULL(t.HoraIngreso,0) > 0
		 )
		 SELECT DISTINCT
		   CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY Minutos) OVER () AS DECIMAL(10,1)) AS P50,
		   CAST(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY Minutos) OVER () AS DECIMAL(10,1)) AS P90
		 FROM X
		 WHERE Minutos BETWEEN -240 AND 480`,
	);

	await q(
		'Puntualidad del paciente (Horallegada - HoraAsignada) y duración de consulta',
		`WITH X AS (
		   SELECT
		     CASE WHEN ISNULL(t.Horallegada,0) > 0 AND ISNULL(t.HoraAsignada,0) > 0
		          THEN ${MIN('t.HoraAsignada', 't.Horallegada')} END AS Puntualidad,
		     CASE WHEN ISNULL(t.HoraIngreso,0) > 0 AND ISNULL(t.HoraSalida,0) > 0
		          THEN ${MIN('t.HoraIngreso', 't.HoraSalida')} END AS Duracion
		   FROM dbo.imTurnos t
		   WHERE ${rango} AND ISNULL(t.IDPaciente,0) > 0
		 )
		 SELECT
		   COUNT(Puntualidad) AS MuestrasPuntualidad,
		   CAST(AVG(CASE WHEN Puntualidad BETWEEN -240 AND 480 THEN Puntualidad END) AS DECIMAL(10,1)) AS PuntualidadProm,
		   COUNT(Duracion) AS MuestrasDuracion,
		   CAST(AVG(CASE WHEN Duracion BETWEEN -240 AND 480 THEN Duracion END) AS DECIMAL(10,1)) AS DuracionProm
		 FROM X`,
	);

	await q(
		'Sellos Clarion fuera de rango válido (0 .. 8640001)',
		`SELECT
		   SUM(CASE WHEN t.HoraAsignada < 0 OR t.HoraAsignada > 8640001 THEN 1 ELSE 0 END) AS HoraAsignadaInvalida,
		   SUM(CASE WHEN t.Horallegada < 0 OR t.Horallegada > 8640001 THEN 1 ELSE 0 END) AS HorallegadaInvalida,
		   SUM(CASE WHEN t.HoraIngreso < 0 OR t.HoraIngreso > 8640001 THEN 1 ELSE 0 END) AS HoraIngresoInvalida,
		   SUM(CASE WHEN t.HoraSalida  < 0 OR t.HoraSalida  > 8640001 THEN 1 ELSE 0 END) AS HoraSalidaInvalida
		 FROM dbo.imTurnos t
		 WHERE ${rango}`,
	);

	await q(
		'Secuencia rota: ingreso sin llegada, o salida sin ingreso',
		`SELECT
		   SUM(CASE WHEN ISNULL(t.HoraIngreso,0) > 0 AND ISNULL(t.Horallegada,0) = 0 THEN 1 ELSE 0 END) AS IngresoSinLlegada,
		   SUM(CASE WHEN ISNULL(t.HoraSalida,0) > 0 AND ISNULL(t.HoraIngreso,0) = 0 THEN 1 ELSE 0 END) AS SalidaSinIngreso
		 FROM dbo.imTurnos t
		 WHERE ${rango}`,
	);

	// ── 7. Ausentismo inferido ───────────────────────────────────────────────
	titulo('7. Ausentismo inferido — sensibilidad a la ventana de gracia');

	for (const gracia of [30, 60, 120]) {
		await q(
			`Ausentes con graciaMin = ${gracia}`,
			`SELECT
			   COUNT(*) AS Programados,
			   SUM(CASE WHEN t.Status = 1 THEN 1 ELSE 0 END) AS Cancelados,
			   SUM(CASE
			         WHEN t.Status = 0
			          AND ISNULL(t.Horallegada,0) = 0
			          AND ISNULL(t.HoraSalida,0) = 0
			          AND ISNULL(t.NumeroVisita,0) = 0
			          AND DATEADD(MINUTE, ${gracia},
			                DATEADD(SECOND, (t.HoraAsignada - 1) / 100, ${FECHA('t.FechaAsignada')})) < SYSDATETIME()
			         THEN 1 ELSE 0 END) AS Ausentes
			 FROM dbo.imTurnos t
			 WHERE ${rango} AND ISNULL(t.IDPaciente,0) > 0`,
		);
	}

	// ── 8. Costo de query ────────────────────────────────────────────────────
	titulo('8. Índices sobre imTurnos (costo de rangos anuales)');

	await q(
		'Índices de imTurnos',
		`SELECT i.name AS Indice,
		        i.is_primary_key AS EsPK,
		        STUFF((SELECT ', ' + c.name
		               FROM sys.index_columns ic
		               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		               WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
		               ORDER BY ic.key_ordinal
		               FOR XML PATH('')), 1, 2, '') AS Columnas
		 FROM sys.indexes i
		 WHERE i.object_id = OBJECT_ID('dbo.imTurnos') AND i.type > 0`,
	);

	await q(
		'Volumen total de imTurnos (dimensiona el costo del scan)',
		`SELECT
		   COUNT(*) AS FilasTotales,
		   (SELECT COUNT(*) FROM dbo.imTurnos t2 WHERE t2.FechaAsignada BETWEEN ${desdeClarion} AND ${hastaClarion}) AS FilasEnVentana,
		   MIN(${FECHA('t.FechaAsignada')}) AS FechaMasAntigua,
		   MAX(${FECHA('t.FechaAsignada')}) AS FechaMasReciente
		 FROM dbo.imTurnos t
		 WHERE t.FechaAsignada > 0`,
	);

	titulo('RESUMEN');
	console.log(
		hayHallazgosCriticos
			? '[!!] Hay hallazgos que condicionan la implementación. Revisar las marcas [!!] arriba.'
			: '[OK] Sin hallazgos críticos. El módulo puede implementarse tal como está planeado.',
	);
	console.log(
		'\nDecisiones que dependen de esta salida:\n' +
			'  • Cobertura < 30%  → bloque de tiempos degradado en la UI.\n' +
			'  • Status=2 presente → tratar como ATENDIDO en el servicio.\n' +
			'  • imTurnosLog con volumen → mantener el UNION de cancelados.\n' +
			'  • % espontáneo alto → el split de origen es la métrica más informativa.',
	);
}

(async () => {
	try {
		if (ID_EMPRESA) {
			await runWithTenant(ID_EMPRESA, auditar);
		} else {
			await auditar();
		}
		process.exit(0);
	} catch (e) {
		console.error('\nError general:', e.message);
		process.exit(1);
	}
})();
