/**
 * Service: Agenda operativa (slots + turnos en imTurnos).
 */
const { executeQuery } = require('../models/db');
const adjuntosService = require('./adjuntos.service');
const agendaRacService = require('./agendaRac.service');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	convertirFechaClarionADate,
	convertirHoraClarionAString,
	fechaCalendarioArgentina,
	horaWallArgentina,
	horaClarionAhoraArgentina,
} = require('../utils/dateUtils');
const {
	DIAS_SEMANA,
	clarionAIntervaloMin,
	clarionPasoMinutos,
	TIPO_TURNO_GRILLA,
	TIPO_TURNO_SOBRETURNO,
	STATUS_TURNO,
	STATUS_OCUPADO,
	STATUS_CANCELADO,
	STATUS_ATENDIDO,
	HORA_TURNO_TOLERANCIA,
	horaClaveTurno,
	horasTurnoEquivalentes,
} = require('../utils/agendaCatalogos');
const agendaConfig = require('./agendaConfig.service');

const DIA_POR_JS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

function _validarMatricula(matricula) {
	const m = Number(matricula);
	if (!Number.isFinite(m) || m <= 0) {
		const e = new Error('Matrícula inválida');
		e.statusCode = 400;
		throw e;
	}
	return m;
}

function _isoDate(d) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

function _parseIso(iso) {
	const [y, mo, d] = String(iso).split('-').map(Number);
	return new Date(y, mo - 1, d);
}

function _hhmm(clarion) {
	if (!clarion) return null;
	const s = convertirHoraClarionAString(clarion);
	return s ? s.slice(0, 5) : null;
}

/** Nombre del operador (imPassword) por CodOperador o Valor personal. */
async function _nombreOperador(cod) {
	const n = Number(cod);
	if (!Number.isFinite(n) || n <= 0) return null;
	const rows = await executeQuery(
		`SELECT TOP 1 Apellido, Nombres FROM dbo.imPassword
		 WHERE CodOperador = @p0 OR ValorPersonal = @p0`,
		[{ value: n, type: 'Int' }],
	);
	if (!rows[0]) return null;
	return `${rows[0].Apellido || ''} ${rows[0].Nombres || ''}`.trim() || null;
}

function _calcularEdad(fechaIso) {
	if (!fechaIso) return null;
	const born = new Date(`${String(fechaIso).slice(0, 10)}T12:00:00`);
	if (Number.isNaN(born.getTime())) return null;
	const today = new Date();
	let age = today.getFullYear() - born.getFullYear();
	const m = today.getMonth() - born.getMonth();
	if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age -= 1;
	return age >= 0 && age < 150 ? age : null;
}

function _fechaNacimientoIso(turno) {
	const raw = turno?.FechaNacimientoIso ?? turno?.FechaNacimiento;
	if (!raw) return null;
	if (raw instanceof Date && !Number.isNaN(raw.getTime())) return _isoDate(raw);
	const s = String(raw).trim();
	if (!s) return null;
	return s.length >= 10 ? s.slice(0, 10) : s;
}

/** Campos de paciente, triage y horas de atención desde fila de turno + join. */
function _slotExtrasFromTurno(turno) {
		if (!turno) {
		return {
			idClasificacionTriage: null,
			horaLlegada: null,
			horaIngreso: null,
			horaAtencion: null,
			horaSalida: null,
			numeroVisita: 0,
			sexo: null,
			fechaNacimiento: null,
			edad: null,
			cobertura: null,
			racControles: 0,
			racMedicacion: 0,
		};
	}
	const hl = Number(turno.Horallegada) || 0;
	const hi = Number(turno.HoraIngreso) || 0;
	const hs = Number(turno.HoraSalida) || 0;
	const fechaNac = _fechaNacimientoIso(turno);
	return {
		idClasificacionTriage:
			turno.IdClasificacionTriage != null ? Number(turno.IdClasificacionTriage) : null,
		horaLlegada: hl > 0 ? _hhmm(hl) : null,
		horaIngreso: hi > 0 ? _hhmm(hi) : null,
		horaSalida: hs > 0 ? _hhmm(hs) : null,
		numeroVisita: Number(turno.NumeroVisita) || 0,
		/** Compat: atendido = HoraSalida registrada */
		horaAtencion: hs > 0 ? _hhmm(hs) : null,
		sexo: turno.Sexo ? String(turno.Sexo).trim() : null,
		fechaNacimiento: fechaNac,
		edad: _calcularEdad(fechaNac),
		cobertura: turno.Cobertura ? String(turno.Cobertura).trim() : null,
		racControles: 0,
		racMedicacion: 0,
	};
}

const SQL_PACIENTE_JOIN = `
  LEFT JOIN dbo.imPacientes pac ON pac.IDPaciente = t.IDPaciente
  LEFT JOIN dbo.imClientes c ON c.Valor = pac.NumeroCuenta`;

const SQL_PACIENTE_COLS = `
  pac.ApellidoyNombre AS PacienteNombre,
  pac.Sexo,
  CASE
    WHEN pac.FechaNacimiento IS NULL OR pac.FechaNacimiento <= 0 OR pac.FechaNacimiento > 1000000 THEN NULL
    ELSE CONVERT(varchar(10), DATEADD(DAY, pac.FechaNacimiento, '1800-12-28'), 23)
  END AS FechaNacimientoIso,
  c.RazonSocial AS Cobertura`;

async function _racResumenPorTurnos(idTurnos) {
	const map = new Map();
	const ids = [...new Set(idTurnos.map(Number).filter((n) => n > 0))];
	if (!ids.length) return map;
	const list = ids.join(',');
	const [ctrlRows, medRows] = await Promise.all([
		executeQuery(
			`SELECT IdTurno, COUNT(*) AS cant
			 FROM dbo.imInterCtrlFrecuente
			 WHERE IdTurno IN (${list})
			 GROUP BY IdTurno`,
		),
		executeQuery(
			`SELECT IdTurno, COUNT(*) AS cant
			 FROM dbo.imInterCtrlMedicamento
			 WHERE IdTurno IN (${list})
			 GROUP BY IdTurno`,
		),
	]);
	for (const id of ids) map.set(id, { controles: 0, medicacion: 0 });
	for (const r of ctrlRows) {
		const id = Number(r.IdTurno);
		const cur = map.get(id) || { controles: 0, medicacion: 0 };
		cur.controles = Number(r.cant) || 0;
		map.set(id, cur);
	}
	for (const r of medRows) {
		const id = Number(r.IdTurno);
		const cur = map.get(id) || { controles: 0, medicacion: 0 };
		cur.medicacion = Number(r.cant) || 0;
		map.set(id, cur);
	}
	return map;
}

function _aplicarRacResumenASlots(slots, racMap) {
	for (const s of slots) {
		if (!s.idTurno) continue;
		const r = racMap.get(Number(s.idTurno));
		if (r) {
			s.racControles = r.controles;
			s.racMedicacion = r.medicacion;
		}
	}
}

function _diaSemana(date) {
	return DIA_POR_JS[date.getDay()];
}

/** Normaliza código de servicio (trim + mayúsculas). */
function _normServicioCode(v) {
	return String(v ?? '')
		.trim()
		.toUpperCase();
}

/**
 * Resuelve filtro de servicio (Valor imServicios, Descripción o IdServicio) a tokens comparables.
 */
async function _tokensServicioFiltro(servicioFiltro) {
	const raw = String(servicioFiltro || '').trim();
	if (!raw) return null;
	const tokens = new Set([_normServicioCode(raw)]);
	const rows = await executeQuery(
		`SELECT Valor, Descripcion FROM dbo.imServicios
		 WHERE RTRIM(Valor) = @p0
		    OR RTRIM(Descripcion) = @p0
		    OR UPPER(RTRIM(Descripcion)) = UPPER(@p0)
		    OR UPPER(RTRIM(Valor)) = UPPER(@p0)`,
		[{ value: raw, type: 'VarChar' }],
	);
	for (const r of rows) {
		const v = _normServicioCode(r.Valor);
		const d = _normServicioCode(r.Descripcion);
		if (v) tokens.add(v);
		if (d) tokens.add(d);
	}
	return tokens;
}

function _horarioCoincideServicio(r, tokens) {
	if (!tokens || !tokens.size) return true;
	const idServ = _normServicioCode(r.IdServicio);
	const valServ = _normServicioCode(r.ValorServicio);
	for (const t of tokens) {
		if (!t) continue;
		if (idServ === t || valServ === t) return true;
		if (t.length >= 2 && idServ && (idServ.startsWith(t) || t.startsWith(idServ))) {
			return true;
		}
	}
	return false;
}

function _estadoLabel(status) {
	if (status == null) return 'LIBRE';
	const n = Number(status);
	if (n === STATUS_OCUPADO) return 'OCUPADO';
	if (n === STATUS_CANCELADO) return 'CANCELADO';
	if (n === STATUS_ATENDIDO) return 'ATENDIDO';
	return STATUS_TURNO[n] || `S${n}`;
}

function _turnoOcupaSlot(turno) {
	if (!turno) return false;
	const idP = Number(turno.IDPaciente) || 0;
	if (idP <= 0) return false;
	const st = turno.Status != null ? Number(turno.Status) : STATUS_OCUPADO;
	return st !== STATUS_CANCELADO;
}

/** Estado visual del slot (CANCELADO se muestra aunque el cupo esté disponible para reasignar). */
function _estadoSlotDesdeTurno(turno) {
	if (!turno) return 'LIBRE';
	const st = turno.Status != null ? Number(turno.Status) : STATUS_OCUPADO;
	if (st === STATUS_CANCELADO) return 'CANCELADO';
	if (!_turnoOcupaSlot(turno)) return 'LIBRE';
	return _estadoLabel(st);
}

function _prioridadTurnoEnMapa(turno) {
	if (!turno) return 0;
	if (_turnoOcupaSlot(turno)) return 3;
	if (Number(turno.Status) === STATUS_CANCELADO) return 2;
	const idP = Number(turno.IDPaciente) || 0;
	return idP > 0 ? 1 : 0;
}

function _slotDesdeTurno(turno, sectorDefault) {
	const horaClarion = Number(turno.HoraAsignada);
	const tt = Number(turno.TipoTurno) || 0;
	const ocupa = _turnoOcupaSlot(turno);
	const hora = _hhmm(horaClarion);
	return {
		hora,
		horaClarion,
		sector: String(turno.Sector || sectorDefault || '')
			.trim()
			.slice(0, 4),
		estado: _estadoSlotDesdeTurno(turno),
		status: turno?.Status ?? null,
		tipoTurno: tt,
		esSobreturno: tt === TIPO_TURNO_SOBRETURNO,
		idTurno: turno?.IdTurno ?? null,
		idPaciente: Number(turno.IDPaciente) || null,
		pacienteNombre: turno.PacienteNombre ? String(turno.PacienteNombre).trim() : null,
		numeroDocumento: turno.NumeroDocumento ?? null,
		observaciones: turno.Observaciones ?? null,
		motivoCancelacion: turno.MotivoCancelacion ?? null,
		..._slotExtrasFromTurno(turno),
	};
}

/** En el mapa de turnos, prioriza activo > cancelado > placeholder vacío. */
function _mapSetTurnoPreferPaciente(map, key, turno) {
	const prev = map.get(key);
	if (!prev || _prioridadTurnoEnMapa(turno) > _prioridadTurnoEnMapa(prev)) {
		map.set(key, turno);
	}
}

/** Condición SQL (@p2): misma hora (±tolerancia migración o misma clave /100). */
const SQL_HORA_TURNO_EQUIV_P2 = `(ABS(HoraAsignada - @p2) <= ${HORA_TURNO_TOLERANCIA}
	OR (HoraAsignada / 100) = (@p2 / 100))`;

/** ¿La fecha cae en un no-horario de día completo? */
function _diaBloqueado(fechaClarion, noHorarios) {
	for (const nh of noHorarios) {
		if (fechaClarion < nh.DesdeFecha || fechaClarion > (nh.HastaFecha ?? nh.DesdeFecha)) continue;
		const hd = Number(nh.HoraDesde) || 0;
		const hh = Number(nh.HoraHasta) || 0;
		if (!hd && !hh) return true;
	}
	return false;
}

/** ¿El slot (fecha+hora clarion) cae en no-horario parcial? */
function _slotBloqueado(fechaClarion, horaClarion, noHorarios) {
	for (const nh of noHorarios) {
		if (fechaClarion < nh.DesdeFecha || fechaClarion > (nh.HastaFecha ?? nh.DesdeFecha)) continue;
		const hd = Number(nh.HoraDesde) || 0;
		const hh = Number(nh.HoraHasta) || 0;
		if (!hd && !hh) return true;
		if (hd && hh && horaClarion >= hd && horaClarion < hh) return true;
	}
	return false;
}

