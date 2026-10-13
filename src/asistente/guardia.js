/**
 * Lecturas compuestas de Internación, pensadas para gastar UNA llamada al modelo (o ninguna):
 * - resumen_internacion: ficha + evoluciones + indicaciones + estudios + HC en una sola tool.
 * - pase_de_guardia / listar_internados: texto armado acá (respuestaDirecta), sin redacción del modelo.
 */
const clinica = require('./clinica');
const hc = require('./historiaClinica');
const resumir = require('./resumir');
const censo = require('./censo');
const ficha = require('./ficha');

const MAX_PASE = 30;
const MAX_LISTA = 60;
const CONCURRENCIA = 4;
const TEXTO_PASE = 220;
const SECCIONES_RESUMEN = ['hc_ingreso', 'signos_vitales', 'laboratorios', 'interconsultas'];

const puede = (ctx, codigo) => typeof ctx.tienePermiso !== 'function' || ctx.tienePermiso(ctx.permisos || [], codigo);

/** Contexto hijo con un presupuesto de lectura fijo (las lecturas en paralelo no se lo pisan). */
function conPresupuesto(ctx, chars) {
	const sub = Object.create(ctx);
	sub.lecturaUsada = resumir.PRESUPUESTO_TURNO - chars;
	return sub;
}

