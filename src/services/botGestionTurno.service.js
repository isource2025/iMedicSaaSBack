/**
 * Estado unificado de gestión de turno (datos del comprobante).
 * La IA actualiza vía herramientas; el wizard solo transacciona (RENAPER/reserva).
 */
const crypto = require('crypto');
const diag = require('../utils/diagLog');
const botConversacion = require('./botConversacion.service');

const ESTADOS_CERRADOS = new Set(['completada', 'cancelada']);

function debugEnabled() {
	return process.env.BOT_DEBUG_GESTION !== '0';
}

function dbg(msg, extra) {
	if (!debugEnabled()) return;
	diag.line('gestionTurno', msg, extra);
}

function _ahora() {
	return new Date().toISOString();
}

function _nuevoId() {
	return `gt-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function obtenerGestionActiva(conv) {
	const g = conv?.contextoBot?.gestionTurno;
	if (!g || ESTADOS_CERRADOS.has(g.estado)) return null;
	return g;
}

function ensureGestion(conv) {
	const existente = obtenerGestionActiva(conv);
	if (existente) return existente;
	return {
		id: _nuevoId(),
		estado: 'recopilando',
		iniciadaEn: _ahora(),
		actualizadaEn: _ahora(),
		identidad: null,
		especialidad: null,
		profesional: null,
		preferenciaHorario: null,
		turnoOfrecido: null,
		historialCambios: [],
	};
}

function _pushHistorial(gestion, campo, valor, meta = {}) {
	if (!gestion.historialCambios) gestion.historialCambios = [];
	gestion.historialCambios.push({
		campo,
		valor,
		ts: _ahora(),
		...meta,
	});
	if (gestion.historialCambios.length > 40) {
		gestion.historialCambios = gestion.historialCambios.slice(-40);
	}
}

function _touch(gestion) {
	gestion.actualizadaEn = _ahora();
	return gestion;
}

function mergeDesdeIdentidad(gestion, conv) {
	if (!gestion) return gestion;
	if (!conv?.idPaciente && !conv?.dniPaciente) return gestion;

	gestion.identidad = {
		estado: conv.idPaciente ? 'confirmada' : 'pendiente',
		dni: conv.dniPaciente || gestion.identidad?.dni || null,
		idPaciente: conv.idPaciente || null,
		nombreTicket: gestion.identidad?.nombreTicket || null,
		fechaNacimiento: gestion.identidad?.fechaNacimiento || null,
		fuente: gestion.identidad?.fuente || null,
	};
	if (conv.idPaciente && gestion.estado === 'recopilando') {
		gestion.estado = 'buscando';
	}
	_pushHistorial(gestion, 'identidad', gestion.identidad.dni);
	dbg('merge identidad', { dni: gestion.identidad.dni, idPaciente: gestion.identidad.idPaciente });
	return _touch(gestion);
}

function mergeDesdeHerramientas(gestion, resultados) {
	if (!gestion || !Array.isArray(resultados)) return gestion;

	for (const r of resultados) {
		if (!r.ok || !r.datos) continue;
		const d = r.datos;

		if (r.nombre === 'buscar_profesional' && d.tipo === 'unico') {
			gestion.profesional = {
				matricula: d.profesional.matricula,
				nombre: d.profesional.nombre,
				origen: gestion.profesional?.origen || 'paciente',
				confirmada: true,
			};
			if (d.especialidad?.valor) {
				gestion.especialidad = {
					valor: d.especialidad.valor,
					nombre: d.especialidad.nombre,
					origen: gestion.especialidad?.origen || 'inferida_profesional',
					confirmada: true,
				};
			}
			_pushHistorial(gestion, 'profesional', d.profesional.nombre);
			dbg('merge profesional unico', d.profesional);
		}

		if (r.nombre === 'buscar_profesional' && d.tipo === 'multiples') {
			gestion.candidatosProfesionales = (d.matches || []).slice(0, 8);
			_pushHistorial(gestion, 'candidatos', d.matches?.length);
		}

		if (r.nombre === 'resolver_especialidad' && d.encontrada && d.especialidad) {
			if (!gestion.especialidad?.confirmada || !gestion.profesional?.confirmada) {
				gestion.especialidad = {
					valor: d.especialidad.valor,
					nombre: d.especialidad.nombre,
					origen: 'paciente',
					confirmada: true,
				};
				_pushHistorial(gestion, 'especialidad', d.especialidad.nombre);
				dbg('merge especialidad', d.especialidad);
			}
		}

		if (r.nombre === 'interpretar_preferencia_horario' && d.resumen) {
			gestion.preferenciaHorario = {
				resumen: d.resumen,
				fechaDesde: d.fechaDesde || null,
				fechaHasta: d.fechaHasta || null,
				franja: d.franja || null,
				diasSemana: d.diasSemana || [],
				flexible: d.flexible !== false,
			};
			_pushHistorial(gestion, 'preferenciaHorario', d.resumen);
			dbg('merge preferencia', gestion.preferenciaHorario);
		}

		if (r.nombre === 'buscar_turno_disponible' && d.turno) {
			gestion.turnoOfrecido = {
				...d.turno,
				origen: 'recomendacion_sistema',
			};
			gestion.estado = 'ofreciendo';
			_pushHistorial(gestion, 'turnoOfrecido', `${d.turno.fecha} ${d.turno.hora}`);
		}
	}

	return _touch(gestion);
}

function mergeDesdeInterpretacion(gestion, parametros = {}) {
	if (!gestion || !parametros) return gestion;

	if (parametros.profesional || parametros.medico) {
		const nombre = String(parametros.profesional || parametros.medico).trim();
		if (nombre && !gestion.profesional?.confirmada) {
			gestion.profesionalPendienteTexto = nombre;
		}
	}

	if (parametros.especialidad && !gestion.especialidad?.confirmada) {
		gestion.especialidadPendienteTexto = String(parametros.especialidad).trim();
	}

	if (parametros.resumen || parametros.preferirFechaDesde) {
		const ph = gestion.preferenciaHorario || {};
		gestion.preferenciaHorario = { ...ph };
		if (parametros.resumen && !ph.resumen) {
			gestion.preferenciaHorario.resumen = String(parametros.resumen).trim();
		}
		if (parametros.preferirFechaDesde && !ph.fechaDesde) {
			gestion.preferenciaHorario.fechaDesde = String(parametros.preferirFechaDesde).slice(0, 10);
		}
		if (parametros.preferirFechaHasta && !ph.fechaHasta) {
			gestion.preferenciaHorario.fechaHasta = String(parametros.preferirFechaHasta).slice(0, 10);
		}
		if (parametros.preferirFranja && !ph.franja) {
			gestion.preferenciaHorario.franja = parametros.preferirFranja;
		}
	}

	return _touch(gestion);
}

function mergeTurnoOfrecido(gestion, sugerencia) {
	if (!gestion || !sugerencia) return gestion;
	gestion.turnoOfrecido = {
		matricula: sugerencia.matricula,
		medico: sugerencia.medico,
		especialidadValor: sugerencia.especialidad,
		especialidadNombre: sugerencia.especialidadNombre,
		fecha: sugerencia.fecha,
		fechaLegible: sugerencia.fechaLegible,
		diaSemana: sugerencia.diaSemana,
		hora: sugerencia.hora,
		sector: sugerencia.sector,
		origen: sugerencia.origen || 'recomendacion_sistema',
	};
	if (sugerencia.medico && !gestion.profesional?.confirmada) {
		gestion.profesional = {
			matricula: sugerencia.matricula,
			nombre: sugerencia.medico,
			origen: 'recomendacion_sistema',
			confirmada: true,
		};
	}
	if (sugerencia.especialidadNombre && !gestion.especialidad?.confirmada) {
		gestion.especialidad = {
			valor: sugerencia.especialidad,
			nombre: sugerencia.especialidadNombre,
			origen: 'recomendacion_sistema',
			confirmada: true,
		};
	}
	gestion.estado = 'ofreciendo';
	_pushHistorial(gestion, 'turnoOfrecido', `${sugerencia.fecha} ${sugerencia.hora}`);
	dbg('merge turno ofrecido', gestion.turnoOfrecido);
	return _touch(gestion);
}

function mergeIdentidadRenaper(gestion, { dni, nombre, fechaNacimiento, fuente, idPaciente }) {
	if (!gestion) return gestion;
	gestion.identidad = {
		estado: idPaciente ? 'confirmada' : 'pendiente',
		dni: dni || gestion.identidad?.dni,
		idPaciente: idPaciente || gestion.identidad?.idPaciente,
		nombreTicket: nombre || gestion.identidad?.nombreTicket,
		fechaNacimiento: fechaNacimiento || gestion.identidad?.fechaNacimiento,
		fuente: fuente || gestion.identidad?.fuente,
	};
	if (idPaciente) gestion.estado = gestion.turnoOfrecido ? 'ofreciendo' : 'buscando';
	return _touch(gestion);
}

function aPreferenciasBusqueda(gestion, ajusteExtra = null) {
	const excluir = { slots: [], fechas: [], diasSemana: [] };
	const preferir = {
		fechas: [],
		diasSemana: [],
		franja: null,
		horaDesde: null,
		horaHasta: null,
		fechaDesde: null,
		fechaHasta: null,
	};

	const ph = gestion?.preferenciaHorario;
	if (ph) {
		if (ph.fechaDesde) preferir.fechaDesde = ph.fechaDesde;
		if (ph.fechaHasta) preferir.fechaHasta = ph.fechaHasta;
		if (ph.franja) preferir.franja = ph.franja;
		if (ph.diasSemana?.length) preferir.diasSemana = [...ph.diasSemana];
	}

	if (ajusteExtra?.preferir) {
		const p = ajusteExtra.preferir;
		if (p.fechas?.length) preferir.fechas.push(...p.fechas);
		if (p.diasSemana?.length) preferir.diasSemana.push(...p.diasSemana);
		if (p.franja) preferir.franja = p.franja;
		if (p.fechaDesde) preferir.fechaDesde = p.fechaDesde;
		if (p.fechaHasta) preferir.fechaHasta = p.fechaHasta;
	}
	if (ajusteExtra?.excluir) {
		const e = ajusteExtra.excluir;
		if (e.slots?.length) excluir.slots.push(...e.slots);
		if (e.fechas?.length) excluir.fechas.push(...e.fechas);
		if (e.diasSemana?.length) excluir.diasSemana.push(...e.diasSemana);
	}

	preferir.fechas = [...new Set(preferir.fechas)];
	preferir.diasSemana = [...new Set(preferir.diasSemana)];
	excluir.fechas = [...new Set(excluir.fechas)];
	excluir.diasSemana = [...new Set(excluir.diasSemana)];

	return { excluir, preferir, resumen: ph?.resumen || ajusteExtra?.resumen || null };
}

function aDatosOperativos(gestion, conv) {
	if (!gestion) return null;
	const out = {
		gestionResumen: resumenParaPrompt(gestion),
		nombreSaludo: conv?.nombreContacto
			? String(conv.nombreContacto).trim().split(/\s+/)[0]
			: null,
		pacienteIdentificado: Boolean(conv?.idPaciente || gestion.identidad?.idPaciente),
	};
	if (gestion.profesional?.nombre) out.medico = gestion.profesional.nombre;
	if (gestion.especialidad?.nombre) out.especialidad = gestion.especialidad.nombre;
	if (gestion.preferenciaHorario?.resumen) out.preferencia = gestion.preferenciaHorario.resumen;
	const t = gestion.turnoOfrecido;
	if (t) {
		out.medico = out.medico || t.medico;
		out.especialidad = out.especialidad || t.especialidadNombre;
		out.fechaLegible = t.fechaLegible || t.fecha;
		out.diaSemana = t.diaSemana;
		out.hora = t.hora;
	}
	if (gestion.identidad?.nombreTicket) {
		out.nombrePaciente = gestion.identidad.nombreTicket;
	}
	return out;
}

function resumenParaPrompt(gestion) {
	if (!gestion) return '(sin gestión activa)';
	const partes = [`estado=${gestion.estado}`];
	if (gestion.identidad?.dni) {
		partes.push(
			`identidad=${gestion.identidad.estado} DNI ${gestion.identidad.dni}${gestion.identidad.nombreTicket ? ` (${gestion.identidad.nombreTicket})` : ''}`,
		);
	}
	if (gestion.especialidad?.nombre) {
		partes.push(`especialidad=${gestion.especialidad.nombre}${gestion.especialidad.confirmada ? ' ✓' : ''}`);
	}
	if (gestion.profesional?.nombre) {
		partes.push(`profesional=${gestion.profesional.nombre}${gestion.profesional.confirmada ? ' ✓' : ''}`);
	}
	if (gestion.preferenciaHorario?.resumen) {
		partes.push(`preferencia=${gestion.preferenciaHorario.resumen}`);
	}
	if (gestion.turnoOfrecido?.fecha) {
		const t = gestion.turnoOfrecido;
		partes.push(`turno_ofrecido=${t.medico} ${t.fechaLegible || t.fecha} ${t.hora}`);
	}
	return partes.join(' | ');
}

function sincronizarLegacy(ctx, gestion) {
	if (!gestion) return ctx;
	const out = { ...(ctx || {}), gestionTurno: gestion };

	if (gestion.especialidad?.valor) {
		out.especialidadPendiente = {
			valor: gestion.especialidad.valor,
			nombre: gestion.especialidad.nombre,
		};
	}
	if (gestion.profesional?.matricula) {
		out.profesionalPendiente = {
			matricula: gestion.profesional.matricula,
			nombre: gestion.profesional.nombre,
		};
	}
	if (gestion.candidatosProfesionales?.length) {
		out.candidatosProfesionales = gestion.candidatosProfesionales;
	}
	if (gestion.turnoOfrecido?.fecha && gestion.estado === 'ofreciendo') {
		const t = gestion.turnoOfrecido;
		out.tipo = 'turno_sugerido';
		out.matricula = t.matricula;
		out.medico = t.medico;
		out.especialidadValor = t.especialidadValor || gestion.especialidad?.valor;
		out.especialidadNombre = t.especialidadNombre || gestion.especialidad?.nombre;
		out.fecha = t.fecha;
		out.fechaLegible = t.fechaLegible;
		out.diaSemana = t.diaSemana;
		out.hora = t.hora;
		out.sector = t.sector;
	}

	return out;
}

function cerrarGestion(gestion, motivo = 'cancelada') {
	if (!gestion) return null;
	gestion.estado = motivo === 'completada' ? 'completada' : 'cancelada';
	gestion.cerradaEn = _ahora();
	_pushHistorial(gestion, 'cierre', motivo);
	dbg('gestión cerrada', { id: gestion.id, motivo });
	return _touch(gestion);
}

function tieneProfesionalConfirmado(gestion) {
	return Boolean(gestion?.profesional?.confirmada && gestion?.profesional?.matricula);
}

function tieneEspecialidadConfirmada(gestion) {
	return Boolean(gestion?.especialidad?.confirmada && gestion?.especialidad?.valor);
}

function necesitaIdentidad(conv, gestion) {
	return !conv?.idPaciente && !gestion?.identidad?.idPaciente;
}

function puedeBuscarTurno(conv, gestion) {
	const esp = gestion?.especialidad?.valor || conv?.contextoBot?.especialidadPendiente?.valor;
	const prof =
		gestion?.profesional?.matricula || conv?.contextoBot?.profesionalPendiente?.matricula;
	return Boolean(esp || prof);
}

async function persistir(idConversacion, conv, gestion) {
	const ctx = sincronizarLegacy(conv?.contextoBot, gestion);
	await botConversacion.guardarContextoBot(idConversacion, ctx);
	dbg('persistido', { idConversacion, resumen: resumenParaPrompt(gestion) });
	return (await botConversacion.obtenerConversacion(idConversacion)) || conv;
}

async function cargarOAsegurar(idConversacion, conv) {
	let gestion = ensureGestion(conv);
	gestion = mergeDesdeIdentidad(gestion, conv);
	return gestion;
}

function herramientasSugeridasParaTexto(texto, gestion) {
	const t = String(texto || '').toLowerCase();
	const llamadas = [{ nombre: 'estado_gestion', argumentos: {} }];

	const pareceMedico =
		/\b(dr|dra|doctor|doctora|medico|profesional|biasi|viasi|de\s+biasi)\b/i.test(t) ||
		/\bturno\s+con\b/i.test(t);
	const pareceTiempo =
		/\b(agosto|septiembre|octubre|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio)\b/i.test(
			t,
		) ||
		/\b(semana que viene|proxima semana|manana|otro dia|otra fecha|\d{1,2}\/\d{1,2})\b/i.test(t);

	if (pareceMedico || !gestion?.profesional?.confirmada) {
		llamadas.push({ nombre: 'buscar_profesional', argumentos: { texto } });
	}
	if (pareceTiempo || !gestion?.preferenciaHorario?.resumen) {
		llamadas.push({ nombre: 'interpretar_preferencia_horario', argumentos: { texto } });
	}

	const pareceEsp = t.length <= 24 && /\b(trauma|onco|gineco|cardio|pediatr)\b/i.test(t);
	if (pareceEsp && !gestion?.especialidad?.confirmada) {
		llamadas.push({ nombre: 'resolver_especialidad', argumentos: { texto } });
	}

	dbg('herramientas sugeridas', llamadas.map((l) => l.nombre));
	return llamadas;
}

module.exports = {
	debugEnabled,
	dbg,
	obtenerGestionActiva,
	ensureGestion,
	cargarOAsegurar,
	mergeDesdeIdentidad,
	mergeDesdeHerramientas,
	mergeDesdeInterpretacion,
	mergeTurnoOfrecido,
	mergeIdentidadRenaper,
	aPreferenciasBusqueda,
	aDatosOperativos,
	resumenParaPrompt,
	sincronizarLegacy,
	cerrarGestion,
	persistir,
	tieneProfesionalConfirmado,
	tieneEspecialidadConfirmada,
	necesitaIdentidad,
	puedeBuscarTurno,
	herramientasSugeridasParaTexto,
};
