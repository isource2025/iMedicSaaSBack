/**
 * Service: Configuración de agenda por médico.
 *
 * Tablas:
 *   - imPersonalHorarios   PK (Matricula, Dia, HoraDesde)
 *   - imPersonalNoHorarios PK (Matricula, DesdeFecha, HoraDesde, MotivodeEsepcion)
 *
 * Todas las fechas/horas de las dos tablas viven en formato Clarion (int).
 * Este service expone la API en formato ISO/HH:MM y se encarga de la conversión.
 */
const sql = require('mssql');
const { executeQuery, getRequestPool } = require('../models/db');
const {
	convertirFechaAClarion,
	convertirHoraAClarion,
	convertirFechaClarionADate,
	convertirHoraClarionAString,
} = require('../utils/dateUtils');
const {
	DIAS_SEMANA,
	MOTIVOS_NO_HORARIO,
	normalizarDia,
	intervaloMinAClarion,
	clarionAIntervaloMin,
} = require('../utils/agendaCatalogos');

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

function _hhmm(d) {
	if (!d) return null;
	const s = convertirHoraClarionAString(d);
	return s ? s.slice(0, 5) : null;
}

function _isoDate(clarion) {
	const d = convertirFechaClarionADate(clarion);
	if (!d) return null;
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

function _validarMatricula(matricula) {
	const m = Number(matricula);
	if (!Number.isFinite(m) || m <= 0) {
		const e = new Error('Matrícula inválida');
		e.statusCode = 400;
		throw e;
	}
	return m;
}

// ────────────────────────────────────────────────────────────────────────────
// HORARIOS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la configuración semanal del médico, agrupada por día.
 * Estructura:
 *   {
 *     intervaloMin: 30,                  // mayoritario (puede haber dispersión)
 *     consultorio:  'CAR',               // mayoritario
 *     servicio:     'CAR',
 *     dias: [
 *       { dia: 'Lunes', rangos: [{ inicio:'08:00', fin:'12:00', intervaloMin:30, consultorio, servicio }] },
 *       ...
 *     ],
 *     permanentes: [   // filas legacy con Dia=''
 *       { horaInicio:'00:00', horaFin:'00:00', intervaloMin: ..., consultorio, servicio }
 *     ]
 *   }
 */
async function obtenerHorariosPorMatricula(matricula) {
	const m = _validarMatricula(matricula);

	const rows = await executeQuery(
		`SELECT Matricula, Dia, HoraDesde, HoraHasta, IntervaloConsulta, IDConsultorio, IdServicio
		 FROM dbo.imPersonalHorarios
		 WHERE Matricula = @p0
		 ORDER BY Dia, HoraDesde`,
		[{ value: m, type: 'Int' }],
	);

	const dias = DIAS_SEMANA.map((d) => ({ dia: d, rangos: [] }));
	const permanentes = [];
	let intervaloMin = null;
	let consultorio = null;
	let servicio = null;
	const conteoIntervalos = new Map();
	const conteoConsult = new Map();
	const conteoServ = new Map();

	for (const r of rows) {
		const im = clarionAIntervaloMin(r.IntervaloConsulta);
		const inicio = _hhmm(r.HoraDesde);
		const fin = _hhmm(r.HoraHasta);
		const cons = r.IDConsultorio ? String(r.IDConsultorio).trim() : null;
		const serv = r.IdServicio ? String(r.IdServicio).trim() : null;

		if (im != null) conteoIntervalos.set(im, (conteoIntervalos.get(im) || 0) + 1);
		if (cons) conteoConsult.set(cons, (conteoConsult.get(cons) || 0) + 1);
		if (serv) conteoServ.set(serv, (conteoServ.get(serv) || 0) + 1);

		const diaNorm = normalizarDia(r.Dia);
		if (!diaNorm) {
			// Fila legacy "guardia continua" (Dia="").
			permanentes.push({
				horaInicio: inicio,
				horaFin: fin,
				intervaloMin: im,
				consultorio: cons,
				servicio: serv,
			});
			continue;
		}
		const slot = dias.find((x) => x.dia === diaNorm);
		if (slot) {
			slot.rangos.push({
				inicio,
				fin,
				inicioClarion: Number(r.HoraDesde) || null,
				finClarion: Number(r.HoraHasta) || null,
				intervaloMin: im,
				consultorio: cons,
				servicio: serv,
			});
		}
	}

	function _moda(map) {
		let best = null;
		let bestN = 0;
		for (const [k, n] of map) if (n > bestN) { best = k; bestN = n; }
		return best;
	}

	intervaloMin = _moda(conteoIntervalos);
	consultorio = _moda(conteoConsult);
	servicio = _moda(conteoServ);

	return {
		matricula: m,
		intervaloMin,
		consultorio,
		servicio,
		dias,
		permanentes,
	};
}

/**
 * Reemplaza la configuración semanal del médico con un payload nuevo.
 *
 * payload:
 *   {
 *     intervaloMin: 30,                          // requerido (entero positivo)
 *     consultorio:  'CAR' | null,
 *     servicio:     'CAR' | null,
 *     dias: [
 *       { dia: 'Lunes',  rangos: [{ inicio:'08:00', fin:'12:00' }] },
 *       { dia: 'Martes', rangos: [{ inicio:'08:00', fin:'12:00' }, { inicio:'15:00', fin:'19:00' }] }
 *     ]
 *   }
 *
 * Sólo modifica los días incluidos en `dias`. Si rangos[] viene vacío el día
 * queda sin atención (DELETE). Las filas legacy con Dia='' (permanentes)
 * NO se tocan en este endpoint.
 */
async function reemplazarHorarios(matricula, payload) {
	const m = _validarMatricula(matricula);
	const intervaloMin = Number(payload?.intervaloMin);
	if (!Number.isFinite(intervaloMin) || intervaloMin <= 0) {
		const e = new Error('intervaloMin requerido (entero positivo en minutos)');
		e.statusCode = 400;
		throw e;
	}
	if (!Array.isArray(payload?.dias)) {
		const e = new Error('payload.dias debe ser un array');
		e.statusCode = 400;
		throw e;
	}

	const consultorio = payload.consultorio ? String(payload.consultorio).trim().slice(0, 4) : '';
	const servicio = payload.servicio ? String(payload.servicio).trim().slice(0, 4) : '';
	const intervaloClarion = intervaloMinAClarion(intervaloMin);

	// Validación + normalización
	const cambios = []; // [{ dia, rangos:[{HoraDesde, HoraHasta}] }]
	for (const d of payload.dias) {
		const dia = normalizarDia(d?.dia);
		if (!dia) {
			const e = new Error(`Día inválido: ${d?.dia}`);
			e.statusCode = 400;
			throw e;
		}
		const rangos = Array.isArray(d.rangos) ? d.rangos : [];
		if (rangos.length > 2) {
			const e = new Error(`Día ${dia}: como máximo 2 rangos (jornada simple o doble)`);
			e.statusCode = 400;
			throw e;
		}

		// Validar cada rango y convertir a Clarion
		const rangosClarion = [];
		for (const r of rangos) {
			if (!r?.inicio || !r?.fin) {
				const e = new Error(`Día ${dia}: rango sin inicio/fin`);
				e.statusCode = 400;
				throw e;
			}
			const ini = convertirHoraAClarion(r.inicio);
			const fin = convertirHoraAClarion(r.fin);
			if (ini == null || fin == null || ini >= fin) {
				const e = new Error(`Día ${dia}: rango inválido (${r.inicio}-${r.fin})`);
				e.statusCode = 400;
				throw e;
			}
			// Múltiplo del intervalo
			const duracionUnidad = (fin - ini); // en mismas unidades Clarion (centésimas+1)
			// duracion en minutos = (fin-ini) / 6000 aprox. Validar divisibilidad por intervalo.
			if ((fin - ini) % (intervaloMin * 6000) !== 0) {
				const e = new Error(
					`Día ${dia}: el rango ${r.inicio}-${r.fin} no es múltiplo de ${intervaloMin} min`,
				);
				e.statusCode = 400;
				throw e;
			}
			rangosClarion.push({ HoraDesde: ini, HoraHasta: fin });
		}

		// Sin solape entre rangos del mismo día
		rangosClarion.sort((a, b) => a.HoraDesde - b.HoraDesde);
		for (let i = 1; i < rangosClarion.length; i++) {
			if (rangosClarion[i].HoraDesde < rangosClarion[i - 1].HoraHasta) {
				const e = new Error(`Día ${dia}: rangos solapados`);
				e.statusCode = 400;
				throw e;
			}
		}

		cambios.push({ dia, rangos: rangosClarion });
	}

	// Transacción: por cada día, DELETE + INSERT.
	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		for (const c of cambios) {
			await new sql.Request(tx)
				.input('mat', sql.Int, m)
				.input('dia', sql.VarChar(9), c.dia)
				.query(`DELETE FROM dbo.imPersonalHorarios WHERE Matricula = @mat AND Dia = @dia`);

			for (const r of c.rangos) {
				await new sql.Request(tx)
					.input('mat', sql.Int, m)
					.input('dia', sql.VarChar(9), c.dia)
					.input('hd', sql.Int, r.HoraDesde)
					.input('hh', sql.Int, r.HoraHasta)
					.input('iv', sql.Int, intervaloClarion)
					.input('cons', sql.VarChar(4), consultorio)
					.input('serv', sql.VarChar(4), servicio)
					.query(`
						INSERT INTO dbo.imPersonalHorarios
							(Matricula, Dia, HoraDesde, HoraHasta, IntervaloConsulta, IDConsultorio, IdServicio)
						VALUES (@mat, @dia, @hd, @hh, @iv, @cons, @serv)
					`);
			}
		}
		await tx.commit();
	} catch (err) {
		try { await tx.rollback(); } catch (_) {}
		throw err;
	}

	return obtenerHorariosPorMatricula(m);
}