/** Elige IdServicio del rango horario que cubre la hora (±tolerancia). */
function _elegirSectorDeRangos(filas, horaClarion) {
	const h = Number(horaClarion);
	if (!Number.isFinite(h) || h <= 0) return null;
	const tol = HORA_TURNO_TOLERANCIA;
	let mejor = null;
	let mejorDist = Infinity;
	for (const r of filas) {
		const hd =
			r.inicioClarion != null && Number(r.inicioClarion) > 0
				? Number(r.inicioClarion)
				: r.HoraDesde != null
					? Number(r.HoraDesde)
					: convertirHoraAClarion(r.inicio);
		const hh =
			r.finClarion != null && Number(r.finClarion) > 0
				? Number(r.finClarion)
				: r.HoraHasta != null
					? Number(r.HoraHasta)
					: convertirHoraAClarion(r.fin);
		const sec = String(r.servicio || r.IdServicio || '')
			.trim()
			.slice(0, 4);
		if (!sec || hd == null || hh == null || !hd || !hh) continue;
		if (h + tol < hd || h - tol > hh) continue;
		const dist = Math.min(Math.abs(h - hd), Math.abs(h - hh));
		if (dist < mejorDist) {
			mejorDist = dist;
			mejor = sec;
		}
	}
	return mejor;
}

/**
 * Sector del médico para imTurnos.Sector (varchar 4, = IdServicio del horario).
 * 1) IdServicio del rango en imPersonalHorarios que cubre la hora.
 * 2) idSector en imPersonalSectores (por Valor del personal).
 */
async function _sectorPersonalAsignado(matricula) {
	const sectores = await executeQuery(
		`SELECT TOP 1 RTRIM(LTRIM(ps.idSector)) AS idSector
		 FROM dbo.imPersonal p
		 INNER JOIN dbo.imPersonalSectores ps ON ps.idPersonal = p.Valor
		 WHERE p.Matricula = @p0
		 ORDER BY ps.idSector`,
		[{ value: matricula, type: 'Int' }],
	);
	if (sectores.length && sectores[0].idSector) {
		return String(sectores[0].idSector).trim().slice(0, 4);
	}
	return null;
}

async function _resolverSectorMedico(matricula, fechaIso, horaClarion) {
	const sectorPersonal = await _sectorPersonalAsignado(matricula);
	if (sectorPersonal) return sectorPersonal;

	const diaNombre = _diaSemana(_parseIso(fechaIso));
	const horarios = await executeQuery(
		`SELECT IdServicio, HoraDesde, HoraHasta
		 FROM dbo.imPersonalHorarios
		 WHERE Matricula = @p0 AND Dia = @p1
		 ORDER BY HoraDesde`,
		[
			{ value: matricula, type: 'Int' },
			{ value: diaNombre, type: 'VarChar' },
		],
	);
	const filas = horarios.map((r) => ({
		IdServicio: r.IdServicio,
		inicioClarion: Number(r.HoraDesde) || null,
		finClarion: Number(r.HoraHasta) || null,
	}));
	return _elegirSectorDeRangos(filas, horaClarion);
}

/** Datos del médico titular del turno (imPersonal por Matricula). */
async function _datosProfesionalParaTurno(matricula, fechaIso = null, horaClarion = null) {
	const rows = await executeQuery(
		`SELECT TOP 1 p.Matricula, p.ApellidoNombre, p.ValorEspecialidad, p.ValorServicio, p.Valor
		 FROM dbo.imPersonal p
		 INNER JOIN dbo.imPersonalHorarios h ON h.Matricula = p.Matricula
		 WHERE p.Matricula = @p0
		   AND NULLIF(LTRIM(RTRIM(p.ApellidoNombre)), '') IS NOT NULL`,
		[{ value: matricula, type: 'Int' }],
	);
	if (!rows.length) {
		return { matricula, nombre: null, especialidad: 0, valorServicio: null, sector: null };
	}
	const r = rows[0];
	const sector =
		fechaIso != null
			? await _resolverSectorMedico(matricula, fechaIso, horaClarion)
			: null;
	return {
		matricula,
		nombre: r.ApellidoNombre ? String(r.ApellidoNombre).trim() : null,
		especialidad: Number(r.ValorEspecialidad) || 0,
		valorServicio: r.ValorServicio != null ? Number(r.ValorServicio) : null,
		sector,
	};
}

async function _cargarNoHorarios(matricula, desdeClarion, hastaClarion) {
	return executeQuery(
		`SELECT DesdeFecha, HastaFecha, HoraDesde, HoraHasta
		 FROM dbo.imPersonalNoHorarios
		 WHERE Matricula = @p0
		   AND DesdeFecha <= @p1
		   AND (HastaFecha IS NULL OR HastaFecha >= @p2)`,
		[
			{ value: matricula, type: 'Int' },
			{ value: hastaClarion, type: 'Int' },
			{ value: desdeClarion, type: 'Int' },
		],
	);
}

async function _cargarTurnos(matricula, desdeClarion, hastaClarion) {
	const rows = await executeQuery(
		`SELECT t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional, t.Sector,
		        t.Observaciones, t.Status, t.TipoTurno, t.NumeroDocumento, t.MotivoCancelacion,
		        t.Horallegada, t.HoraIngreso, t.HoraSalida, t.IdClasificacionTriage, t.NumeroVisita,
		        ${SQL_PACIENTE_COLS}
		 FROM dbo.imTurnos t
		 ${SQL_PACIENTE_JOIN}
		 WHERE t.Profesional = @p0
		   AND FechaAsignada >= @p1
		   AND FechaAsignada <= @p2`,
		[
			{ value: matricula, type: 'Int' },
			{ value: desdeClarion, type: 'Int' },
			{ value: hastaClarion, type: 'Int' },
		],
	);
	const map = new Map();
	for (const t of rows) {
		const fecha = _isoDate(convertirFechaClarionADate(t.FechaAsignada));
		const horaClarion = Number(t.HoraAsignada);
		const hora = _hhmm(horaClarion);
		const sector = String(t.Sector || '').trim();
		const clave = horaClaveTurno(horaClarion);
		const tt = Number(t.TipoTurno) || 0;
		if (tt === TIPO_TURNO_SOBRETURNO) {
			map.set(`${fecha}|st|${horaClarion}|${sector}`, t);
			continue;
		}
		_mapSetTurnoPreferPaciente(map, `${fecha}|${horaClarion}|${sector}`, t);
		_mapSetTurnoPreferPaciente(map, `${fecha}|${clave}|${sector}`, t);
		_mapSetTurnoPreferPaciente(map, `${fecha}|${horaClarion}|`, t);
		_mapSetTurnoPreferPaciente(map, `${fecha}|${clave}|`, t);
		if (hora) _mapSetTurnoPreferPaciente(map, `${fecha}|${hora}|${sector}`, t);
	}
	return { rows, map };
}

function _rangoClarionBounds(rango) {
	const ini =
		rango.inicioClarion != null && Number(rango.inicioClarion) > 0
			? Number(rango.inicioClarion)
			: convertirHoraAClarion(rango.inicio);
	const fin =
		rango.finClarion != null && Number(rango.finClarion) > 0
			? Number(rango.finClarion)
			: convertirHoraAClarion(rango.fin);
	return { ini, fin };
}

function _jornadaIndexParaHora(rangos, horaClarion) {
	const h = Number(horaClarion);
	if (!rangos?.length) return 0;
	for (let i = 0; i < rangos.length; i++) {
		const { ini, fin } = _rangoClarionBounds(rangos[i]);
		if (ini != null && fin != null && h >= ini && h <= fin) return i;
	}
	let mejor = 0;
	let mejorDist = Infinity;
	for (let i = 0; i < rangos.length; i++) {
		const { ini } = _rangoClarionBounds(rangos[i]);
		if (ini == null) continue;
		const dist = Math.abs(h - ini);
		if (dist < mejorDist) {
			mejorDist = dist;
			mejor = i;
		}
	}
	return mejor;
}

function _buildJornadasMeta(rangos) {
	if (!rangos || rangos.length <= 1) return [];
	const nombres = ['Mañana', 'Tarde'];
	return rangos.map((r, idx) => {
		const { ini, fin } = _rangoClarionBounds(r);
		const inicio = r.inicio || _hhmm(ini) || '';
		const finH = r.fin || _hhmm(fin) || '';
		const nombre = nombres[idx] || `Jornada ${idx + 1}`;
		return {
			index: idx,
			label: nombre,
			inicio,
			fin: finH,
			titulo: `${nombre} (${inicio}–${finH})`,
		};
	});
}

/** Agrega filas de sobreturnos (TipoTurno=1) que no están en la grilla base. */
function _agregarSobreturnosEnSlots(slots, fechaIso, turnosRows, sectorDefault, rangos) {
	const idsEnGrilla = new Set(slots.map((s) => s.idTurno).filter(Boolean));
	for (const t of turnosRows) {
		const fecha = _isoDate(convertirFechaClarionADate(t.FechaAsignada));
		if (fecha !== fechaIso) continue;
		if ((Number(t.TipoTurno) || 0) !== TIPO_TURNO_SOBRETURNO) continue;
		if (idsEnGrilla.has(t.IdTurno)) continue;
		const extra = _slotDesdeTurno(t, sectorDefault);
		extra.jornadaIndex = _jornadaIndexParaHora(rangos, extra.horaClarion);
		const base = slots.find((s) =>
			horasTurnoEquivalentes(s.horaClarion, extra.horaClarion),
		);
		if (base?.hora) extra.hora = `${base.hora} · ST`;
		slots.push(extra);
	}
	slots.sort((a, b) => {
		const ha = a.horaClarion ?? 0;
		const hb = b.horaClarion ?? 0;
		if (ha !== hb) return ha - hb;
		return (a.esSobreturno ? 1 : 0) - (b.esSobreturno ? 1 : 0);
	});
}

/** Hora Clarion desfasada para sobreturno (±unidades de 10 ms, sin colisión). */
async function _resolverHoraSobreturno(matricula, fechaClarion, baseHoraClarion) {
	const base = Number(baseHoraClarion);
	if (!Number.isFinite(base) || base <= 0) {
		const e = new Error('Hora base inválida para sobreturno');
		e.statusCode = 400;
		throw e;
	}
	const rows = await executeQuery(
		`SELECT HoraAsignada FROM dbo.imTurnos
		 WHERE Profesional = @p0 AND FechaAsignada = @p1
		   AND (HoraAsignada / 100) = (@p2 / 100)
		   AND (Status IS NULL OR Status <> ${STATUS_CANCELADO})`,
		[
			{ value: matricula, type: 'Int' },
			{ value: fechaClarion, type: 'Int' },
			{ value: base, type: 'Int' },
		],
	);
	const usadas = new Set(rows.map((r) => Number(r.HoraAsignada)));
	for (let delta = 0; delta <= 50; delta++) {
		const candidatos =
			delta === 0
				? [base]
				: [base + delta, base - delta].filter((h) => h > 0);
		for (const h of candidatos) {
			if (!usadas.has(h)) return h;
		}
	}
	const e = new Error('No hay cupo para otro sobreturno en este horario');
	e.statusCode = 409;
	throw e;
}

/**
 * Genera la grilla de slots para un rango de fechas.
 */
