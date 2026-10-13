/**
 * Herramientas clínicas compuestas: resuelven el contexto de la visita del lado
 * servidor y arman el mismo payload que envían los modales del front.
 */
const { executeQuery } = require('../models/db');
const httpInterno = require('./httpInterno');
const autoria = require('./autoria');
const resumir = require('./resumir');
const censo = require('./censo');

const SECCIONES = Object.freeze({
	'hcIngreso': 'Historia clínica de ingreso',
	'indicaciones': 'Indicaciones médicas',
	'evoluciones': 'Evoluciones médicas',
	'interconsulta': 'Interconsultas',
	'solicitudEstudios': 'Pedidos de estudios',
	'laboratorios': 'Laboratorios',
	'protocolos': 'Protocolos',
	'epicrisis': 'Epicrisis',
	'procedimientos': 'Procedimientos',
	'movimientos': 'Movimientos / traslados',
	'medicacion-suministrada': 'Medicación suministrada',
	'controles-frecuentes': 'Controles frecuentes / signos vitales',
	'control': 'Control de enfermería',
	'evolucion-enfermeria': 'Evolución de enfermería',
	'dieta': 'Dietas',
	'balance-hidrico': 'Balance hídrico',
	'insumos': 'Insumos',
	'adjuntos': 'Adjuntos',
});