// ────────────────────────────────────────────────────────────────────────────
// NO-HORARIOS (ausencias)
// ────────────────────────────────────────────────────────────────────────────

async function listarNoHorarios(matricula, { desde, hasta } = {}) {
	const m = _validarMatricula(matricula);
	const params = [{ value: m, type: 'Int' }];
	let filtro = '';
	if (desde) {
		const d = convertirFechaAClarion(desde);
		params.push({ value: d, type: 'Int' });
		filtro += ` AND HastaFecha >= @p${params.length - 1}`;
	}
	if (hasta) {
		const h = convertirFechaAClarion(hasta);
		params.push({ value: h, type: 'Int' });
		filtro += ` AND DesdeFecha <= @p${params.length - 1}`;
	}

	const rows = await executeQuery(
		`SELECT Matricula, DesdeFecha, HastaFecha, HoraDesde, HoraHasta, MotivodeEsepcion,
		        FechaCarga, HoraCarga, CodOperador
		 FROM dbo.imPersonalNoHorarios
		 WHERE Matricula = @p0 ${filtro}
		 ORDER BY DesdeFecha DESC, HoraDesde DESC`,
		params,
	);

	return rows.map((r) => ({
		matricula: r.Matricula,
		desdeFecha: _isoDate(r.DesdeFecha),
		hastaFecha: _isoDate(r.HastaFecha),
		horaDesde: _hhmm(r.HoraDesde),
		horaHasta: _hhmm(r.HoraHasta),
		diaCompleto: !r.HoraDesde && !r.HoraHasta,
		motivo: r.MotivodeEsepcion,
		motivoLabel: MOTIVOS_NO_HORARIO[r.MotivodeEsepcion] || `Motivo ${r.MotivodeEsepcion}`,
		fechaCarga: _isoDate(r.FechaCarga),
		horaCarga: _hhmm(r.HoraCarga),
		codOperador: r.CodOperador,
	}));
}