async function generarSlots(matricula, desdeIso, hastaIso, opts = {}) {
	const ligero = !!opts.ligero;
	const m = _validarMatricula(matricula);
	const desde = _parseIso(desdeIso);
	const hasta = _parseIso(hastaIso);
	if (hasta < desde) {
		const e = new Error('hasta debe ser >= desde');
		e.statusCode = 400;
		throw e;
	}

	const desdeClarion = convertirFechaAClarion(desdeIso);
	const hastaClarion = convertirFechaAClarion(hastaIso);

	const [horarios, noHorarios, turnosData] = await Promise.all([
		agendaConfig.obtenerHorariosPorMatricula(m),
		_cargarNoHorarios(m, desdeClarion, hastaClarion),
		_cargarTurnos(m, desdeClarion, hastaClarion),
	]);

	const sectorPersonalMed = await _sectorPersonalAsignado(m);

	const diasOut = [];
	const cursor = new Date(desde);
	while (cursor <= hasta) {
		const fechaIso = _isoDate(cursor);
		const fechaClarion = convertirFechaAClarion(fechaIso);
		const diaNombre = _diaSemana(cursor);
		const diaCfg = horarios.dias.find((d) => d.dia === diaNombre);

		if (_diaBloqueado(fechaClarion, noHorarios)) {
			diasOut.push({
				fecha: fechaIso,
				dia: diaNombre,
				bloqueado: true,
				motivo: 'ausencia',
				slots: [],
			});
			cursor.setDate(cursor.getDate() + 1);
			continue;
		}

		if (!diaCfg?.rangos?.length) {
			const slotsSinHorario = [];
			if (!ligero) {
				_agregarSobreturnosEnSlots(
					slotsSinHorario,
					fechaIso,
					turnosData.rows,
					sectorPersonalMed,
					[],
				);
			}
			diasOut.push({
				fecha: fechaIso,
				dia: diaNombre,
				bloqueado: false,
				motivo: 'sin_horario',
				slots: slotsSinHorario,
			});
			cursor.setDate(cursor.getDate() + 1);
			continue;
		}

		const jornadas = _buildJornadasMeta(diaCfg.rangos);
		const slots = [];
		for (let jornadaIndex = 0; jornadaIndex < diaCfg.rangos.length; jornadaIndex++) {
			const rango = diaCfg.rangos[jornadaIndex];
			const intervaloMin =
				rango.intervaloMin || horarios.intervaloMin || clarionAIntervaloMin(180001) || 30;
			const step = clarionPasoMinutos(intervaloMin);
			const { ini: t0, fin: finClarion } = _rangoClarionBounds(rango);
			let t = t0;
			const fin = finClarion;
			if (t == null || fin == null || t >= fin) continue;

			while (t <= fin) {
				if (!_slotBloqueado(fechaClarion, t, noHorarios)) {
					const hora = _hhmm(t);
					const clave = horaClaveTurno(t);
					const sector =
						sectorPersonalMed ||
						_elegirSectorDeRangos(diaCfg.rangos, t) ||
						String(
							rango.servicio ||
								horarios.servicio ||
								rango.consultorio ||
								horarios.consultorio ||
								'',
						)
							.trim()
							.slice(0, 4);
					const turno =
						turnosData.map.get(`${fechaIso}|${t}|${sector}`) ||
						turnosData.map.get(`${fechaIso}|${clave}|${sector}`) ||
						turnosData.map.get(`${fechaIso}|${t}|`) ||
						turnosData.map.get(`${fechaIso}|${clave}|`) ||
						turnosData.map.get(`${fechaIso}|${hora}|${sector}`) ||
						turnosData.map.get(`${fechaIso}|${hora}|`);
					const libre = !_turnoOcupaSlot(turno);
					const tt = turno ? Number(turno.TipoTurno) || 0 : TIPO_TURNO_GRILLA;
					slots.push({
						hora,
						horaClarion: t,
						sector,
						jornadaIndex,
						estado: _estadoSlotDesdeTurno(turno),
						status: turno?.Status ?? null,
						tipoTurno: tt,
						esSobreturno: false,
						idTurno: turno?.IdTurno ?? null,
						idPaciente: turno?.IDPaciente ?? null,
						pacienteNombre: turno?.PacienteNombre
							? String(turno.PacienteNombre).trim()
							: null,
						numeroDocumento: turno?.NumeroDocumento ?? null,
						observaciones: turno?.Observaciones ?? null,
						motivoCancelacion: turno?.MotivoCancelacion ?? null,
						..._slotExtrasFromTurno(turno),
					});
				}
				t += step;
			}
		}

		if (!ligero) {
			_agregarSobreturnosEnSlots(slots, fechaIso, turnosData.rows, sectorPersonalMed, diaCfg.rangos);
			const racMap = await _racResumenPorTurnos(
				slots.map((s) => s.idTurno).filter(Boolean),
			);
			_aplicarRacResumenASlots(slots, racMap);
		}
		slots.sort((a, b) => {
			const ha = a.horaClarion ?? 0;
			const hb = b.horaClarion ?? 0;
			if (ha !== hb) return ha - hb;
			return (a.esSobreturno ? 1 : 0) - (b.esSobreturno ? 1 : 0);
		});
		diasOut.push({
			fecha: fechaIso,
			dia: diaNombre,
			bloqueado: false,
			jornadas,
			slots,
		});
		cursor.setDate(cursor.getDate() + 1);
	}

	const profesional = await _datosProfesionalParaTurno(m, desdeIso);
	return {
		matricula: m,
		desde: desdeIso,
		hasta: hastaIso,
		dias: diasOut,
		profesional,
	};
}

/** Fechas (YYYY-MM-DD) del mes/rango con al menos un cupo de agenda (para calendario). */
async function listarDiasConAgenda(matricula, desdeIso, hastaIso) {
	const data = await generarSlots(matricula, desdeIso, hastaIso, { ligero: true });
	const fechas = (data.dias || [])
		.filter((d) => !d.bloqueado && Array.isArray(d.slots) && d.slots.length > 0)
		.map((d) => String(d.fecha).slice(0, 10));
	return {
		matricula: data.matricula,
		desde: desdeIso,
		hasta: hastaIso,
		fechas,
	};
}

async function resumenDia(matricula, fechaIso) {
	const data = await generarSlots(matricula, fechaIso, fechaIso);
	const dia = data.dias[0];
	if (!dia || dia.bloqueado) {
		return {
			fecha: fechaIso,
			bloqueado: true,
			total: 0,
			libres: 0,
			ocupados: 0,
		};
	}
	const total = dia.slots.length;
	const libres = dia.slots.filter((s) => s.estado === 'LIBRE').length;
	return {
		fecha: fechaIso,
		bloqueado: false,
		total,
		libres,
		ocupados: total - libres,
	};
}

async function listarTurnos(matricula, desdeIso, hastaIso) {
	const m = _validarMatricula(matricula);
	const desdeClarion = convertirFechaAClarion(desdeIso);
	const hastaClarion = convertirFechaAClarion(hastaIso);
	const rows = await executeQuery(
		`SELECT t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional,
		        t.Sector, t.Observaciones, t.Status, t.TipoTurno, t.NumeroDocumento,
		        t.MotivoCancelacion, t.Horallegada, t.HoraIngreso, t.HoraSalida,
		        t.IdClasificacionTriage, t.NumeroVisita,
		        ${SQL_PACIENTE_COLS}
		 FROM dbo.imTurnos t
		 ${SQL_PACIENTE_JOIN}
		 WHERE t.Profesional = @p0
		   AND t.FechaAsignada >= @p1
		   AND t.FechaAsignada <= @p2
		 ORDER BY t.FechaAsignada, t.HoraAsignada`,
		[
			{ value: m, type: 'Int' },
			{ value: desdeClarion, type: 'Int' },
			{ value: hastaClarion, type: 'Int' },
		],
	);

	const mapped = rows.map((t) => ({
		idTurno: t.IdTurno,
		fecha: _isoDate(convertirFechaClarionADate(t.FechaAsignada)),
		hora: _hhmm(t.HoraAsignada),
		idPaciente: t.IDPaciente,
		pacienteNombre: t.PacienteNombre ? String(t.PacienteNombre).trim() : null,
		profesional: t.Profesional,
		sector: String(t.Sector || '').trim(),
		observaciones: t.Observaciones,
		status: t.Status,
		estado: _estadoLabel(t.Status),
		tipoTurno: t.TipoTurno,
		esSobreturno: (Number(t.TipoTurno) || 0) === TIPO_TURNO_SOBRETURNO,
		numeroDocumento: t.NumeroDocumento,
		motivoCancelacion: t.MotivoCancelacion,
		..._slotExtrasFromTurno(t),
	}));
	const racMap = await _racResumenPorTurnos(mapped.map((x) => x.idTurno));
	for (const item of mapped) {
		if (!item.idTurno) continue;
		const r = racMap.get(Number(item.idTurno));
		if (r) {
			item.racControles = r.controles;
			item.racMedicacion = r.medicacion;
		}
	}
	return mapped;
}

/**
 * Devuelve médicos con agenda configurada para `fechaIso`.
 * @param {object} [filtros]
 * @param {string} [filtros.servicio]  IdServicio / imServicios.Valor (4 chars o código catálogo)
 * @param {number} [filtros.especialidad] imPersonal.ValorEspecialidad
 */
async function disponibilidadDia(fechaIso, filtros = {}) {
	const fechaClarion = convertirFechaAClarion(fechaIso);
	const date = _parseIso(fechaIso);
	const diaNombre = _diaSemana(date);
	const servicioFiltro = filtros.servicio
		? String(filtros.servicio).trim().slice(0, 80)
		: null;
	const tokensServicio = servicioFiltro
		? await _tokensServicioFiltro(servicioFiltro)
		: null;
	const espFiltro =
		filtros.especialidad != null && Number.isFinite(Number(filtros.especialidad))
			? Number(filtros.especialidad)
			: null;

	// Horarios para el día pedido (sin filtrar por matrícula)
	const horarioRows = await executeQuery(
		`SELECT h.Matricula, h.HoraDesde, h.HoraHasta, h.IntervaloConsulta, h.IdServicio,
		        p.ApellidoNombre, p.Valor AS ValorPersonal, p.ValorEspecialidad, p.ValorServicio
		 FROM dbo.imPersonalHorarios h
		 LEFT JOIN dbo.imPersonal p ON p.Matricula = h.Matricula
		 WHERE h.Dia = @p0`,
		[{ value: diaNombre, type: 'VarChar' }],
	);
	if (!horarioRows.length) return [];

	const horarioFiltrado = horarioRows.filter((r) => {
		if (espFiltro != null) {
			const ve = Number(r.ValorEspecialidad);
			if (ve !== espFiltro) return false;
		}
		if (tokensServicio && !_horarioCoincideServicio(r, tokensServicio)) return false;
		return true;
	});
	if (!horarioFiltrado.length) return [];

	const matriculas = [...new Set(horarioFiltrado.map((r) => Number(r.Matricula)))];

	// No-horarios día completo que afectan esa fecha (HoraDesde=0 y HoraHasta=0)
	const matInList = matriculas.join(',');
	const noHorariosFull = matriculas.length
		? await executeQuery(
				`SELECT Matricula
				 FROM dbo.imPersonalNoHorarios
				 WHERE DesdeFecha <= @p0
				   AND (HastaFecha IS NULL OR HastaFecha >= @p0)
				   AND (HoraDesde IS NULL OR HoraDesde = 0)
				   AND (HoraHasta IS NULL OR HoraHasta = 0)
				   AND Matricula IN (${matInList})`,
				[{ value: fechaClarion, type: 'Int' }],
			)
		: [];
	const matBloqueadas = new Set(noHorariosFull.map((r) => Number(r.Matricula)));

	// Turnos asignados ese día por médico
	const turnosPorMatricula = matriculas.length
		? await executeQuery(
				`SELECT Profesional, COUNT(*) AS cant
				 FROM dbo.imTurnos
				 WHERE FechaAsignada = @p0
				   AND Profesional IN (${matInList})
				   AND IDPaciente IS NOT NULL
				   AND IDPaciente <> 0
				   AND (Status IS NULL OR Status <> ${STATUS_CANCELADO})
				 GROUP BY Profesional`,
				[{ value: fechaClarion, type: 'Int' }],
			)
		: [];
	const ocupadosPorMat = new Map(
		turnosPorMatricula.map((r) => [Number(r.Profesional), Number(r.cant)]),
	);

	// Acumular total slots por médico
	const totalPorMat = new Map();
	const nombrePorMat = new Map();
	for (const r of horarioFiltrado) {
		const mat = Number(r.Matricula);
		if (matBloqueadas.has(mat)) continue;
		const intervaloMin = clarionAIntervaloMin(r.IntervaloConsulta) || 30;
		const inicio = _hhmm(r.HoraDesde);
		const fin = _hhmm(r.HoraHasta);
		if (!inicio || !fin) continue;
		const [hi, mi] = inicio.split(':').map(Number);
		const [hf, mf] = fin.split(':').map(Number);
		const minutos = hf * 60 + mf - (hi * 60 + mi);
		if (minutos <= 0) continue;
		// +1 para incluir el slot que inicia exactamente en HoraHasta
		// (igual que el sistema legacy y que la grilla generada por generarSlots).
		const slots = Math.floor(minutos / intervaloMin) + 1;
		totalPorMat.set(mat, (totalPorMat.get(mat) || 0) + slots);
		if (r.ApellidoNombre && !nombrePorMat.has(mat)) {
			nombrePorMat.set(mat, String(r.ApellidoNombre).trim());
		}
	}

	const out = [];
	for (const [mat, total] of totalPorMat) {
		const ocupados = ocupadosPorMat.get(mat) || 0;
		const libres = Math.max(0, total - ocupados);
		out.push({
			matricula: mat,
			nombre: nombrePorMat.get(mat) || `Matrícula ${mat}`,
			total,
			ocupados,
			libres,
		});
	}
	out.sort((a, b) => a.nombre.localeCompare(b.nombre));
	return out;
}

