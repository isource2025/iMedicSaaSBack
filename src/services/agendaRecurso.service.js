/**
 * Agenda por sector / servicio (recurso compartido).
 * Misma forma que imPersonalHorarios, sin aceptación: visible a médicos
 * con ese sector (imPersonalSectores) o servicio asignado.
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
	normalizarDia,
	intervaloMinAClarion,
	clarionAIntervaloMin,
} = require('../utils/agendaCatalogos');
const feriadosService = require('./feriados.service');

const TIPOS = new Set(['SECTOR', 'SERVICIO']);

async function ensureTable() {
	await executeQuery(`
		IF OBJECT_ID(N'dbo.imAgendaRecursoHorarios', N'U') IS NULL
		BEGIN
			CREATE TABLE dbo.imAgendaRecursoHorarios (
				TipoRecurso       VARCHAR(10)  NOT NULL,
				ValorRecurso      VARCHAR(20)  NOT NULL,
				Dia               VARCHAR(20)  NOT NULL CONSTRAINT DF_imAgendaRecursoHorarios_Dia DEFAULT '',
				HoraDesde         INT          NOT NULL,
				HoraHasta         INT          NOT NULL,
				IntervaloConsulta INT          NULL,
				IDConsultorio     VARCHAR(20)  NULL,
				IdServicio        VARCHAR(20)  NULL,
				CONSTRAINT PK_imAgendaRecursoHorarios PRIMARY KEY (TipoRecurso, ValorRecurso, Dia, HoraDesde)
			);
		END
	`);
}

function _normTipo(tipo) {
	const t = String(tipo || '')
		.trim()
		.toUpperCase();
	if (!TIPOS.has(t)) {
		const e = new Error('Tipo de recurso inválido (SECTOR|SERVICIO)');
		e.statusCode = 400;
		throw e;
	}
	return t;
}

function _normValor(valor) {
	const v = String(valor || '')
		.trim()
		.slice(0, 20);
	if (!v) {
		const e = new Error('Valor de recurso requerido');
		e.statusCode = 400;
		throw e;
	}
	return v;
}

function _hhmm(d) {
	if (!d) return null;
	const s = convertirHoraClarionAString(d);
	return s ? s.slice(0, 5) : null;
}

function _isoDate(d) {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

function _parseIso(iso) {
	const [y, m, d] = String(iso || '')
		.split('-')
		.map(Number);
	if (!y || !m || !d) {
		const e = new Error('Fecha ISO inválida');
		e.statusCode = 400;
		throw e;
	}
	return new Date(y, m - 1, d);
}

function _diaSemana(date) {
	const map = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
	return map[date.getDay()];
}

function clarionPasoMinutos(intervaloMin) {
	return Math.max(1, Number(intervaloMin) || 30) * 6000;
}

async function obtenerHorarios(tipo, valor) {
	await ensureTable();
	const t = _normTipo(tipo);
	const v = _normValor(valor);
	const rows = await executeQuery(
		`SELECT TipoRecurso, ValorRecurso, Dia, HoraDesde, HoraHasta, IntervaloConsulta, IDConsultorio, IdServicio
		 FROM dbo.imAgendaRecursoHorarios
		 WHERE TipoRecurso = @p0 AND LTRIM(RTRIM(ValorRecurso)) = @p1
		 ORDER BY Dia, HoraDesde`,
		[
			{ value: t, type: 'VarChar' },
			{ value: v, type: 'VarChar' },
		],
	);

	const dias = DIAS_SEMANA.map((d) => ({ dia: d, rangos: [] }));
	let intervaloMin = null;
	let consultorio = null;
	let servicio = null;
	const conteoIntervalos = new Map();

	for (const r of rows) {
		const im = clarionAIntervaloMin(r.IntervaloConsulta);
		const inicio = _hhmm(r.HoraDesde);
		const fin = _hhmm(r.HoraHasta);
		const cons = r.IDConsultorio ? String(r.IDConsultorio).trim() : null;
		const serv = r.IdServicio ? String(r.IdServicio).trim() : null;
		if (im != null) conteoIntervalos.set(im, (conteoIntervalos.get(im) || 0) + 1);
		if (cons && !consultorio) consultorio = cons;
		if (serv && !servicio) servicio = serv;

		const diaNorm = normalizarDia(r.Dia);
		if (!diaNorm) continue;
		const bucket = dias.find((d) => d.dia === diaNorm);
		if (!bucket) continue;
		bucket.rangos.push({
			inicio,
			fin,
			intervaloMin: im,
			consultorio: cons,
			servicio: serv,
		});
	}

	let max = 0;
	for (const [k, c] of conteoIntervalos) {
		if (c > max) {
			max = c;
			intervaloMin = k;
		}
	}

	return {
		tipo: t,
		valor: v,
		intervaloMin: intervaloMin || 30,
		consultorio,
		servicio: servicio || (t === 'SERVICIO' ? v : null),
		dias,
	};
}

async function reemplazarHorarios(tipo, valor, payload = {}) {
	await ensureTable();
	const t = _normTipo(tipo);
	const v = _normValor(valor);
	const intervaloMin = Number(payload.intervaloMin) || 30;
	const intervaloClarion = intervaloMinAClarion(intervaloMin);
	const consultorio = payload.consultorio != null ? String(payload.consultorio).trim().slice(0, 4) : '';
	const servicio =
		payload.servicio != null
			? String(payload.servicio).trim().slice(0, 4)
			: t === 'SERVICIO'
				? v.slice(0, 4)
				: '';

	const diasIn = Array.isArray(payload.dias) ? payload.dias : [];
	const cambios = [];
	for (const d of diasIn) {
		const dia = normalizarDia(d?.dia);
		if (!dia) continue;
		const rangos = Array.isArray(d.rangos) ? d.rangos : [];
		if (rangos.length > 2) {
			const e = new Error(`Día ${dia}: como máximo 2 rangos`);
			e.statusCode = 400;
			throw e;
		}
		const rangosClarion = [];
		for (const r of rangos) {
			if (!r?.inicio || !r?.fin) continue;
			const ini = convertirHoraAClarion(r.inicio);
			const fin = convertirHoraAClarion(r.fin);
			if (ini == null || fin == null || ini >= fin) {
				const e = new Error(`Día ${dia}: rango inválido (${r.inicio}-${r.fin})`);
				e.statusCode = 400;
				throw e;
			}
			if ((fin - ini) % (intervaloMin * 6000) !== 0) {
				const e = new Error(
					`Día ${dia}: el rango ${r.inicio}-${r.fin} no es múltiplo de ${intervaloMin} min`,
				);
				e.statusCode = 400;
				throw e;
			}
			rangosClarion.push({ HoraDesde: ini, HoraHasta: fin });
		}
		rangosClarion.sort((a, b) => a.HoraDesde - b.HoraDesde);
		cambios.push({ dia, rangos: rangosClarion });
	}

	const pool = await getRequestPool();
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		await new sql.Request(tx)
			.input('t', sql.VarChar(10), t)
			.input('v', sql.VarChar(20), v)
			.query(
				`DELETE FROM dbo.imAgendaRecursoHorarios WHERE TipoRecurso = @t AND LTRIM(RTRIM(ValorRecurso)) = @v`,
			);

		for (const c of cambios) {
			for (const r of c.rangos) {
				await new sql.Request(tx)
					.input('t', sql.VarChar(10), t)
					.input('v', sql.VarChar(20), v)
					.input('dia', sql.VarChar(20), c.dia)
					.input('hd', sql.Int, r.HoraDesde)
					.input('hh', sql.Int, r.HoraHasta)
					.input('iv', sql.Int, intervaloClarion)
					.input('cons', sql.VarChar(20), consultorio || null)
					.input('serv', sql.VarChar(20), servicio || null)
					.query(`
						INSERT INTO dbo.imAgendaRecursoHorarios
							(TipoRecurso, ValorRecurso, Dia, HoraDesde, HoraHasta, IntervaloConsulta, IDConsultorio, IdServicio)
						VALUES (@t, @v, @dia, @hd, @hh, @iv, @cons, @serv)
					`);
			}
		}
		await tx.commit();
	} catch (err) {
		try {
			await tx.rollback();
		} catch (_) {}
		throw err;
	}
	return obtenerHorarios(t, v);
}

/** Recursos con horario configurado, filtrados por sectores/servicios del profesional. */
async function listarRecursosVisibles({ matricula, valorPersonal } = {}) {
	await ensureTable();
	const mat = Number(matricula) || 0;
	const vp = Number(valorPersonal) || 0;

	const configured = await executeQuery(
		`SELECT DISTINCT TipoRecurso, LTRIM(RTRIM(ValorRecurso)) AS ValorRecurso
		 FROM dbo.imAgendaRecursoHorarios`,
	);

	let sectores = new Set();
	let servicios = new Set();

	if (vp > 0) {
		const secRows = await executeQuery(
			`SELECT LTRIM(RTRIM(idSector)) AS idSector
			 FROM dbo.imPersonalSectores WHERE idPersonal = @p0`,
			[{ value: vp, type: 'Int' }],
		).catch(() => []);
		for (const r of secRows || []) {
			const s = String(r.idSector || '').trim();
			if (s) sectores.add(s.toUpperCase());
		}
	}
	if (mat > 0) {
		const pers = await executeQuery(
			`SELECT TOP 1 LTRIM(RTRIM(ValorServicio)) AS ValorServicio, Valor
			 FROM dbo.imPersonal WHERE Matricula = @p0`,
			[{ value: mat, type: 'Int' }],
		).catch(() => []);
		const vs = String(pers[0]?.ValorServicio || '').trim();
		if (vs) servicios.add(vs.toUpperCase());
		if (!vp && pers[0]?.Valor) {
			const secRows = await executeQuery(
				`SELECT LTRIM(RTRIM(idSector)) AS idSector
				 FROM dbo.imPersonalSectores WHERE idPersonal = @p0`,
				[{ value: Number(pers[0].Valor), type: 'Int' }],
			).catch(() => []);
			for (const r of secRows || []) {
				const s = String(r.idSector || '').trim();
				if (s) sectores.add(s.toUpperCase());
			}
		}
	}

	const out = [];
	for (const r of configured || []) {
		const tipo = String(r.TipoRecurso || '').trim().toUpperCase();
		const valor = String(r.ValorRecurso || '').trim();
		if (!tipo || !valor) continue;
		const key = valor.toUpperCase();
		if (sectores.size + servicios.size === 0) continue;
		if (tipo === 'SECTOR' && !sectores.has(key)) continue;
		if (tipo === 'SERVICIO' && !servicios.has(key)) continue;
		out.push({
			tipo,
			valor,
			nombre: `${tipo === 'SECTOR' ? 'Sector' : 'Servicio'} ${valor}`,
			esRecurso: true,
		});
	}
	out.sort((a, b) => a.nombre.localeCompare(b.nombre));
	return out;
}

