/**
 * Altas del menú médico de la visita (HC de ingreso, indicaciones no medicamentosas,
 * estudios, interconsultas, protocolos/procedimientos, epicrisis). Cada una resuelve
 * los catálogos del lado servidor y devuelve el mismo body que arma el modal del
 * front, como pendiente: nada se guarda sin la tarjeta Confirmar.
 */
const clinica = require('./clinica');
const httpInterno = require('./httpInterno');

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'al', 'a', 'y', 'por', 'p', 'x', 'en', 'con', 'un', 'una']);
const NUMEROS = { uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', seis: '6', ocho: '8', doce: '12' };
const MAX_OPCIONES = 15;

function norm(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function tokens(s) {
	return norm(s)
		.split(' ')
		.map((t) => NUMEROS[t] || t)
		.filter((t) => t && !STOP.has(t));
}

/** Sin la terminación de género/número: «hiposódica» ≈ «HIPOSODICO», «nebulización» ≈ «NEBULIZACIONES». */
function raiz(t) {
	return t.length > 4 ? t.replace(/(iones|ion|as|os|es|a|o|s)$/, '') : t;
}

function isoDe(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function recortar(s, max) {
	const t = String(s ?? '').trim();
	return t ? t.slice(0, max) : '';
}

async function api(ctx, method, path, query) {
	return httpInterno.llamar({ method, path, query, headers: httpInterno.headersDesdeReq(ctx.req, ctx.token) });
}

async function listaDe(ctx, path, query) {
	const r = await api(ctx, 'GET', path, query);
	if (r.status >= 400) {
		throw Object.assign(new Error(r.body?.message || r.body?.mensaje || `No se pudo leer ${path} (HTTP ${r.status})`), {
			statusCode: r.status,
		});
	}
	const d = r.body?.data !== undefined ? r.body.data : r.body;
	return d;
}

/**
 * Elige un ítem de catálogo por lo que dijo el usuario. Exacto → ese; si todas las
 * palabras están en una sola opción → esa; si hay varias → hay que preguntar.
 * `estricto` (lo que se factura): una sola coincidencia con más de una palabra extra
 * también se pregunta («punción lumbar» ≠ «AORTOGRAFIA POR PUNCION LUMBAR»).
 */
function elegir(lista, pedido, etiqueta, que, { estricto = false } = {}) {
	const etiquetas = lista.map((x) => String(etiqueta(x) || '').trim());
	const unicas = (idx) => [...new Set(idx.map((i) => etiquetas[i]))].slice(0, MAX_OPCIONES);
	const q = norm(pedido);
	if (!q) return { pedir: que, aviso: `Falta ${que}. Preguntale cuál.`, opciones: unicas(lista.map((_, i) => i)) };
	const exactos = lista.map((_, i) => i).filter((i) => norm(etiquetas[i]) === q);
	if (exactos.length) return { item: lista[exactos[0]] };
	const ts = tokens(pedido).map(raiz);
	const contiene = (i) => {
		const e = ` ${tokens(etiquetas[i]).map(raiz).join(' ')} `;
		return ts.every((t) => e.includes(` ${t}`));
	};
	const hits = lista.map((_, i) => i).filter(contiene);
	const distintos = unicas(hits);
	if (distintos.length === 1) {
		const extra = tokens(distintos[0]).filter((t) => !/^\d+$/.test(t)).length - ts.length;
		if (!estricto || extra <= 1) return { item: lista[hits[0]] };
		const otros = lista.map((_, i) => i).filter((i) => ts.some((t) => t.length > 2 && norm(etiquetas[i]).includes(t)));
		return {
			pedir: que,
			aviso: `No hay una ${que} que se llame exactamente «${pedido}». Mostrá las opciones y preguntá cuál; no elijas vos.`,
			opciones: unicas([...hits, ...otros]),
		};
	}
	if (distintos.length > 1) {
		return { pedir: que, aviso: `Hay varias opciones de ${que} para «${pedido}». Mostralas y preguntá cuál.`, opciones: distintos };
	}
	const parecidos = lista.map((_, i) => i).filter((i) => ts.some((t) => t.length > 2 && norm(etiquetas[i]).includes(t)));
	return {
		error: `No encontré «${pedido}» en ${que}.`,
		opciones: parecidos.length ? unicas(parecidos) : undefined,
	};
}

async function visitaParaCargar(ctx, numeroVisita) {
	const c = await clinica.contextoVisita(ctx, numeroVisita);
	if (c.egresada) return { error: `La visita ${c.numeroVisita} (${c.paciente || 'paciente'}) está egresada: no se cargan registros nuevos.` };
	return c;
}

function quien(c) {
	return `${c.paciente || 'paciente'} (visita ${c.numeroVisita}${c.cama ? `, cama ${c.cama}` : ''})`;
}

function internacionDe(c) {
	return { numeroVisita: c.numeroVisita, paciente: c.paciente, documento: c.documento, sector: c.sector, cama: c.cama };
}

const URGENCIAS = { normal: 'Normal', urgente: 'Urgente', medio: 'Medio', media: 'Medio' };
function urgenciaDe(u) {
	return URGENCIAS[norm(u)] || 'Normal';
}

/* ───────────── HC de ingreso ───────────── */

const SIGNOS_HC = { ta: 'SV_PA', fc: 'SV_FC', fr: 'SV_FR', temperatura: 'SV_TAX', glucemia: 'SV_GLUCEMIA', peso: 'SV_PESOACTUAL', talla: 'SV_TALLA' };
const EXAMEN_HC = {
	general: ['SV_IMPRESIONGENERAL', 200],
	respiratorio: ['AR_TEXTO', 5000],
	cardiovascular: ['AC_TEXTO', 5000],
	abdomen: ['A_TEXTO', 5000],
	neurologico: ['SN_CONCIENCIA', 200],
};
const LETRAS_PD = 'ABCDEFGHIJK'.split('');

async function prepararHcIngreso(args, ctx) {
	const motivo = recortar(args.motivoConsulta, 500);
	const enfermedad = recortar(args.enfermedadActual, 7800);
	if (!motivo && !enfermedad) return { error: 'Falta el motivo de consulta o la enfermedad actual: pedíselos al usuario.' };
	const c = await visitaParaCargar(ctx, args.numeroVisita);
	if (c.error) return c;

	const body = {
		NumeroVisita: c.numeroVisita,
		IdSector: c.sector || '',
		MotivoConsulta: motivo,
		EnfermedadActual: enfermedad,
		fecha: clinica.fechaValida(args.fecha),
		hora: clinica.horaValida(args.hora),
	};
	const sv = args.signosVitales || {};
	for (const [k, col] of Object.entries(SIGNOS_HC)) if (recortar(sv[k], 40)) body[col] = recortar(sv[k], 40);
	const ex = args.examenFisico || {};
	for (const [k, [col, max]] of Object.entries(EXAMEN_HC)) if (recortar(ex[k], max)) body[col] = recortar(ex[k], max);
	if (recortar(args.impresionDiagnostica, 7800)) body.IMPRESIONDIAGNOSTICA = recortar(args.impresionDiagnostica, 7800);
	if (recortar(args.comentario, 1000)) body.COMENTARIODEINGRESO = recortar(args.comentario, 1000);
	(Array.isArray(args.planDiagnostico) ? args.planDiagnostico : []).slice(0, LETRAS_PD.length).forEach((p, i) => {
		if (recortar(p, 200)) body[`PD_${LETRAS_PD[i]}`] = recortar(p, 200);
	});
	(Array.isArray(args.planTerapeutico) ? args.planTerapeutico : []).slice(0, 15).forEach((p, i) => {
		if (recortar(p, 200)) body[`PT_${i + 1}`] = recortar(p, 200);
	});

	let previa = null;
	const r = await api(ctx, 'GET', `/api/hc-ingreso/visita/${c.numeroVisita}`);
	if (r.status < 400) {
		const filas = Array.isArray(r.body?.data) ? r.body.data : [];
		if (filas.length) previa = String(filas[0].Fecha || filas[0].fecha || '').slice(0, 10) || 'sin fecha';
	}
	const signos = Object.entries(SIGNOS_HC)
		.filter(([, col]) => body[col])
		.map(([k, col]) => `${k.toUpperCase()} ${body[col]}`);
	const lineas = [
		motivo && `Motivo de consulta: ${motivo}`,
		enfermedad && `Enfermedad actual: ${enfermedad}`,
		signos.length && `Signos vitales: ${signos.join(' · ')} (también se cargan en Controles)`,
		...Object.entries(EXAMEN_HC)
			.filter(([, [col]]) => body[col])
			.map(([k, [col]]) => `Examen ${k}: ${body[col]}`),
		body.IMPRESIONDIAGNOSTICA && `Impresión diagnóstica: ${body.IMPRESIONDIAGNOSTICA}`,
		LETRAS_PD.some((l) => body[`PD_${l}`]) && `Plan diagnóstico: ${LETRAS_PD.map((l) => body[`PD_${l}`]).filter(Boolean).join('; ')}`,
		body.PT_1 && `Plan terapéutico: ${Array.from({ length: 15 }, (_, i) => body[`PT_${i + 1}`]).filter(Boolean).join('; ')}`,
		body.COMENTARIODEINGRESO && `Comentario: ${body.COMENTARIODEINGRESO}`,
	].filter(Boolean);
	const textoMarcado = enfermedad ? 'EnfermedadActual' : 'MotivoConsulta';
	return {
		http: { method: 'POST', path: '/api/hc-ingreso', body },
		internacion: internacionDe(c),
		resumen: `Cargar HC de ingreso a ${quien(c)} el ${body.fecha} ${body.hora}${previa ? ` · ya tiene una del ${previa}: esta se agrega como nueva` : ''}`,
		detalle: lineas.join('\n'),
		link: clinica.linkSeccion(c.numeroVisita, 'hcIngreso'),
		generativo: [textoMarcado],
	};
}

/* ───────────── Indicaciones (sin medicación) ───────────── */

const TIPOS_INDICACION = {
	control: { letra: 'C', lista: 'tiposControles', nombre: 'controles' },
	medida_asistencial: { letra: 'A', lista: 'controlesAsistenciales', nombre: 'medidas asistenciales' },
	dieta: { letra: 'D', lista: 'tiposDieta', nombre: 'dietas' },
};
const ALIAS_INDICACION = [
	[/^(control(es)? de )?signos vitales$|^svv?$|^csv$/, 'pulso frec resp presion temp'],
	[/^(control de )?(ta|tension arterial)$/, 'presion arterial'],
	[/^(control de )?diuresis$|^ritmo diuretico$/, 'volumen de orina'],
	[/^(control de )?(temperatura|temp)$/, 'temperatura axilar'],
	[/^(ayuno|npo|nada por boca)$/, 'nada por boca'],
	[/^hgt$|^glucemia capilar$/, 'control de glucemia'],
];

function aliasIndicacion(pedido) {
	const q = norm(pedido);
	const a = ALIAS_INDICACION.find(([re]) => re.test(q));
	return a ? a[1] : pedido;
}

/** Veces por día según el intervalo de la frecuencia (en centésimas de segundo, como el front). */
function vecesPorDia(intervalo) {
	const n = Number(intervalo);
	if (!Number.isFinite(n) || n < 100000) return 1;
	return Math.max(1, Math.round(8640000 / n));
}

function normFrecuencia(s) {
	return norm(s)
		.replace(/\bc\s*(\d)/g, 'cada $1')
		.replace(/\b(\d+)\s*(horas?|hrs?|hs|h)\b/g, '$1 hs')
		.replace(/\b(horas?|hrs?|h)\b/g, 'hs')
		.replace(/\b(diario|diaria|por dia)\b/g, 'al dia')
		.replace(/^una vez al dia$|^1 vez por dia$/, '1 vez al dia');
}

async function prepararIndicacion(args, ctx) {
	const pedido = String(args.item || '').trim();
	if (!pedido) return { error: 'Falta qué indicar (control, medida asistencial o dieta).' };
	if (/medicaci|medicament|farmac|antibiot|ampolla|comprimid|\bmg\b|endoven|intramusc|subcut/i.test(`${args.tipo || ''} ${pedido}`)) {
		return { error: 'La medicación no se indica desde el chat: se carga en la pantalla de Indicaciones.', noOfrecer: true };
	}
	const c = await visitaParaCargar(ctx, args.numeroVisita);
	if (c.error) return c;
	const datos = await listaDe(ctx, '/api/indicaciones/formulario/datos');
	const tipos = Array.isArray(datos?.tiposIndicacion) ? datos.tiposIndicacion : [];

	const buscados = args.tipo && TIPOS_INDICACION[args.tipo] ? [args.tipo] : Object.keys(TIPOS_INDICACION);
	const q = aliasIndicacion(pedido);
	const sinGenerico = norm(q).replace(/^(dieta|indicacion|control|controles|medida)( de| del)? /, '');
	let elegido = null;
	let multiples = null;
	for (const consulta of [...new Set([q, sinGenerico])]) {
		for (const t of buscados) {
			const lista = Array.isArray(datos?.[TIPOS_INDICACION[t].lista]) ? datos[TIPOS_INDICACION[t].lista] : [];
			const r = elegir(lista, consulta, (x) => x.Descripcion, TIPOS_INDICACION[t].nombre);
			if (r.item) {
				elegido = { tipo: t, item: r.item };
				break;
			}
			if (r.pedir && !multiples) multiples = r;
		}
		if (elegido || multiples) break;
	}
	if (!elegido) {
		if (multiples) return multiples;
		return {
			error: `No encontré «${pedido}» entre controles, medidas asistenciales ni dietas. Si es un medicamento, se indica en la pantalla.`,
		};
	}
	const { letra } = TIPOS_INDICACION[elegido.tipo];
	const candidatos = tipos.filter((t) => String(t.Tipo).trim() === letra);
	const descItem = norm(elegido.item.Descripcion);
	const tipoInd =
		candidatos.find((t) => norm(t.Descripcion) && descItem.includes(norm(t.Descripcion))) ||
		candidatos.find((t) => /^(dieta|control|medidas asistenciales)$/.test(norm(t.Descripcion))) ||
		candidatos[0];
	if (!tipoInd) return { error: `No hay un tipo de indicación «${elegido.tipo}» configurado.` };

	let frecuencia = null;
	if (letra !== 'D') {
		const frecs = Array.isArray(datos?.frecuenciasAdmin) ? datos.frecuenciasAdmin : [];
		const r = elegir(frecs, normFrecuencia(args.frecuencia), (f) => normFrecuencia(f.Valor), 'frecuencia');
		if (!r.item) {
			const opciones = frecs.map((f) => String(f.Valor).trim()).filter((v) => !/gotas|gts/i.test(v));
			return { pedir: 'frecuencia', aviso: r.error || `Falta la frecuencia de «${elegido.item.Descripcion.trim()}». Preguntá cuál.`, opciones };
		}
		frecuencia = r.item;
	}
	const fecha = clinica.fechaValida(args.fecha);
	if (fecha !== clinica.hoyIso() && fecha !== isoDe(new Date(Date.now() + 86400000))) {
		return { error: 'Las indicaciones se cargan para hoy o mañana.' };
	}

	const dosis = Number(args.cantidad) > 0 ? Number(args.cantidad) : 1;
	const alias = String(elegido.item.Descripcion).trim().slice(0, 50);
	const observaciones = recortar(args.observaciones, 255) || null;
	const body = {
		NumeroVisita: c.numeroVisita,
		NroAdicional: null,
		FechaCarga: fecha,
		HoraCarga: null,
		OperadorCarga: null,
		ProfesionalAsiste: null,
		FechaCumplido: null,
		HoraCumplido: null,
		FechaProximo: null,
		HoraProximo: null,
		FechaRevision: null,
		HoraRevision: null,
		TipoIndicacion: Number(tipoInd.Valor),
		Codigo: Number(elegido.item.Valor),
		Cantidad: frecuencia ? dosis * vecesPorDia(frecuencia.Intervalo) : null,
		TipoUnidad: null,
		Frecuencia: frecuencia ? frecuencia.Valor : null,
		Observaciones: observaciones,
		FechaExpiro: 0,
		HoraExpiro: null,
		CantidadIndicada: frecuencia ? dosis : null,
		Orden: Number(tipoInd.OrdenMedicacion) || 0,
		Estado: null,
		CantidadPorTurno: null,
		CantidadEntregada: null,
		ParaFechaEntrega: null,
		FormaAdicional: null,
		NroIndicacionAnterior: null,
		IdSector: c.sector ? c.sector.slice(0, 4) : null,
		AliasMedicamento: alias,
		ExcluidoDeEntrega: null,
	};
	const partes = [String(tipoInd.Descripcion).trim(), alias, frecuencia && String(frecuencia.Valor).trim()].filter(Boolean);
	return {
		http: { method: 'POST', path: '/api/indicaciones', body },
		internacion: internacionDe(c),
		resumen: `Indicar a ${quien(c)}: ${partes.join(' · ')} · desde ${fecha}`,
		detalle: observaciones ? `Observaciones: ${observaciones}` : null,
		link: clinica.linkSeccion(c.numeroVisita, 'indicaciones'),
		generativo: [],
	};
}

/* ───────────── Estudios ───────────── */

const ALIAS_ESTUDIO = [
	[/\b(rx|rayos|placa)\b/g, 'radiografia'],
	[/\b(tac|tomografia)\b/g, 'tc'],
	[/\beco\b/g, 'ecografia'],
	[/\b(ecg|electro)\b/g, 'electrocardiograma'],
	[/\brmn?\b|\bresonancia\b/g, 'resonancia'],
];

function consultaEstudio(pedido) {
	let q = norm(pedido);
	for (const [re, r] of ALIAS_ESTUDIO) q = q.replace(re, r);
	return q;
}

async function buscarPractica(ctx, pedido) {
	const q = consultaEstudio(pedido);
	const ts = tokens(q).filter((t) => t.length > 1);
	const intentos = [q, ...[...ts].sort((a, b) => b.length - a.length).slice(0, 2)];
	let lista = [];
	for (const termino of intentos) {
		if (termino.length < 2) continue;
		const d = await listaDe(ctx, '/api/estudios/tipos/buscar', { q: termino, limit: 40 });
		lista = Array.isArray(d) ? d : [];
		if (lista.length) break;
	}
	if (!lista.length) return { error: `No encontré el estudio «${pedido}».` };
	return elegir(lista, q, (x) => String(x.descripcion || '').trim(), `estudio «${pedido}»`);
}

function serviciosDePractica(servicios, practica) {
	const pref = String(practica.idPractica || '').slice(0, 2);
	const porPrefijo = servicios.filter((s) => (s.prefijos || []).map(String).includes(pref));
	if (porPrefijo.length <= 1) return porPrefijo;
	const desc = norm(practica.descripcion);
	const porNombre = porPrefijo.filter((s) => tokens(s.descripcion).some((t) => t.length > 3 && desc.includes(t)));
	return porNombre.length ? porNombre : porPrefijo;
}

async function prepararEstudios(args, ctx) {
	const pedidos = (Array.isArray(args.estudios) ? args.estudios : [args.estudios]).map((s) => String(s || '').trim()).filter(Boolean);
	if (!pedidos.length) return { error: 'Falta qué estudios pedir.' };
	const c = await visitaParaCargar(ctx, args.numeroVisita);
	if (c.error) return c;

	const practicas = [];
	for (const p of pedidos.slice(0, 20)) {
		const r = await buscarPractica(ctx, p);
		if (!r.item) return r;
		if (!practicas.some((x) => x.idPractica === r.item.idPractica)) practicas.push(r.item);
	}
	const servicios = await listaDe(ctx, '/api/estudios/sectores-receptor');
	const lista = Array.isArray(servicios) ? servicios : [];
	let servicio = null;
	if (args.servicio) {
		const r = elegir(lista, args.servicio, (s) => String(s.descripcion || s.valor).trim(), 'servicio');
		if (!r.item) return r;
		servicio = r.item;
	} else {
		const porPractica = practicas.map((p) => serviciosDePractica(lista, p));
		const comunes = porPractica.reduce((acc, ss) => acc.filter((s) => ss.some((x) => x.valor === s.valor)), porPractica[0] || []);
		if (comunes.length === 1) servicio = comunes[0];
		else if (!comunes.length && porPractica.every((ss) => ss.length)) {
			return { error: 'Esos estudios van a servicios distintos: pedilos en llamadas separadas (una por servicio).' };
		} else {
			return {
				pedir: 'servicio',
				aviso: 'No pude deducir a qué servicio va el pedido. Preguntá cuál.',
				opciones: (comunes.length ? comunes : lista).map((s) => String(s.descripcion).trim()).slice(0, 25),
			};
		}
	}

	const notas = recortar(args.notas, 5000) || undefined;
	const estadoUrgencia = urgenciaDe(args.urgencia);
	const sectorSolicitante = String(ctx.req?.idSector || c.sector || '').trim() || undefined;
	const base = { idVisita: c.numeroVisita, sectorSolicitante, idSectorReceptor: String(servicio.valor).trim(), notas, estadoUrgencia };
	const http =
		practicas.length === 1
			? { method: 'POST', path: '/api/estudios', body: { ...base, idTipoPedido: practicas[0].idTipoPedido, idPractica: practicas[0].idPractica } }
			: {
					method: 'POST',
					path: '/api/solicitudes-estudios',
					body: { ...base, items: practicas.map((p) => ({ idTipoPedido: p.idTipoPedido, idPractica: p.idPractica })) },
				};
	return {
		http,
		internacion: internacionDe(c),
		resumen: `Pedir ${practicas.length === 1 ? 'estudio' : `${practicas.length} estudios`} para ${quien(c)} a ${String(servicio.descripcion).trim()} · ${estadoUrgencia}`,
		detalle: [...practicas.map((p) => `• ${String(p.descripcion).trim()} (${p.idPractica})`), notas && `Notas: ${notas}`].filter(Boolean).join('\n'),
		link: clinica.linkSeccion(c.numeroVisita, 'solicitudEstudios'),
		generativo: notas ? ['notas'] : [],
	};
}

/* ───────────── Interconsultas ───────────── */

async function prepararInterconsulta(args, ctx) {
	const motivo = recortar(args.motivo, 4800);
	if (!motivo) return { error: 'Falta el motivo de la interconsulta: pedíselo al usuario.' };
	const c = await visitaParaCargar(ctx, args.numeroVisita);
	if (c.error) return c;
	const servicios = await listaDe(ctx, '/api/interconsultas/sectores-destino');
	const r = elegir(Array.isArray(servicios) ? servicios : [], args.servicio, (s) => String(s.descripcion || s.valor).trim(), 'servicio');
	if (!r.item) return r;
	const estadoUrgencia = urgenciaDe(args.urgencia);
	return {
		http: {
			method: 'POST',
			path: '/api/interconsultas',
			body: {
				idVisita: c.numeroVisita,
				idSectorReceptor: String(r.item.valor).trim(),
				sectorSolicitante: String(ctx.req?.idSector || c.sector || '').trim() || undefined,
				motivo,
				estadoUrgencia,
			},
		},
		internacion: internacionDe(c),
		resumen: `Pedir interconsulta a ${String(r.item.descripcion).trim()} para ${quien(c)} · ${estadoUrgencia}`,
		detalle: `Motivo: ${motivo}`,
		link: clinica.linkSeccion(c.numeroVisita, 'interconsulta'),
		generativo: ['motivo'],
	};
}

/* ───────────── Epicrisis ───────────── */

async function prepararEpicrisis(args, ctx) {
	let diagnostico = '';
	let diagnosticoText = '';
	const dx = String(args.diagnostico || '').trim();
	if (dx) {
		const lista = await listaDe(ctx, '/api/agenda/diagnosticos/buscar', { q: dx, limit: 20 });
		const r = elegir(Array.isArray(lista) ? lista : [], dx, (d) => `${String(d.codigo).trim()} ${String(d.descripcion).trim()}`, 'diagnóstico');
		const porCodigo = (Array.isArray(lista) ? lista : []).find((d) => norm(d.codigo) === norm(dx));
		const item = porCodigo || r.item;
		if (!item) return r;
		diagnostico = String(item.codigo).trim().slice(0, 8);
		diagnosticoText = String(item.descripcion).trim();
	}
	const c = await clinica.contextoVisita(ctx, args.numeroVisita);
	const out = await clinica.prepararEpicrisis({ ...args, diagnostico, diagnosticoText }, ctx);
	return {
		...out,
		internacion: internacionDe(c),
		resumen: `${out.resumen}${diagnostico ? ` · Dx ${diagnostico} ${diagnosticoText}` : ''}`,
	};
}

/* ───────────── Protocolos (procedimientos) ───────────── */

const FUNCIONES = { especialista: 1, ayudante: 2, ayudante_1: 2, ayudante_2: 3, ayudante_3: 11, anestesista: 4, instrumentista: 5, monitoreo: 6 };

function fechaHoraLocal(f, h) {
	return `${clinica.fechaValida(f)}T${clinica.horaValida(h).padStart(5, '0')}`;
}

async function prepararProtocolo(args, ctx) {
	const texto = recortar(args.texto, 20000);
	if (!texto) return { error: 'Falta la descripción del procedimiento (lo que se hizo): pedísela al usuario.' };
	const valorPropio = Number(ctx.req?.valorPersonal);
	if (!Number.isFinite(valorPropio) || valorPropio <= 0) return { error: 'Tu usuario no está vinculado a un profesional: el protocolo se carga en la pantalla.' };
	const c = await visitaParaCargar(ctx, args.numeroVisita);
	if (c.error) return c;

	const qPractica = String(args.practica || '').trim();
	if (!qPractica) return { error: 'Falta la práctica realizada (nombre o código).' };
	let practica = null;
	const codigo = qPractica.match(/(?:^|\D)(\d{3,})\)?\s*$/)?.[1];
	if (codigo) {
		const r = await api(ctx, 'GET', `/api/protocolos/practicas/${codigo}`);
		practica = r.status < 400 ? r.body?.data || null : null;
	}
	if (!practica) {
		const ts = tokens(qPractica).filter((t) => t.length > 2).sort((a, b) => b.length - a.length);
		let lista = [];
		for (const q of [norm(qPractica), ...ts.slice(0, 2)]) {
			const d = await listaDe(ctx, '/api/protocolos/practicas/buscar', { q, limit: 40 });
			lista = Array.isArray(d) ? d : [];
			if (lista.length) break;
		}
		const r = elegir(lista, qPractica, (p) => `${String(p.descripcion || '').trim()} · ${p.idPractica}`, 'práctica', { estricto: true });
		if (!r.item) return r;
		practica = r.item;
	}

	let tipo = null;
	if (args.tipoProtocolo) {
		const tipos = await listaDe(ctx, '/api/protocolos/tipos');
		const r = elegir(Array.isArray(tipos) ? tipos : [], args.tipoProtocolo, (t) => String(t.descripcion || '').trim(), 'tipo de protocolo');
		if (!r.item) return r;
		tipo = r.item;
	}

	const equipo = [{ valorPersonal: valorPropio, funcion: 1, nombre: 'vos' }];
	for (const m of Array.isArray(args.equipo) ? args.equipo.slice(0, 6) : []) {
		const funcion = FUNCIONES[norm(m.funcion).replace(/ /g, '_')] || FUNCIONES.ayudante;
		const lista = await listaDe(ctx, '/api/protocolos/profesionales/buscar', { q: tokens(m.profesional)[0] || m.profesional, limit: 30 });
		const r = elegir(Array.isArray(lista) ? lista : [], m.profesional, (p) => String(p.apellidoNombre || '').trim(), 'profesional');
		if (!r.item) return r;
		equipo.push({ valorPersonal: Number(r.item.valorPersonal), funcion, nombre: String(r.item.apellidoNombre).trim() });
	}
	if (args.rolPropio && FUNCIONES[norm(args.rolPropio).replace(/ /g, '_')]) equipo[0].funcion = FUNCIONES[norm(args.rolPropio).replace(/ /g, '_')];

	const fin = fechaHoraLocal(args.fechaFin, args.horaFin);
	const inicio = args.horaInicio ? fechaHoraLocal(args.fechaInicio || args.fechaFin, args.horaInicio) : null;
	if (inicio && inicio > fin) return { error: 'El inicio es posterior al fin.' };
	const nombreFuncion = (f) => Object.keys(FUNCIONES).find((k) => FUNCIONES[k] === f) || 'equipo';
	const body = {
		numeroVisita: c.numeroVisita,
		texto,
		fechaHoraFin: fin,
		fechaHoraInicio: inicio,
		tipoProtocolo: tipo ? String(tipo.tipoProtocolo).trim() || undefined : undefined,
		tecnica: recortar(args.tecnica, 120) || undefined,
		diagnosticoPre: recortar(args.diagnosticoPre, 10) || undefined,
		diagnosticoPos: recortar(args.diagnosticoPos, 10) || undefined,
		practicas: [
			{
				idPractica: Number(practica.idPractica),
				tipoPractica: practica.tipoPractica === 'MO' ? 'MO' : 'NO',
				cantidad: 1,
				profesionales: equipo.map(({ valorPersonal, funcion }) => ({ valorPersonal, funcion })),
			},
		],
		medicamentos: [],
	};
	return {
		http: { method: 'POST', path: '/api/protocolos', body },
		internacion: internacionDe(c),
		resumen: `Cargar protocolo a ${quien(c)}: ${String(practica.descripcion).trim()} (${practica.idPractica}) · fin ${fin.replace('T', ' ')} · genera la práctica (procedimiento facturable)`,
		detalle: [
			`Equipo: ${equipo.map((e) => `${e.nombre} (${nombreFuncion(e.funcion)})`).join(', ')}`,
			tipo && `Tipo: ${String(tipo.descripcion).trim()}`,
			body.tecnica && `Técnica: ${body.tecnica}`,
			`Descripción: ${texto}`,
		]
			.filter(Boolean)
			.join('\n'),
		link: clinica.linkSeccion(c.numeroVisita, 'protocolos'),
		generativo: ['texto'],
	};
}

module.exports = {
	elegir,
	norm,
	prepararHcIngreso,
	prepararIndicacion,
	prepararEstudios,
	prepararInterconsulta,
	prepararEpicrisis,
	prepararProtocolo,
	vecesPorDia,
	normFrecuencia,
};