/**
 * Profesionales con horarios configurados (cualquier día), sin depender de una fecha.
 * @param {object} [filtros]
 * @param {string} [filtros.servicio]
 * @param {number} [filtros.especialidad]
 */
async function listarProfesionalesAgenda(filtros = {}) {
	const servicioFiltro = filtros.servicio
		? String(filtros.servicio).trim().slice(0, 80)
		: null;
	const tokensServicio = servicioFiltro
		? await _tokensServicioFiltro(servicioFiltro)
		: null;
	const espFiltro =
		filtros.especialidad != null && Number.isFinite(Number(filtros.especialidad))
			? Number(filtros.especialidad)
			: null;

	const horarioRows = await executeQuery(
		`SELECT DISTINCT h.Matricula, h.IdServicio,
		        p.ApellidoNombre, p.ValorEspecialidad, p.ValorServicio
		 FROM dbo.imPersonalHorarios h
		 INNER JOIN dbo.imPersonal p ON p.Matricula = h.Matricula
		 WHERE h.Matricula > 0
		   AND NULLIF(LTRIM(RTRIM(p.ApellidoNombre)), '') IS NOT NULL`,
	);

	const porMat = new Map();
	for (const r of horarioRows) {
		if (espFiltro != null) {
			const ve = Number(r.ValorEspecialidad);
			if (ve !== espFiltro) continue;
		}
		if (tokensServicio && !_horarioCoincideServicio(r, tokensServicio)) continue;
		const mat = Number(r.Matricula);
		if (!porMat.has(mat)) {
			porMat.set(mat, {
				matricula: mat,
				nombre: String(r.ApellidoNombre).trim(),
				total: 0,
				ocupados: 0,
				libres: 0,
			});
		}
	}

	const out = [...porMat.values()];
	out.sort((a, b) => a.nombre.localeCompare(b.nombre));
	return out;
}

/**
 * Asigna (o re-asigna) un turno en imTurnos para el slot indicado.
 *
 * Reglas:
 *  - Médico: sólo a su propia matrícula (se valida en el controller).
 *  - El slot debe pertenecer a la grilla generada (horario configurado y no bloqueado).
 *  - Si ya existe un turno con paciente en (Fecha, Hora, Profesional, Sector) -> 409.
 *  - Si existe un placeholder (IDPaciente NULL/0) lo actualizamos; si no, INSERT.
 *
 * @param {object} payload
 * @param {number} payload.matricula
 * @param {string} payload.fecha       ISO YYYY-MM-DD
 * @param {string} payload.hora        "HH:MM"
 * @param {string} payload.sector      varchar(4)
 * @param {number} payload.idPaciente
 * @param {string} [payload.observaciones]
 * @param {number} [payload.tipoTurno] tinyint
 * @param {number} [payload.especialidad]
 * @param {number} [payload.codOperador] usuario que asigna
 */
async function asignarTurno({
	matricula,
	fecha,
	hora,
	horaClarion: horaClarionIn,
	sector,
	idPaciente,
	observaciones,
	tipoTurno,
	especialidad,
	codOperador,
}) {
	const m = _validarMatricula(matricula);
	if (!fecha || (!hora && horaClarionIn == null)) {
		const e = new Error('fecha y hora son requeridas');
		e.statusCode = 400;
		throw e;
	}
	const idPac = Number(idPaciente);
	if (!Number.isFinite(idPac) || idPac <= 0) {
		const e = new Error('idPaciente inválido');
		e.statusCode = 400;
		throw e;
	}

	const fechaClarion = convertirFechaAClarion(fecha);
	const horaClarion =
		horaClarionIn != null && Number(horaClarionIn) > 0
			? Number(horaClarionIn)
			: convertirHoraAClarion(hora);
	if (!fechaClarion || horaClarion == null) {
		const e = new Error('fecha/hora inválidas');
		e.statusCode = 400;
		throw e;
	}

	const esSobreturno = Number(tipoTurno) === TIPO_TURNO_SOBRETURNO;
	const tt = esSobreturno ? TIPO_TURNO_SOBRETURNO : TIPO_TURNO_GRILLA;

	const profPre = await _datosProfesionalParaTurno(m, fecha, horaClarion);
	if (!profPre?.nombre) {
		const e = new Error('Profesional no encontrado en la nómina activa');
		e.statusCode = 404;
		e.code = 'PROFESIONAL_INEXISTENTE';
		throw e;
	}

	const hoyClarion = convertirFechaAClarion(_isoDate(new Date()));
	if (fechaClarion < hoyClarion) {
		const e = new Error('No se pueden asignar turnos en fechas anteriores al día de hoy');
		e.statusCode = 400;
		throw e;
	}

	// Validar slot contra horarios configurados / no-horarios
	const grilla = await generarSlots(m, fecha, fecha);
	const dia = grilla.dias[0];
	if (!esSobreturno && (!dia || dia.bloqueado)) {
		const e = new Error('La fecha está bloqueada para este profesional');
		e.statusCode = 409;
		throw e;
	}
	if (esSobreturno && !dia) {
		const e = new Error('Fecha inválida para sobreturno');
		e.statusCode = 400;
		throw e;
	}

	const slot = (dia?.slots ?? []).find(
		(s) =>
			!s.esSobreturno &&
			(horasTurnoEquivalentes(s.horaClarion, horaClarion) ||
				(hora && s.hora === hora && (s.sector || '') === String(sector || '').trim().slice(0, 4))),
	);
	if (!slot && !esSobreturno) {
		const e = new Error('El horario indicado no es un slot válido');
		e.statusCode = 409;
		throw e;
	}
	if (
		!esSobreturno &&
		slot &&
		slot.estado !== 'LIBRE' &&
		slot.estado !== 'CANCELADO'
	) {
		const e = new Error('El turno ya está ocupado');
		e.statusCode = 409;
		throw e;
	}

	let horaPersistir = horaClarion;
	if (esSobreturno) {
		const base =
			slot?.horaClarion != null && Number(slot.horaClarion) > 0
				? Number(slot.horaClarion)
				: horaClarion > 0
					? horaClarion
					: convertirHoraAClarion('08:00');
		horaPersistir = await _resolverHoraSobreturno(m, fechaClarion, base);
	}

	// Sector = IdServicio del horario del médico (no del operador logueado ni del slot UI)
	const prof = await _datosProfesionalParaTurno(m, fecha, horaClarion);
	if (!prof?.nombre) {
		const e = new Error('Profesional no encontrado en la nómina activa');
		e.statusCode = 404;
		e.code = 'PROFESIONAL_INEXISTENTE';
		throw e;
	}
	const sec =
		(prof.sector && String(prof.sector).trim().slice(0, 4)) ||
		String(slot?.sector || sector || '')
			.trim()
			.slice(0, 4);
	let secFinal = sec && sec !== '0000' ? sec : '';
	if (!secFinal) {
		secFinal = (await _sectorPersonalAsignado(m)) || '';
	}
	if (!secFinal && prof.valorServicio != null) {
		secFinal = String(prof.valorServicio).trim().slice(0, 4);
	}
	if (!secFinal) {
		secFinal = String(sector || '').trim().slice(0, 4);
	}
	if (!secFinal) {
		const e = new Error('No se pudo determinar el sector del profesional');
		e.statusCode = 409;
		throw e;
	}
	const esp = Number(prof.especialidad) || 0;

	// Datos del paciente
	const pac = await executeQuery(
		`SELECT TOP 1 IDPaciente, NumeroDocumento, ApellidoyNombre
		 FROM dbo.imPacientes WHERE IDPaciente = @p0`,
		[{ value: idPac, type: 'Int' }],
	);
	if (!pac.length) {
		const e = new Error('Paciente inexistente');
		e.statusCode = 404;
		throw e;
	}
	const numDoc = Number(pac[0].NumeroDocumento) || 0;

	// Día en español sin acento (mismo formato que imPersonalHorarios)
	const diaNombre = _diaSemana(_parseIso(fecha));

	const obs = String(observaciones || '').slice(0, 1000);
	const cod = codOperador != null && Number.isFinite(Number(codOperador))
		? Number(codOperador)
		: 0;

	// FechaCarga / HoraCarga = ahora (Argentina)
	const fechaCargaIso = fechaCalendarioArgentina();
	const horaCargaStr = horaWallArgentina(false);
	const fechaCargaClarion = convertirFechaAClarion(fechaCargaIso);
	const horaCargaClarion = convertirHoraAClarion(horaCargaStr);

	if (esSobreturno) {
		const insSt = await executeQuery(
			`INSERT INTO dbo.imTurnos
			   (Dia, FechaAsignada, HoraAsignada, IDPaciente, Profesional, Sector,
			    Horallegada, HoraIngreso, HoraSalida, Especialidad, Observaciones,
			    FechaCarga, HoraCarga, CodOperador, Status, TipoTurno, NumeroVisita,
			    NumeroDocumento, MotivoCancelacion)
			 VALUES (@p0, @p1, @p2, @p3, @p4, @p5,
			         0, 0, 0, @p6, @p7,
			         @p8, @p9, @p10, @p11, @p12, 0,
			         @p13, NULL);
			 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdTurno;`,
			[
				{ value: diaNombre, type: 'VarChar' },
				{ value: fechaClarion, type: 'Int' },
				{ value: horaPersistir, type: 'Int' },
				{ value: idPac, type: 'Int' },
				{ value: m, type: 'Int' },
				{ value: secFinal, type: 'VarChar' },
				{ value: esp, type: 'Int' },
				{ value: obs, type: 'VarChar' },
				{ value: fechaCargaClarion, type: 'Int' },
				{ value: horaCargaClarion, type: 'Int' },
				{ value: cod, type: 'Int' },
				{ value: STATUS_OCUPADO, type: 'TinyInt' },
				{ value: tt, type: 'TinyInt' },
				{ value: numDoc, type: 'Int' },
			],
		);
		return { idTurno: insSt?.[0]?.IdTurno || null, accion: 'created', tipoTurno: tt };
	}

	// Fila existente en el mismo horario (cualquier sector: migración DPI vs grilla ECO, etc.)
	const existente = await executeQuery(
		`SELECT TOP 1 IdTurno, IDPaciente, Sector, HoraAsignada, Especialidad, TipoTurno, Status
		 FROM dbo.imTurnos
		 WHERE FechaAsignada = @p0 AND Profesional = @p1
		   AND ${SQL_HORA_TURNO_EQUIV_P2}
		   AND (TipoTurno IS NULL OR TipoTurno = @p3)
		 ORDER BY CASE WHEN IDPaciente IS NOT NULL AND IDPaciente > 0
		               AND (Status IS NULL OR Status <> ${STATUS_CANCELADO}) THEN 0 ELSE 1 END,
		          ABS(HoraAsignada - @p2),
		          IdTurno`,
		[
			{ value: fechaClarion, type: 'Int' },
			{ value: m, type: 'Int' },
			{ value: horaPersistir, type: 'Int' },
			{ value: TIPO_TURNO_GRILLA, type: 'TinyInt' },
		],
	);

	if (existente.length) {
		const idP = Number(existente[0].IDPaciente) || 0;
		const stEx =
			existente[0].Status != null ? Number(existente[0].Status) : STATUS_OCUPADO;
		if (idP > 0 && stEx !== STATUS_CANCELADO) {
			const e = new Error('El turno ya está ocupado');
			e.statusCode = 409;
			throw e;
		}
		const idTurno = existente[0].IdTurno;
		const horaPersistida = Number(existente[0].HoraAsignada) || horaPersistir;
		await executeQuery(
			`UPDATE dbo.imTurnos
			 SET IDPaciente = @p0,
			     NumeroDocumento = @p1,
			     Observaciones = @p2,
			     TipoTurno = @p3,
			     Especialidad = @p4,
			     Status = 0,
			     MotivoCancelacion = NULL,
			     Dia = @p5,
			     Sector = @p6,
			     Horallegada = 0,
			     HoraIngreso = 0,
			     HoraSalida = 0,
			     FechaCarga = @p7,
			     HoraCarga = @p8,
			     CodOperador = @p9
			 WHERE IdTurno = @p10`,
			[
				{ value: idPac, type: 'Int' },
				{ value: numDoc, type: 'Int' },
				{ value: obs, type: 'VarChar' },
				{ value: tt, type: 'TinyInt' },
				{ value: esp, type: 'Int' },
				{ value: diaNombre, type: 'VarChar' },
				{ value: secFinal, type: 'VarChar' },
				{ value: fechaCargaClarion, type: 'Int' },
				{ value: horaCargaClarion, type: 'Int' },
				{ value: cod, type: 'Int' },
				{ value: idTurno, type: 'Int' },
			],
		);
		return { idTurno, accion: 'updated' };
	}

	// INSERT (IdTurno es IDENTITY) — Horallegada/HoraIngreso se marcan al llegar/ingresar
	const ins = await executeQuery(
		`INSERT INTO dbo.imTurnos
		   (Dia, FechaAsignada, HoraAsignada, IDPaciente, Profesional, Sector,
		    Horallegada, HoraIngreso, HoraSalida, Especialidad, Observaciones,
		    FechaCarga, HoraCarga, CodOperador, Status, TipoTurno, NumeroVisita,
		    NumeroDocumento, MotivoCancelacion)
		 VALUES (@p0, @p1, @p2, @p3, @p4, @p5,
		         0, 0, 0, @p6, @p7,
		         @p8, @p9, @p10, 0, @p11, 0,
		         @p12, NULL);
		 SELECT CAST(SCOPE_IDENTITY() AS INT) AS IdTurno;`,
		[
			{ value: diaNombre, type: 'VarChar' },
			{ value: fechaClarion, type: 'Int' },
			{ value: horaPersistir, type: 'Int' },
			{ value: idPac, type: 'Int' },
			{ value: m, type: 'Int' },
			{ value: secFinal, type: 'VarChar' },
			{ value: esp, type: 'Int' },
			{ value: obs, type: 'VarChar' },
			{ value: fechaCargaClarion, type: 'Int' },
			{ value: horaCargaClarion, type: 'Int' },
			{ value: cod, type: 'Int' },
			{ value: tt, type: 'TinyInt' },
			{ value: numDoc, type: 'Int' },
		],
	);
	const idTurno = ins?.[0]?.IdTurno || null;
	return { idTurno, accion: 'created' };
}