function _validarPayloadNoHorario(p) {
	if (!p?.desdeFecha) {
		const e = new Error('desdeFecha es requerido (YYYY-MM-DD)');
		e.statusCode = 400;
		throw e;
	}
	const motivo = Number(p.motivo);
	if (!Number.isFinite(motivo) || motivo < 0 || motivo > 255) {
		const e = new Error('motivo inválido (0..255)');
		e.statusCode = 400;
		throw e;
	}
	const desde = convertirFechaAClarion(p.desdeFecha);
	const hasta = p.hastaFecha ? convertirFechaAClarion(p.hastaFecha) : desde;
	if (hasta < desde) {
		const e = new Error('hastaFecha < desdeFecha');
		e.statusCode = 400;
		throw e;
	}
	const horaDesde = p.diaCompleto ? 0 : (p.horaDesde ? convertirHoraAClarion(p.horaDesde) : 0);
	const horaHasta = p.diaCompleto ? 0 : (p.horaHasta ? convertirHoraAClarion(p.horaHasta) : 0);
	if (!p.diaCompleto && horaDesde && horaHasta && horaHasta <= horaDesde) {
		const e = new Error('horaHasta <= horaDesde');
		e.statusCode = 400;
		throw e;
	}
	return { desde, hasta, horaDesde, horaHasta, motivo };
}

