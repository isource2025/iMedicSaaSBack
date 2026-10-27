/**
 * Ciclo de vida de la internación desde el asistente: camas, traslados,
 * asignación de cama, revertir egreso y edición/borrado de evoluciones.
 * Cada escritura arma el mismo payload que el modal del front y queda como
 * tarjeta Confirmar; la ruta real valida permisos y autoría al confirmar.
 */
const { executeQuery } = require('../models/db');
const httpInterno = require('./httpInterno');
const clinica = require('./clinica');
const autoria = require('./autoria');
const manifiesto = require('./manifiesto');
const { convertirFechaAClarion, convertirHoraAClarion } = require('../utils/dateUtils');

/** Estados de imEstadoCama que no admiten paciente (igual que el modal de traslado). */
const ESTADOS_NO_LIBRES = ['A', 'I', 'C', 'O', 'H', 'R'];
const MAX_CAMAS = 40;

async function api(ctx, method, path, query, body) {
	return httpInterno.llamar({
		method,
		path,
		query,
		body,
		headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
	});
}

function errorHttp(r, fallback) {
	return { error: r.body?.mensaje || r.body?.message || `${fallback} (HTTP ${r.status})` };
}

function normalizar(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function ahoraClarion(fecha, hora) {
	return {
		fecha: convertirFechaAClarion(fecha),
		hora: convertirHoraAClarion(hora),
	};
}

function lineaCama(c) {
	if (!c) return '—';
	const sector = c.sectorDescripcion && c.sectorDescripcion !== c.sector ? `${c.sectorDescripcion} (${c.sector})` : c.sector;
	return `${sector || 'sin sector'} cama ${c.cama || '—'}`;
}

/* ───────────── Camas libres ───────────── */

async function queryCamasLibres(sector) {
	const params = ESTADOS_NO_LIBRES.map((v) => ({ value: v }));
	let filtro = '';
	const s = String(sector || '').trim();
	if (s) {
		const i = params.length;
		filtro = ` AND (LTRIM(RTRIM(hc.ValorSector)) = @p${i} OR s.Descripcion COLLATE Latin1_General_CI_AI LIKE @p${i + 1})`;
		params.push({ value: s }, { value: `%${s}%` });
	}
	const enEstados = ESTADOS_NO_LIBRES.map((_, i) => `@p${i}`).join(', ');
	const rows = await executeQuery(
		`
		SELECT TOP 200
			LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) AS sector,
			LTRIM(RTRIM(ISNULL(s.Descripcion, ''))) AS sectorDescripcion,
			LTRIM(RTRIM(ISNULL(hc.ValorHabitacionCama, ''))) AS cama,
			LTRIM(RTRIM(ISNULL(ec.Descripcion, ''))) AS estado
		FROM dbo.imHabitacionCamas hc WITH (NOLOCK)
		LEFT JOIN dbo.imSectores s WITH (NOLOCK) ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(hc.ValorSector))
		LEFT JOIN dbo.imEstadoCama ec WITH (NOLOCK) ON hc.ValorEstadoCama = ec.Valor
		WHERE ISNULL(TRY_CAST(hc.NumeroVisita AS int), 0) = 0
			AND UPPER(LTRIM(RTRIM(ISNULL(hc.ValorEstadoCama, 'U')))) NOT IN (${enEstados})
			${filtro}
		ORDER BY hc.ValorSector, hc.ValorHabitacionCama`,
		params,
	);
	return (rows || []).filter((r) => r.cama);
}

async function camasLibres(args) {
	const lista = await queryCamasLibres(args.sector);
	if (!lista.length) {
		return {
			total: 0,
			camas: [],
			aviso: args.sector ? `No hay camas libres en «${args.sector}».` : 'No hay camas libres en el hospital.',
		};
	}
	return {
		total: lista.length,
		camas: lista.slice(0, MAX_CAMAS),
		aviso: lista.length > MAX_CAMAS ? `Hay ${lista.length} camas libres; se muestran ${MAX_CAMAS}. Filtrá por sector.` : undefined,
	};
}

/** «UTI-3», «3 de UTI», «cama 105»: separa sector y código de cama. */
function partesCama(texto) {
	const t = String(texto || '').trim();
	const conGuion = t.match(/^([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)$/);
	if (conGuion) return { sector: conGuion[1], cama: conGuion[2] };
	return { sector: null, cama: t.replace(/^cama\s+/i, '').trim() };
}

async function resolverCamaLibre(args) {
	const pedido = partesCama(args.cama);
	const sector = String(args.sector || pedido.sector || '').trim();
	const libres = await queryCamasLibres(sector);
	if (!pedido.cama) {
		return {
			pedir: 'cama',
			aviso: libres.length
				? 'Falta la cama destino. Mostrá estas camas libres y esperá que el usuario elija.'
				: `No hay camas libres${sector ? ` en «${sector}»` : ''}.`,
			camas: libres.slice(0, MAX_CAMAS),
		};
	}
	const q = normalizar(pedido.cama);
	const hits = libres.filter((c) => normalizar(c.cama) === q || normalizar(`${c.sector}-${c.cama}`) === q);
	if (hits.length === 1) return { cama: hits[0] };
	if (hits.length > 1) {
		return {
			pedir: 'cama',
			aviso: `La cama «${pedido.cama}» existe en varios sectores. Preguntá en cuál.`,
			camas: hits,
		};
	}
	return {
		error: `La cama «${pedido.cama}»${sector ? ` de «${sector}»` : ''} no está libre o no existe.`,
		camas: libres.slice(0, MAX_CAMAS),
	};
}

/* ───────────── Movimientos ───────────── */

function movimientoCorto(m) {
	const fecha = (f, h) => (f ? `${f}${h ? ` ${h}` : ''}` : null);
	return {
		sector: m.NombreSector || m.ValorSector || null,
		cama: m.NombreCama || m.ValorHabitacionCama || null,
		servicio: m.NombreServicio || null,
		desde: fecha(m.FechaAdmisionISO, m.HoraAdmisionISO),
		hasta: fecha(m.FechaEgresoISO, m.HoraEgresoISO),
		disposicion: m.DisposicionEgresoDescripcion || null,
		diagnostico: String(m.Diagnostico || '').trim() || null,
		operador: m.OperadorNombre || null,
	};
}

async function verMovimientos(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const r = await api(ctx, 'GET', `/api/patients/visitas/${nv}/movimientos`);
	if (r.status >= 400) return errorHttp(r, 'No se pudieron leer los movimientos');
	const data = Array.isArray(r.body?.data) ? r.body.data : [];
	return {
		numeroVisita: nv,
		total: data.length,
		movimientos: data.map(movimientoCorto),
		link: clinica.linkSeccion(nv, 'movimientos'),
	};
}

/* ───────────── Traslado ───────────── */

async function prepararTraslado(args, ctx) {
	const c = await clinica.contextoVisita(ctx, args.numeroVisita);
	if (c.egresada) return { error: `${c.paciente || 'El paciente'} (visita ${c.numeroVisita}) ya está egresado.` };
	if (!c.cama) {
		return { error: `${c.paciente || 'El paciente'} no tiene cama asignada: usá asignar_cama, no un traslado.` };
	}
	const destino = await resolverCamaLibre(args);
	if (destino.error || destino.pedir) return { ...destino, internacion: c };
	const cama = destino.cama;
	if (cama.sector === c.sector && normalizar(cama.cama) === normalizar(c.cama)) {
		return { error: `${c.paciente} ya está en esa cama.` };
	}
	const fecha = clinica.fechaValida(args.fecha);
	const hora = clinica.horaValida(args.hora);
	const t = ahoraClarion(fecha, hora);
	return {
		http: {
			method: 'PUT',
			path: `/api/patients/visitas/${c.numeroVisita}/mover-cama`,
			body: {
				FechaAdmision: t.fecha,
				HoraAdmision: t.hora,
				FechaEgreso: t.fecha,
				HoraEgreso: t.hora,
				EstadoAmbulatorio: '',
				Diagnostico: '',
				bedId: cama.cama,
				ValorSector: cama.sector,
				FechaCarga: t.fecha,
				HoraCarga: t.hora,
			},
		},
		internacion: { numeroVisita: c.numeroVisita, paciente: c.paciente, documento: c.documento, sector: cama.sector, cama: cama.cama },
		resumen: `Trasladar a ${c.paciente || 'paciente'} (visita ${c.numeroVisita}) de ${c.sector || '—'} cama ${c.cama} → ${lineaCama(cama)} · ${fecha} ${hora}`,
		link: clinica.linkSeccion(c.numeroVisita, 'movimientos'),
	};
}

/* ───────────── Asignar cama (internado sin ubicación) ───────────── */

function filaSinCama(r) {
	return {
		numeroVisita: Number(r.numeroVisita),
		paciente: String(r.apellidoYNombre || '').trim() || null,
		documento: String(r.numeroDocumento || '').trim() || null,
		hc: String(r.numeroHC || '').trim() || null,
		sector: String(r.valorSector || '').trim() || null,
		ingreso: [r.fechaAdmision, r.horaAdmision].filter(Boolean).join(' ') || null,
		diagnostico: String(r.diagnosticoDescripcion || r.diagnostico || '').trim() || null,
	};
}

async function buscarSinCama(termino, ctx) {
	const claves = clinica.extraerClavesBusqueda(termino);
	// La API busca con LIKE sobre el texto entero: se manda la pieza más distintiva y se filtra acá.
	const pieza = claves.numeroVisita || claves.dni || [...claves.tokens].sort((a, b) => b.length - a.length)[0] || termino;
	const r = await api(ctx, 'GET', '/api/patients/visitas/internados-sin-cama', { termino: String(pieza) });
	if (r.status >= 400) return errorHttp(r, 'No se pudieron leer los internados sin cama');
	const lista = (Array.isArray(r.body?.data) ? r.body.data : []).map(filaSinCama);
	return { lista: lista.filter((i) => clinica.coincideInternado(i, claves)) };
}

async function prepararAsignarCama(args, ctx) {
	const termino = String(args.termino || '').trim() || (args.numeroVisita ? String(args.numeroVisita) : '');
	if (!termino) return { error: 'Indicá a qué internado sin cama (apellido y nombre, DNI o visita).' };
	const bus = await buscarSinCama(termino, ctx);
	if (bus.error) return bus;
	let lista = bus.lista;
	const nv = parseInt(args.numeroVisita, 10);
	if (args.termino && Number.isFinite(nv) && nv > 0) lista = lista.filter((i) => i.numeroVisita === nv);
	if (!lista.length) {
		return {
			error: `No hay un internado SIN cama que coincida con «${termino}». Si ya tiene cama, es un traslado (trasladar_cama).`,
		};
	}
	if (lista.length > 1) {
		return { pedir: 'cual', aviso: 'Hay varios internados sin cama que coinciden. Indicá cuál (número de visita).', internaciones: lista };
	}
	const p = lista[0];
	const destino = await resolverCamaLibre(args);
	if (destino.error || destino.pedir) return { ...destino, internacion: p };
	const cama = destino.cama;
	const fecha = clinica.fechaValida(args.fecha);
	const hora = clinica.horaValida(args.hora);
	const ingreso = ahoraClarion(fecha, hora);
	const carga = ahoraClarion(clinica.hoyIso(), clinica.horaValida());
	return {
		http: {
			method: 'POST',
			path: `/api/patients/visitas/${p.numeroVisita}/asignar-cama`,
			body: {
				FechaAdmision: ingreso.fecha,
				HoraAdmision: ingreso.hora,
				ClasePaciente: 'I',
				bedId: cama.cama,
				ValorSector: cama.sector,
				FechaCarga: carga.fecha,
				HoraCarga: carga.hora,
			},
		},
		internacion: { ...p, sector: cama.sector, cama: cama.cama },
		resumen: `Asignar a ${p.paciente || 'paciente'} (visita ${p.numeroVisita}) la ${lineaCama(cama)} · ingreso a cama ${fecha} ${hora}`,
		link: clinica.linkSeccion(p.numeroVisita, 'movimientos'),
	};
}

/* ───────────── Revertir egreso ───────────── */

async function resolverEgresada(args, ctx) {
	const termino = String(args.termino || '').trim();
	const nv = parseInt(args.numeroVisita, 10);
	if (!termino) {
		const n = clinica.numeroVisitaDe(args, ctx);
		return n ? { numeroVisita: n } : { error: 'Indicá a qué paciente egresado (apellido y nombre, DNI o visita).' };
	}
	const bus = await clinica.buscarInternacion({ termino, incluirEgresadas: true }, ctx);
	if (bus.error) return bus;
	let lista = bus.egresadas || [];
	if (!lista.length) {
		if ((bus.internaciones || []).some((i) => !i.egresada)) {
			return { error: `«${termino}» sigue internado: no hay egreso para revertir.` };
		}
		return { error: `No hay una visita egresada que coincida con «${termino}».` };
	}
	if (Number.isFinite(nv) && nv > 0) {
		lista = lista.filter((i) => Number(i.numeroVisita) === nv);
		if (!lista.length) return { error: `La visita ${nv} no es de «${termino}». Confirmá a qué paciente.` };
	}
	if (lista.length > 1) {
		return { pedir: 'cual', aviso: 'Hay varias visitas egresadas que coinciden. Indicá cuál (número de visita).', internaciones: lista };
	}
	return { numeroVisita: lista[0].numeroVisita, internacion: lista[0] };
}

async function prepararRevertirEgreso(args, ctx) {
	const v = await resolverEgresada(args, ctx);
	if (v.error || v.pedir) return v;
	const nv = v.numeroVisita;
	const r = await api(ctx, 'GET', `/api/patients/visitas/${nv}/revertir-egreso`);
	if (r.status >= 400) return errorHttp(r, 'No se pudo revisar el egreso');
	const d = r.body?.data || {};
	const paciente = d.pacienteNombre || v.internacion?.paciente || null;
	if (!d.puedeRevertir) {
		return {
			error: d.mensaje || `No se puede revertir el egreso de la visita ${nv}.`,
			conflictos: d.conflictos || [],
		};
	}
	const vuelve =
		d.camaEstado === 'libre' || d.camaEstado === 'propia'
			? `vuelve a ${d.etiquetaUbicacion || `${d.sector || ''} cama ${d.cama || ''}`.trim()}`
			: 'queda internado SIN cama (la anterior no está libre)';
	const avisos = [d.mensaje, ...(d.avisos || [])].filter(Boolean);
	return {
		http: { method: 'POST', path: `/api/patients/visitas/${nv}/revertir-egreso`, body: {} },
		internacion: { ...(v.internacion || {}), numeroVisita: nv, paciente, egresada: false },
		resumen: `Revertir el egreso de ${paciente || 'paciente'} (visita ${nv}) · ${vuelve}`,
		detalle: avisos.length ? avisos.join('\n') : undefined,
		link: clinica.linkSeccion(nv, 'movimientos'),
	};
}

/* ───────────── Evoluciones: editar / eliminar ───────────── */

async function leerEvolucion(ctx, id) {
	const r = await api(ctx, 'GET', `/api/evoluciones/${id}`);
	if (r.status === 404) return { error: `No existe la evolución ${id}.` };
	if (r.status >= 400) return errorHttp(r, 'No se pudo leer la evolución');
	const ev = r.body?.data;
	if (!ev) return { error: `No existe la evolución ${id}.` };
	return { ev };
}

/** Misma regla que requirePropietario: solo el autor (o un admin) modifica o borra. */
async function verificarAutoria(method, path, ctx) {
	const p = await autoria.verificar(manifiesto.resolver(method, path), path, ctx.req);
	if (p.ok) return null;
	return { error: p.mensaje || 'La evolución es de otro profesional: no la podés modificar.', codigoError: p.codigoError || null, noOfrecer: true };
}

async function evolucionDeLaVisita(args, ctx) {
	const id = parseInt(args.idEvolucion, 10);
	if (!Number.isFinite(id) || id <= 0) {
		return { error: 'Falta idEvolucion. Listá las evoluciones con ver_evoluciones y usá el IdHCEvolucion de la que dijo el usuario.' };
	}
	const leida = await leerEvolucion(ctx, id);
	if (leida.error) return leida;
	const ev = leida.ev;
	const nv = clinica.numeroVisitaDe(args, ctx);
	if (nv && Number(ev.IdVisita) !== nv) {
		return { error: `La evolución ${id} es de la visita ${ev.IdVisita}, no de la ${nv}. No se toca.` };
	}
	const c = await clinica.contextoVisita(ctx, ev.IdVisita);
	return { id, ev, c };
}

function cuandoEv(ev) {
	return `${ev.FechaEv || '—'} ${ev.HoraEv || ''}`.trim();
}

async function prepararEditarEvolucion(args, ctx) {
	const texto = String(args.texto || '').trim();
	if (!texto) return { error: 'El texto nuevo de la evolución está vacío.' };
	const r = await evolucionDeLaVisita(args, ctx);
	if (r.error) return r;
	const { id, ev, c } = r;
	const path = `/api/evoluciones/${id}`;
	const ajena = await verificarAutoria('PUT', path, ctx);
	if (ajena) return ajena;
	return {
		http: {
			method: 'PUT',
			path,
			body: {
				FechaEv: ev.FechaEv,
				HoraEv: ev.HoraEv,
				IdSector: ev.IdSector,
				Evolucion: texto,
				NumeroDocumento: ev.NumeroDocumento || c.documento,
			},
		},
		internacion: { numeroVisita: c.numeroVisita, paciente: c.paciente, documento: c.documento, sector: c.sector, cama: c.cama },
		resumen: `Modificar la evolución del ${cuandoEv(ev)} de ${c.paciente || 'paciente'} (visita ${c.numeroVisita})`,
		detalle: texto,
		link: clinica.linkSeccion(c.numeroVisita, 'evoluciones'),
		generativo: ['Evolucion'],
	};
}

async function prepararEliminarEvolucion(args, ctx) {
	const r = await evolucionDeLaVisita(args, ctx);
	if (r.error) return r;
	const { id, ev, c } = r;
	const path = `/api/evoluciones/${id}`;
	const ajena = await verificarAutoria('DELETE', path, ctx);
	if (ajena) return ajena;
	const previo = String(ev.Evolucion || '').trim();
	return {
		http: { method: 'DELETE', path },
		internacion: { numeroVisita: c.numeroVisita, paciente: c.paciente, documento: c.documento, sector: c.sector, cama: c.cama },
		resumen: `Eliminar la evolución del ${cuandoEv(ev)} de ${c.paciente || 'paciente'} (visita ${c.numeroVisita})`,
		detalle: previo.length > 600 ? `${previo.slice(0, 600)}…` : previo || undefined,
		link: clinica.linkSeccion(c.numeroVisita, 'evoluciones'),
	};
}

module.exports = {
	camasLibres,
	resolverCamaLibre,
	verMovimientos,
	prepararTraslado,
	prepararAsignarCama,
	prepararRevertirEgreso,
	prepararEditarEvolucion,
	prepararEliminarEvolucion,
	partesCama,
};