async function _obtenerTurnoProfesional(matricula, idTurno) {
	const rows = await executeQuery(
		`SELECT TOP 1 IdTurno, IDPaciente, Status, TipoTurno, FechaAsignada, HoraAsignada, Profesional, HoraSalida, Horallegada
		 FROM dbo.imTurnos
		 WHERE IdTurno = @p0 AND Profesional = @p1`,
		[
			{ value: idTurno, type: 'Int' },
			{ value: matricula, type: 'Int' },
		],
	);
	if (!rows.length) {
		const e = new Error('Turno no encontrado');
		e.statusCode = 404;
		throw e;
	}
	return rows[0];
}

/** Administrativo: localiza el turno solo por IdTurno (sin exigir matrícula en la URL). */
async function _obtenerTurnoPorId(idTurno) {
	const rows = await executeQuery(
		`SELECT TOP 1 IdTurno, IDPaciente, Status, TipoTurno, FechaAsignada, HoraAsignada, Profesional, HoraSalida, Horallegada
		 FROM dbo.imTurnos
		 WHERE IdTurno = @p0`,
		[{ value: idTurno, type: 'Int' }],
	);
	if (!rows.length) {
		const e = new Error('Turno no encontrado');
		e.statusCode = 404;
		throw e;
	}
	return rows[0];
}

function _horaClarionAhora() {
	return horaClarionAhoraArgentina();
}

function _validarTurnoHorario(row) {
	const st = row.Status != null ? Number(row.Status) : STATUS_OCUPADO;
	const idP = Number(row.IDPaciente) || 0;
	if (idP <= 0) {
		const e = new Error('No hay paciente asignado en este turno');
		e.statusCode = 409;
		throw e;
	}
	if (st === STATUS_CANCELADO) {
		const e = new Error('El turno está cancelado');
		e.statusCode = 409;
		throw e;
	}
	const hs = Number(row.HoraSalida) || 0;
	if (st === STATUS_ATENDIDO || hs > 0) {
		const e = new Error('El turno ya fue cerrado');
		e.statusCode = 409;
		throw e;
	}
}

/**
 * Marca Horallegada con la hora actual (paciente presente en recepción).
 */
async function marcarLlegada({ matricula, idTurno, porIdTurno, codOperador }) {
	const m = _validarMatricula(matricula);
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const row = porIdTurno ? await _obtenerTurnoPorId(id) : await _obtenerTurnoProfesional(m, id);
	_validarTurnoHorario(row);
	const horaClarion = _horaClarionAhora();
	const cod = Number(codOperador) || 0;
	if (cod > 0) {
		await executeQuery(
			`UPDATE dbo.imTurnos SET Horallegada = @p0, OperadorLlegada = @p2 WHERE IdTurno = @p1`,
			[
				{ value: horaClarion, type: 'Int' },
				{ value: id, type: 'Int' },
				{ value: cod, type: 'Int' },
			],
		);
	} else {
		await executeQuery(`UPDATE dbo.imTurnos SET Horallegada = @p0 WHERE IdTurno = @p1`, [
			{ value: horaClarion, type: 'Int' },
			{ value: id, type: 'Int' },
		]);
	}
	return { idTurno: id, horaLlegada: _hhmm(horaClarion) };
}

/**
 * Marca HoraIngreso con la hora actual (paciente ingresó a consultorio).
 */
async function marcarIngreso({ matricula, idTurno, porIdTurno, codOperador }) {
	const m = _validarMatricula(matricula);
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const row = porIdTurno ? await _obtenerTurnoPorId(id) : await _obtenerTurnoProfesional(m, id);
	_validarTurnoHorario(row);
	const hl = Number(row.Horallegada) || 0;
	if (hl <= 0) {
		const e = new Error('Primero debe marcarse la llegada del paciente');
		e.statusCode = 409;
		throw e;
	}
	const horaClarion = _horaClarionAhora();
	const cod = Number(codOperador) || 0;
	if (cod > 0) {
		await executeQuery(
			`UPDATE dbo.imTurnos SET HoraIngreso = @p0, OperadorIngreso = @p2 WHERE IdTurno = @p1`,
			[
				{ value: horaClarion, type: 'Int' },
				{ value: id, type: 'Int' },
				{ value: cod, type: 'Int' },
			],
		);
	} else {
		await executeQuery(`UPDATE dbo.imTurnos SET HoraIngreso = @p0 WHERE IdTurno = @p1`, [
			{ value: horaClarion, type: 'Int' },
			{ value: id, type: 'Int' },
		]);
	}
	return { idTurno: id, horaIngreso: _hhmm(horaClarion) };
}

/**
 * Cancela un turno (Status = 1). No aplica a turnos ya atendidos (Status = 3).
 */
async function cancelarTurno({ matricula, idTurno }) {
	const m = _validarMatricula(matricula);
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const row = await _obtenerTurnoProfesional(m, id);
	const st = row.Status != null ? Number(row.Status) : STATUS_OCUPADO;
	const idP = Number(row.IDPaciente) || 0;
	if (idP <= 0) {
		const e = new Error('No hay turno asignado para cancelar');
		e.statusCode = 409;
		throw e;
	}
	if (st === STATUS_CANCELADO) {
		const e = new Error('El turno ya está cancelado');
		e.statusCode = 409;
		throw e;
	}
	if (st === STATUS_ATENDIDO) {
		const e = new Error('No se puede cancelar un turno ya atendido');
		e.statusCode = 409;
		throw e;
	}
	await executeQuery(
		`UPDATE dbo.imTurnos SET Status = @p0 WHERE IdTurno = @p1`,
		[
			{ value: STATUS_CANCELADO, type: 'TinyInt' },
			{ value: id, type: 'Int' },
		],
	);
	return { idTurno: id, status: STATUS_CANCELADO };
}

/**
 * Actualiza paciente y/o observaciones de un turno existente (admin / agenda).
 */
async function actualizarTurno({ matricula, idTurno, idPaciente, observaciones }) {
	const m = _validarMatricula(matricula);
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const idPac = Number(idPaciente);
	if (!Number.isFinite(idPac) || idPac <= 0) {
		const e = new Error('idPaciente inválido');
		e.statusCode = 400;
		throw e;
	}
	const row = await _obtenerTurnoProfesional(m, id);
	const st = row.Status != null ? Number(row.Status) : STATUS_OCUPADO;
	if (st === STATUS_ATENDIDO) {
		const e = new Error('No se puede modificar un turno ya atendido');
		e.statusCode = 409;
		throw e;
	}
	const pac = await executeQuery(
		`SELECT TOP 1 IDPaciente, NumeroDocumento
		 FROM dbo.imPacientes WHERE IDPaciente = @p0`,
		[{ value: idPac, type: 'Int' }],
	);
	if (!pac.length) {
		const e = new Error('Paciente inexistente');
		e.statusCode = 404;
		throw e;
	}
	const numDoc = Number(pac[0].NumeroDocumento) || 0;
	const obs =
		observaciones !== undefined
			? String(observaciones || '').slice(0, 1000)
			: null;

	const params = [
		{ value: idPac, type: 'Int' },
		{ value: numDoc, type: 'Int' },
		{ value: STATUS_OCUPADO, type: 'TinyInt' },
	];
	let sql = `UPDATE dbo.imTurnos
		SET IDPaciente = @p0,
		    NumeroDocumento = @p1,
		    Status = @p2,
		    MotivoCancelacion = NULL`;
	if (obs !== null) {
		params.push({ value: obs, type: 'VarChar' });
		sql += `, Observaciones = @p${params.length - 1}`;
	}
	params.push({ value: id, type: 'Int' });
	sql += ` WHERE IdTurno = @p${params.length - 1}`;
	await executeQuery(sql, params);
	return { idTurno: id, status: STATUS_OCUPADO };
}

/**
 * Borra turno: sobreturno (TipoTurno=1) se elimina; grilla (0) se libera.
 */
async function borrarTurno({ matricula, idTurno }) {
	const m = _validarMatricula(matricula);
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const row = await _obtenerTurnoProfesional(m, id);
	const st = row.Status != null ? Number(row.Status) : STATUS_OCUPADO;
	if (st === STATUS_ATENDIDO) {
		const e = new Error('No se puede borrar un turno ya atendido');
		e.statusCode = 409;
		throw e;
	}
	const tt = Number(row.TipoTurno) || 0;
	if (tt === TIPO_TURNO_SOBRETURNO) {
		await executeQuery(`DELETE FROM dbo.imTurnos WHERE IdTurno = @p0`, [
			{ value: id, type: 'Int' },
		]);
		return { idTurno: id, accion: 'deleted' };
	}
	await executeQuery(
		`UPDATE dbo.imTurnos
		 SET IDPaciente = NULL,
		     NumeroDocumento = 0,
		     Observaciones = '',
		     Status = @p0,
		     MotivoCancelacion = NULL,
		     HoraIngreso = 0,
		     HoraSalida = 0
		 WHERE IdTurno = @p1`,
		[
			{ value: STATUS_OCUPADO, type: 'TinyInt' },
			{ value: id, type: 'Int' },
		],
	);
	return { idTurno: id, accion: 'cleared' };
}

/**
 * Trae el código de práctica de consulta desde XPARAMETROS.
 * Default fallback: 420101.
 */
async function _getCodPracticaConsulta() {
	try {
		const rows = await executeQuery(
			`SELECT TOP 1 VALOR_STRING, VALOR_INTEGER FROM dbo.XPARAMETROS
			 WHERE IDPARAMETRO = 'CODPRACTICACONSULTA'`,
		);
		if (!rows.length) return 420101;
		const s = rows[0].VALOR_STRING && String(rows[0].VALOR_STRING).trim();
		const n = s ? Number(s) : Number(rows[0].VALOR_INTEGER || 0);
		return Number.isFinite(n) && n > 0 ? n : 420101;
	} catch {
		return 420101;
	}
}

/** Devuelve el próximo NUMEROVISITA disponible (MAX+1). */
async function _proximoNumeroVisita() {
	const rows = await executeQuery(
		`SELECT ISNULL(MAX(NUMEROVISITA), 0) + 1 AS next FROM dbo.imVisita`,
	);
	return Number(rows[0].next) || 1;
}