async function enTandas(items, n, fn) {
	const out = new Array(items.length);
	let i = 0;
	const trabajador = async () => {
		while (i < items.length) {
			const k = i++;
			out[k] = await fn(items[k]).catch(() => null);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
	return out;
}

function diasDesde(iso, hoy = clinica.hoyIso()) {
	if (!iso) return null;
	const d = Math.floor((Date.parse(hoy) - Date.parse(iso)) / 86400000);
	return Number.isFinite(d) && d >= 0 ? d : null;
}

function enUnaLinea(t, max) {
	const s = String(t || '').replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function sinLink(o) {
	if (!o || typeof o !== 'object') return o;
	const { link, enPantalla, numeroVisita, ...resto } = o;
	return resto;
}

function ordenarPorCama(filas) {
	return [...filas].sort((a, b) => String(a.cama || '').localeCompare(String(b.cama || ''), 'es', { numeric: true }));
}

/* ───────────── resumen_internacion ───────────── */

async function resolverInternado(args, ctx) {
	const termino = String(args.termino || '').trim();
	if (termino) {
		const bus = await clinica.buscarInternacion({ termino }, ctx);
		const lista = bus.internaciones || [];
		if (!lista.length) return { error: bus.aviso || `No hay un internado que coincida con «${termino}».` };
		if (lista.length > 1) {
			return { pedir: 'cual', aviso: bus.aviso || 'Hay varios internados que coinciden. Preguntá cuál (número de visita).', internaciones: lista };
		}
		return { internado: lista[0], aviso: bus.aproximado ? bus.aviso : undefined };
	}
	const nv = clinica.numeroVisitaDe(args, ctx);
	if (!nv) return { error: 'No sé de qué internado. Decime el nombre, DNI o número de visita.' };
	if (Number(ctx.foco?.numeroVisita) === nv) return { internado: ctx.foco };
	let delCenso = null;
	if (ctx.idEmpresa) {
		try {
			delCenso = (await censo.obtener(ctx.idEmpresa)).find((f) => f.numeroVisita === nv) || null;
		} catch {
			/* sin censo queda la visita sola */
		}
	}
	return { internado: delCenso ? censo.publica(delCenso) : { numeroVisita: nv } };
}

function estudiosCortos(e) {
	if (!e || e.error) return e && { error: e.error };
	const lista = e.estudios || [];
	return {
		total: e.total,
		pendientes: lista.filter((x) => !x.hecho).slice(0, 10).map((x) => ({ practica: x.practica, fechaPedido: x.fechaPedido, urgencia: x.urgencia || undefined })),
		hechosRecientes: lista
			.filter((x) => x.hecho)
			.slice(0, 5)
			.map((x) => ({ practica: x.practica, fechaResultado: x.fechaResultado, resultado: x.resultado ? enUnaLinea(x.resultado, 200) : undefined })),
		aviso: e.aviso,
	};
}

function indicacionesCortas(i) {
	if (!i || i.error) return i && { error: i.error };
	const lista = i.indicaciones?.length ? i.indicaciones : i.ultimas || [];
	return {
		fecha: i.fecha,
		total: i.total,
		items: lista.slice(0, 12).map((x) => [x.descripcion || x.medicamento, x.frecuencia, x.observaciones].filter(Boolean).join(' · ')),
		aviso: i.aviso,
	};
}

/**
 * Todo lo del internado en una llamada, con presupuesto por parte.
 * Cada parte respeta su permiso; lo que falta se informa, no se inventa.
 */
async function resumenInternacion(args, ctx) {
	const r = await resolverInternado(args, ctx);
	if (r.error || r.pedir) return r;
	const i = r.internado;
	const nv = Number(i.numeroVisita);
	if (i.paciente && !i.egresada) {
		const f = ficha.deInternacion(i);
		ctx.foco = f;
		if (ctx.conv) require('./sesion').guardarFoco(ctx.conv, f);
	}

	const sinPermiso = (codigo) => ({ error: `Sin permiso (${codigo}).` });
	const [evoluciones, indicaciones, estudios, historia] = await Promise.all([
		puede(ctx, 'INTERNACION.EVOLUCIONES.VER')
			? clinica.verEvoluciones({ numeroVisita: nv, dias: args.dias, diasDefault: 3 }, conPresupuesto(ctx, 1500)).catch((e) => ({ error: e.message }))
			: sinPermiso('INTERNACION.EVOLUCIONES.VER'),
		puede(ctx, 'INTERNACION.INDICACIONES.VER')
			? clinica.verIndicaciones({ numeroVisita: nv }, ctx).catch((e) => ({ error: e.message }))
			: sinPermiso('INTERNACION.INDICACIONES.VER'),
		puede(ctx, 'INTERNACION.ESTUDIOS.VER')
			? clinica.verEstudios({ numeroVisita: nv, filtro: 'todos' }, ctx).catch((e) => ({ error: e.message }))
			: sinPermiso('INTERNACION.ESTUDIOS.VER'),
		hc.verHistoriaClinica({ numeroVisita: nv, secciones: SECCIONES_RESUMEN }, conPresupuesto(ctx, 1800)).catch((e) => ({ error: e.message })),
	]);

	const out = {
		ficha: ficha.textoDe(ficha.deInternacion(i)),
		diasInternado: diasDesde(i.ingresoIso) ?? undefined,
		evoluciones: sinLink(evoluciones),
		indicaciones: indicacionesCortas(indicaciones),
		estudios: estudiosCortos(estudios),
		historiaClinica: (historia?.secciones || []).map(sinLink),
		resumido: Boolean(evoluciones?.resumido || historia?.resumido) || undefined,
		aviso: r.aviso,
		link: clinica.linkSeccion(nv, 'evoluciones'),
	};
	resumir.consumirDelTurno(ctx, out);
	return out;
}

/* ───────────── censo: pase de guardia y lista ───────────── */

async function censoDe(ctx) {
	if (!ctx.idEmpresa) throw new Error('No se pudo leer el censo de internados.');
	return censo.obtener(ctx.idEmpresa);
}

function listaSectores(filas) {
	return censo
		.sectores(filas)
		.map((s) => `- ${s.descripcion}${s.descripcion !== s.sector ? ` (${s.sector})` : ''}: ${s.internados}`)
		.join('\n');
}

/** Sin sector: el del internado en foco no, el pedido es explícito; se ofrece la lista. */
function pedirSector(filas, titulo) {
	const total = filas.length;
	return {
		total,
		sectores: censo.sectores(filas).map((s) => s.sector),
		respuestaDirecta: total
			? `${titulo}: ¿de qué sector? Hoy hay ${total} internados:\n${listaSectores(filas)}`
			: 'No hay internados en este momento.',
	};
}

function delSector(filas, sector) {
	const elegidas = censo.filtrarSector(filas, sector);
	if (!elegidas.length) {
		return {
			error: `No encontré internados en el sector «${sector}».`,
			respuestaDirecta: `No encontré internados en el sector «${sector}». Sectores con internados hoy:\n${listaSectores(filas)}`,
		};
	}
	return { elegidas: ordenarPorCama(elegidas) };
}

function nombreSector(filas) {
	const f = filas[0];
	return f.sectorDescripcion && f.sectorDescripcion !== f.sector ? `${f.sectorDescripcion} (${f.sector})` : f.sector || 'sin sector';
}

async function ultimaEvolucion(nv, ctx) {
	const r = await clinica.api(ctx, 'GET', `/api/evoluciones/${nv}/byDate`, { date: clinica.hoyIso(), days: 2 });
	if (r.status >= 400) return { error: true };
	const e = resumir.recientesPrimero(resumir.filasDe(r.body))[0];
	if (!e) return null;
	return {
		fecha: [e.FechaEv || e.Fecha, e.HoraEv || e.Hora].filter(Boolean).join(' '),
		profesional: e.ProfesionalNombreCompleto || null,
		texto: enUnaLinea(e.Evolucion || e.Texto, TEXTO_PASE),
	};
}

async function estudiosPendientes(nv, ctx) {
	const r = await clinica.api(ctx, 'GET', `/api/solicitudes-estudios/visita/${nv}`);
	if (r.status >= 400) return { error: true };
	const sol = Array.isArray(r.body?.data) ? r.body.data : [];
	return sol
		.flatMap((s) => (Array.isArray(s.Items) ? s.Items : []))
		.filter((it) => !it.Cumplido)
		.map((it) => it.PracticaSolicitada || it.NomencladorDescripcion || it.TipoPedidoDescripcion)
		.filter(Boolean);
}

function lineaPaciente(f) {
	const dias = diasDesde(f.ingresoIso);
	return [
		`**Cama ${f.cama || '—'} · ${f.paciente || `Visita ${f.numeroVisita}`}**`,
		dias != null ? `día ${dias + 1}` : null,
		f.diagnostico ? `Dx: ${f.diagnostico}` : null,
	]
		.filter(Boolean)
		.join(' · ');
}

async function paseDeGuardia(args, ctx) {
	const filas = await censoDe(ctx);
	const sector = String(args.sector || '').trim();
	if (!sector) return pedirSector(filas, 'Pase de guardia');
	const sel = delSector(filas, sector);
	if (sel.error) return sel;
	const pacientes = sel.elegidas.slice(0, MAX_PASE);
	const verEvol = puede(ctx, 'INTERNACION.EVOLUCIONES.VER');
	const verEst = puede(ctx, 'INTERNACION.ESTUDIOS.VER');

	const detalles = await enTandas(pacientes, CONCURRENCIA, async (f) => ({
		evolucion: verEvol ? await ultimaEvolucion(f.numeroVisita, ctx) : undefined,
		pendientes: verEst ? await estudiosPendientes(f.numeroVisita, ctx) : undefined,
	}));

	const bloques = pacientes.map((f, k) => {
		const d = detalles[k] || {};
		const lineas = [lineaPaciente(f)];
		if (verEvol) {
			const e = d.evolucion;
			if (e?.error || !d) lineas.push('- Última evolución: no se pudo leer.');
			else if (e) lineas.push(`- Última evolución (${e.fecha}${e.profesional ? `, ${e.profesional}` : ''}): ${e.texto}`);
			else lineas.push('- Sin evoluciones en las últimas 48 h.');
		}
		if (verEst) {
			const p = d.pendientes;
			if (p?.error) lineas.push('- Estudios: no se pudieron leer.');
			else if (p?.length) lineas.push(`- Estudios pendientes: ${p.slice(0, 5).join(', ')}${p.length > 5 ? ` y ${p.length - 5} más` : ''}`);
		}
		return lineas.join('\n');
	});

	const titulo = `### Pase de guardia · ${nombreSector(pacientes)} · ${sel.elegidas.length} internado${sel.elegidas.length === 1 ? '' : 's'}`;
	const pie = [
		sel.elegidas.length > MAX_PASE ? `Se muestran ${MAX_PASE} de ${sel.elegidas.length}: pedime el resto por cama.` : null,
		!verEvol || !verEst ? 'Sin permiso para ver evoluciones o estudios: esa parte no se incluye.' : null,
		'Armado con los registros del sistema; verificá en la HC antes de decidir conductas.',
	].filter(Boolean);

	return {
		sector: pacientes[0].sector,
		total: sel.elegidas.length,
		pacientes: pacientes.map((f) => ({ cama: f.cama, paciente: f.paciente, numeroVisita: f.numeroVisita })),
		respuestaDirecta: [titulo, '', bloques.join('\n\n'), '', ...pie].join('\n'),
	};
}

async function listarInternados(args, ctx) {
	const filas = await censoDe(ctx);
	const sector = String(args.sector || '').trim();
	if (!sector) {
		return {
			total: filas.length,
			sectores: censo.sectores(filas),
			respuestaDirecta: filas.length
				? `Hoy hay **${filas.length} internados**:\n${listaSectores(filas)}\n\nDecime un sector y te listo los pacientes.`
				: 'No hay internados en este momento.',
		};
	}
	const sel = delSector(filas, sector);
	if (sel.error) return sel;
	const lista = sel.elegidas.slice(0, MAX_LISTA);
	const filasTabla = lista.map((f) => {
		const dias = diasDesde(f.ingresoIso);
		return `| ${f.cama || '—'} | ${f.paciente || '—'} | ${f.numeroVisita} | ${dias != null ? dias + 1 : '—'} | ${enUnaLinea(f.diagnostico, 40) || '—'} |`;
	});
	return {
		sector: lista[0].sector,
		total: sel.elegidas.length,
		pacientes: lista.map((f) => ({ cama: f.cama, paciente: f.paciente, numeroVisita: f.numeroVisita })),
		respuestaDirecta: [
			`**${nombreSector(lista)}** · ${sel.elegidas.length} internado${sel.elegidas.length === 1 ? '' : 's'}`,
			'',
			'| Cama | Paciente | Visita | Día | Diagnóstico |',
			'|---|---|---|---|---|',
			...filasTabla,
			sel.elegidas.length > MAX_LISTA ? `\nSe muestran ${MAX_LISTA} de ${sel.elegidas.length}.` : '',
		]
			.filter((l) => l !== '')
			.join('\n'),
	};
}

module.exports = { resumenInternacion, paseDeGuardia, listarInternados, diasDesde, _interno: { enTandas, conPresupuesto } };
