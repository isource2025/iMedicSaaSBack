/**
 * RAC de enfermería vinculado a turnos de agenda (imTurnos).
 */
const { executeQuery } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	convertirFechaClarionADate,
} = require('../utils/dateUtils');
const { normalizarTextoParaClarionAnsi } = require('../utils/clarionText');
const controlesService = require('./controlesFrecuentes.service');
const medicacionService = require('./medicacionControl.service');

function _validarIdTurno(id) {
	const n = Number(id);
	if (!Number.isFinite(n) || n <= 0) {
		const e = new Error('IdTurno inválido');
		e.statusCode = 400;
		throw e;
	}
	return n;
}

async function _obtenerTurno(idTurno) {
	const rows = await executeQuery(
		`SELECT t.IdTurno, t.FechaAsignada, t.HoraAsignada, t.IDPaciente, t.Profesional,
		        t.Sector, t.Observaciones, t.Status, t.NumeroVisita, t.NumeroDocumento,
		        t.IdClasificacionTriage,
		        pac.ApellidoyNombre AS PacienteNombre
		 FROM dbo.imTurnos t
		 LEFT JOIN dbo.imPacientes pac ON pac.IDPaciente = t.IDPaciente
		 WHERE t.IdTurno = @p0`,
		[{ value: idTurno, type: 'Int' }],
	);
	if (!rows.length) {
		const e = new Error('Turno no encontrado');
		e.statusCode = 404;
		throw e;
	}
	const t = rows[0];
	return {
		idTurno: t.IdTurno,
		idPaciente: t.IDPaciente,
		pacienteNombre: t.PacienteNombre ? String(t.PacienteNombre).trim() : null,
		numeroDocumento: t.NumeroDocumento,
		profesional: t.Profesional,
		sector: String(t.Sector || '').trim(),
		numeroVisita: Number(t.NumeroVisita) || 0,
		idClasificacionTriage: t.IdClasificacionTriage,
		observaciones: t.Observaciones,
	};
}

const SELECT_CONTROL = `
  cf.Valor, cf.NumeroVisita,
  CONVERT(varchar(10), DATEADD(day, NULLIF(cf.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(cf.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
  cf.Pulso, cf.Maximo, cf.Minimo, cf.FrecuenciaRespiratoria,
  cf.Axilar, cf.Rectal, cf.Hgt, cf.PAMedia, cf.Saturometria,
  cf.Peso, cf.Talla, cf.Observaciones, cf.IdTurno, cf.IdHci,
  pw1.Apellido AS OperadorApellido, pw1.Nombres AS OperadorNombres
`;

const SELECT_MEDICACION = `
  mc.IDCtrlMedica,
  CONVERT(varchar(10), DATEADD(day, NULLIF(mc.FechaControl,0) - 4, '1801-01-01'), 23) AS FechaControl,
  CONVERT(varchar(8), DATEADD(ms, (NULLIF(mc.HoraControl,0) - 1) * 10, 0), 108) AS HoraControl,
  mc.Troquel, mc.Cantidad, mc.TipoUnidad, mc.Observaciones, mc.IdTurno,
  v.Alias AS NombreMedicamento, v.Descripcion AS DescripcionMedicamento
`;

async function obtenerRac(idTurno) {
	const id = _validarIdTurno(idTurno);
	const turno = await _obtenerTurno(id);

	const controles = await executeQuery(
		`SELECT ${SELECT_CONTROL}
		 FROM dbo.imInterCtrlFrecuente cf
		 LEFT JOIN dbo.imPassword pw1 ON pw1.CodOperador = cf.OperadorCarga
		 WHERE cf.IdTurno = @p0
		 ORDER BY cf.FechaControl DESC, cf.HoraControl DESC, cf.Valor DESC`,
		[{ value: id, type: 'Int' }],
	);

	const medicacion = await executeQuery(
		`SELECT ${SELECT_MEDICACION}
		 FROM dbo.imInterCtrlMedicamento mc
		 LEFT JOIN dbo.imVademecum v ON v.Troquel = mc.Troquel
		 WHERE mc.IdTurno = @p0
		 ORDER BY mc.FechaControl DESC, mc.HoraControl DESC, mc.IDCtrlMedica DESC`,
		[{ value: id, type: 'Int' }],
	);

	return { turno, controles, medicacion };
}