/** Padding a 6 caracteres del código de diagnóstico. */
function _padDiag(d) {
	const s = String(d || '').trim().toUpperCase();
	if (!s) return '';
	return s.length >= 6 ? s.slice(0, 8) : s.padEnd(6, ' ');
}

/** Normaliza string seguro. */
function _s(v, max) {
	if (v == null) return '';
	const s = String(v);
	return max != null ? s.slice(0, max) : s;
}

const estudiosService = require('./estudios.service');

/** Sector receptor/solicitante para pedidos (4 chars, legacy). */
function _padSectorPedido(v) {
	return estudiosService._padSector(v);
}

/** Resuelve un tipo de pedido/estudio desde imTiposPedidosEstudios. */
async function _resolverTipoPedidoEstudio(idTipoPedido) {
	return estudiosService.resolverTipoPedidoEstudio(idTipoPedido);
}

/** Inserta imFacPracticas + imFacProfesionales (titular, funcion=1). */
async function _insertarFacPracticaConProfesional({
	numeroVisita,
	idPaciente,
	codPractica,
	sector,
	codOp,
	matriculaMedico,
	fechaClarion,
	horaClarion,
}) {
	const practicaRows = await executeQuery(
		`INSERT INTO dbo.imFacPracticas (
			Numero, NumeroVisita, TipoPractica, Practica,
			CantidadPractica, FechaPractica, HoraPracticaInicio, HoraPracticaFin,
			ValorSector, FechaPrograma, HoraPrograma, CodOperador,
			FechaGraba, HoraGraba, Factura, Estado, Autorizada, Status,
			NroInforme, NroAutorizacion, IdPaciente
		) VALUES (
			0, @p0, 'NO', @p1,
			1, @p2, @p3, 0,
			@p4, @p2, @p3, @p5,
			@p2, @p3, 0, 2, 2, 0,
			0, '', @p6
		);
		SELECT SCOPE_IDENTITY() AS Valor`,
		[
			{ value: numeroVisita, type: 'Int' },
			{ value: codPractica, type: 'Int' },
			{ value: fechaClarion, type: 'Int' },
			{ value: horaClarion, type: 'Int' },
			{ value: sector, type: 'VarChar' },
			{ value: codOp, type: 'Int' },
			{ value: idPaciente, type: 'Int' },
		],
	);
	const valorPractica = Number(practicaRows[0]?.Valor) || 0;
	if (valorPractica <= 0) {
		const e = new Error('No se pudo registrar la práctica');
		e.statusCode = 500;
		throw e;
	}
	const profRows = await executeQuery(
		`INSERT INTO dbo.imFacProfesionales (
			Valor, Matricula, Funcion, CodOperador,
			FachaGraba, HoraGraba, Factura, Status
		) VALUES (
			@p0, @p1, 1, @p2,
			@p3, @p4, 0, 0
		);
		SELECT SCOPE_IDENTITY() AS IDFacProfesional`,
		[
			{ value: valorPractica, type: 'Int' },
			{ value: matriculaMedico, type: 'Int' },
			{ value: codOp, type: 'Int' },
			{ value: fechaClarion, type: 'Int' },
			{ value: horaClarion, type: 'Int' },
		],
	);
	const idFacProf = Number(profRows[0]?.IDFacProfesional) || 0;
	if (idFacProf <= 0) {
		const e = new Error('No se pudo registrar el profesional de la práctica');
		e.statusCode = 500;
		throw e;
	}
	return { valorPractica, idFacProf };
}

/**
 * Cierra el turno con flujo completo:
 *  - Inserta imVisita (clasePaciente='A')
 *  - Inserta imHCI esqueleto con datos del form
 *  - Inserta imFacPracticas (consulta) e imFacProfesionales (matrícula del médico, funcion=1)
 *  - Actualiza imTurnos (Status=Atendido, HoraSalida, NumeroVisita)
 *  - Actualiza imInterCtrlFrecuente / imInterCtrlMedicamento con el NumeroVisita generado
 *
 * @param {Object} args
 * @param {number} args.matricula - matrícula del profesional del turno
 * @param {number} args.idTurno
 * @param {number} args.codOperador - operador logueado (puede ser médico o administrativo)
 * @param {string} [args.diagnostico] - código CIE-10 (ej. "R100")
 * @param {number} [args.contrato] - Valor de imClientes (cobertura)
 * @param {Object} [args.hci] - campos de imHCI a guardar
 * @param {Array<{idTipoPedido:number}>} [args.procedimientos] - procedimientos realizados en consultorio
 * @param {Array<{idTipoPedido:number,notas?:string,estadoUrgencia?:string}>} [args.pedidosEstudios] - pedidos de estudios
 */
async function cerrarTurno({
	matricula,
	idTurno,
	codOperador,
	diagnostico,
	contrato,
	hci,
	porIdTurno,
	procedimientos,
	pedidosEstudios,
}) {
	const m = _validarMatricula(matricula);
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	const codOp = Number(codOperador) || 0;

	const row = porIdTurno ? await _obtenerTurnoPorId(id) : await _obtenerTurnoProfesional(m, id);
	const matriculaMedico = Number(row.Profesional) || m;
	if (!matriculaMedico || matriculaMedico <= 0) {
		const e = new Error('El turno no tiene médico asignado');
		e.statusCode = 409;
		throw e;
	}
	const st = row.Status != null ? Number(row.Status) : STATUS_OCUPADO;
	const idP = Number(row.IDPaciente) || 0;
	if (idP <= 0) {
		const e = new Error('No hay paciente asignado en este turno');
		e.statusCode = 409;
		throw e;
	}
	if (st === STATUS_CANCELADO) {
		const e = new Error('No se puede cerrar un turno cancelado');
		e.statusCode = 409;
		throw e;
	}
	const hs = Number(row.HoraSalida) || 0;
	if (st === STATUS_ATENDIDO || hs > 0) {
		const e = new Error('El turno ya fue cerrado');
		e.statusCode = 409;
		throw e;
	}
	if (!String(diagnostico || '').trim()) {
		const e = new Error('El diagnóstico es obligatorio para cerrar el turno');
		e.statusCode = 400;
		throw e;
	}

	// ── Datos de fecha/hora del cierre (Argentina) ──
	const fechaIso = fechaCalendarioArgentina();
	const horaStr = horaWallArgentina(true);
	const fechaClarion = convertirFechaAClarion(fechaIso);
	const horaClarion = convertirHoraAClarion(horaStr);

	// ── Datos adicionales del turno (sector, paciente) ──
	const detalle = await executeQuery(
		`SELECT TOP 1 t.IdTurno, t.IDPaciente, t.Sector, t.Profesional, t.NumeroVisita,
		        p.NumeroCuenta, c.RazonSocial AS CoberturaNombre, c.Valor AS ContratoValor
		 FROM dbo.imTurnos t
		 LEFT JOIN dbo.imPacientes p ON p.IDPaciente = t.IDPaciente
		 LEFT JOIN dbo.imClientes c ON c.Valor = p.NumeroCuenta
		 WHERE t.IdTurno = @p0`,
		[{ value: id, type: 'Int' }],
	);
	const sector = String(detalle[0]?.Sector || '').trim().padEnd(4, ' ').slice(0, 4);

	// Si el turno ya tenía NumeroVisita, lo reutilizamos
	let numeroVisita = Number(detalle[0]?.NumeroVisita) || 0;
	const yaTieneVisita = numeroVisita > 0;
	if (!yaTieneVisita) numeroVisita = await _proximoNumeroVisita();

	const diagPadded = _padDiag(diagnostico);
	const contratoDesdePaciente =
		Number(detalle[0]?.NumeroCuenta) || Number(detalle[0]?.ContratoValor) || 0;
	const contratoId = Number(contrato) > 0 ? Number(contrato) : contratoDesdePaciente;

	// Para rollback parcial si algo falla luego del INSERT visita
	const creados = {
		visita: null,
		hci: null,
		practica: null,
		profesional: null,
		practicasExtra: [],
		profesionalesExtra: [],
		pedidosEstudios: [],
	};

	const listaProcedimientos = Array.isArray(procedimientos) ? procedimientos : [];
	const listaPedidosEstudios = Array.isArray(pedidosEstudios) ? pedidosEstudios : [];
	const sectorSolicitante = String(detalle[0]?.Sector || '').trim().slice(0, 4);
	const now = new Date();

	try {
		if (!yaTieneVisita) {
			// 1) imVisita
			await executeQuery(
				`INSERT INTO dbo.imVisita (
					NUMEROVISITA, IDPACIENTE, IDDESCONOCIDA, FECHAADMISIONS, TIPOADMISION,
					VALORSECTOR, CLASEPACIENTE, DOCTORADMISOR, DOCTORASISTIENDO,
					DIAGNOSTICO, CLIENTE, CONTRATO, CLASEFINANCIERA,
					FECHAEGRESO, HORAEGRESO, FECHACARGA, HORACARGA,
					ESTADO, ESTADOAMBULATORIO, OPERADOR, OperadorEgreso, ORIGENADMISION,
					STATUS
				) VALUES (
					@p0, @p1, 0, @p2, ' ',
					@p3, 'A', @p4, @p4,
					@p5, 0, @p6, ' ',
					@p7, @p8, @p7, @p8,
					'', '', @p9, @p10, 0,
					0
				)`,
				[
					{ value: numeroVisita, type: 'Int' },
					{ value: idP, type: 'Int' },
					{ value: now, type: 'DateTime' },
					{ value: sector, type: 'VarChar' },
					{ value: matriculaMedico, type: 'Int' },
					{ value: diagPadded, type: 'VarChar' },
					{ value: contratoId, type: 'Int' },
					{ value: fechaClarion, type: 'Int' },
					{ value: horaClarion, type: 'Int' },
					{ value: _s(String(codOp), 10), type: 'VarChar' },
					{ value: codOp, type: 'Int' },
				],
			);
			creados.visita = numeroVisita;
		} else {
			// La visita ya existe — solo actualizar egreso/diagnóstico/operador egreso
			await executeQuery(
				`UPDATE dbo.imVisita
				 SET FECHAEGRESO = @p1, HORAEGRESO = @p2,
				     DIAGNOSTICO = CASE WHEN LEN(LTRIM(RTRIM(@p3))) > 0 THEN @p3 ELSE DIAGNOSTICO END,
				     CONTRATO = CASE WHEN @p4 > 0 THEN @p4 ELSE CONTRATO END,
				     OperadorEgreso = @p5
				 WHERE NUMEROVISITA = @p0`,
				[
					{ value: numeroVisita, type: 'Int' },
					{ value: fechaClarion, type: 'Int' },
					{ value: horaClarion, type: 'Int' },
					{ value: diagPadded, type: 'VarChar' },
					{ value: contratoId, type: 'Int' },
					{ value: codOp, type: 'Int' },
				],
			);
		}

		// 2) imHCI esqueleto + form (IdHCIngreso es IDENTITY)
		const h = hci || {};
		const hciRows = await executeQuery(
			`INSERT INTO dbo.imHCI (
				NumeroVisita, Fecha, IdSector, IdProfecional,
				MotivoConsulta, EnfermedadActual, Semiologia,
				SV_PA, SV_FC, SV_FR, SV_TAX, SV_GLUCEMIA,
				SV_TALLA, SV_PESOACTUAL, SV_IMPRESIONGENERAL
			) VALUES (
				@p0, @p1, @p2, @p3,
				@p4, @p5, @p6,
				@p7, @p8, @p9, @p10, @p11,
				@p12, @p13, @p14
			);
			SELECT SCOPE_IDENTITY() AS IdHCIngreso`,
			[
				{ value: numeroVisita, type: 'Int' },
				{ value: now, type: 'DateTime' },
				{ value: sector, type: 'VarChar' },
				{ value: matriculaMedico, type: 'Int' },
				{ value: _s(h.motivoConsulta, 500), type: 'VarChar' },
				{ value: _s(h.enfermedadActual, 8000), type: 'VarChar' },
				{ value: _s(h.semiologia, 255), type: 'VarChar' },
				{ value: _s(h.pa, 40), type: 'VarChar' },
				{ value: _s(h.fc, 40), type: 'VarChar' },
				{ value: _s(h.fr, 40), type: 'VarChar' },
				{ value: _s(h.tax, 40), type: 'VarChar' },
				{ value: _s(h.glucemia, 40), type: 'VarChar' },
				{ value: _s(h.talla, 40), type: 'VarChar' },
				{ value: _s(h.peso, 40), type: 'VarChar' },
				{ value: _s(h.impresionGeneral, 200), type: 'VarChar' },
			],
		);
		const idHci = Number(hciRows[0]?.IdHCIngreso) || 0;
		if (idHci <= 0) {
			const e = new Error('No se pudo crear el registro de historia clínica');
			e.statusCode = 500;
			throw e;
		}
		creados.hci = idHci;

		// 3) imFacPracticas (consulta; Valor es IDENTITY)
		const codConsulta = await _getCodPracticaConsulta();
		const consultaIns = await _insertarFacPracticaConProfesional({
			numeroVisita,
			idPaciente: idP,
			codPractica: codConsulta,
			sector,
			codOp,
			matriculaMedico,
			fechaClarion,
			horaClarion,
		});
		const valorPractica = consultaIns.valorPractica;
		const idFacProf = consultaIns.idFacProf;
		creados.practica = valorPractica;
		creados.profesional = idFacProf;

		// 4) Procedimientos realizados en consultorio (uno o N)
		for (const item of listaProcedimientos) {
			const tipo = await _resolverTipoPedidoEstudio(item?.idTipoPedido);
			const codPractica = Number(tipo.IdPractica) || 0;
			if (codPractica <= 0) {
				const e = new Error(`Práctica inválida para tipo ${tipo.IdTipoPedido}`);
				e.statusCode = 400;
				throw e;
			}
			const extra = await _insertarFacPracticaConProfesional({
				numeroVisita,
				idPaciente: idP,
				codPractica,
				sector,
				codOp,
				matriculaMedico,
				fechaClarion,
				horaClarion,
			});
			creados.practicasExtra.push(extra.valorPractica);
			creados.profesionalesExtra.push(extra.idFacProf);
		}

		// 5) Pedidos de estudios (vía Agenda — misma persistencia que Internación)
		for (const item of listaPedidosEstudios) {
			const creado = await estudiosService.crearPedido({
				idVisita: numeroVisita,
				matriculaSolicitante: matriculaMedico,
				sectorSolicitante,
				idTipoPedido: item?.idTipoPedido,
				idSectorReceptor: item?.idSectorReceptor,
				notas: item?.notas,
				estadoUrgencia: item?.estadoUrgencia,
				fechaPedido: now,
			});
			creados.pedidosEstudios.push(creado.idPedido);
		}

		// 5) UPDATE imInterCtrlFrecuente (controles RAC del turno)
		await executeQuery(
			`UPDATE dbo.imInterCtrlFrecuente SET NumeroVisita = @p0 WHERE IdTurno = @p1`,
			[
				{ value: numeroVisita, type: 'Int' },
				{ value: id, type: 'Int' },
			],
		);

		// 6) UPDATE imInterCtrlMedicamento (medicaciones RAC del turno)
		await executeQuery(
			`UPDATE dbo.imInterCtrlMedicamento SET NumeroVisita = @p0 WHERE IdTurno = @p1`,
			[
				{ value: numeroVisita, type: 'Int' },
				{ value: id, type: 'Int' },
			],
		);

		// 6b) Adjuntos cargados por IdTurno → NumeroVisita
		await adjuntosService.vincularAdjuntosTurnoAVisita(id, numeroVisita);

		// 7) UPDATE imTurnos (cerrar + NumeroVisita)
		await executeQuery(
			`UPDATE dbo.imTurnos
			 SET Status = @p0, HoraSalida = @p1, NumeroVisita = @p2
			 WHERE IdTurno = @p3`,
			[
				{ value: STATUS_ATENDIDO, type: 'TinyInt' },
				{ value: horaClarion, type: 'Int' },
				{ value: numeroVisita, type: 'Int' },
				{ value: id, type: 'Int' },
			],
		);

		return {
			idTurno: id,
			status: STATUS_ATENDIDO,
			horaSalida: _hhmm(horaClarion),
			numeroVisita,
			idHci: creados.hci,
			valorPractica: creados.practica,
			idFacProfesional: creados.profesional,
			valoresPracticasProcedimientos: creados.practicasExtra,
			procedimientosRegistrados: creados.practicasExtra.length,
			pedidosEstudiosRegistrados: creados.pedidosEstudios.length,
		};
	} catch (err) {
		// Rollback best-effort en orden inverso
		try {
			for (const idPed of creados.pedidosEstudios.slice().reverse()) {
				await executeQuery(`DELETE FROM dbo.imPedidosEstudios WHERE IdPedido = @p0`, [
					{ value: idPed, type: 'Int' },
				]);
			}
			for (let i = creados.profesionalesExtra.length - 1; i >= 0; i--) {
				await executeQuery(`DELETE FROM dbo.imFacProfesionales WHERE IDFacProfesional = @p0`, [
					{ value: creados.profesionalesExtra[i], type: 'Int' },
				]);
			}
			for (const val of creados.practicasExtra.slice().reverse()) {
				await executeQuery(`DELETE FROM dbo.imFacPracticas WHERE Valor = @p0`, [
					{ value: val, type: 'Int' },
				]);
			}
			if (creados.profesional)
				await executeQuery(`DELETE FROM dbo.imFacProfesionales WHERE IDFacProfesional = @p0`, [
					{ value: creados.profesional, type: 'Int' },
				]);
			if (creados.practica)
				await executeQuery(`DELETE FROM dbo.imFacPracticas WHERE Valor = @p0`, [
					{ value: creados.practica, type: 'Int' },
				]);
			if (creados.hci)
				await executeQuery(`DELETE FROM dbo.imHCI WHERE IdHCIngreso = @p0`, [
					{ value: creados.hci, type: 'Int' },
				]);
			if (creados.visita)
				await executeQuery(`DELETE FROM dbo.imVisita WHERE NUMEROVISITA = @p0`, [
					{ value: creados.visita, type: 'Int' },
				]);
		} catch (rollbackErr) {
			console.error('[cerrarTurno] rollback parcial falló:', rollbackErr.message);
		}
		err.statusCode = err.statusCode || 500;
		throw err;
	}
}