function hoyIso() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function horaAhora() {
	const d = new Date();
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fechaValida(f) {
	return typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : hoyIso();
}

function horaValida(h) {
	return typeof h === 'string' && /^\d{1,2}:\d{2}$/.test(h) ? h : horaAhora();
}

/** Endpoint de cada sección clínica: cada carga va a SU sección, nunca como evolución. */
const API_POR_SECCION = {
	evoluciones: '/api/evoluciones',
	indicaciones: '/api/indicaciones',
	dieta: '/api/dieta-control',
	'controles-frecuentes': '/api/controles-frecuentes',
	'balance-hidrico': '/api/balance-hidrico',
	'medicacion-suministrada': '/api/medicacion-control',
	'evolucion-enfermeria': '/api/evolucion-enfermeria',
	interconsulta: '/api/interconsultas',
	solicitudEstudios: '/api/solicitudes-estudios',
	protocolos: '/api/protocolos',
	procedimientos: '/api/procedimientos',
	epicrisis: '/api/epicrisis',
	hcIngreso: '/api/hc-ingreso',
};

function seccionDeApi(path) {
	const p = String(path || '').split('?')[0];
	for (const [seccion, base] of Object.entries(API_POR_SECCION)) {
		if (p === base || p.startsWith(`${base}/`)) return seccion;
	}
	return null;
}

function linkSeccion(numeroVisita, seccion) {
	const s = SECCIONES[seccion] ? seccion : 'indicaciones';
	return `/dashboard/visita/${encodeURIComponent(String(numeroVisita))}?seccion=${encodeURIComponent(s)}`;
}

async function api(ctx, method, path, query, body) {
	return httpInterno.llamar({
		method,
		path,
		query,
		body,
		headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
	});
}

async function contextoVisita(ctx, numeroVisita) {
	const nv = parseInt(numeroVisita, 10);
	if (!Number.isFinite(nv) || nv <= 0) {
		const e = new Error('numeroVisita inválido');
		e.statusCode = 400;
		throw e;
	}
	const r = await api(ctx, 'GET', `/api/patients/visitas/${nv}/contexto-clinico`);
	if (r.status >= 400) {
		const e = new Error(r.body?.mensaje || `No se pudo leer la visita ${nv} (HTTP ${r.status})`);
		e.statusCode = r.status;
		throw e;
	}
	const d = r.body?.data || {};
	return {
		numeroVisita: nv,
		paciente: d.NombrePaciente || null,
		documento: String(d.documentoPaciente || '').trim() || null,
		sector: String(d.sector || '').trim() || null,
		cama: d.numeroCama || null,
		egresada: Boolean(d.egresada),
		diagnostico: d.DiagnosticoDescripcion || null,
		cobertura: d.RazonSocialCliente || null,
		servicio: d.ServicioMedicoDescripcion || null,
		ingreso: d.fechaIngresoSQL || null,
	};
}

function profesionalDe(ctx) {
	const m = Number(ctx.req?.matricula);
	if (Number.isFinite(m) && m > 0) return m;
	const op = Number(ctx.req?.auth?.usuario?.codOperador);
	if (Number.isFinite(op) && op > 0) return op;
	return null;
}

const STOP_BUSCA = new Set([
	'de',
	'del',
	'la',
	'el',
	'los',
	'las',
	'y',
	'dni',
	'documento',
	'numero',
	'visita',
	'hc',
	'paciente',
	'internado',
	'por',
	'favor',
	'con',
	'nro',
]);

function extraerClavesBusqueda(termino) {
	const raw = String(termino || '').trim();
	const q = normalizarTxt(raw);
	let dni = null;
	let numeroVisita = null;
	if (/^\d+$/.test(raw)) {
		if (raw.length >= 7) dni = raw;
		else if (raw.length >= 4) numeroVisita = Number(raw);
	} else {
		const mDni = q.match(/\b(\d{7,9})\b/);
		if (mDni) dni = mDni[1];
		const mVis = q.match(/\b(\d{4,6})\b/);
		if (mVis && !dni) numeroVisita = Number(mVis[1]);
	}
	const tokens = q
		.replace(/\d+/g, ' ')
		.split(' ')
		.filter((t) => t.length >= 3 && !STOP_BUSCA.has(t));
	return { dni, numeroVisita, tokens, q };
}

function coincideInternado(i, claves) {
	if (!i) return false;
	const doc = String(i.documento || '').replace(/\s+/g, '');
	if (claves.dni && doc === claves.dni) return true;
	if (claves.numeroVisita && Number(i.numeroVisita) === claves.numeroVisita) return true;
	if (!claves.tokens.length) return Boolean(claves.dni || claves.numeroVisita);
	const nom = normalizarTxt(i.paciente);
	return claves.tokens.every((t) => nom.includes(t));
}

function filaInternado(r) {
	return {
		numeroVisita: Number(r.numeroVisita),
		paciente: r.paciente || null,
		documento: String(r.documento || '').trim() || null,
		hc: String(r.hc ?? '').trim() || null,
		idPaciente: r.idPaciente || r.IdPaciente || null,
		ingreso: r.ingreso || null,
		egresada: Boolean(r.egresada),
		sector: r.sector ? String(r.sector).trim() : null,
		sectorDescripcion: r.sectorDescripcion ? String(r.sectorDescripcion).trim() : null,
		cama: r.cama ? String(r.cama).trim() : null,
		diagnostico: r.diagnostico ? String(r.diagnostico).trim() : null,
		link: linkSeccion(r.numeroVisita, 'indicaciones'),
	};
}

function internadosDeContexto(ctx) {
	const out = [];
	const seen = new Set();
	const push = (i) => {
		const nv = Number(i?.numeroVisita);
		if (!Number.isFinite(nv) || nv <= 0 || seen.has(nv)) return;
		seen.add(nv);
		out.push({
			numeroVisita: nv,
			paciente: i.paciente || i.NombrePaciente || null,
			documento: i.documento || i.documentoPaciente || null,
			sector: i.sector || null,
			cama: i.cama || i.numeroCama || null,
			egresada: Boolean(i.egresada),
			link: linkSeccion(nv, 'indicaciones'),
		});
	};
	const p = ctx?.pantalla;
	for (const i of p?.internadosVisibles || []) push(i);
	if (p?.internado) push(p.internado);
	const nv = Number(ctx?.entidades?.numeroVisita);
	if (nv > 0) push({ numeroVisita: nv, cama: ctx.entidades.idCama });
	return out;
}

function whereClaves(claves, start = 0) {
	const params = [];
	const parts = [];
	const add = (sql, p) => {
		parts.push(sql.replace(/@px/g, `@p${start + params.length}`));
		params.push(p);
	};
	if (claves.dni) {
		add('LTRIM(RTRIM(p.NumeroDocumento)) = @px', { value: claves.dni, type: 'NVarChar', length: 30 });
	}
	if (claves.numeroVisita) {
		add('v.NumeroVisita = @px', { value: claves.numeroVisita, type: 'Int' });
	}
	if (claves.tokens.length) {
		const ands = claves.tokens.slice(0, 6).map((t) => {
			const sql = `p.ApellidoYNombre LIKE @p${start + params.length}`;
			params.push({ value: `%${t}%`, type: 'NVarChar', length: 80 });
			return sql;
		});
		parts.push(`(${ands.join(' AND ')})`);
	}
	return { sql: parts.length ? parts.join(' OR ') : '1=0', params };
}

const SELECT_INTERNA = `
      v.NumeroVisita AS numeroVisita,
      v.IdPaciente AS idPaciente,
      LTRIM(RTRIM(ISNULL(p.ApellidoYNombre, ''))) AS paciente,
      LTRIM(RTRIM(ISNULL(p.NumeroDocumento, ''))) AS documento,
      p.NumeroHC AS hc,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) AS ingreso,
      CASE WHEN TRY_CAST(v.FechaEgreso AS int) > 0 THEN 1 ELSE 0 END AS egresada,
      LTRIM(RTRIM(ISNULL(d.Descripcion, ISNULL(v.Diagnostico, '')))) AS diagnostico`;

async function queryOcupados(claves) {
	const w = whereClaves(claves, 0);
	const rows = await executeQuery(
		`
    SELECT TOP 15
      ${SELECT_INTERNA},
      LTRIM(RTRIM(hc.ValorSector)) AS sector,
      LTRIM(RTRIM(s.Descripcion)) AS sectorDescripcion,
      LTRIM(RTRIM(hc.ValorHabitacionCama)) AS cama
    FROM dbo.imHabitacionCamas hc
    INNER JOIN dbo.imVisita v ON v.NumeroVisita = hc.NumeroVisita AND TRY_CAST(hc.NumeroVisita AS int) > 0
    INNER JOIN dbo.imPacientes p ON p.IdPaciente = v.IdPaciente
    LEFT JOIN dbo.imSectores s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(hc.ValorSector))
    LEFT JOIN dbo.imDiagnosticos d ON LTRIM(RTRIM(d.CodigoOMS)) = LTRIM(RTRIM(CAST(v.Diagnostico AS varchar(20))))
    WHERE ${w.sql}
    ORDER BY v.FECHAADMISIONS DESC
    `,
		w.params,
	);
	return (rows || []).map(filaInternado);
}

async function queryEgresadas(claves) {
	const w = whereClaves(claves, 0);
	const rows = await executeQuery(
		`
    SELECT TOP 5
      ${SELECT_INTERNA},
      um.ValorSector AS sector,
      LTRIM(RTRIM(s.Descripcion)) AS sectorDescripcion,
      um.ValorHabitacionCama AS cama
    FROM dbo.imVisita v
    INNER JOIN dbo.imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN dbo.imDiagnosticos d ON LTRIM(RTRIM(d.CodigoOMS)) = LTRIM(RTRIM(CAST(v.Diagnostico AS varchar(20))))
    OUTER APPLY (
      SELECT TOP 1 m.ValorSector, m.ValorHabitacionCama
      FROM dbo.imVisitaMovimiento m
      WHERE m.NumeroVisita = v.NumeroVisita
      ORDER BY m.FechaAdmision DESC, m.HoraAdmision DESC
    ) um
    LEFT JOIN dbo.imSectores s ON LTRIM(RTRIM(s.Valor)) = LTRIM(RTRIM(um.ValorSector))
    WHERE ISNULL(TRY_CAST(v.FechaEgreso AS int), 0) > 0
      AND (${w.sql})
    ORDER BY v.FechaEgreso DESC
    `,
		w.params,
	);
	return (rows || []).map((r) => ({ ...filaInternado(r), egresada: true }));
}

async function internadoDesdeCama(ctx, idCama) {
	if (!ctx || !idCama) return null;
	try {
		const r = await api(ctx, 'GET', `/api/beds/${encodeURIComponent(String(idCama))}`);
		const d = r.body?.data || r.body;
		const nv = Number(d?.NumeroVisita ?? d?.numeroVisita);
		if (!Number.isFinite(nv) || nv <= 0) return null;
		return filaInternado({
			numeroVisita: nv,
			paciente: d.NombrePaciente,
			documento: d.documentoPaciente || d.DocumentoPaciente,
			hc: d.NumeroHC,
			ingreso: d.fechaIngresoSQL,
			egresada: false,
			sector: d.sector,
			cama: d.numeroCama || d.ValorHabitacionCama,
		});
	} catch {
		return null;
	}
}

function conLink(i) {
	return { ...censo.publica(i), link: linkSeccion(i.numeroVisita, 'indicaciones') };
}

/** null = sin censo (sin empresa o falló la query): se usa la búsqueda SQL de siempre. */
async function buscarEnCenso(claves, ctx) {
	if (!ctx?.idEmpresa) return null;
	try {
		return censo.buscar(await censo.obtener(ctx.idEmpresa), claves);
	} catch (err) {
		console.warn('[asistente] censo:', err.message);
		return null;
	}
}

/** Busca internaciones ACTIVAS (cama ocupada) por nombre / DNI / visita. */
async function buscarInternacion(args, ctx) {
	const termino = String(args.termino || '').trim();
	if (termino.length < 2) return { error: 'Escribí al menos 2 caracteres' };
	const incluirEgresadas = Boolean(args.incluirEgresadas);
	const claves = extraerClavesBusqueda(termino);
	if (!claves.dni && !claves.numeroVisita && !claves.tokens.length) {
		return { error: 'Indicá apellido y nombre, DNI o número de visita' };
	}

	const dePantalla = internadosDeContexto(ctx);
	if (ctx?.entidades?.idCama && !dePantalla.length) {
		const deCama = await internadoDesdeCama(ctx, ctx.entidades.idCama);
		if (deCama) dePantalla.push(deCama);
	}
	const matchPantalla = dePantalla.filter((i) => coincideInternado(i, claves));

	const delCenso = await buscarEnCenso(claves, ctx);
	if (delCenso?.exactos.length) {
		const internaciones = delCenso.exactos.slice(0, 15).map(conLink);
		return { total: internaciones.length, internaciones };
	}

	let internaciones = [];
	if (!delCenso) {
		try {
			internaciones = await queryOcupados(claves);
		} catch (err) {
			if (matchPantalla.length) internaciones = matchPantalla.filter((i) => !i.egresada);
			else throw err;
		}
	}
	if (internaciones.length) {
		return { total: internaciones.length, internaciones };
	}

	let egresadas = matchPantalla
		.filter((i) => !internaciones.some((x) => x.numeroVisita === i.numeroVisita))
		.map((i) => ({ ...i, egresada: true }));
	if (incluirEgresadas || !egresadas.length) {
		try {
			const mas = await queryEgresadas(claves);
			for (const e of mas) {
				if (!egresadas.some((x) => x.numeroVisita === e.numeroVisita)) egresadas.push(e);
			}
		} catch {
			/* si no hay SQL, devolvemos lo de pantalla */
		}
	}
	if (egresadas.length) {
		const e = egresadas[0];
		return {
			total: 0,
			internaciones: incluirEgresadas ? egresadas : [],
			egresadas,
			aviso: `${e.paciente || 'Ese paciente'} (visita ${e.numeroVisita}) ya está egresado. No hay internación activa.`,
		};
	}
	if (delCenso?.aproximados.length && !claves.dni && !claves.numeroVisita) {
		const aprox = delCenso.aproximados.map(conLink);
		return {
			total: aprox.length,
			internaciones: aprox,
			aproximado: true,
			aviso:
				aprox.length === 1
					? `No hay un internado «${termino}» exacto; el más parecido es ${aprox[0].paciente}.`
					: `No hay un internado «${termino}» exacto. Los más parecidos: ${aprox.map((i) => i.paciente).join(', ')}. Preguntá cuál.`,
		};
	}
	return { total: 0, internaciones: [] };
}

async function resumenVisita(args, ctx) {
	const c = await contextoVisita(ctx, args.numeroVisita);
	return {
		...c,
		links: Object.fromEntries(
			['controles-frecuentes', 'evoluciones', 'indicaciones', 'epicrisis'].map((s) => [s, linkSeccion(c.numeroVisita, s)]),
		),
	};
}

/** La más reciente con texto largo; las demás acortadas y, si no entran, resumidas por profesional. */
const VISTA_EVOLUCIONES = Object.freeze({
	maxTexto: 1500,
	maxTextoPrimero: 1500,
	parteResumen: 0.25,
	conservar: ['IdHCEvolucion', '_propio'],
	omitir: ['IdSector', 'NumeroDocumento', 'Profecional', 'IdPersonal', 'ValorEspecialidad', 'Matricula'],
	resumen: { tipo: 'agrupar', por: ['ProfesionalNombreCompleto'] },
});

async function verEvoluciones(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	let query = { date: fechaValida(args.fecha), days: args.dias != null ? args.dias : 7 };
	const leer = async (q) => {
		const r = await api(ctx, 'GET', `/api/evoluciones/${nv}/byDate`, q);
		if (r.status >= 400) return { error: r.body?.mensaje || `No se pudieron leer las evoluciones (HTTP ${r.status})`, status: r.status };
		autoria.anotar(r.body, ctx.req);
		return { filas: resumir.recientesPrimero(resumir.filasDe(r.body)) };
	};
	const leido = await leer(query);
	if (leido.error) return leido;
	let { filas } = leido;
	let aviso;
	// Sin fecha ni días pedidos, una semana vacía no significa «sin evoluciones»: se traen las últimas.
	if (!filas.length && args.fecha == null && args.dias == null) {
		const todo = await leer({ ...query, days: 'all' });
		if (todo.filas?.length) {
			filas = todo.filas;
			aviso = `No hay evoluciones en los últimos ${query.days} días; se muestran las más recientes de la internación.`;
			query = { ...query, days: 'all' };
		}
	}
	const periodo = query.days === 'all' ? 'toda la internación' : `${query.days} días hasta ${query.date}`;
	const out = {
		numeroVisita: nv,
		periodo,
		...resumir.presentar(filas, VISTA_EVOLUCIONES, resumir.presupuestoDelTurno(ctx)),
		aviso: filas.length ? aviso : `No hay evoluciones en ${periodo}.`,
		enPantalla:
			filas.length && ctx?.pantalla?.seccion === 'evoluciones'
				? 'La sección muestra solo el día del calendario y el período elegido («Hoy» por defecto). Si el usuario no ve una, que cambie el día o el período («Semana», «Todas»).'
				: undefined,
		link: linkSeccion(nv, 'evoluciones'),
	};
	resumir.consumirDelTurno(ctx, out);
	return out;
}

/** Visita explícita o, si no viene, la del internado en foco / en pantalla. */
function numeroVisitaDe(args, ctx) {
	const candidatos = [
		args?.numeroVisita,
		ctx?.foco?.numeroVisita,
		ctx?.entidades?.numeroVisita,
		ctx?.pantalla?.internado?.numeroVisita,
	];
	for (const c of candidatos) {
		const n = parseInt(c, 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return null;
}

const CAMPOS_INDICACION = [
	'descripcion',
	'medicamento',
	'cantidad',
	'tipoUnidad',
	'frecuencia',
	'observaciones',
	'promptCodigo',
	'vigenteDesde',
	'fullName',
];

function indicacionCorta(i) {
	const out = {};
	for (const c of CAMPOS_INDICACION) {
		const v = typeof i?.[c] === 'string' ? i[c].trim() : i?.[c];
		if (v != null && v !== '') out[c] = v;
	}
	// En controles/dietas/actividades el join trae un medicamento que no corresponde.
	if (String(i?.tipo || '').trim().toUpperCase() !== 'M') delete out.medicamento;
	return out;
}

/** Indicaciones de la fecha; si ese día no hay, las últimas cargadas (aclarado en aviso). */
async function verIndicaciones(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const fecha = fechaValida(args.fecha);
	const link = linkSeccion(nv, 'indicaciones');
	const r = await api(ctx, 'GET', `/api/indicaciones/${nv}/byDate`, {
		date: fecha,
		days: args.dias != null ? args.dias : undefined,
		incluirSuspendidas: args.incluirSuspendidas ? 1 : undefined,
	});
	if (r.status >= 400) {
		return { error: r.body?.mensaje || `No se pudieron leer las indicaciones (HTTP ${r.status})`, status: r.status };
	}
	const items = Array.isArray(r.body?.data) ? r.body.data : [];
	if (items.length) {
		const indicaciones = caberEnChars(items.slice(0, 40).map(indicacionCorta), resumir.PRESUPUESTO_LECTURA);
		return {
			numeroVisita: nv,
			fecha,
			total: items.length,
			indicaciones,
			truncado: indicaciones.length < items.length || undefined,
			link,
		};
	}
	const u = await api(ctx, 'GET', `/api/indicaciones/ultimas/${nv}`);
	const todasUltimas = u.status < 400 && Array.isArray(u.body?.data) ? u.body.data : [];
	const ultimas = caberEnChars(todasUltimas.slice(0, 40).map(indicacionCorta), resumir.PRESUPUESTO_LECTURA);
	return {
		numeroVisita: nv,
		fecha,
		total: 0,
		indicaciones: [],
		aviso: todasUltimas.length
			? `No hay indicaciones cargadas el ${fecha}. En «ultimas» van las últimas cargadas (vigentes desde ${todasUltimas[0].vigenteDesde || '—'}): aclaraselo al usuario.`
			: `No hay indicaciones cargadas el ${fecha} ni anteriores.`,
		ultimas,
		truncado: ultimas.length < todasUltimas.length || undefined,
		link,
	};
}

const FILTROS_ESTUDIOS = Object.freeze(['hechos', 'pendientes', 'todos']);
const MAX_CHARS_ESTUDIOS = resumir.PRESUPUESTO_LECTURA;

function practicaDe(solicitud, item) {
	return {
		fechaPedido: item.FechaPedido || solicitud.FechaPedido || null,
		practica: item.PracticaSolicitada || item.NomencladorDescripcion || item.TipoPedidoDescripcion || null,
		servicio: solicitud.SectorReceptorNombre || solicitud.ServicioDescripcion || null,
		solicitante: solicitud.MedicoSolicitanteNombre || null,
		urgencia: item.EstadoUrgencia || null,
		hecho: Boolean(item.Cumplido),
		fechaResultado: item.FechaResultado || null,
		realizador: item.RealizadorNombre || null,
		resultado: item.TextoResultado ? String(item.TextoResultado).trim().slice(0, 400) : null,
	};
}

function caberEnChars(lista, max) {
	let out = lista;
	while (out.length > 1 && JSON.stringify(out).length > max) out = out.slice(0, -1);
	return out;
}

/**
 * Prácticas pedidas para la visita. «Hecho» = cumplido (tiene protocolo).
 * Lee la visita, no la bandeja /pendientes del servicio receptor.
 */
async function verEstudios(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const filtro = FILTROS_ESTUDIOS.includes(args.filtro) ? args.filtro : 'todos';
	const r = await api(ctx, 'GET', `/api/solicitudes-estudios/visita/${nv}`);
	if (r.status >= 400) {
		return { error: r.body?.mensaje || `No se pudieron leer los estudios (HTTP ${r.status})`, status: r.status };
	}
	const solicitudes = Array.isArray(r.body?.data) ? r.body.data : [];
	const practicas = solicitudes.flatMap((s) => (Array.isArray(s.Items) ? s.Items : []).map((it) => practicaDe(s, it)));
	const hechos = practicas.filter((p) => p.hecho);
	const elegidas =
		filtro === 'hechos' ? hechos : filtro === 'pendientes' ? practicas.filter((p) => !p.hecho) : practicas;
	const estudios = caberEnChars(elegidas.slice(0, 30), MAX_CHARS_ESTUDIOS);
	return {
		numeroVisita: nv,
		filtro,
		total: elegidas.length,
		hechos: hechos.length,
		pendientes: practicas.length - hechos.length,
		estudios,
		truncado: estudios.length < elegidas.length || undefined,
		aviso: elegidas.length
			? undefined
			: `La visita ${nv} no tiene estudios ${filtro === 'todos' ? 'pedidos' : filtro}.`,
		link: linkSeccion(nv, 'solicitudEstudios'),
	};
}

async function verControles(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const r = await api(ctx, 'GET', `/api/controles-frecuentes/${nv}/byDate`, {
		fecha: fechaValida(args.fecha),
		days: args.dias != null ? args.dias : 3,
	});
	return { http: r, link: linkSeccion(nv, 'controles-frecuentes') };
}

async function verEpicrisis(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const r = await api(ctx, 'GET', `/api/epicrisis/${nv}`);
	return { http: r, link: linkSeccion(nv, 'epicrisis') };
}

async function generarBorradorEpicrisis(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const r = await api(ctx, 'POST', `/api/epicrisis/${nv}/generar-ia`, null, { IdVisita: nv });
	if (r.status >= 400) return { error: r.body?.mensaje || `HTTP ${r.status}` };
	const d = r.body?.data || {};
	if (d.uso && ctx.medidor) {
		ctx.medidor.registrarExterno({
			origen: 'epicrisis_ia',
			herramienta: 'generar_borrador_epicrisis',
			modelo: d.uso.modelo,
			usage: d.uso.usage,
		});
	}
	return {
		numeroVisita: nv,
		borrador: d.epicrisis || '',
		diagnostico: d.diagnostico || null,
		diagnosticoText: d.diagnosticoText || null,
		fuente: d.fuente || null,
		aviso:
			'Es un BORRADOR. Mostráselo al usuario. Para guardarlo usá guardar_epicrisis con este texto (o el editado).',
		link: linkSeccion(nv, 'epicrisis'),
	};
}

async function prepararEvolucion(args, ctx) {
	const texto = String(args.texto || '').trim();
	if (!texto) throw Object.assign(new Error('El texto de la evolución está vacío'), { statusCode: 400 });
	const c = await contextoVisita(ctx, args.numeroVisita);
	if (c.egresada) throw Object.assign(new Error('La visita está egresada: no se cargan evoluciones'), { statusCode: 400 });
	if (!c.documento) throw Object.assign(new Error('La visita no tiene documento de paciente'), { statusCode: 400 });
	const fecha = fechaValida(args.fecha);
	const hora = horaValida(args.hora);
	return {
		http: {
			method: 'POST',
			path: '/api/evoluciones',
			body: {
				IdVisita: c.numeroVisita,
				FechaEv: fecha,
				HoraEv: hora,
				IdSector: c.sector || undefined,
				Evolucion: texto,
				NumeroDocumento: c.documento,
			},
		},
		internacion: { numeroVisita: c.numeroVisita, paciente: c.paciente, documento: c.documento, sector: c.sector, cama: c.cama },
		resumen: `Cargar evolución a ${c.paciente || 'paciente'} (visita ${c.numeroVisita}, cama ${c.cama || '—'}) el ${fecha} ${hora}`,
		detalle: texto,
		link: linkSeccion(c.numeroVisita, 'evoluciones'),
		generativo: ['Evolucion'],
	};
}

function normalizarTxt(s) {
	return String(s || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const AFIRMA_MOTIVO = /^(si|ok|dale|bueno|perfecto|ese|esa|confirmo|confirmado|yes)(\b.*)?$/i;

function resolverDisposicion(lista, pedido) {
	const raw = String(pedido || '').trim();
	if (!raw) return null;
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0 && String(n) === raw) {
		return lista.find((d) => Number(d.Valor) === n) || { Valor: n, Descripcion: raw };
	}
	const q = normalizarTxt(raw);
	if (AFIRMA_MOTIVO.test(q) || q.length < 4) {
		return { ambiguo: true, opciones: lista, aviso: 'Un «sí» no es un motivo. Pasá el texto del catálogo (ej. ALTA MEDICA).' };
	}
	const exacta = lista.find((d) => normalizarTxt(d.Descripcion) === q);
	if (exacta) return exacta;
	const hits = lista.filter((d) => {
		const desc = normalizarTxt(d.Descripcion);
		return desc === q || desc.startsWith(`${q} `) || desc.includes(` ${q} `) || q.includes(desc);
	});
	if (hits.length === 1) return hits[0];
	return { ambiguo: true, opciones: hits.length ? hits : lista };
}

/** Motivo del catálogo escrito tal cual en el mensaje del usuario (ej. «… por alta médica»). */
function disposicionEnTexto(lista, mensaje) {
	const t = ` ${normalizarTxt(mensaje)} `;
	if (t.trim().length < 4) return null;
	const hits = lista.filter((d) => t.includes(` ${normalizarTxt(d.Descripcion)} `));
	return hits.length === 1 ? hits[0].Descripcion : null;
}

async function listarDisposiciones(ctx) {
	const r = await api(ctx, 'GET', '/api/disposiciones-egreso');
	if (r.status >= 400) {
		const e = new Error(r.body?.mensaje || `No se pudieron leer los motivos de egreso (HTTP ${r.status})`);
		e.statusCode = r.status;
		throw e;
	}
	const rows = Array.isArray(r.body) ? r.body : r.body?.data || [];
	return rows
		.map((d) => ({ Valor: Number(d.Valor), Descripcion: String(d.Descripcion || '').trim() }))
		.filter((d) => d.Valor > 0 && d.Descripcion);
}

/**
 * Con nombre/DNI manda el nombre: numeroVisita solo elige entre los que coinciden.
 * Nunca se egresa una visita de otro paciente que el nombrado.
 */
async function resolverInternacionEgreso(args, ctx) {
	const nvArg = parseInt(args.numeroVisita, 10);
	const nv = Number.isFinite(nvArg) && nvArg > 0 ? nvArg : null;
	const termino = String(args.termino || '').trim();
	if (nv && termino.length < 2) return { numeroVisita: nv };
	if (termino.length < 2) {
		return { error: 'Indicá el paciente internado (apellido y nombre, DNI o número de visita).' };
	}
	const bus = await buscarInternacion({ termino }, ctx);
	if (bus.aviso && !(bus.internaciones || []).length) {
		return { error: bus.aviso, egresadas: bus.egresadas };
	}
	let internaciones = bus.internaciones || [];
	if (!internaciones.length) {
		return {
			error: `No hay un internado que coincida con «${termino}». «Dar de alta» acá es un egreso: no se crea un paciente ni personal.`,
		};
	}
	if (nv) {
		const elegida = internaciones.filter((i) => Number(i.numeroVisita) === nv);
		if (!elegida.length) {
			return {
				error: `La visita ${nv} no es de «${termino}». No se arma el egreso: confirmá a qué paciente.`,
				internaciones,
			};
		}
		internaciones = elegida;
	}
	if (internaciones.length > 1) {
		return {
			pedir: 'cual',
			aviso: 'Hay más de un internado con ese nombre. Indicá cuál (número de visita) y el motivo de egreso.',
			internaciones,
		};
	}
	return { numeroVisita: internaciones[0].numeroVisita, internacion: internaciones[0] };
}

const NO_ES_EGRESO = /\b(personal|medico|enfermer|empleado|usuario|rol|especialidad|matricula)\b/i;

/** Si el pedido es dar de alta / egresar a un internado, extrae el nombre. No cubre alta de personal. */
function pedidoEgreso(mensaje) {
	const raw = String(mensaje || '').replace(/\s+/g, ' ').trim();
	if (!raw || NO_ES_EGRESO.test(raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return null;
	const t = raw
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	const m =
		t.match(/\b(?:des|dar|dale|dan|dieron)\s+de\s+alta\s+(?:a\s+|al\s+|la\s+)?(.+)/) ||
		t.match(/\b(?:egresar|externar)\s+(?:a\s+|al\s+|la\s+)?(.+)/);
	if (!m) return null;
	const termino = m[1]
		.replace(/[?.!,;:]+$/g, '')
		.replace(/\b(por favor|gracias)\b/g, '')
		.trim();
	if (termino.length < 2 || /^(un|una|el|la|los|las|paciente|internado)s?$/.test(termino)) return null;
	return { termino };
}

function lineaInternado(i) {
	const donde = [i.sector && `sector ${i.sector}`, i.cama && `cama ${i.cama}`].filter(Boolean).join(', ');
	return `• **${i.paciente}** · DNI ${i.documento || '—'} · visita ${i.numeroVisita}${donde ? ` · ${donde}` : ''}${i.ingreso ? ` · ingreso ${i.ingreso}` : ''}`;
}

/** Texto de la primera respuesta de egreso: lo arma el código, no el modelo. */
function textoDesdeEgreso(resultado, termino) {
	const r = resultado || {};
	const lista = r.internaciones || [];
	if (r.pedir === 'cual' || lista.length > 1) {
		return [
			`Hay ${lista.length} internados que coinciden con «${termino}». ¿A cuál das de alta y con qué motivo (alta médica, derivación, óbito…)?`,
			'',
			...lista.map(lineaInternado),
		].join('\n');
	}
	if (r.pedir === 'motivo' || lista.length === 1) {
		const p = r.internacion || lista[0] || {};
		const ops = (r.opciones || []).map((o) => `• ${o.Descripcion} (${o.Valor})`).join('\n');
		return [
			`Voy a dar de alta a **${p.paciente || termino}** (visita ${p.numeroVisita}${p.sector ? `, ${p.sector}` : ''}${p.cama ? ` cama ${p.cama}` : ''}).`,
			`Fecha y hora: ${r.fechaEgreso || 'ahora'} ${r.horaEgreso || ''}`.trim(),
			'',
			'¿Cuál es el motivo de egreso?',
			ops || '• Alta médica · derivación · óbito (el catálogo se carga al confirmar el motivo)',
		]
			.filter(Boolean)
			.join('\n');
	}
	if (r.requiereConfirmacion) {
		return [r.resumen, r.aviso || 'Revisá y tocá Confirmar. Todavía no se guardó.'].filter(Boolean).join('\n\n');
	}
	if (r.error) {
		const extra = lista.length ? `\n\nInternados que coinciden:\n${lista.map(lineaInternado).join('\n')}` : '';
		return `${r.error}${extra}`;
	}
	if (lista.length === 1) return `Encontré a ${lineaInternado(lista[0]).replace(/^• /, '')}.`;
	return null;
}

const CODIGO_CIE = /^[A-Z]\d{2}(\.?[0-9A-Z]{1,4})?$/i;

/** Prepara el egreso de un internado. Fecha/hora = ahora, salvo que el usuario las pida distintas. */
async function prepararEgreso(args, ctx) {
	const hallado = await resolverInternacionEgreso(args, ctx);
	if (hallado.error || hallado.pedir) return hallado;

	const c = await contextoVisita(ctx, hallado.numeroVisita);
	if (c.egresada) {
		return { error: `${c.paciente || 'El paciente'} (visita ${c.numeroVisita}) ya está egresado.` };
	}

	const lista = await listarDisposiciones(ctx);
	const pedido =
		args.disposicion ?? args.disposicionEgreso ?? args.motivo ?? disposicionEnTexto(lista, ctx?.req?.body?.mensaje);
	const resuelta = resolverDisposicion(lista, pedido);
	const fecha = fechaValida(args.fecha);
	const hora = horaValida(args.hora);
	const internacion = {
		numeroVisita: c.numeroVisita,
		paciente: c.paciente,
		documento: c.documento,
		sector: c.sector,
		cama: c.cama,
		ingreso: c.ingreso,
		diagnostico: c.diagnostico,
	};
	const dxPedido = String(args.diagnosticoEgreso || '').trim();
	// imVisitaMovimiento.Diagnostico es un código CIE (varchar 8): texto libre quedaría truncado como código.
	if (dxPedido && !CODIGO_CIE.test(dxPedido)) {
		return {
			error: `«${dxPedido}» no es un código CIE. Pasá el código (ej. J18.9) o no pases diagnóstico: se mantiene el de la internación.`,
			internacion,
		};
	}
	const lineaDx = dxPedido
		? `Dx egreso: ${dxPedido.toUpperCase()}`
		: `Dx egreso: se mantiene el de la internación (${c.diagnostico || 'sin diagnóstico cargado'})`;

	if (!resuelta || resuelta.ambiguo) {
		return {
			pedir: 'motivo',
			aviso:
				`${(resuelta && resuelta.aviso) || 'Para el egreso solo hace falta el motivo del catálogo. Fecha y hora se cargan con la de ahora.'} ` +
				`Cuando el usuario elija el motivo, llamá preparar_egreso otra vez con numeroVisita ${c.numeroVisita} y disposicion: eso arma la tarjeta Confirmar. No pidas «sí» por chat.`,
			internacion,
			diagnosticoEgreso: lineaDx,
			opciones: (resuelta && resuelta.opciones) || lista,
			fechaEgreso: fecha,
			horaEgreso: hora,
			link: linkSeccion(c.numeroVisita, 'movimientos'),
		};
	}

	return {
		http: {
			method: 'POST',
			path: '/api/patients/visitas/egreso',
			body: {
				numeroVisita: c.numeroVisita,
				fechaEgreso: fecha,
				horaEgreso: hora,
				disposicionEgreso: resuelta.Valor,
				diagnosticoEgreso: dxPedido ? dxPedido.toUpperCase() : undefined,
			},
		},
		internacion,
		resumen: `Egresar a ${c.paciente || 'paciente'} (visita ${c.numeroVisita}${c.sector ? `, ${c.sector}` : ''}${c.cama ? ` cama ${c.cama}` : ''}) · ${resuelta.Descripcion} · ${fecha} ${hora} · ${lineaDx}`,
		link: linkSeccion(c.numeroVisita, 'movimientos'),
	};
}

async function prepararEpicrisis(args, ctx) {
	const texto = String(args.texto || '').trim();
	if (!texto) throw Object.assign(new Error('El texto de la epicrisis está vacío'), { statusCode: 400 });
	const c = await contextoVisita(ctx, args.numeroVisita);
	if (!c.documento) throw Object.assign(new Error('La visita no tiene documento de paciente'), { statusCode: 400 });
	if (!c.sector) throw Object.assign(new Error('No se pudo resolver el sector de la visita'), { statusCode: 400 });
	const fecha = fechaValida(args.fecha);
	const hora = horaValida(args.hora);
	return {
		http: {
			method: 'POST',
			path: '/api/epicrisis',
			body: {
				IdVisita: c.numeroVisita,
				Fecha: fecha,
				Hora: hora,
				IdSector: c.sector,
				Epicrisis: texto,
				NumeroDocumento: c.documento,
				Profecional: profesionalDe(ctx),
				Diagnostico: args.diagnostico || '',
				DiagnosticoText: args.diagnosticoText || '',
				GeneradoConIA: true,
			},
		},
		resumen: `Guardar epicrisis de ${c.paciente || 'paciente'} (visita ${c.numeroVisita}) el ${fecha} ${hora}`,
		detalle: texto,
		link: linkSeccion(c.numeroVisita, 'epicrisis'),
		generativo: ['Epicrisis'],
	};
}

module.exports = {
	SECCIONES,
	API_POR_SECCION,
	seccionDeApi,
	linkSeccion,
	contextoVisita,
	buscarInternacion,
	resumenVisita,
	numeroVisitaDe,
	verEvoluciones,
	verIndicaciones,
	verEstudios,
	verControles,
	verEpicrisis,
	generarBorradorEpicrisis,
	prepararEvolucion,
	prepararEpicrisis,
	prepararEgreso,
	resolverDisposicion,
	disposicionEnTexto,
	pedidoEgreso,
	textoDesdeEgreso,
	extraerClavesBusqueda,
	coincideInternado,
	internadosDeContexto,
	hoyIso,
	fechaValida,
	horaValida,
	api,
};