async function crearControlTurno(idTurno, data) {
	const id = _validarIdTurno(idTurno);
	const turno = await _obtenerTurno(id);
	const created = await controlesService.crearControl({
		numeroVisita: turno.numeroVisita || 0,
		fechaControl: data.fechaControl,
		horaControl: data.horaControl,
		operadorCarga: data.operadorCarga,
		pulso: data.pulso,
		presionMax: data.presionMax,
		presionMin: data.presionMin,
		presionMedia: data.presionMedia,
		frecuenciaRespiratoria: data.frecuenciaRespiratoria,
		temperaturaAxilar: data.temperaturaAxilar,
		temperaturaRectal: data.temperaturaRectal,
		glucemia: data.glucemia,
		saturacion: data.saturacion,
		peso: data.peso,
		talla: data.talla,
		observaciones: data.observaciones,
		idSector: data.idSector || turno.sector,
		idTurno: id,
	});
	return created;
}

async function crearMedicacionTurno(idTurno, data) {
	const id = _validarIdTurno(idTurno);
	const turno = await _obtenerTurno(id);

	const ahora = new Date();
	const yyyy = ahora.getFullYear();
	const mm = String(ahora.getMonth() + 1).padStart(2, '0');
	const dd = String(ahora.getDate()).padStart(2, '0');
	const hh = String(ahora.getHours()).padStart(2, '0');
	const mi = String(ahora.getMinutes()).padStart(2, '0');
	const ss = String(ahora.getSeconds()).padStart(2, '0');

	const fechaCargaClarion = convertirFechaAClarion(`${yyyy}-${mm}-${dd}`);
	const horaCargaClarion = convertirHoraAClarion(`${hh}:${mi}:${ss}`);
	const fechaControlClarion = convertirFechaAClarion(data.fechaControl || `${yyyy}-${mm}-${dd}`);
	const horaControlClarion = convertirHoraAClarion(
		(data.horaControl || `${hh}:${mi}`) + ':00',
	);

	// Mismo INSERT que internación (indicaciones.service); columnas char: Sector(4), TipoUnidad(5)
	const sector = String(data.idSector || turno.sector || '')
		.trim()
		.slice(0, 4);
	const tipoUnidad = String(data.tipoUnidad || '')
		.trim()
		.slice(0, 5);

	const sql = `
		INSERT INTO dbo.imInterCtrlMedicamento (
			NumeroVisita, NroIndicacion, Observaciones, Profesional, OperadorCarga,
			HoraCarga, FechaCarga, HoraControl, FechaControl,
			Sector, Cantidad, CantidadIndicada, TipoUnidad, Troquel, IdTurno
		)
		OUTPUT INSERTED.IDCtrlMedica
		VALUES (
			@p0, 0, @p1, @p2, @p3, @p4, @p5, @p6, @p7,
			@p8, @p9, @p10, @p11, @p12, @p13
		)
	`;

	const params = [
		{ value: turno.numeroVisita || 0 },
		{ value: normalizarTextoParaClarionAnsi(data.observaciones || '') },
		{ value: data.profesional || data.operadorCarga || 0 },
		{ value: data.operadorCarga || 0 },
		{ value: horaCargaClarion },
		{ value: fechaCargaClarion },
		{ value: horaControlClarion },
		{ value: fechaControlClarion },
		{ value: sector },
		{ value: Number(data.cantidad) || 0 },
		{ value: Number(data.cantidadIndicada ?? data.cantidad) || 0 },
		{ value: tipoUnidad },
		{ value: Number(data.troquel) || 0 },
		{ value: id },
	];

	const rows = await executeQuery(sql, params);
	return { idCtrlMedica: rows[0]?.IDCtrlMedica };
}

async function actualizarTriage(idTurno, { idClasificacionTriage, observaciones }) {
	const id = _validarIdTurno(idTurno);
	const nivel =
		idClasificacionTriage != null && Number.isFinite(Number(idClasificacionTriage))
			? Number(idClasificacionTriage)
			: null;

	if (nivel != null && (nivel < 1 || nivel > 5)) {
		const e = new Error('Clasificación de triage inválida (1-5)');
		e.statusCode = 400;
		throw e;
	}

	let sql = `UPDATE dbo.imTurnos SET IdClasificacionTriage = @p0 WHERE IdTurno = @p1`;
	const params = [
		{ value: nivel, type: 'Int' },
		{ value: id, type: 'Int' },
	];

	if (observaciones !== undefined) {
		sql = `UPDATE dbo.imTurnos SET IdClasificacionTriage = @p0, Observaciones = @p1 WHERE IdTurno = @p2`;
		params.splice(1, 0, {
			value: normalizarTextoParaClarionAnsi(String(observaciones || '').slice(0, 1000)),
		});
	}

	await executeQuery(sql, params);
	return obtenerRac(id);
}

module.exports = {
	obtenerRac,
	crearControlTurno,
	crearMedicacionTurno,
	actualizarTriage,
	eliminarControl: controlesService.eliminarControl,
	eliminarMedicacion: medicacionService.eliminarMedicacion,
};