/**
 * Todos los turnos de un paciente (histórico), opcionalmente filtrados por médico.
 * @param {number} idPaciente
 * @param {{ matriculaMedico?: number }} [opciones]
 */
async function buscarTurnosPorPaciente(idPaciente, opciones = {}) {
	const id = Number(idPaciente);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idPaciente inválido');
		e.statusCode = 400;
		throw e;
	}
	const med =
		opciones.matriculaMedico != null && Number.isFinite(Number(opciones.matriculaMedico))
			? Number(opciones.matriculaMedico)
			: null;
	const soloActivos = !!opciones.soloActivos;
	const hoyClarion = convertirFechaAClarion(_isoDate(new Date()));

	const params = [{ value: id, type: 'Int' }];
	let medFilter = '';
	if (med != null && med > 0) {
		medFilter = ' AND t.Profesional = @p1';
		params.push({ value: med, type: 'Int' });
	}
	let activosFilter = '';
	if (soloActivos) {
		const idx = params.length;
		activosFilter = ` AND (t.Status IS NULL OR t.Status = ${STATUS_OCUPADO})
		 AND t.FechaAsignada >= @p${idx}`;
		params.push({ value: hoyClarion, type: 'Int' });
	}

	const rows = await executeQuery(
		`SELECT t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional,
		        t.Sector, t.Observaciones, t.Status, t.TipoTurno, t.NumeroDocumento,
		        t.MotivoCancelacion,
		        pac.ApellidoyNombre AS PacienteNombre,
		        per.ApellidoNombre AS ProfesionalNombre
		 FROM dbo.imTurnos t
		 LEFT JOIN dbo.imPacientes pac ON pac.IDPaciente = t.IDPaciente
		 LEFT JOIN dbo.imPersonal per ON per.Matricula = t.Profesional
		 WHERE t.IDPaciente = @p0
		   AND t.IDPaciente > 0
		   ${medFilter}
		   ${activosFilter}
		 ORDER BY t.FechaAsignada DESC, t.HoraAsignada DESC`,
		params,
	);

	return rows.map((t) => ({
		idTurno: t.IdTurno,
		fecha: _isoDate(convertirFechaClarionADate(t.FechaAsignada)),
		hora: _hhmm(t.HoraAsignada),
		idPaciente: t.IDPaciente,
		pacienteNombre: t.PacienteNombre ? String(t.PacienteNombre).trim() : null,
		profesional: t.Profesional,
		profesionalNombre: t.ProfesionalNombre
			? String(t.ProfesionalNombre).trim()
			: null,
		sector: String(t.Sector || '').trim(),
		observaciones: t.Observaciones,
		status: t.Status,
		estado: _estadoLabel(t.Status),
		tipoTurno: t.TipoTurno,
		esSobreturno: (Number(t.TipoTurno) || 0) === TIPO_TURNO_SOBRETURNO,
		numeroDocumento: t.NumeroDocumento,
		motivoCancelacion: t.MotivoCancelacion,
	}));
}

/**
 * Catálogo de sectores/servicios receptores para pedidos de estudios (imServicios).
 */
async function listarSectoresReceptorEstudios() {
	return estudiosService.listarSectoresReceptor();
}

/**
 * Búsqueda de tipos de pedidos/estudios en imTiposPedidosEstudios.
 */
async function buscarTiposPedidosEstudios({ q, limit = 30 }) {
	return estudiosService.buscarTiposPedidosEstudios({ q, limit });
}

/**
 * Búsqueda de diagnósticos CIE-10 en imDiagnosticos.
 */
async function buscarDiagnosticos({ q, limit = 30 }) {
	const term = String(q || '').trim();
	const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
	if (term.length < 2) return [];
	const like = `%${term}%`;
	const rows = await executeQuery(
		`SELECT TOP ${lim} Valor, RTRIM(LTRIM(CodigoOMS)) AS codigo, RTRIM(LTRIM(Descripcion)) AS descripcion
		 FROM dbo.imDiagnosticos
		 WHERE CIE = 10 AND (
		   CodigoOMS LIKE @p0 OR Descripcion LIKE @p0
		 )
		 ORDER BY CASE WHEN CodigoOMS LIKE @p1 THEN 0 ELSE 1 END, CodigoOMS`,
		[
			{ value: like, type: 'VarChar' },
			{ value: `${term}%`, type: 'VarChar' },
		],
	);
	return rows.map((r) => ({
		valor: r.Valor,
		codigo: r.codigo,
		descripcion: r.descripcion,
	}));
}

/**
 * Búsqueda de clientes (obras sociales / coberturas) en imClientes.
 */
async function buscarClientes({ q, limit = 30 }) {
	const term = String(q || '').trim();
	const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
	const like = term ? `%${term}%` : null;
	const params = [];
	let where = '';
	if (like) {
		where = `WHERE RazonSocial LIKE @p0 OR CAST(Valor AS VARCHAR(20)) LIKE @p0`;
		params.push({ value: like, type: 'VarChar' });
	}
	const rows = await executeQuery(
		`SELECT TOP ${lim} Valor, RTRIM(LTRIM(RazonSocial)) AS razonSocial,
		        RTRIM(LTRIM(ValorCliente)) AS tipo
		 FROM dbo.imClientes
		 ${where}
		 ORDER BY RazonSocial`,
		params,
	);
	return rows.map((r) => ({
		valor: r.Valor,
		razonSocial: r.razonSocial,
		tipo: r.tipo,
	}));
}

/**
 * Detalle completo de una atención de turno (HC, diagnóstico, RAC, adjuntos).
 */
