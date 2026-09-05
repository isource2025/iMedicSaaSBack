/**
 * Analítica ambulatoria — indicadores derivados de la agenda (imTurnos) y de las
 * visitas ambulatorias (imVisita con ClasePaciente = 'A').
 *
 * Universo de datos
 * -----------------
 * Toda consulta ambulatoria entra por uno de dos caminos, y las métricas de
 * volumen los discriminan siempre:
 *   • AGENDA     → turno reservado con antelación (imTurnos.TipoTurno = 0).
 *   • A_DEMANDA  → el paciente llega sin cita: se registra un turno en el acto
 *                  (TipoTurno = 1) o directamente una visita sin turno.
 *
 * Por qué TipoTurno y no "¿tiene visita asociada?"
 * ------------------------------------------------
 * En los hospitales que registran la atención espontánea desde la misma pantalla
 * de agenda, casi toda visita ambulatoria termina con un turno vinculado, así que
 * `NumeroVisita IS NOT NULL` clasificaría como "agenda" a la guardia entera.
 * TipoTurno sí separa los dos flujos: en los turnos TipoTurno=1 la hora asignada
 * coincide con la de llegada (el registro se crea cuando el paciente aparece),
 * mientras que los TipoTurno=0 se cargan días antes.
 *
 * Inasistencia
 * ------------
 * imTurnos no tiene estado "ausente": Status sólo admite 0=OCUPADO, 1=CANCELADO,
 * 3=ATENDIDO (más un 2 legacy que algunos tenants usan como atendido). La
 * inasistencia se infiere: turno de agenda cuyo instante programado + `graciaMin`
 * ya pasó sin cierre y sin visita. Dentro de la ventana de gracia el turno sigue
 * siendo PENDIENTE (o EN_SALA si hay llegada), no ausente.
 *
 * La llegada NO puede usarse para descartar la inasistencia: hay instalaciones
 * donde Horallegada se completa al crear el turno, de modo que el 100% de los
 * turnos "tiene llegada" y el ausentismo daría siempre 0. Sólo el cierre (Status,
 * HoraSalida o NumeroVisita) prueba que el paciente fue atendido.
 *
 * La demanda espontánea nunca entra al ausentismo: un paciente que se registra al
 * llegar no puede faltar a su propia llegada.
 *
 * Cancelaciones
 * -------------
 * TR_imTurnos_Insert archiva el turno cancelado en imTurnosLog y lo borra de
 * imTurnos cuando alguien reutiliza el slot. Contar sólo imTurnos subestima la
 * cancelación histórica, así que se unen ambas tablas deduplicando por IdTurno.
 *
 * Aritmética Clarion
 * ------------------
 * FechaAsignada = días desde 1800-12-28.
 * Hora*         = centésimas de segundo + 1 → minutos = (b - a) / 6000.
 * Los intervalos fuera de [-240, 480] minutos se descartan: son cargas erróneas
 * o cruces de medianoche que distorsionan cualquier promedio.
 *
 * No requiere objetos SQL desplegados en el tenant ni cambios de esquema.
 */
const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const {
	convertirFechaAClarion,
	fechaCalendarioArgentina,
	horaWallArgentina,
	fechaIsoOffsetArgentina,
} = require('../utils/dateUtils');

// ── Constantes de dominio ───────────────────────────────────────────────────

/** Ventana de gracia por defecto antes de considerar ausente a un paciente. */
const GRACIA_MIN_DEFAULT = 60;
const GRACIA_MIN_MIN = 0;
const GRACIA_MIN_MAX = 24 * 60;

/** Rango sano para cualquier intervalo derivado de los sellos Clarion. */
const INTERVALO_MIN = -240;
const INTERVALO_MAX = 480;

/** Máximo Clarion TIME válido (24 h en centésimas + 1). */
const CLARION_TIME_MAX = 8640001;

const EPOCH_CLARION = "'1800-12-28'";

// ── Helpers ─────────────────────────────────────────────────────────────────

function _num(v, defecto = 0) {
	const n = Number(v);
	return Number.isFinite(n) ? n : defecto;
}

