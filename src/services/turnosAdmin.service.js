/**
 * Administrador de turnos — listado global imTurnos con filtros y paginación.
 */
const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirFechaClarionADate,
	convertirHoraClarionAString,
} = require('../utils/dateUtils');
const {
	STATUS_TURNO,
	STATUS_OCUPADO,
	STATUS_CANCELADO,
	STATUS_ATENDIDO,
	TIPO_TURNO_SOBRETURNO,
} = require('../utils/agendaCatalogos');
const {
	resolverCancelacion,
	ensureColumnasCancelacion,
	tieneTurnosLog,
} = require('../utils/turnoCancelacion');

const SQL_SELECT = `
  SELECT
    t.IdTurno, t.Dia, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional,
    t.Sector, t.Horallegada, t.HoraIngreso, t.HoraSalida, t.Especialidad,
    t.Observaciones, t.FechaCarga, t.HoraCarga, t.CodOperador, t.Status, t.TipoTurno,
    t.NumeroVisita, t.NumeroDocumento, t.MotivoCancelacion, t.IdClasificacionTriage,
    t.OperadorCancelacion, t.OrigenCancelacion, t.EsLog,
    pac.ApellidoyNombre AS PacienteNombre,
    per.ApellidoNombre AS ProfesionalNombre,
    LTRIM(RTRIM(
      COALESCE(op.Apellido, '') +
      CASE WHEN op.Apellido IS NOT NULL AND op.Nombres IS NOT NULL THEN ' ' ELSE '' END +
      COALESCE(op.Nombres, '')
    )) AS PersonalAtendioNombre,
    opCan.Apellido AS OpCanApellido,
    opCan.Nombres AS OpCanNombres,
    diag.Diagnostico AS DiagnosticoCodigo`;

async function _sqlFrom() {
	const [tieneLog, tieneCols] = await Promise.all([
		tieneTurnosLog(),
		ensureColumnasCancelacion(),
	]);
	const cancelCols = tieneCols
		? 't.OperadorCancelacion, t.OrigenCancelacion, CAST(0 AS TINYINT) AS EsLog'
		: 'CAST(NULL AS INT) AS OperadorCancelacion, CAST(NULL AS VARCHAR(12)) AS OrigenCancelacion, CAST(0 AS TINYINT) AS EsLog';
	const live = `SELECT t.IdTurno, t.Dia, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional,
    t.Sector, t.Horallegada, t.HoraIngreso, t.HoraSalida, t.Especialidad,
    t.Observaciones, t.FechaCarga, t.HoraCarga, t.CodOperador, t.Status, t.TipoTurno,
    t.NumeroVisita, t.NumeroDocumento, t.MotivoCancelacion, t.IdClasificacionTriage,
    ${cancelCols}
    FROM dbo.imTurnos t`;
	const log = tieneLog
		? `UNION ALL
    SELECT l.IdTurno, l.Dia, l.FechaAsignada, l.HoraAsignada, l.IDPaciente, l.Profesional,
    l.Sector, l.Horallegada, l.HoraIngreso, l.HoraSalida, l.Especialidad,
    l.Observaciones, l.FechaCarga, l.HoraCarga, l.CodOperador, l.Status, l.TipoTurno,
    l.NumeroVisita, l.NumeroDocumento, l.MotivoCancelacion, l.IdClasificacionTriage,
    CAST(NULL AS INT) AS OperadorCancelacion, CAST(NULL AS VARCHAR(12)) AS OrigenCancelacion,
    CAST(1 AS TINYINT) AS EsLog
    FROM dbo.imTurnosLog l
    WHERE l.Status = ${STATUS_CANCELADO}
      AND ISNULL(l.IDPaciente, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM dbo.imTurnos v WHERE v.IdTurno = l.IdTurno)`
		: '';
	return `
  FROM (${live}
    ${log}) t
  LEFT JOIN dbo.imPacientes pac ON pac.IDPaciente = t.IDPaciente
  LEFT JOIN dbo.imPersonal per ON per.Matricula = t.Profesional
  LEFT JOIN dbo.imPassword op ON op.CodOperador = t.CodOperador
  LEFT JOIN dbo.imPassword opCan
    ON t.OperadorCancelacion IS NOT NULL AND t.OperadorCancelacion > 0
   AND (opCan.CodOperador = t.OperadorCancelacion OR opCan.ValorPersonal = t.OperadorCancelacion)
  OUTER APPLY (
    SELECT TOP 1 vm.Diagnostico
    FROM dbo.imVisitaMovimiento vm
    WHERE vm.NumeroVisita = t.NumeroVisita AND t.NumeroVisita > 0
    ORDER BY vm.FechaAdmision DESC, vm.HoraAdmision DESC
  ) diag`;
}

function _isoDate(d) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

function _hhmm(clarion) {
	if (!clarion) return null;
	const s = convertirHoraClarionAString(clarion);
	return s ? s.slice(0, 5) : null;
}

function _estadoLabel(status) {
	if (status == null) return 'LIBRE';
	const n = Number(status);
	if (n === STATUS_OCUPADO) return 'OCUPADO';
	if (n === STATUS_CANCELADO) return 'CANCELADO';
	if (n === STATUS_ATENDIDO) return 'ATENDIDO';
	return STATUS_TURNO[n] || `S${n}`;
}

function _tipoTurnoLabel(tt) {
	const n = Number(tt) || 0;
	return n === TIPO_TURNO_SOBRETURNO ? 'SOBRETURNO' : 'GRILLA';
}