async function obtenerDetalleAtencionTurno(idTurno) {
	const id = Number(idTurno);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idTurno inválido');
		e.statusCode = 400;
		throw e;
	}

	const rows = await executeQuery(
		`SELECT TOP 1
		        t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.Horallegada, t.HoraIngreso, t.HoraSalida,
		        t.Sector, t.Observaciones, t.Status, t.TipoTurno, t.NumeroVisita, t.Especialidad,
		        t.IdClasificacionTriage, t.Profesional, t.NumeroDocumento,
		        t.CodOperador, t.FechaCarga, t.HoraCarga,
		        t.OperadorLlegada, t.OperadorIngreso,
		        op.Apellido AS OpAsigApellido, op.Nombres AS OpAsigNombres,
		        ${SQL_PACIENTE_COLS},
		        pac.NumeroHC,
		        prof.ApellidoNombre AS ProfesionalNombre
		 FROM dbo.imTurnos t
		 ${SQL_PACIENTE_JOIN}
		 LEFT JOIN dbo.imPersonal prof ON prof.Matricula = t.Profesional
		 LEFT JOIN dbo.imPassword op ON op.CodOperador = t.CodOperador OR op.ValorPersonal = t.CodOperador
		 WHERE t.IdTurno = @p0`,
		[{ value: id, type: 'Int' }],
	);
	if (!rows.length) {
		const e = new Error('Turno no encontrado');
		e.statusCode = 404;
		throw e;
	}

	const r = rows[0];
	const st = r.Status != null ? Number(r.Status) : STATUS_OCUPADO;
	const hs = Number(r.HoraSalida) || 0;
	const numeroVisita = Number(r.NumeroVisita) || 0;
	const extras = _slotExtrasFromTurno(r);

	const racStats = await executeQuery(
		`SELECT
			(SELECT COUNT(*) FROM dbo.imInterCtrlFrecuente WHERE IdTurno = @p0) AS controles,
			(SELECT COUNT(*) FROM dbo.imInterCtrlMedicamento WHERE IdTurno = @p0) AS medicacion`,
		[{ value: id, type: 'Int' }],
	);
	const racControles = Number(racStats[0]?.controles) || 0;
	const racMedicacion = Number(racStats[0]?.medicacion) || 0;

	const tieneAtencion =
		st === STATUS_ATENDIDO ||
		hs > 0 ||
		numeroVisita > 0 ||
		Boolean(extras.horaLlegada) ||
		Boolean(extras.horaIngreso) ||
		extras.idClasificacionTriage != null ||
		racControles > 0 ||
		racMedicacion > 0;

	if (!tieneAtencion) {
		const e = new Error('El turno aún no tiene datos de atención registrados');
		e.statusCode = 404;
		throw e;
	}

	let diagnostico = null;
	let hc = null;

	if (numeroVisita > 0) {
		const visitaRows = await executeQuery(
			`SELECT TOP 1 RTRIM(LTRIM(DIAGNOSTICO)) AS codigo
			 FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
			[{ value: numeroVisita, type: 'Int' }],
		);
		const codRaw = visitaRows[0]?.codigo ? String(visitaRows[0].codigo).trim() : '';
		if (codRaw) {
			const codBusq = codRaw.replace(/\s+/g, '');
			const diagRows = await executeQuery(
				`SELECT TOP 1 RTRIM(LTRIM(CodigoOMS)) AS codigo, RTRIM(LTRIM(Descripcion)) AS descripcion
				 FROM dbo.imDiagnosticos
				 WHERE CIE = 10 AND REPLACE(RTRIM(LTRIM(CodigoOMS)), ' ', '') = @p0`,
				[{ value: codBusq, type: 'VarChar' }],
			);
			diagnostico = diagRows[0]
				? { codigo: diagRows[0].codigo, descripcion: diagRows[0].descripcion }
				: { codigo: codRaw, descripcion: null };
		}

		const hciRows = await executeQuery(
			`SELECT TOP 1 MotivoConsulta, EnfermedadActual, Semiologia,
			        SV_PA, SV_FC, SV_FR, SV_TAX, SV_GLUCEMIA, SV_TALLA, SV_PESOACTUAL, SV_IMPRESIONGENERAL
			 FROM dbo.imHCI
			 WHERE NumeroVisita = @p0
			 ORDER BY IdHCIngreso DESC`,
			[{ value: numeroVisita, type: 'Int' }],
		);
		if (hciRows[0]) {
			const h = hciRows[0];
			hc = {
				motivoConsulta: h.MotivoConsulta ? String(h.MotivoConsulta).trim() : null,
				enfermedadActual: h.EnfermedadActual ? String(h.EnfermedadActual).trim() : null,
				semiologia: h.Semiologia ? String(h.Semiologia).trim() : null,
				pa: h.SV_PA ? String(h.SV_PA).trim() : null,
				fc: h.SV_FC ? String(h.SV_FC).trim() : null,
				fr: h.SV_FR ? String(h.SV_FR).trim() : null,
				tax: h.SV_TAX ? String(h.SV_TAX).trim() : null,
				glucemia: h.SV_GLUCEMIA ? String(h.SV_GLUCEMIA).trim() : null,
				talla: h.SV_TALLA ? String(h.SV_TALLA).trim() : null,
				peso: h.SV_PESOACTUAL ? String(h.SV_PESOACTUAL).trim() : null,
				impresionGeneral: h.SV_IMPRESIONGENERAL
					? String(h.SV_IMPRESIONGENERAL).trim()
					: null,
			};
		}
	}

	const rac = await agendaRacService.obtenerRac(id);
	let adjuntos = [];
	try {
		adjuntos = await adjuntosService.getAdjuntosPorTurno(id);
	} catch {
		adjuntos = [];
	}

	const fa = Number(r.FechaAsignada) || 0;
	const fechaIso = fa > 0 ? _isoDate(convertirFechaClarionADate(fa)) : null;

	const opAsigNom = [r.OpAsigApellido, r.OpAsigNombres]
		.filter(Boolean)
		.map((s) => String(s).trim())
		.join(' ')
		.trim();
	const fcAsig = Number(r.FechaCarga) || 0;
	const hcAsig = Number(r.HoraCarga) || 0;
	const opLlegadaCod = Number(r.OperadorLlegada) || 0;
	const opIngresoCod = Number(r.OperadorIngreso) || 0;
	const codAsig = Number(r.CodOperador) || 0;

	const [nomAsig, nomLlegada, nomIngreso] = await Promise.all([
		opAsigNom ? Promise.resolve(opAsigNom) : codAsig > 0 ? _nombreOperador(codAsig) : null,
		opLlegadaCod > 0 ? _nombreOperador(opLlegadaCod) : null,
		opIngresoCod > 0 ? _nombreOperador(opIngresoCod) : null,
	]);

	const trazabilidad = {
		asignacion:
			codAsig > 0 || fcAsig > 0
				? {
						nombre: nomAsig || null,
						fecha: fcAsig > 0 ? _isoDate(convertirFechaClarionADate(fcAsig)) : null,
						hora: hcAsig > 0 ? _hhmm(hcAsig) : null,
					}
				: null,
		llegada: extras.horaLlegada
			? { hora: extras.horaLlegada, operador: nomLlegada }
			: null,
		ingreso: extras.horaIngreso
			? { hora: extras.horaIngreso, operador: nomIngreso }
			: null,
		cierre: extras.horaSalida ? { hora: extras.horaSalida, operador: null } : null,
	};

	if (numeroVisita > 0) {
		const visRows = await executeQuery(
			`SELECT TOP 1 OperadorEgreso FROM dbo.imVisita WHERE NUMEROVISITA = @p0`,
			[{ value: numeroVisita, type: 'Int' }],
		);
		if (visRows[0]) {
			const opEgr = Number(visRows[0].OperadorEgreso) || 0;
			if (opEgr > 0 && extras.horaSalida) {
				const nom = await _nombreOperador(opEgr);
				trazabilidad.cierre = {
					hora: extras.horaSalida,
					operador: nom,
				};
			}
		}
	}

	let procedimientosRealizados = [];
	let pedidosEstudiosDetalle = [];

	if (numeroVisita > 0) {
		const codConsulta = await _getCodPracticaConsulta();
		const procRows = await executeQuery(
			`SELECT fp.Valor, fp.Practica, fp.CantidadPractica, fp.HoraPracticaInicio,
			        LTRIM(RTRIM(ISNULL(tp.DescPractica, ''))) AS DescTipo,
			        LTRIM(RTRIM(ISNULL(nom.Descripcion, ''))) AS DescNom,
			        prof.ApellidoNombre AS ProfesionalNombre
			 FROM dbo.imFacPracticas fp
			 LEFT JOIN dbo.imTiposPedidosEstudios tp ON tp.IdPractica = fp.Practica
			 LEFT JOIN dbo.imNomenclador nom ON nom.IDPractica = fp.Practica
			 LEFT JOIN dbo.imFacProfesionales fprof ON fprof.Valor = fp.Valor AND fprof.Funcion = 1
			 LEFT JOIN dbo.imPersonal prof ON prof.Matricula = fprof.Matricula
			 WHERE fp.NumeroVisita = @p0 AND fp.Practica <> @p1
			 ORDER BY fp.Valor`,
			[
				{ value: numeroVisita, type: 'Int' },
				{ value: codConsulta, type: 'Int' },
			],
		);
		procedimientosRealizados = (procRows || []).map((row) => {
			const descTipo = String(row.DescTipo || '').trim();
			const descNom = String(row.DescNom || '').trim();
			const cod = Number(row.Practica) || 0;
			return {
				valor: Number(row.Valor) || 0,
				codigoPractica: cod,
				descripcion: descTipo || descNom || (cod > 0 ? `Práctica ${cod}` : '—'),
				cantidad: Number(row.CantidadPractica) || 1,
				hora: _hhmm(Number(row.HoraPracticaInicio) || 0),
				profesional: row.ProfesionalNombre
					? String(row.ProfesionalNombre).trim()
					: null,
			};
		});

		const pedMapped = await estudiosService.listarPorVisita(numeroVisita);
		pedidosEstudiosDetalle = (pedMapped || []).map((row) => {
			const fp = row.FechaPedido;
			let fechaPedido = null;
			if (fp instanceof Date && !Number.isNaN(fp.getTime())) {
				fechaPedido = fp.toISOString();
			} else if (row.FechaPedidoISO) {
				fechaPedido = String(row.FechaPedidoISO);
			} else if (fp) {
				fechaPedido = String(fp);
			}
			return {
				idPedido: row.IdPedido,
				idTipoPedido: row.IdTipoPedido || 0,
				codigoPractica: row.CodigoPractica || 0,
				descripcion:
					row.PracticaSolicitada ||
					(row.CodigoPractica > 0 ? `Estudio ${row.CodigoPractica}` : '—'),
				sectorReceptor: row.SectorReceptor || '',
				sectorReceptorNombre: row.ServicioDescripcion || row.SectorReceptorNombre || null,
				estadoUrgencia: row.EstadoUrgencia,
				notas: row.NotasObservacion,
				fechaPedido,
				cumplido: !!row.Cumplido,
				idProtocolo: row.IdProtocolo || 0,
				textoResultado: row.TextoResultado,
				fechaResultado: row.FechaResultado || null,
			};
		});
	}

	return {
		turno: {
			idTurno: id,
			fecha: fechaIso,
			hora: _hhmm(Number(r.HoraAsignada) || 0) || null,
			sector: String(r.Sector || '').trim(),
			status: st,
			estado: st === STATUS_ATENDIDO || hs > 0 ? 'ATENDIDO' : 'OCUPADO',
			tipoTurno: Number(r.TipoTurno) || 0,
			observaciones: r.Observaciones ? String(r.Observaciones).trim() : null,
			numeroVisita,
			idClasificacionTriage: extras.idClasificacionTriage,
			horaLlegada: extras.horaLlegada,
			horaIngreso: extras.horaIngreso,
			horaSalida: extras.horaSalida,
			especialidad: Number(r.Especialidad) || 0,
		},
		paciente: {
			nombre: r.PacienteNombre ? String(r.PacienteNombre).trim() : null,
			numeroDocumento: r.NumeroDocumento ?? null,
			numeroHC: r.NumeroHC ? String(r.NumeroHC).trim() : null,
			sexo: extras.sexo,
			fechaNacimiento: extras.fechaNacimiento,
			edad: extras.edad,
			cobertura: extras.cobertura,
		},
		profesional: {
			matricula: Number(r.Profesional) || 0,
			nombre: r.ProfesionalNombre ? String(r.ProfesionalNombre).trim() : null,
		},
		hc,
		diagnostico,
		rac: {
			controles: rac.controles || [],
			medicacion: rac.medicacion || [],
		},
		adjuntos: (adjuntos || []).map((a) => ({
			idAdjunto: a.IdAdjunto,
			nombreArchivo: a.NombreArchivo,
			tipoImagen: a.TipoImagen,
			tipoImagenNombre: a.TipoImagenNombre,
			fechaCarga: a.FechaCarga,
		})),
		trazabilidad,
		procedimientosRealizados,
		pedidosEstudios: pedidosEstudiosDetalle,
	};
}

module.exports = {
	generarSlots,
	listarDiasConAgenda,
	resumenDia,
	listarTurnos,
	buscarTurnosPorPaciente,
	disponibilidadDia,
	listarProfesionalesAgenda,
	asignarTurno,
	actualizarTurno,
	cancelarTurno,
	borrarTurno,
	marcarLlegada,
	marcarIngreso,
	cerrarTurno,
	buscarDiagnosticos,
	buscarClientes,
	buscarTiposPedidosEstudios,
	listarSectoresReceptorEstudios,
	obtenerDetalleAtencionTurno,
};