async function listarRecursosConfigurados() {
	await ensureTable();
	const rows = await executeQuery(
		`SELECT DISTINCT TipoRecurso, LTRIM(RTRIM(ValorRecurso)) AS ValorRecurso
		 FROM dbo.imAgendaRecursoHorarios
		 ORDER BY TipoRecurso, ValorRecurso`,
	);
	return (rows || []).map((r) => ({
		tipo: String(r.TipoRecurso || '').trim().toUpperCase(),
		valor: String(r.ValorRecurso || '').trim(),
		nombre: `${String(r.TipoRecurso).toUpperCase() === 'SECTOR' ? 'Sector' : 'Servicio'} ${String(r.ValorRecurso || '').trim()}`,
		esRecurso: true,
	}));
}

async function generarSlots(tipo, valor, desdeIso, hastaIso) {
	const t = _normTipo(tipo);
	const v = _normValor(valor);
	const horarios = await obtenerHorarios(t, v);
	const desde = _parseIso(desdeIso);
	const hasta = _parseIso(hastaIso);
	if (hasta < desde) {
		const e = new Error('hasta debe ser >= desde');
		e.statusCode = 400;
		throw e;
	}

	const desdeClarion = convertirFechaAClarion(desdeIso);
	const hastaClarion = convertirFechaAClarion(hastaIso);
	const sectorKey = t === 'SECTOR' ? v : v;

	const [turnos, feriados] = await Promise.all([
		executeQuery(
		`
		SELECT t.IdTurno, t.FechaAsignada, t.Hora, t.Sector, t.Profesional, t.IDPaciente, t.Status,
		       t.Observaciones, t.EsSobreturno,
		       LTRIM(RTRIM(ISNULL(p.ApellidoyNombre, ''))) AS PacienteNombre
		FROM dbo.imTurnos t
		LEFT JOIN dbo.imPacientes p ON p.IDPaciente = t.IDPaciente
		WHERE t.FechaAsignada BETWEEN @p0 AND @p1
		  AND LTRIM(RTRIM(ISNULL(t.Sector, ''))) = @p2
		`,
		[
			{ value: desdeClarion, type: 'Int' },
			{ value: hastaClarion, type: 'Int' },
			{ value: sectorKey, type: 'VarChar' },
		],
		).catch(() => []),
		feriadosService.listarEnRangoConEnsure(desdeIso, hastaIso).catch(() => []),
	]);

	const turnoMap = new Map();
	for (const row of turnos || []) {
		const fecha = convertirFechaClarionADate(row.FechaAsignada);
		const fechaIso = fecha ? _isoDate(fecha) : null;
		const hora = _hhmm(row.Hora);
		if (!fechaIso || !hora) continue;
		const k = `${fechaIso}|${hora}`;
		if (!turnoMap.has(k)) turnoMap.set(k, []);
		turnoMap.get(k).push(row);
	}

	const diasOut = [];
	const cursor = new Date(desde);
	while (cursor <= hasta) {
		const fechaIso = _isoDate(cursor);
		const diaNombre = _diaSemana(cursor);
		const feriado = feriadosService.feriadoEnFecha(fechaIso, feriados);
		if (feriado) {
			diasOut.push({
				fecha: fechaIso,
				dia: diaNombre,
				bloqueado: true,
				motivo: 'feriado',
				motivoLabel: feriado.nombre || 'Feriado',
				slots: [],
			});
			cursor.setDate(cursor.getDate() + 1);
			continue;
		}
		const diaCfg = horarios.dias.find((d) => d.dia === diaNombre);
		const slots = [];

		if (diaCfg?.rangos?.length) {
			for (const rango of diaCfg.rangos) {
				const intervaloMin = rango.intervaloMin || horarios.intervaloMin || 30;
				const step = clarionPasoMinutos(intervaloMin);
				const ini = convertirHoraAClarion(rango.inicio);
				const fin = convertirHoraAClarion(rango.fin);
				if (ini == null || fin == null) continue;
				for (let tClarion = ini; tClarion < fin; tClarion += step) {
					const hora = _hhmm(tClarion);
					const existentes = turnoMap.get(`${fechaIso}|${hora}`) || [];
					const ocupado = existentes.find(
						(x) => Number(x.IDPaciente) > 0 && Number(x.Status) !== 1,
					);
					const cancelado = existentes.find((x) => Number(x.Status) === 1);
					if (ocupado) {
						slots.push({
							hora,
							horaClarion: tClarion,
							sector: sectorKey,
							estado: Number(ocupado.Status) === 2 ? 'ATENDIDO' : 'OCUPADO',
							idTurno: ocupado.IdTurno,
							idPaciente: ocupado.IDPaciente,
							pacienteNombre: ocupado.PacienteNombre || null,
							profesional: ocupado.Profesional,
							observaciones: ocupado.Observaciones || null,
							esSobreturno: !!ocupado.EsSobreturno,
							esRecurso: true,
							tipoRecurso: t,
							valorRecurso: v,
						});
					} else if (cancelado) {
						slots.push({
							hora,
							horaClarion: tClarion,
							sector: sectorKey,
							estado: 'CANCELADO',
							idTurno: cancelado.IdTurno,
							idPaciente: cancelado.IDPaciente,
							esRecurso: true,
							tipoRecurso: t,
							valorRecurso: v,
						});
					} else {
						slots.push({
							hora,
							horaClarion: tClarion,
							sector: sectorKey,
							estado: 'LIBRE',
							idTurno: null,
							esRecurso: true,
							tipoRecurso: t,
							valorRecurso: v,
						});
					}
				}
			}
		}

		diasOut.push({
			fecha: fechaIso,
			dia: diaNombre,
			bloqueado: false,
			motivo: diaCfg?.rangos?.length ? null : 'sin_horario',
			slots,
		});
		cursor.setDate(cursor.getDate() + 1);
	}

	return { tipo: t, valor: v, dias: diasOut };
}

module.exports = {
	ensureTable,
	obtenerHorarios,
	reemplazarHorarios,
	listarRecursosVisibles,
	listarRecursosConfigurados,
	generarSlots,
};
