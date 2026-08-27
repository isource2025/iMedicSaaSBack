/**
 * Analítica ambulatoria — indicadores derivados de la agenda (imTurnos) y de las
 * visitas ambulatorias (imVisita con ClasePaciente = 'A').
 *
 * Universo de datos
 * -----------------
 * Toda consulta ambulatoria entra por uno de dos caminos, y las métricas de
 * volumen los discriminan siempre:
 *   • AGENDA     → la visita tiene un turno asociado (imTurnos.NumeroVisita).
 *   • ESPONTANEO → visita ambulatoria sin turno (demanda no programada).
 *
 * Inasistencia
 * ------------
 * imTurnos no tiene estado "ausente": Status sólo admite 0=OCUPADO, 1=CANCELADO,
 * 3=ATENDIDO (más un 2 legacy que algunos tenants usan como atendido). La
 * inasistencia se infiere: turno ocupado cuyo instante programado + `graciaMin`
 * ya pasó, sin llegada marcada, sin cierre y sin visita. Dentro de la ventana de
 * gracia el turno sigue siendo PENDIENTE, no ausente.
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
			${_intervalo('u.HoraAsignada', 'u.Horallegada')} AS MinPuntualidad,
			${_intervalo('u.Horallegada', 'u.HoraIngreso')} AS MinEspera,
			${_intervalo('u.HoraAsignada', 'u.HoraIngreso')} AS MinRetraso,
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
				WHEN ISNULL(b.Horallegada, 0) > 0 THEN 'EN_SALA'
				WHEN DATEADD(MINUTE, @p2, b.InstanteTurno) < CONVERT(DATETIME, @p3, 120)
				     THEN 'AUSENTE'
				ELSE 'PENDIENTE'
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
		COUNT(${p}MinRetraso) AS RetrasoMuestras,
		AVG(${p}MinRetraso) AS RetrasoProm,
		COUNT(${p}MinConsulta) AS ConsultaMuestras,
		AVG(${p}MinConsulta) AS ConsultaProm`;
}

// ── Consultas ───────────────────────────────────────────────────────────────

async function _consultarResumen(cte, params) {
	const rows = await executeQuery(
		`${cte}
		SELECT
			COUNT(*) AS Programados,
			SUM(CASE WHEN Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN Estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS Pendientes,
			SUM(CASE WHEN Estado = 'EN_SALA' THEN 1 ELSE 0 END) AS EnSala,
			SUM(CASE WHEN Estado = 'EN_CONSULTORIO' THEN 1 ELSE 0 END) AS EnConsultorio,
			SUM(CASE WHEN TipoTurno = 1 THEN 1 ELSE 0 END) AS Sobreturnos,
			${_agregadosTiempo()},
			SUM(CASE WHEN Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS AtendidosParaCobertura,
			SUM(CASE WHEN Estado = 'ATENDIDO' AND ISNULL(Horallegada, 0) > 0
			         THEN 1 ELSE 0 END) AS AtendidosConLlegada,
			SUM(CASE WHEN Estado = 'ATENDIDO' AND ISNULL(HoraIngreso, 0) > 0
			         THEN 1 ELSE 0 END) AS AtendidosConIngreso,
			SUM(CASE WHEN Estado = 'ATENDIDO' AND ISNULL(Horallegada, 0) > 0
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
async function _consultarPercentiles(cte, params) {
	const pct = (col, q) =>
		`CAST(PERCENTILE_CONT(${q}) WITHIN GROUP (ORDER BY ${col}) OVER () AS DECIMAL(10,2))`;
	try {
		const rows = await executeQuery(
			`${cte}
			SELECT DISTINCT
				${pct('MinEspera', 0.5)} AS EsperaP50,
				${pct('MinEspera', 0.9)} AS EsperaP90,
				${pct('MinPuntualidad', 0.5)} AS PuntualidadP50,
				${pct('MinRetraso', 0.5)} AS RetrasoP50,
				${pct('MinRetraso', 0.9)} AS RetrasoP90,
				${pct('MinConsulta', 0.5)} AS ConsultaP50
			FROM TurnosEstado`,
			params,
		);
		return rows?.[0] || {};
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
			COUNT(*) AS Programados,
			SUM(CASE WHEN Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			SUM(CASE WHEN Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN Estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS Pendientes,
			AVG(MinEspera) AS EsperaProm
		FROM TurnosEstado
		GROUP BY FechaTurno
		ORDER BY FechaTurno`,
		params,
	);
}

async function _consultarPorEspecialidad(cte, params) {
	return executeQuery(
		`${cte}
		SELECT TOP 30
			te.Especialidad AS Codigo,
			MAX(esp.Descripcion) AS Descripcion,
			COUNT(*) AS Programados,
			SUM(CASE WHEN te.Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN te.Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			AVG(te.MinEspera) AS EsperaProm
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
			COUNT(*) AS Programados,
			SUM(CASE WHEN te.Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN te.Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			AVG(te.MinEspera) AS EsperaProm
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
			COUNT(*) AS Programados,
			SUM(CASE WHEN te.Estado = 'ATENDIDO' THEN 1 ELSE 0 END) AS Atendidos,
			SUM(CASE WHEN te.Estado = 'AUSENTE' THEN 1 ELSE 0 END) AS Ausentes,
			SUM(CASE WHEN te.Estado = 'CANCELADO' THEN 1 ELSE 0 END) AS Cancelados,
			AVG(te.MinEspera) AS EsperaProm,
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
			AVG(MinEspera) AS EsperaProm
		FROM TurnosEstado
		GROUP BY ${SQL_DIA_SEMANA}, DATEPART(HOUR, InstanteTurno)
		ORDER BY DiaSemana, Hora`,
		params,
	);
}

/**
 * Volumen de consultas ambulatorias reales (imVisita) separando las que nacen de
 * un turno de agenda de las espontáneas.
 */
