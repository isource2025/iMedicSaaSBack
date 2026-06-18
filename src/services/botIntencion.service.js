/**
 * @deprecated Usar botInterpretacion.service.js — mantiene compatibilidad de imports.
 */
const botInterpretacion = require('./botInterpretacion.service');
const botAgenda = require('./botAgenda.service');

function intencionAAjusteTurno(intencion, parametros = {}, sugerenciaActual = null) {
	const MAP_DIA = {
		domingo: 0,
		lunes: 1,
		martes: 2,
		miercoles: 3,
		jueves: 4,
		viernes: 5,
		sabado: 6,
	};

	function diasANumeros(lista) {
		const out = [];
		for (const d of lista || []) {
			const key = String(d || '')
				.trim()
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '');
			if (MAP_DIA[key] != null) out.push(MAP_DIA[key]);
		}
		return [...new Set(out)];
	}

	function normalizarFranja(v) {
		const f = String(v || '')
			.trim()
			.toLowerCase();
		if (f === 'manana' || f === 'mañana') return 'manana';
		if (f === 'tarde') return 'tarde';
		if (f === 'noche') return 'noche';
		return null;
	}

	const excluir = { slots: [], fechas: [], diasSemana: [] };
	const preferir = {
		fechas: [],
		diasSemana: [],
		franja: normalizarFranja(parametros.preferirFranja),
		horaDesde: parametros.horaDesde || null,
		horaHasta: parametros.horaHasta || null,
		fechaDesde: parametros.preferirFechaDesde
			? String(parametros.preferirFechaDesde).slice(0, 10)
			: null,
		fechaHasta: parametros.preferirFechaHasta
			? String(parametros.preferirFechaHasta).slice(0, 10)
			: null,
	};

	if (sugerenciaActual?.matricula && sugerenciaActual?.fecha && sugerenciaActual?.hora) {
		excluir.slots.push({
			matricula: sugerenciaActual.matricula,
			fecha: String(sugerenciaActual.fecha).slice(0, 10),
			hora: String(sugerenciaActual.hora).slice(0, 5),
		});
	}

	for (const f of parametros.preferirFechas || []) {
		if (f) preferir.fechas.push(String(f).slice(0, 10));
	}
	preferir.diasSemana = diasANumeros(parametros.preferirDiasSemana);
	excluir.diasSemana = diasANumeros(parametros.excluirDiasSemana);

	for (const f of parametros.excluirFechas || []) {
		if (f) excluir.fechas.push(String(f).slice(0, 10));
	}

	preferir.fechas = [...new Set(preferir.fechas)];
	preferir.diasSemana = [...new Set(preferir.diasSemana)];
	excluir.diasSemana = [...new Set(excluir.diasSemana)];
	excluir.fechas = [...new Set(excluir.fechas)];

	const partes = [];
	if (preferir.fechas?.length === 1) partes.push(preferir.fechas[0]);
	else if (preferir.fechaDesde && preferir.fechaHasta) partes.push('la semana que viene');
	else if (preferir.diasSemana?.length) {
		const nombres = Object.entries(MAP_DIA)
			.filter(([, n]) => preferir.diasSemana.includes(n))
			.map(([k]) => k);
		if (nombres.length) partes.push(nombres.join(' y '));
	}
	if (preferir.franja === 'tarde') partes.push('por la tarde');
	else if (preferir.franja === 'manana') partes.push('por la mañana');
	const resumen = String(parametros.resumen || '').trim() || partes.join(' ') || null;

	return { excluir, preferir, resumen };
}

function esPasoIdentificacionLibre(paso, conv) {
	if (paso === 'TURNO_COMPLETADO') return false;
	if (conv?.idPaciente && paso === 'CONFIRMAR' && !conv?.contextoBot) return false;
	if (paso === 'IDENTIFICAR' || paso === 'inicio' || !paso) return true;
	if (paso === 'CONFIRMAR' && conv?.contextoBot?.tipo !== 'turno_sugerido') return true;
	return false;
}

async function resolverProfesionalesDesdeIntencion(intencion) {
	if (!intencion) return { tipo: 'no_encontrada' };
	if (intencion.intencion !== 'listar_profesionales') {
		return { tipo: 'no_encontrada' };
	}

	const nombre = String(intencion.parametros?.especialidad || '').trim();
	if (nombre) {
		const res = await resolverEspecialidadDesdeIntencion({
			intencion: 'elegir_especialidad',
			parametros: { especialidad: nombre },
		});
		if (res.tipo === 'especialidad') {
			return { tipo: 'profesionales', especialidad: res.especialidad };
		}
	}

	return { tipo: 'sin_especialidad' };
}

async function resolverEspecialidadDesdeIntencion(intencion) {
	if (!intencion) return { tipo: 'no_encontrada' };
	if (intencion.intencion === 'listar_especialidades') {
		return { tipo: 'listar', lista: await botAgenda.listarEspecialidadesBot() };
	}
	if (intencion.intencion === 'listar_profesionales') {
		return resolverProfesionalesDesdeIntencion(intencion);
	}
	if (intencion.intencion === 'conversacion') {
		return { tipo: 'conversacion' };
	}
	const puedeElegir =
		intencion.intencion === 'elegir_especialidad' || intencion.intencion === 'solicitar_turno';
	if (!puedeElegir) {
		return { tipo: 'no_encontrada' };
	}

	const nombre = String(intencion.parametros?.especialidad || '').trim();
	if (!nombre) return { tipo: 'no_encontrada' };

	const lista = await botAgenda.listarEspecialidadesBot();
	const buscado = nombre
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	let match = lista.find(
		(e) =>
			String(e.nombre || '')
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '') === buscado,
	);
	if (!match) {
		match = lista.find((e) =>
			String(e.nombre || '')
				.toLowerCase()
				.normalize('NFD')
				.replace(/[\u0300-\u036f]/g, '')
				.includes(buscado),
		);
	}
	if (!match) return { tipo: 'no_encontrada' };
	return { tipo: 'especialidad', especialidad: match };
}

module.exports = {
	gptHabilitado: botInterpretacion.gptHabilitado,
	interpretarIntencion: botInterpretacion.interpretarIntencion,
	interpretarMensaje: botInterpretacion.interpretarMensaje,
	intencionAAjusteTurno,
	resolverEspecialidadDesdeIntencion,
	resolverProfesionalesDesdeIntencion,
	esPasoIdentificacionLibre,
};