function _mapRow(r) {
	const hs = Number(r.HoraSalida) || 0;
	const fecha = convertirFechaClarionADate(r.FechaAsignada);
	return {
		idTurno: r.IdTurno,
		dia: r.Dia ? String(r.Dia).trim() : null,
		fecha: fecha ? _isoDate(fecha) : null,
		hora: _hhmm(r.HoraAsignada),
		horaClarion: Number(r.HoraAsignada) || null,
		idPaciente: r.IDPaciente,
		pacienteNombre: r.PacienteNombre ? String(r.PacienteNombre).trim() : null,
		numeroDocumento: r.NumeroDocumento ?? null,
		profesional: r.Profesional,
		profesionalNombre: r.ProfesionalNombre
			? String(r.ProfesionalNombre).trim()
			: null,
		sector: String(r.Sector || '').trim(),
		horallegada: _hhmm(r.Horallegada),
		horaIngreso: _hhmm(r.HoraIngreso),
		horaSalida: hs > 0 ? _hhmm(hs) : null,
		horaAtencion: hs > 0 ? _hhmm(hs) : null,
		especialidad: r.Especialidad,
		observaciones: r.Observaciones ? String(r.Observaciones).trim() : null,
		fechaCarga: r.FechaCarga
			? _isoDate(convertirFechaClarionADate(r.FechaCarga))
			: null,
		horaCarga: _hhmm(r.HoraCarga),
		codOperador: r.CodOperador,
		status: r.Status,
		estado: _estadoLabel(r.Status),
		esLog: Number(r.EsLog) === 1,
		tipoTurno: r.TipoTurno,
		tipoTurnoLabel: _tipoTurnoLabel(r.TipoTurno),
		numeroVisita: r.NumeroVisita,
		...resolverCancelacion(r),
		idClasificacionTriage: r.IdClasificacionTriage,
		diagnostico: r.DiagnosticoCodigo
			? String(r.DiagnosticoCodigo).trim()
			: null,
		personalAtendio: r.PersonalAtendioNombre
			? String(r.PersonalAtendioNombre).trim()
			: null,
	};
}

function _buildWhere(filtros) {
	const parts = [];
	const params = [];
	let i = 0;

	const add = (sql, value, type) => {
		parts.push(sql.replace(/\$i/g, `@p${i}`));
		params.push({ value, type });
		i += 1;
	};

	if (filtros.fechaDesde) {
		add('t.FechaAsignada >= $i', convertirFechaAClarion(filtros.fechaDesde), 'Int');
	}
	if (filtros.fechaHasta) {
		add('t.FechaAsignada <= $i', convertirFechaAClarion(filtros.fechaHasta), 'Int');
	}
	if (filtros.status !== '' && filtros.status != null) {
		add('t.Status = $i', Number(filtros.status), 'TinyInt');
	}
	if (filtros.tipoTurno !== '' && filtros.tipoTurno != null) {
		add('t.TipoTurno = $i', Number(filtros.tipoTurno), 'TinyInt');
	}
	if (filtros.sector) {
		add('LTRIM(RTRIM(t.Sector)) = $i', String(filtros.sector).trim().slice(0, 4), 'VarChar');
	}
	if (filtros.profesional) {
		add('t.Profesional = $i', Number(filtros.profesional), 'Int');
	}
	if (filtros.triage !== '' && filtros.triage != null) {
		if (Number(filtros.triage) === 0) {
			parts.push('(t.IdClasificacionTriage IS NULL OR t.IdClasificacionTriage = 0)');
		} else {
			add('t.IdClasificacionTriage = $i', Number(filtros.triage), 'Int');
		}
	}
	if (filtros.idTurno) {
		add('t.IdTurno = $i', Number(filtros.idTurno), 'Int');
	}
	if (filtros.idPaciente) {
		add('t.IDPaciente = $i', Number(filtros.idPaciente), 'Int');
	}
	if (filtros.numeroDocumento) {
		add('t.NumeroDocumento = $i', Number(filtros.numeroDocumento), 'Int');
	}
	if (filtros.q) {
		const q = `%${String(filtros.q).trim()}%`;
		parts.push(`(
			pac.ApellidoyNombre LIKE @p${i}
			OR CAST(t.NumeroDocumento AS VARCHAR(20)) LIKE @p${i + 1}
			OR CAST(t.IdTurno AS VARCHAR(20)) LIKE @p${i + 2}
			OR t.Observaciones LIKE @p${i + 3}
			OR per.ApellidoNombre LIKE @p${i + 4}
		)`);
		params.push(
			{ value: q },
			{ value: q },
			{ value: q },
			{ value: q },
			{ value: q },
		);
		i += 5;
	}

	const whereSql = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
	return { whereSql, params };
}

/**
 * @param {object} filtros
 * @param {number} page
 * @param {number} limit
 */
async function listar(filtros = {}, page = 1, limit = 25) {
	const p = Math.max(1, Number(page) || 1);
	const l = Math.min(100, Math.max(1, Number(limit) || 25));
	const offset = (p - 1) * l;

	const { whereSql, params } = _buildWhere(filtros);
	const sqlFrom = await _sqlFrom();

	const countRows = await executeQuery(
		`SELECT COUNT(*) AS total ${sqlFrom} ${whereSql}`,
		params,
	);
	const total = Number(countRows[0]?.total) || 0;

	const dataParams = [...params, { value: offset, type: 'Int' }, { value: l, type: 'Int' }];
	const rows = await executeQuery(
		`${SQL_SELECT}
		 ${sqlFrom}
		 ${whereSql}
		 ORDER BY t.FechaAsignada DESC, t.HoraAsignada DESC, t.IdTurno DESC
		 OFFSET @p${params.length} ROWS FETCH NEXT @p${params.length + 1} ROWS ONLY`,
		dataParams,
	);

	return {
		data: rows.map(_mapRow),
		pagination: {
			page: p,
			limit: l,
			total,
			totalPages: Math.max(1, Math.ceil(total / l)),
		},
	};
}

module.exports = { listar };