async function _consultarOrigen(filtros) {
	try {
		return await executeQuery(
			`SELECT
				CAST(v.FechaAdmisionS AS DATE) AS Fecha,
				SUM(CASE WHEN tt.NumeroVisita IS NOT NULL THEN 1 ELSE 0 END) AS Agenda,
				SUM(CASE WHEN tt.NumeroVisita IS NULL THEN 1 ELSE 0 END) AS Espontaneo
			FROM dbo.imVisita v
			LEFT JOIN (
				SELECT DISTINCT NumeroVisita
				FROM dbo.imTurnos
				WHERE ISNULL(NumeroVisita, 0) > 0
			) tt ON tt.NumeroVisita = v.NumeroVisita
			WHERE UPPER(LTRIM(RTRIM(ISNULL(v.ClasePaciente, '')))) = 'A'
			  AND v.FechaAdmisionS >= @p0
			  AND v.FechaAdmisionS < DATEADD(DAY, 1, @p1)
			GROUP BY CAST(v.FechaAdmisionS AS DATE)
			ORDER BY CAST(v.FechaAdmisionS AS DATE)`,
			[{ value: filtros.fechaInicio }, { value: filtros.fechaFin }],
		);
	} catch (error) {
		if (esObjetoSqlMissing(error)) {
			console.warn('[ambulatorio] imVisita no disponible, se omite el split por origen');
			return [];
		}
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

	// El ausentismo se mide sobre los turnos que realmente debían presentarse:
	// los cancelados avisaron y no son inasistencia.
	const base = Math.max(0, programados - cancelados);

	const atendidosCobertura = _num(row.AtendidosParaCobertura);
	const conAmbos = _num(row.AtendidosConAmbos);

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
		sobreturnos: _num(row.Sobreturnos),
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
			},
			retraso: {
				muestras: _num(row.RetrasoMuestras),
				promedio: _dec(row.RetrasoProm),
				p50: _dec(pct.RetrasoP50),
				p90: _dec(pct.RetrasoP90),
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
			conAmbos,
			coberturaPct: _porcentaje(conAmbos, atendidosCobertura),
		},
	};
}

function _mapSerie(rows, origenRows) {
	const origenPorFecha = new Map();
	for (const r of origenRows || []) {
		origenPorFecha.set(_iso(r.Fecha), {
			agenda: _num(r.Agenda),
			espontaneo: _num(r.Espontaneo),
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
			const o = origenPorFecha.get(fecha) || { agenda: 0, espontaneo: 0 };
			return {
				fecha,
				programados: _num(t.Programados),
				atendidos: _num(t.Atendidos),
				cancelados: _num(t.Cancelados),
				ausentes: _num(t.Ausentes),
				pendientes: _num(t.Pendientes),
				esperaProm: _dec(t.EsperaProm),
				ambulatoriasAgenda: o.agenda,
				ambulatoriasEspontaneas: o.espontaneo,
				ambulatoriasTotal: o.agenda + o.espontaneo,
			};
		});
}

function _mapOrigen(origenRows) {
	let agenda = 0;
	let espontaneo = 0;
	for (const r of origenRows || []) {
		agenda += _num(r.Agenda);
		espontaneo += _num(r.Espontaneo);
	}
	const total = agenda + espontaneo;
	return {
		total,
		agenda,
		espontaneo,
		agendaPct: _porcentaje(agenda, total),
		espontaneoPct: _porcentaje(espontaneo, total),
	};
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
			tasaAusentismo: _porcentaje(_num(r.Ausentes), base || programados),
			esperaProm: _dec(r.EsperaProm),
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

	const [resumenRow, percentiles, serieRows, origenRows, espRows, secRows, profRows, heatRows] =
		await Promise.all([
			_consultarResumen(cte, params),
			_consultarPercentiles(cte, params),
			_consultarSerie(cte, params),
			_consultarOrigen(filtros),
			_consultarPorEspecialidad(cte, params),
			_consultarPorSector(cte, params),
			_consultarPorProfesional(cte, params),
			_consultarHeatmap(cte, params),
		]);

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
		porEspecialidad: _mapDimension(espRows, 'Codigo'),
		porSector: _mapDimension(secRows, 'Codigo', (r) => ({ ambInt: _txt(r.AmbInt) })),
		porProfesional: _mapDimension(profRows, 'Matricula', (r) => ({
			cancelados: _num(r.Cancelados),
			consultaProm: _dec(r.ConsultaProm),
		})),
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
		atendidos: hoyMap.atendidos,
		pendientes: hoyMap.pendientes,
		ausentes: hoyMap.ausentes,
		cancelados: hoyMap.cancelados,
		enCurso: hoyMap.enCurso,
		tasaAusentismo: hoyMap.tasaAusentismo,
		esperaPromedioMin: hoyMap.tiempos.espera.promedio,
		coberturaPct: hoyMap.calidadDatos.coberturaPct,
		ambulatoriasTotal: origen.total,
		ambulatoriasEspontaneas: origen.espontaneo,
		porcentajeCambioAtendidos: _variacion(hoyMap.atendidos, _num(rowAyer.Atendidos)),
	};
}

module.exports = {
	obtenerAnaliticaAmbulatoria,
	obtenerResumenAmbulatorioHoy,
	normalizarFiltros,
	GRACIA_MIN_DEFAULT,
	GRACIA_MIN_MAX,
};