/** Redondea a 1 decimal, o null si no hay dato. */
function _dec(v) {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function _txt(v) {
	const s = String(v ?? '').trim();
	return s || null;
}

/** YYYY-MM-DD a partir de lo que devuelva el driver para una columna DATE. */
function _iso(v) {
	if (!v) return null;
	if (v instanceof Date) {
		const y = v.getUTCFullYear();
		const m = String(v.getUTCMonth() + 1).padStart(2, '0');
		const d = String(v.getUTCDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	return String(v).slice(0, 10);
}

/**
 * "Ahora" en hora de pared de Argentina como texto 'YYYY-MM-DD HH:MM:SS'.
 *
 * Va como string y no como Date a propósito: InstanteTurno se arma en SQL a
 * partir de enteros Clarion, que ya representan hora local de Argentina sin
 * zona. Mandar un Date haría que el driver aplicara su propia conversión UTC y
 * el corte de ausentismo quedaría corrido según dónde corra el proceso.
 */
function _ahoraArgentina() {
	return `${fechaCalendarioArgentina()} ${horaWallArgentina(true)}`;
}

function _porcentaje(parte, total) {
	const t = _num(total);
	if (t <= 0) return 0;
	return Math.round((_num(parte) / t) * 1000) / 10;
}

/**
 * Variación porcentual entre dos períodos. Mismo criterio que
 * indicadores.service.obtenerResumenPacientesHoy para que las cards del
 * dashboard hablen el mismo idioma.
 */
function _variacion(actual, previo) {
	const a = _num(actual);
	const p = _num(previo);
	if (p > 0) return Math.round(((a - p) / p) * 1000) / 10;
	if (a > 0) return 100;
	return 0;
}

function esObjetoSqlMissing(error) {
	return (
		Number(error?.number) === 208 || /Invalid object name/i.test(String(error?.message || ''))
	);
}

// ── Detección de imTurnosLog (no existe en todos los tenants) ───────────────

const _tieneLogPorTenant = new Map();

function _tieneTurnosLog() {
	const key = getTenantId() ?? 'plataforma';
	// Se cachea la promesa, no el booleano: dos consultas en paralelo sobre el
	// mismo tenant comparten el sondeo en lugar de dispararlo dos veces.
	if (!_tieneLogPorTenant.has(key)) {
		const probe = executeQuery(
			`SELECT CASE WHEN OBJECT_ID('dbo.imTurnosLog', 'U') IS NULL THEN 0 ELSE 1 END AS Existe`,
		)
			.then((rows) => Number(rows?.[0]?.Existe) === 1)
			.catch(() => false);
		_tieneLogPorTenant.set(key, probe);
	}
	return _tieneLogPorTenant.get(key);
}

// ── Construcción del CTE base ───────────────────────────────────────────────

/** Columnas que se proyectan igual desde imTurnos y desde imTurnosLog. */
const COLS_TURNO = `
	t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional,
	t.Sector, t.Horallegada, t.HoraIngreso, t.HoraSalida, t.Especialidad,
	t.Status, t.TipoTurno, t.NumeroVisita`;

/** Intervalo en minutos entre dos sellos Clarion, ya acotado al rango sano. */
function _intervalo(desde, hasta) {
	return `CASE
		WHEN ISNULL(${desde}, 0) > 0 AND ISNULL(${hasta}, 0) > 0
		 AND (${hasta} - ${desde}) / 6000.0 BETWEEN ${INTERVALO_MIN} AND ${INTERVALO_MAX}
		THEN (${hasta} - ${desde}) / 6000.0
	END`;
}

/**
 * Normaliza y valida los filtros aceptados por el módulo.
 * @param {object} filtros
 * @returns {{fechaInicio: string, fechaFin: string, graciaMin: number,
 *            sector: string|null, profesional: number|null, especialidad: number|null}}
 */
function normalizarFiltros(filtros = {}) {
	const fechaInicio = String(filtros.fechaInicio || '').slice(0, 10);
	const fechaFin = String(filtros.fechaFin || '').slice(0, 10);

	let graciaMin = Number(filtros.graciaMin);
	if (!Number.isFinite(graciaMin)) graciaMin = GRACIA_MIN_DEFAULT;
	graciaMin = Math.min(GRACIA_MIN_MAX, Math.max(GRACIA_MIN_MIN, Math.round(graciaMin)));

	const profesional = Number(filtros.profesional);
	const especialidad = Number(filtros.especialidad);

	return {
		fechaInicio,
		fechaFin,
		graciaMin,
		sector: filtros.sector ? String(filtros.sector).trim().slice(0, 4) : null,
		profesional: Number.isFinite(profesional) && profesional > 0 ? profesional : null,
		especialidad: Number.isFinite(especialidad) && especialidad > 0 ? especialidad : null,
	};
}

/**
 * Arma el prefijo WITH compartido por todas las consultas del módulo y la lista
 * de parámetros asociada. Los índices de parámetros son estables:
 *   @p0 desdeClarion  @p1 hastaClarion  @p2 graciaMin  @p3 ahora
 *   @p4.. filtros opcionales
 */
async function _contextoTurnos(filtros) {
	const desdeClarion = convertirFechaAClarion(filtros.fechaInicio);
	const hastaClarion = convertirFechaAClarion(filtros.fechaFin);

	const params = [
		{ value: desdeClarion, type: 'Int' },
		{ value: hastaClarion, type: 'Int' },
		{ value: filtros.graciaMin, type: 'Int' },
		{ value: _ahoraArgentina(), type: 'VarChar', length: 19 },
	];

	const condiciones = [];
	if (filtros.sector) {
		condiciones.push(`AND LTRIM(RTRIM(t.Sector)) = @p${params.length}`);
		params.push({ value: filtros.sector, type: 'VarChar', length: 4 });
	}
	if (filtros.profesional != null) {
		condiciones.push(`AND t.Profesional = @p${params.length}`);
		params.push({ value: filtros.profesional, type: 'Int' });
	}
	if (filtros.especialidad != null) {
		condiciones.push(`AND t.Especialidad = @p${params.length}`);
		params.push({ value: filtros.especialidad, type: 'Int' });
	}
	const filtroSql = condiciones.join('\n\t\t   ');

	// El log sólo aporta turnos cancelados que ya no viven en imTurnos.
	const unionLog = (await _tieneTurnosLog())
		? `
		UNION ALL
		SELECT ${COLS_TURNO}
		FROM dbo.imTurnosLog t
		WHERE t.FechaAsignada BETWEEN @p0 AND @p1
		   AND ISNULL(t.IDPaciente, 0) > 0
		   AND NOT EXISTS (SELECT 1 FROM dbo.imTurnos v WHERE v.IdTurno = t.IdTurno)
		   ${filtroSql}`
		: '';

	const fechaTurno = `DATEADD(DAY, u.FechaAsignada, ${EPOCH_CLARION})`;

	const cte = `
	WITH TurnosUnion AS (
		SELECT ${COLS_TURNO}
		FROM dbo.imTurnos t
		WHERE t.FechaAsignada BETWEEN @p0 AND @p1
		   AND ISNULL(t.IDPaciente, 0) > 0
		   ${filtroSql}${unionLog}
	),
	TurnosBase AS (
		SELECT
			u.*,
			CAST(${fechaTurno} AS DATE) AS FechaTurno,
			DATEADD(
				SECOND,
				CASE WHEN u.HoraAsignada BETWEEN 1 AND ${CLARION_TIME_MAX}
				     THEN (u.HoraAsignada - 1) / 100 ELSE 0 END,
				CAST(${fechaTurno} AS DATETIME)
			) AS InstanteTurno,
			CASE WHEN ISNULL(u.TipoTurno, 0) = 0 THEN 1 ELSE 0 END AS EsAgenda,
			CASE WHEN ISNULL(u.TipoTurno, 0) = 0
			     THEN ${_intervalo('u.HoraAsignada', 'u.Horallegada')} END AS MinPuntualidad,
			CASE WHEN ISNULL(u.TipoTurno, 0) = 0
			     THEN ${_intervalo('u.HoraAsignada', 'u.HoraIngreso')} END AS MinEspera,
			${_intervalo('u.Horallegada', 'u.HoraSalida')} AS MinPermanencia,
			${_intervalo('u.HoraIngreso', 'u.HoraSalida')} AS MinConsulta
		FROM TurnosUnion u
	),
	TurnosEstado AS (
		SELECT
			b.*,
			CASE
				WHEN b.Status = 1 THEN 'CANCELADO'
				WHEN b.Status IN (2, 3) OR ISNULL(b.HoraSalida, 0) > 0
				     OR ISNULL(b.NumeroVisita, 0) > 0 THEN 'ATENDIDO'
				WHEN ISNULL(b.HoraIngreso, 0) > 0 THEN 'EN_CONSULTORIO'
				WHEN DATEADD(MINUTE, @p2, b.InstanteTurno) >= CONVERT(DATETIME, @p3, 120)
				     THEN CASE WHEN ISNULL(b.Horallegada, 0) > 0 THEN 'EN_SALA' ELSE 'PENDIENTE' END
				WHEN b.EsAgenda = 1 THEN 'AUSENTE'
				ELSE 'SIN_CERRAR'
			END AS Estado
		FROM TurnosBase b
	)`;

	return { cte, params };
}

/** Agregados de tiempos reutilizables (mismos alias en resumen y en rankings). */
function _agregadosTiempo(prefijo = '') {
	const p = prefijo;
	return `
		COUNT(${p}MinEspera) AS EsperaMuestras,
		AVG(${p}MinEspera) AS EsperaProm,
		MAX(${p}MinEspera) AS EsperaMax,
		COUNT(${p}MinPuntualidad) AS PuntualidadMuestras,
		AVG(${p}MinPuntualidad) AS PuntualidadProm,
		COUNT(${p}MinPermanencia) AS PermanenciaMuestras,
		AVG(${p}MinPermanencia) AS PermanenciaProm,
		COUNT(${p}MinConsulta) AS ConsultaMuestras,
		AVG(${p}MinConsulta) AS ConsultaProm`;
}

// ── Consultas ───────────────────────────────────────────────────────────────

async function _consultarResumen(cte, params) {
	const rows = await executeQuery(
		`${cte}
		SELECT
			SUM(EsAgenda) AS Programados,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS Pendientes,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'EN_SALA' THEN 1 ELSE 0 END) AS EnSala,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'EN_CONSULTORIO' THEN 1 ELSE 0 END) AS EnConsultorio,
			SUM(CASE WHEN EsAgenda = 0 AND Estado <> 'CANCELADO' THEN 1 ELSE 0 END) AS TurnosDemanda,
			SUM(CASE WHEN EsAgenda = 0 AND Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS AtendidosDemanda,
			SUM(CASE WHEN EsAgenda = 0 AND Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS CanceladosDemanda,
			${_agregadosTiempo()},
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS AtendidosParaCobertura,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' AND ISNULL(Horallegada, 0) > 0
			         THEN 1 ELSE 0 END) AS AtendidosConLlegada,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' AND ISNULL(HoraIngreso, 0) > 0
			         THEN 1 ELSE 0 END) AS AtendidosConIngreso,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' AND ISNULL(HoraSalida, 0) > 0
			         THEN 1 ELSE 0 END) AS AtendidosConSalida,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' AND ISNULL(Horallegada, 0) > 0
			          AND ISNULL(HoraIngreso, 0) > 0 THEN 1 ELSE 0 END) AS AtendidosConAmbos
		FROM TurnosEstado`,
		params,
	);
	return rows?.[0] || {};
}

/**
 * PERCENTILE_CONT existe desde SQL Server 2012, pero es la única construcción
 * del módulo que podría faltar en un tenant viejo. Va aislada para que su
 * ausencia degrade sólo los percentiles y no todo el payload.
 */
/**
 * Percentiles por rango más cercano (ROW_NUMBER), no con PERCENTILE_CONT.
 *
 * Varias bases del parque corren con nivel de compatibilidad anterior a 110 y
 * ahí PERCENTILE_CONT falla, dejando la mediana y el P90 en blanco justo en las
 * instalaciones más viejas. ROW_NUMBER funciona desde SQL 2005 y la diferencia
 * contra el percentil interpolado es de menos de un minuto con estos volúmenes.
 */
async function _consultarPercentiles(cte, params) {
	const METRICAS = [
		['espera', 'MinEspera', 'Espera'],
		['puntualidad', 'MinPuntualidad', 'Puntualidad'],
		['permanencia', 'MinPermanencia', 'Permanencia'],
		['consulta', 'MinConsulta', 'Consulta'],
	];

	const valores = METRICAS.map(
		([clave, col]) =>
			`SELECT '${clave}' AS Metrica, ${col} AS Valor FROM TurnosEstado WHERE ${col} IS NOT NULL`,
	).join('\n\t\t\t\tUNION ALL ');

	try {
		const rows = await executeQuery(
			`${cte},
			Valores AS (
				${valores}
			),
			Ranking AS (
				SELECT
					Metrica,
					Valor,
					ROW_NUMBER() OVER (PARTITION BY Metrica ORDER BY Valor) AS Posicion,
					COUNT(*) OVER (PARTITION BY Metrica) AS Total
				FROM Valores
			)
			SELECT
				Metrica,
				MAX(CASE WHEN Posicion = CASE WHEN CEILING(Total * 0.5) < 1 THEN 1
				                             ELSE CEILING(Total * 0.5) END
				         THEN Valor END) AS P50,
				MAX(CASE WHEN Posicion = CASE WHEN CEILING(Total * 0.9) < 1 THEN 1
				                             ELSE CEILING(Total * 0.9) END
				         THEN Valor END) AS P90
			FROM Ranking
			GROUP BY Metrica`,
			params,
		);

		const porMetrica = new Map((rows || []).map((r) => [String(r.Metrica), r]));
		const salida = {};
		for (const [clave, , prefijo] of METRICAS) {
			const r = porMetrica.get(clave) || {};
			salida[`${prefijo}P50`] = r.P50 ?? null;
			salida[`${prefijo}P90`] = r.P90 ?? null;
		}
		return salida;
	} catch (error) {
		console.warn('[ambulatorio] percentiles no disponibles:', error.message);
		return {};
	}
}

async function _consultarSerie(cte, params) {
	return executeQuery(
		`${cte}
		SELECT
			FechaTurno AS Fecha,
			SUM(EsAgenda) AS Programados,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN EsAgenda = 1 AND Estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS Pendientes,
			SUM(CASE WHEN EsAgenda = 0 AND Estado <> 'CANCELADO' THEN 1 ELSE 0 END) AS TurnosDemanda,
			AVG(MinEspera) AS EsperaProm
		FROM TurnosEstado
		GROUP BY FechaTurno
		ORDER BY FechaTurno`,
		params,
	);
}

/**
 * El código 0 agrupa los turnos cargados sin especialidad y se muestra como tal.
 * No se intenta deducirla del profesional: imPersonal.ValorEspecialidad viene
 * vacío en la mayoría de las instalaciones y el rescate sería anecdótico.
 */
async function _consultarPorEspecialidad(cte, params) {
	return executeQuery(
		`${cte}
		SELECT TOP 30
			te.Especialidad AS Codigo,
			MAX(esp.Descripcion) AS Descripcion,
			SUM(te.EsAgenda) AS Programados,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN te.EsAgenda = 0 THEN 1 ELSE 0 END) AS TurnosDemanda,
			AVG(te.MinEspera) AS EsperaProm,
			AVG(te.MinPermanencia) AS PermanenciaProm
		FROM TurnosEstado te
		LEFT JOIN dbo.imEspecialidad esp ON esp.Valor = te.Especialidad
		GROUP BY te.Especialidad
		ORDER BY COUNT(*) DESC`,
		params,
	);
}

async function _consultarPorSector(cte, params) {
	return executeQuery(
		`${cte}
		SELECT TOP 30
			LTRIM(RTRIM(ISNULL(te.Sector, ''))) AS Codigo,
			MAX(sec.Descripcion) AS Descripcion,
			MAX(sec.AmbInt) AS AmbInt,
			SUM(te.EsAgenda) AS Programados,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN te.EsAgenda = 0 THEN 1 ELSE 0 END) AS TurnosDemanda,
			AVG(te.MinEspera) AS EsperaProm,
			AVG(te.MinPermanencia) AS PermanenciaProm
		FROM TurnosEstado te
		LEFT JOIN dbo.imSectores sec
			ON LTRIM(RTRIM(sec.Valor)) = LTRIM(RTRIM(ISNULL(te.Sector, '')))
		GROUP BY LTRIM(RTRIM(ISNULL(te.Sector, '')))
		ORDER BY COUNT(*) DESC`,
		params,
	);
}

async function _consultarPorProfesional(cte, params) {
	// imPersonal puede tener varias filas por matrícula (una por especialidad):
	// OUTER APPLY TOP 1 evita multiplicar los turnos en el JOIN.
	return executeQuery(
		`${cte}
		SELECT TOP 30
			te.Profesional AS Matricula,
			MAX(per.ApellidoNombre) AS Nombre,
			SUM(te.EsAgenda) AS Programados,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN te.EsAgenda = 1 AND te.Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN te.EsAgenda = 0 THEN 1 ELSE 0 END) AS TurnosDemanda,
			AVG(te.MinEspera) AS EsperaProm,
			AVG(te.MinPermanencia) AS PermanenciaProm,
			AVG(te.MinConsulta) AS ConsultaProm
		FROM TurnosEstado te
		OUTER APPLY (
			SELECT TOP 1 p.ApellidoNombre
			FROM dbo.imPersonal p
			WHERE p.Matricula = te.Profesional
			  AND NULLIF(LTRIM(RTRIM(p.ApellidoNombre)), '') IS NOT NULL
			ORDER BY p.Valor
		) per
		GROUP BY te.Profesional
		ORDER BY COUNT(*) DESC`,
		params,
	);
}

/** 1900-01-01 fue lunes: el módulo 7 da 0=Lunes..6=Domingo sin depender de DATEFIRST. */
const SQL_DIA_SEMANA = `DATEDIFF(DAY, '1900-01-01', InstanteTurno) % 7`;

async function _consultarHeatmap(cte, params) {
	return executeQuery(
		`${cte}
		SELECT
			${SQL_DIA_SEMANA} AS DiaSemana,
			DATEPART(HOUR, InstanteTurno) AS Hora,
			COUNT(*) AS Programados,
			SUM(CASE WHEN Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			AVG(MinEspera) AS EsperaProm,
			AVG(MinPermanencia) AS PermanenciaProm
		FROM TurnosEstado
		GROUP BY ${SQL_DIA_SEMANA}, DATEPART(HOUR, InstanteTurno)
		ORDER BY DiaSemana, Hora`,
		params,
	);
}

/**
 * Origen de cada visita según el turno que la generó.
 *
 * MIN(TipoTurno) porque una visita puede tener más de un turno vinculado: si
 * alguno fue reservado con antelación (TipoTurno = 0), la atención se cuenta
 * como agenda. Sin fila en esta subconsulta, la visita nació sin turno alguno y
 * es demanda pura.
 */
const SQL_ORIGEN_VISITA = `
	SELECT NumeroVisita, MIN(CAST(ISNULL(TipoTurno, 0) AS INT)) AS TipoTurnoMin
	FROM dbo.imTurnos
	WHERE ISNULL(NumeroVisita, 0) > 0
	GROUP BY NumeroVisita`;

/**
 * WHERE + parámetros compartidos por todas las consultas sobre imVisita.
 * Respeta sector, profesional y especialidad cuando vienen en los filtros.
 */
function _paramsVisitasBase(filtros) {
	const params = [{ value: filtros.fechaInicio }, { value: filtros.fechaFin }];
	const condiciones = [
		`UPPER(LTRIM(RTRIM(ISNULL(v.ClasePaciente, '')))) = 'A'`,
		`v.FechaAdmisionS >= @p0`,
		`v.FechaAdmisionS < DATEADD(DAY, 1, @p1)`,
	];

	if (filtros.sector) {
		condiciones.push(`LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) = @p${params.length}`);
		params.push({ value: filtros.sector, type: 'VarChar', length: 4 });
	}
	if (filtros.profesional != null) {
		condiciones.push(
			`(v.DOCTORADMISOR = @p${params.length} OR v.DOCTORASISTIENDO = @p${params.length})`,
		);
		params.push({ value: filtros.profesional, type: 'Int' });
	}
	if (filtros.especialidad != null) {
		condiciones.push(`(
			EXISTS (
				SELECT 1 FROM dbo.imTurnos t2
				WHERE t2.NumeroVisita = v.NUMEROVISITA AND t2.Especialidad = @p${params.length}
			)
			OR EXISTS (
				SELECT 1 FROM dbo.imPersonal p2
				WHERE (p2.Matricula = v.DOCTORADMISOR OR p2.Valor = v.DOCTORADMISOR)
				  AND p2.ValorEspecialidad = @p${params.length}
			)
		)`);
		params.push({ value: filtros.especialidad, type: 'Int' });
	}

	return { condiciones, params };
}

/**
 * Agenda = la visita vino de un turno reservado con antelación.
 * A demanda = sobreturno registrado al llegar, o visita sin turno.
 */
function _sqlConteoVisitasPorOrigen(aliasTurno = 'tt') {
	return `
		SUM(CASE WHEN ${aliasTurno}.TipoTurnoMin = 0 THEN 1 ELSE 0 END) AS ConTurno,
		SUM(CASE WHEN ${aliasTurno}.TipoTurnoMin IS NULL OR ${aliasTurno}.TipoTurnoMin <> 0
		         THEN 1 ELSE 0 END) AS ADemanda`;
}

/**
 * Volumen de consultas ambulatorias reales (imVisita) separando las que nacen de
 * un turno de agenda de las atenciones a demanda.
 */
async function _consultarOrigen(filtros) {
	try {
		const { condiciones, params } = _paramsVisitasBase(filtros);
		return await executeQuery(
			`SELECT
				CAST(v.FechaAdmisionS AS DATE) AS Fecha,
				${_sqlConteoVisitasPorOrigen()}
			FROM dbo.imVisita v
			LEFT JOIN (${SQL_ORIGEN_VISITA}) tt ON tt.NumeroVisita = v.NUMEROVISITA
			WHERE ${condiciones.join('\n\t\t\t  AND ')}
			GROUP BY CAST(v.FechaAdmisionS AS DATE)
			ORDER BY CAST(v.FechaAdmisionS AS DATE)`,
			params,
		);
	} catch (error) {
		if (esObjetoSqlMissing(error)) {
			console.warn('[ambulatorio] imVisita no disponible, se omite el split por origen');
			return [];
		}
		throw error;
	}
}

async function _consultarVisitasPorSector(filtros) {
	try {
		const { condiciones, params } = _paramsVisitasBase(filtros);
		return await executeQuery(
			`SELECT TOP 30
				LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) AS Codigo,
				MAX(sec.Descripcion) AS Descripcion,
				MAX(sec.AmbInt) AS AmbInt,
				${_sqlConteoVisitasPorOrigen()}
			FROM dbo.imVisita v
			LEFT JOIN (${SQL_ORIGEN_VISITA}) tt ON tt.NumeroVisita = v.NUMEROVISITA
			LEFT JOIN dbo.imSectores sec
				ON LTRIM(RTRIM(sec.Valor)) = LTRIM(RTRIM(ISNULL(v.VALORSECTOR, '')))
			WHERE ${condiciones.join('\n\t\t\t  AND ')}
			GROUP BY LTRIM(RTRIM(ISNULL(v.VALORSECTOR, '')))
			HAVING LTRIM(RTRIM(ISNULL(v.VALORSECTOR, ''))) <> ''
			ORDER BY COUNT(*) DESC`,
			params,
		);
	} catch (error) {
		if (esObjetoSqlMissing(error)) return [];
		throw error;
	}
}

async function _consultarVisitasPorProfesional(filtros) {
	try {
		const { condiciones, params } = _paramsVisitasBase(filtros);
		return await executeQuery(
			`SELECT TOP 30
				v.DOCTORADMISOR AS Matricula,
				MAX(per.ApellidoNombre) AS Nombre,
				${_sqlConteoVisitasPorOrigen()}
			FROM dbo.imVisita v
			LEFT JOIN (${SQL_ORIGEN_VISITA}) tt ON tt.NumeroVisita = v.NUMEROVISITA
			OUTER APPLY (
				SELECT TOP 1 p.ApellidoNombre
				FROM dbo.imPersonal p
				WHERE p.Matricula = v.DOCTORADMISOR OR p.Valor = v.DOCTORADMISOR
				ORDER BY p.Valor
			) per
			WHERE ${condiciones.join('\n\t\t\t  AND ')}
			  AND ISNULL(v.DOCTORADMISOR, 0) > 0
			GROUP BY v.DOCTORADMISOR
			ORDER BY COUNT(*) DESC`,
			params,
		);
	} catch (error) {
		if (esObjetoSqlMissing(error)) return [];
		throw error;
	}
}

async function _consultarVisitasPorEspecialidad(filtros) {
	try {
		const { condiciones, params } = _paramsVisitasBase(filtros);
		return await executeQuery(
			`SELECT TOP 30
				COALESCE(tur.Especialidad, per.ValorEspecialidad, 0) AS Codigo,
				MAX(esp.Descripcion) AS Descripcion,
				${_sqlConteoVisitasPorOrigen()}
			FROM dbo.imVisita v
			LEFT JOIN (${SQL_ORIGEN_VISITA}) tt ON tt.NumeroVisita = v.NUMEROVISITA
			OUTER APPLY (
				SELECT TOP 1 t.Especialidad
				FROM dbo.imTurnos t
				WHERE t.NumeroVisita = v.NUMEROVISITA AND ISNULL(t.Especialidad, 0) > 0
				ORDER BY t.IdTurno
			) tur
			OUTER APPLY (
				SELECT TOP 1 p.ValorEspecialidad
				FROM dbo.imPersonal p
				WHERE p.Matricula = v.DOCTORADMISOR OR p.Valor = v.DOCTORADMISOR
				ORDER BY p.Valor
			) per
			LEFT JOIN dbo.imEspecialidad esp
				ON esp.Valor = COALESCE(tur.Especialidad, per.ValorEspecialidad, 0)
			WHERE ${condiciones.join('\n\t\t\t  AND ')}
			GROUP BY COALESCE(tur.Especialidad, per.ValorEspecialidad, 0)
			ORDER BY COUNT(*) DESC`,
			params,
		);
	} catch (error) {
		if (esObjetoSqlMissing(error)) return [];
		throw error;
	}
}

// ── Mapeo a la forma que consume el front ───────────────────────────────────

function _mapResumen(row, pct, graciaMin) {
	const programados = _num(row.Programados);
	const atendidos = _num(row.Atendidos);
	const cancelados = _num(row.Cancelados);
	const ausentes = _num(row.Ausentes);
	const pendientes = _num(row.Pendientes);
	const enSala = _num(row.EnSala);
	const enConsultorio = _num(row.EnConsultorio);
	const turnosDemanda = _num(row.TurnosDemanda);
	const atendidosDemanda = _num(row.AtendidosDemanda);
	const atendidosTotal = atendidos + atendidosDemanda;

	// El ausentismo se mide sobre los turnos que realmente debían presentarse:
	// los cancelados avisaron y no son inasistencia.
	const base = Math.max(0, programados - cancelados);

	const atendidosCobertura = _num(row.AtendidosParaCobertura);
	const conIngreso = _num(row.AtendidosConIngreso);

	return {
		graciaMin,
		programados,
		atendidos,
		cancelados,
		ausentes,
		pendientes,
		enSala,
		enConsultorio,
		enCurso: enSala + enConsultorio,
		turnosDemanda,
		atendidosDemanda,
		/** Agenda atendida + demanda atendida (mismo criterio que Admin Turnos / Estado=Atendido). */
		atendidosTotal,
		canceladosDemanda: _num(row.CanceladosDemanda),
		tasaAusentismo: _porcentaje(ausentes, base),
		tasaCancelacion: _porcentaje(cancelados, programados),
		tasaAtencion: _porcentaje(atendidos, base),
		tiempos: {
			espera: {
				muestras: _num(row.EsperaMuestras),
				promedio: _dec(row.EsperaProm),
				p50: _dec(pct.EsperaP50),
				p90: _dec(pct.EsperaP90),
				maximo: _dec(row.EsperaMax),
			},
			puntualidad: {
				muestras: _num(row.PuntualidadMuestras),
				promedio: _dec(row.PuntualidadProm),
				p50: _dec(pct.PuntualidadP50),
				p90: _dec(pct.PuntualidadP90),
			},
			permanencia: {
				muestras: _num(row.PermanenciaMuestras),
				promedio: _dec(row.PermanenciaProm),
				p50: _dec(pct.PermanenciaP50),
				p90: _dec(pct.PermanenciaP90),
			},
			consulta: {
				muestras: _num(row.ConsultaMuestras),
				promedio: _dec(row.ConsultaProm),
				p50: _dec(pct.ConsultaP50),
			},
		},
		calidadDatos: {
			atendidos: atendidosCobertura,
			conLlegada: _num(row.AtendidosConLlegada),
			conIngreso: _num(row.AtendidosConIngreso),
			conSalida: _num(row.AtendidosConSalida),
			conAmbos: _num(row.AtendidosConAmbos),
			coberturaPct: _porcentaje(conIngreso, atendidosCobertura),
		},
	};
}

function _mapSerie(rows, origenRows) {
	const origenPorFecha = new Map();
	for (const r of origenRows || []) {
		origenPorFecha.set(_iso(r.Fecha), {
			agenda: _num(r.ConTurno),
			aDemanda: _num(r.ADemanda),
		});
	}

	const fechas = new Set([
		...(rows || []).map((r) => _iso(r.Fecha)),
		...origenPorFecha.keys(),
	]);

	const porFechaTurnos = new Map((rows || []).map((r) => [_iso(r.Fecha), r]));

	return [...fechas]
		.filter(Boolean)
		.sort()
		.map((fecha) => {
			const t = porFechaTurnos.get(fecha) || {};
			const o = origenPorFecha.get(fecha) || { agenda: 0, aDemanda: 0 };
			return {
				fecha,
				programados: _num(t.Programados),
				atendidos: _num(t.Atendidos),
				cancelados: _num(t.Cancelados),
				ausentes: _num(t.Ausentes),
				pendientes: _num(t.Pendientes),
				turnosDemanda: _num(t.TurnosDemanda),
				esperaProm: _dec(t.EsperaProm),
				ambulatoriasAgenda: o.agenda,
				ambulatoriasADemanda: o.aDemanda,
				ambulatoriasTotal: o.agenda + o.aDemanda,
			};
		});
}

function _mapOrigen(origenRows) {
	let agenda = 0;
	let aDemanda = 0;
	for (const r of origenRows || []) {
		agenda += _num(r.ConTurno);
		aDemanda += _num(r.ADemanda);
	}
	const total = agenda + aDemanda;
	return {
		total,
		agenda,
		aDemanda,
		agendaPct: _porcentaje(agenda, total),
		aDemandaPct: _porcentaje(aDemanda, total),
	};
}

function _mapVisitasPorDimension(rows, campoCodigo) {
	const map = new Map();
	for (const r of rows || []) {
		const codigo =
			campoCodigo === 'Matricula'
				? String(_num(r.Matricula))
				: String(r[campoCodigo] ?? '').trim();
		if (!codigo) continue;
		if (campoCodigo === 'Matricula' && codigo === '0') continue;
		map.set(codigo, {
			codigo,
			descripcion: _txt(r.Descripcion) || _txt(r.Nombre),
			ambInt: _txt(r.AmbInt),
			conTurno: _num(r.ConTurno),
			aDemanda: _num(r.ADemanda),
		});
	}
	return map;
}

/**
 * Combina la agenda (imTurnos) con el volumen real de atenciones (imVisita).
 *
 * `aDemanda` sale de imVisita porque cuenta atenciones efectivas. Cuando la
 * visita no registra la dimensión (sector en blanco, profesional admisor
 * distinto del de la agenda) se cae a los turnos TipoTurno=1, para no perder la
 * demanda del sector.
 */
function _mergeDimensionConVisitas(turnoDims, visitaRows, campoCodigo, extra = () => ({})) {
	const visitaMap = _mapVisitasPorDimension(visitaRows, campoCodigo);
	const seen = new Set();
	const merged = [];

	for (const dim of turnoDims || []) {
		seen.add(dim.codigo);
		const v = visitaMap.get(dim.codigo);
		const conTurno = v ? v.conTurno : 0;
		const aDemanda = v ? Math.max(v.aDemanda, dim.turnosDemanda || 0) : dim.turnosDemanda || 0;
		merged.push({ ...dim, conTurno, aDemanda });
	}

	for (const [codigo, v] of visitaMap) {
		if (seen.has(codigo)) continue;
		if (v.conTurno + v.aDemanda <= 0) continue;
		merged.push({
			codigo: v.codigo,
			descripcion: v.descripcion,
			programados: 0,
			atendidos: 0,
			ausentes: 0,
			cancelados: 0,
			turnosDemanda: 0,
			tasaAusentismo: null,
			esperaProm: null,
			permanenciaProm: null,
			conTurno: v.conTurno,
			aDemanda: v.aDemanda,
			...extra(v),
		});
	}

	return merged.sort((a, b) => b.conTurno + b.aDemanda - (a.conTurno + a.aDemanda));
}

function _mapDimension(rows, campoCodigo, extra = () => ({})) {
	return (rows || []).map((r) => {
		const programados = _num(r.Programados);
		const cancelados = _num(r.Cancelados);
		const base = Math.max(0, programados - cancelados);
		return {
			codigo: r[campoCodigo] != null ? String(r[campoCodigo]).trim() : '',
			descripcion: _txt(r.Descripcion) || _txt(r.Nombre),
			programados,
			atendidos: _num(r.Atendidos),
			ausentes: _num(r.Ausentes),
			cancelados,
			turnosDemanda: _num(r.TurnosDemanda),
			tasaAusentismo: programados > 0 ? _porcentaje(_num(r.Ausentes), base || programados) : null,
			esperaProm: _dec(r.EsperaProm),
			permanenciaProm: _dec(r.PermanenciaProm),
			...extra(r),
		};
	});
}

function _mapHeatmap(rows) {
	return (rows || []).map((r) => ({
		diaSemana: _num(r.DiaSemana),
		hora: _num(r.Hora),
		programados: _num(r.Programados),
		ausentes: _num(r.Ausentes),
		esperaProm: _dec(r.EsperaProm),
		permanenciaProm: _dec(r.PermanenciaProm),
	}));
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Payload completo de la página de analítica ambulatoria.
 * @param {object} filtrosIn - fechaInicio, fechaFin, graciaMin, sector, profesional, especialidad
 */
async function obtenerAnaliticaAmbulatoria(filtrosIn = {}) {
	const filtros = normalizarFiltros(filtrosIn);
	const { cte, params } = await _contextoTurnos(filtros);

	const [resumenRow, percentiles, serieRows, origenRows, espRows, secRows, profRows, heatRows, visSecRows, visEspRows, visProfRows] =
		await Promise.all([
			_consultarResumen(cte, params),
			_consultarPercentiles(cte, params),
			_consultarSerie(cte, params),
			_consultarOrigen(filtros),
			_consultarPorEspecialidad(cte, params),
			_consultarPorSector(cte, params),
			_consultarPorProfesional(cte, params),
			_consultarHeatmap(cte, params),
			_consultarVisitasPorSector(filtros),
			_consultarVisitasPorEspecialidad(filtros),
			_consultarVisitasPorProfesional(filtros),
		]);

	const porEspecialidad = _mergeDimensionConVisitas(
		_mapDimension(espRows, 'Codigo'),
		visEspRows,
		'Codigo',
	).map((e) =>
		e.codigo === '0' ? { ...e, descripcion: e.descripcion || 'Sin especialidad registrada' } : e,
	);
	const porSector = _mergeDimensionConVisitas(
		_mapDimension(secRows, 'Codigo', (r) => ({ ambInt: _txt(r.AmbInt) })),
		visSecRows,
		'Codigo',
		(r) => ({ ambInt: r.ambInt ?? null }),
	);
	const porProfesional = _mergeDimensionConVisitas(
		_mapDimension(profRows, 'Matricula', (r) => ({ consultaProm: _dec(r.ConsultaProm) })),
		visProfRows,
		'Matricula',
	);

	return {
		periodo: {
			fechaInicio: filtros.fechaInicio,
			fechaFin: filtros.fechaFin,
			graciaMin: filtros.graciaMin,
		},
		filtros: {
			sector: filtros.sector,
			profesional: filtros.profesional,
			especialidad: filtros.especialidad,
		},
		resumen: _mapResumen(resumenRow, percentiles, filtros.graciaMin),
		porOrigen: _mapOrigen(origenRows),
		serie: _mapSerie(serieRows, origenRows),
		porEspecialidad,
		porSector,
		porProfesional,
		heatmap: _mapHeatmap(heatRows),
	};
}

/**
 * Payload liviano para la card del dashboard: estado de hoy y comparación de
 * atendidos contra ayer. No calcula rankings ni series.
 */
async function obtenerResumenAmbulatorioHoy(graciaMinIn) {
	const hoy = fechaCalendarioArgentina();
	const ayer = fechaIsoOffsetArgentina(-1);

	const filtrosHoy = normalizarFiltros({
		fechaInicio: hoy,
		fechaFin: hoy,
		graciaMin: graciaMinIn,
	});
	const filtrosAyer = { ...filtrosHoy, fechaInicio: ayer, fechaFin: ayer };

	const [ctxHoy, ctxAyer] = await Promise.all([
		_contextoTurnos(filtrosHoy),
		_contextoTurnos(filtrosAyer),
	]);

	const [rowHoy, rowAyer, origenHoy] = await Promise.all([
		_consultarResumen(ctxHoy.cte, ctxHoy.params),
		_consultarResumen(ctxAyer.cte, ctxAyer.params),
		_consultarOrigen({ fechaInicio: hoy, fechaFin: hoy }),
	]);

	const hoyMap = _mapResumen(rowHoy, {}, filtrosHoy.graciaMin);
	const origen = _mapOrigen(origenHoy);

	return {
		fecha: hoy,
		graciaMin: filtrosHoy.graciaMin,
		programados: hoyMap.programados,
		atendidos: hoyMap.atendidosTotal,
		atendidosAgenda: hoyMap.atendidos,
		atendidosDemanda: hoyMap.atendidosDemanda,
		pendientes: hoyMap.pendientes,
		ausentes: hoyMap.ausentes,
		cancelados: hoyMap.cancelados,
		enCurso: hoyMap.enCurso,
		tasaAusentismo: hoyMap.tasaAusentismo,
		esperaPromedioMin: hoyMap.tiempos.espera.promedio,
		coberturaPct: hoyMap.calidadDatos.coberturaPct,
		ambulatoriasTotal: origen.total,
		ambulatoriasADemanda: origen.aDemanda,
		porcentajeCambioAtendidos: _variacion(
			hoyMap.atendidosTotal,
			_num(rowAyer.Atendidos) + _num(rowAyer.AtendidosDemanda),
		),
	};
}

module.exports = {
	obtenerAnaliticaAmbulatoria,
	obtenerResumenAmbulatorioHoy,
	normalizarFiltros,
	GRACIA_MIN_DEFAULT,
	GRACIA_MIN_MAX,
};
