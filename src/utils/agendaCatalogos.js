/**
 * Catálogos / constantes del módulo Agenda.
 *
 * Estos valores NO viven en BD (no existen tablas catálogo asociadas a
 * imTurnos.Status, TipoTurno ni imPersonalNoHorarios.MotivodeEsepcion).
 * Se centralizan acá para que el front los consuma vía /api/agenda/catalogos
 * y para que cualquier renombrado posterior se haga en un solo lugar.
 */

// Días tal como están persistidos en imPersonalHorarios.Dia (varchar(9), sin tildes).
const DIAS_SEMANA = Object.freeze([
	'Lunes',
	'Martes',
	'Miercoles',
	'Jueves',
	'Viernes',
	'Sabado',
	'Domingo',
]);

const DIAS_SET = new Set(DIAS_SEMANA.map((d) => d.toLowerCase()));

/** Normaliza "lunes", "Lunes ", "Miércoles" → "Lunes" / "Miercoles". */
function normalizarDia(input) {
	if (!input) return null;
	const s = String(input).trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
	const idx = DIAS_SEMANA.findIndex((d) => d.toLowerCase() === s);
	return idx >= 0 ? DIAS_SEMANA[idx] : null;
}

// Motivos de no-horario (provisorio: derivado del DISTINCT contra producción).
const MOTIVOS_NO_HORARIO = Object.freeze({
	1: 'Enfermedad',
	2: 'Viaje',
	3: 'Licencia',
	4: 'Otro',
});

// imTurnos.Status
const STATUS_TURNO = Object.freeze({
	0: 'OCUPADO',
	1: 'CANCELADO',
	3: 'ATENDIDO',
});

const STATUS_OCUPADO = 0;
const STATUS_CANCELADO = 1;
const STATUS_ATENDIDO = 3;

// imTurnos.TipoTurno — 0 = grilla / disponibilidad configurada, 1 = sobreturno
const TIPO_TURNO = Object.freeze({
	0: 'Grilla',
	1: 'Sobreturno',
});

const TIPO_TURNO_GRILLA = 0;
const TIPO_TURNO_SOBRETURNO = 1;

// Intervalos sugeridos en minutos para la UI (el back acepta cualquier int positivo).
const INTERVALOS_SUGERIDOS = Object.freeze([5, 10, 15, 20, 30, 45, 60]);

/**
 * Convierte un entero de minutos al Clarion TIME usado en
 * imPersonalHorarios.IntervaloConsulta (HoraDesde/HoraHasta usan el mismo formato).
 *   30 min → 180001  (verificado contra datos reales)
 */
function intervaloMinAClarion(min) {
	const n = Math.round(Number(min));
	if (!Number.isFinite(n) || n <= 0) {
		throw new Error('intervaloMin debe ser un entero positivo');
	}
	return n * 6000 + 1;
}

/** Inverso aproximado: Clarion TIME (intervalo) → minutos (redondea). */
function clarionAIntervaloMin(clarionTime) {
	if (clarionTime == null) return null;
	const n = Number(clarionTime);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.round((n - 1) / 6000);
}

/** Incremento Clarion TIME para N minutos (sin pasar por HH:MM). */
function clarionPasoMinutos(minutos) {
	const n = Math.round(Number(minutos));
	if (!Number.isFinite(n) || n <= 0) return 0;
	return n * 6000;
}

/** @deprecated usar TIPO_TURNO_GRILLA / TIPO_TURNO_SOBRETURNO */
const TIPO_TURNO_RESERVA = TIPO_TURNO_GRILLA;

/**
 * Tolerancia al emparejar HoraAsignada (migración / sistema viejo vs grilla).
 * Misma hora visual puede diferir hasta ±10 en el entero Clarion.
 */
const HORA_TURNO_TOLERANCIA = 10;

/** Clave estable para emparejar grilla y turnos (equiv. SQL: HoraAsignada / 100). */
function horaClaveTurno(horaClarion) {
	const n = Number(horaClarion);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.floor(n / 100);
}

/** ¿Dos HoraAsignada representan el mismo slot de agenda? */
function horasTurnoEquivalentes(a, b) {
	const na = Number(a);
	const nb = Number(b);
	if (!Number.isFinite(na) || !Number.isFinite(nb) || na <= 0 || nb <= 0) return false;
	if (na === nb) return true;
	if (Math.abs(na - nb) <= HORA_TURNO_TOLERANCIA) return true;
	const ca = horaClaveTurno(na);
	return ca > 0 && ca === horaClaveTurno(nb);
}

module.exports = {
	DIAS_SEMANA,
	DIAS_SET,
	MOTIVOS_NO_HORARIO,
	STATUS_TURNO,
	STATUS_OCUPADO,
	STATUS_CANCELADO,
	STATUS_ATENDIDO,
	TIPO_TURNO,
	TIPO_TURNO_GRILLA,
	TIPO_TURNO_SOBRETURNO,
	INTERVALOS_SUGERIDOS,
	normalizarDia,
	intervaloMinAClarion,
	clarionAIntervaloMin,
	clarionPasoMinutos,
	TIPO_TURNO_RESERVA,
	HORA_TURNO_TOLERANCIA,
	horaClaveTurno,
	horasTurnoEquivalentes,
};