async function crearNoHorario(matricula, codOperador, payload) {
	const m = _validarMatricula(matricula);
	const v = _validarPayloadNoHorario(payload);

	const hoyFecha = convertirFechaAClarion(new Date());
	const ahoraHora = convertirHoraAClarion(
		new Date().toTimeString().slice(0, 8),
	);

	await executeQuery(
		`INSERT INTO dbo.imPersonalNoHorarios
		    (Matricula, DesdeFecha, HastaFecha, HoraDesde, HoraHasta, MotivodeEsepcion,
		     FechaCarga, HoraCarga, CodOperador)
		 VALUES (@p0, @p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8)`,
		[
			{ value: m, type: 'Int' },
			{ value: v.desde, type: 'Int' },
			{ value: v.hasta, type: 'Int' },
			{ value: v.horaDesde, type: 'Int' },
			{ value: v.horaHasta, type: 'Int' },
			{ value: v.motivo, type: 'TinyInt' },
			{ value: hoyFecha, type: 'Int' },
			{ value: ahoraHora, type: 'Int' },
			{ value: Number(codOperador) || 0, type: 'SmallInt' },
		],
	);

	return { matricula: m, ...payload };
}

/**
 * Update por PK compuesta. El cliente debe enviar la PK ORIGINAL en `pk`.
 */
async function actualizarNoHorario(matricula, codOperador, body) {
	const m = _validarMatricula(matricula);
	const pk = body?.pk;
	if (!pk?.desdeFecha || !pk?.horaDesde == null || pk?.motivo == null) {
		const e = new Error('pk { desdeFecha, horaDesde, motivo } requerido');
		e.statusCode = 400;
		throw e;
	}
	const pkDesde = convertirFechaAClarion(pk.desdeFecha);
	const pkHora = pk.horaDesde ? convertirHoraAClarion(pk.horaDesde) : 0;
	const pkMotivo = Number(pk.motivo);

	const v = _validarPayloadNoHorario(body);

	// Estrategia: borrar la fila vieja por PK e insertar la nueva (la PK puede cambiar).
	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		await new sql.Request(tx)
			.input('mat', sql.Int, m)
			.input('df', sql.Int, pkDesde)
			.input('hd', sql.Int, pkHora)
			.input('mo', sql.TinyInt, pkMotivo)
			.query(
				`DELETE FROM dbo.imPersonalNoHorarios
				 WHERE Matricula=@mat AND DesdeFecha=@df AND HoraDesde=@hd AND MotivodeEsepcion=@mo`,
			);

		const hoy = convertirFechaAClarion(new Date());
		const ahora = convertirHoraAClarion(new Date().toTimeString().slice(0, 8));

		await new sql.Request(tx)
			.input('mat', sql.Int, m)
			.input('df', sql.Int, v.desde)
			.input('hf', sql.Int, v.hasta)
			.input('hd', sql.Int, v.horaDesde)
			.input('hh', sql.Int, v.horaHasta)
			.input('mo', sql.TinyInt, v.motivo)
			.input('fc', sql.Int, hoy)
			.input('hc', sql.Int, ahora)
			.input('op', sql.SmallInt, Number(codOperador) || 0)
			.query(`
				INSERT INTO dbo.imPersonalNoHorarios
					(Matricula, DesdeFecha, HastaFecha, HoraDesde, HoraHasta, MotivodeEsepcion,
					 FechaCarga, HoraCarga, CodOperador)
				VALUES (@mat, @df, @hf, @hd, @hh, @mo, @fc, @hc, @op)
			`);
		await tx.commit();
	} catch (err) {
		try { await tx.rollback(); } catch (_) {}
		throw err;
	}

	return { matricula: m, ...body };
}

async function eliminarNoHorario(matricula, body) {
	const m = _validarMatricula(matricula);
	if (!body?.desdeFecha || body?.motivo == null) {
		const e = new Error('desdeFecha y motivo requeridos para borrar');
		e.statusCode = 400;
		throw e;
	}
	const df = convertirFechaAClarion(body.desdeFecha);
	const hd = body.horaDesde ? convertirHoraAClarion(body.horaDesde) : 0;
	const mo = Number(body.motivo);

	const r = await executeQuery(
		`DELETE FROM dbo.imPersonalNoHorarios
		 WHERE Matricula=@p0 AND DesdeFecha=@p1 AND HoraDesde=@p2 AND MotivodeEsepcion=@p3;
		 SELECT @@ROWCOUNT AS afectadas;`,
		[
			{ value: m, type: 'Int' },
			{ value: df, type: 'Int' },
			{ value: hd, type: 'Int' },
			{ value: mo, type: 'TinyInt' },
		],
	);
	const afectadas = r?.[0]?.afectadas ?? 0;
	if (!afectadas) {
		const e = new Error('No se encontró el no-horario indicado');
		e.statusCode = 404;
		throw e;
	}
	return { matricula: m, eliminadas: afectadas };
}

module.exports = {
	obtenerHorariosPorMatricula,
	reemplazarHorarios,
	listarNoHorarios,
	crearNoHorario,
	actualizarNoHorario,
	eliminarNoHorario,
};
