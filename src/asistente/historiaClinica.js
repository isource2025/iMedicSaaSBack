/**
 * Lectura de las secciones de la HC de internación que no tienen tool propia.
 * Cada sección pega a SU endpoint (con su permiso INTERNACION.*.VER), igual que
 * la pantalla de la cama; no se usa el export de admisión, que solo pide
 * ADMISION.BUSQUEDA.VER y saltearía esos permisos.
 */
const httpInterno = require('./httpInterno');
const clinica = require('./clinica');
const resumir = require('./resumir');

/** `porFecha`: el endpoint acepta date + days (days='all' = toda la internación). */
const SECCIONES = Object.freeze({
	hc_ingreso: {
		titulo: 'HC de ingreso',
		path: (nv) => `/api/hc-ingreso/visita/${nv}`,
		permiso: 'INTERNACION.HISTORIA_CLINICA.VER',
		seccionFront: 'hcIngreso',
		maxTexto: 1500,
		peso: 2,
	},
	laboratorios: {
		titulo: 'Laboratorios',
		path: (nv) => `/api/laboratorios/visita/${nv}`,
		permiso: 'INTERNACION.ESTUDIOS.VER',
		seccionFront: 'laboratorios',
	},
	signos_vitales: {
		titulo: 'Signos vitales / controles',
		path: (nv) => `/api/controles-frecuentes/${nv}/byDate`,
		permiso: 'INTERNACION.SIGNOS_VITALES.VER',
		seccionFront: 'controles-frecuentes',
		porFecha: true,
		diasDefault: 3,
		// Valor es el id del control; un 0 en pulso/TA/temperatura es «no medido», no un dato clínico.
		omitir: ['Valor'],
		sinCeros: true,
		// Para un análisis vale más la evolución por día que los últimos controles sueltos.
		parteResumen: 0.9,
		resumen: {
			tipo: 'numericos',
			notas: 'Observaciones',
			etiquetas: {
				Pulso: 'Pulso (lpm)',
				Maximo: 'TA sistólica (mmHg)',
				Minimo: 'TA diastólica (mmHg)',
				PAMedia: 'TA media (mmHg)',
				FrecuenciaRespiratoria: 'FR (rpm)',
				Axilar: 'Temp. axilar (°C)',
				Rectal: 'Temp. rectal (°C)',
				Saturometria: 'SatO2 (%)',
				Hgt: 'Glucemia HGT (mg/dl)',
			},
			// Hgt se carga como texto («138MG/DL.», «HGT 80»).
			textoNumerico: { Hgt: true },
			porDia: { Pulso: 'FC', Maximo: 'TAS', Minimo: 'TAD', FrecuenciaRespiratoria: 'FR', Axilar: 'T', Saturometria: 'Sat', Hgt: 'HGT' },
			fueraDeRango: {
				Pulso: [50, 110],
				Maximo: [90, 139],
				Minimo: [50, 89],
				FrecuenciaRespiratoria: [10, 24],
				Axilar: [35.5, 37.7],
				Saturometria: [94, null],
				Hgt: [70, 180],
			},
			criterio: 'Fuera de rango: TAS <90 o >139, TAD <50 o >89, FC <50 o >110, FR <10 o >24, T <35.5 o >37.7, Sat <94, HGT <70 o >180.',
		},
		// Viaja con el resumen y no en el prompt: solo cuando hay signos que analizar.
		comoUsar:
			'Para analizar la evolución usá resumen.tendencia: ya trae por variable los días fuera de rango, el peor valor con fecha y el último día (respetá esos números y fechas, no los recalcules ni copies porDia o fueraDeRango enteros). Primero lo que estuvo fuera de rango, después lo que estuvo en rango, y cerrá con cómo está el último día. No digas «estable» ni «sin anomalías» si hubo valores fuera de rango. No concluyas respuesta al tratamiento, hidratación ni función de órganos, y no recomiendes conductas. Si hay aviso de que no hay registros recientes, decilo al principio.',
	},
	medicacion: {
		titulo: 'Medicación suministrada',
		path: (nv) => `/api/medicacion-control/${nv}/byDate`,
		permiso: 'INTERNACION.MEDICACION.VER',
		seccionFront: 'medicacion-suministrada',
		porFecha: true,
		resumen: { tipo: 'agrupar', por: ['NombreMedicamento', 'DescripcionMedicamento'], sumar: 'Cantidad' },
	},
	interconsultas: {
		titulo: 'Interconsultas',
		path: (nv) => `/api/interconsultas/${nv}`,
		permiso: 'INTERNACION.INTERCONSULTAS.VER',
		seccionFront: 'interconsulta',
		maxTexto: 800,
		resumen: { tipo: 'agrupar', por: ['Especialidad', 'PracticaSolicitada'] },
		ultimosConTexto: true,
	},
	evolucion_enfermeria: {
		titulo: 'Evolución de enfermería',
		path: (nv) => `/api/evolucion-enfermeria/${nv}/byDate`,
		permiso: 'INTERNACION.EVOLUCION_ENFERMERIA.VER',
		seccionFront: 'evolucion-enfermeria',
		porFecha: true,
	},
	balance_hidrico: {
		titulo: 'Balance hídrico',
		path: (nv) => `/api/balance-hidrico/${nv}/all`,
		permiso: 'INTERNACION.BALANCE_HIDRICO.VER',
		seccionFront: 'balance-hidrico',
	},
	dieta: {
		titulo: 'Dietas',
		path: (nv) => `/api/dieta-control/${nv}/byDate`,
		permiso: 'INTERNACION.DIETA.VER',
		seccionFront: 'dieta',
		porFecha: true,
	},
	epicrisis: {
		titulo: 'Epicrisis',
		path: (nv) => `/api/epicrisis/${nv}`,
		permiso: 'INTERNACION.EPICRISIS.VER',
		seccionFront: 'epicrisis',
		maxTexto: 2000,
		peso: 2,
	},
	protocolos: {
		titulo: 'Protocolos',
		path: (nv) => `/api/protocolos/visita/${nv}`,
		permiso: 'INTERNACION.PROTOCOLOS.VER',
		seccionFront: 'protocolos',
		maxTexto: 800,
	},
	procedimientos: {
		titulo: 'Procedimientos',
		path: (nv) => `/api/procedimientos/visita/${nv}`,
		permiso: 'INTERNACION.PROCEDIMIENTOS.VER',
		seccionFront: 'procedimientos',
		omitir: ['Valor', 'Profesionales', 'ProfesionalesLista'],
		resumen: { tipo: 'agrupar', por: ['PracticaDescripcion', 'Practica'], sumar: 'CantidadPractica' },
	},
	insumos: {
		titulo: 'Insumos',
		path: (nv) => `/api/indicaciones/${nv}/insumos/byDate`,
		permiso: 'INTERNACION.INDICACIONES.VER',
		seccionFront: 'insumos',
		porFecha: true,
		resumen: { tipo: 'agrupar', por: ['descripcion'], sumar: 'cantidad' },
	},
	adjuntos: {
		titulo: 'Adjuntos (solo listado, no el contenido)',
		path: (nv) => `/api/adjuntos/visita/${nv}`,
		permiso: 'INTERNACION.ADJUNTOS.VER',
		seccionFront: 'adjuntos',
		resumen: { tipo: 'agrupar', por: ['TipoImagenNombre', 'TipoImagen'] },
	},
});

const NOMBRES = Object.freeze(Object.keys(SECCIONES));
const MAX_SECCIONES = 6;
/**
 * Lo que ve el modelo por llamada. Si los registros no entran, va un resumen
 * calculado acá (no por el modelo) más los últimos registros, y el chat avisa.
 */
const PRESUPUESTO_CHARS = resumir.PRESUPUESTO_LECTURA;
const MIN_CHARS_SECCION = 500;
const TOPE_TOTAL = 4200;
const MARGEN_TOPE = TOPE_TOTAL - PRESUPUESTO_CHARS;
const DIAS_DEFAULT = 7;

function periodoDe(sec, args) {
	if (!sec.porFecha) return null;
	const dias = args.todas ? 'all' : Number.isFinite(Number(args.dias)) && Number(args.dias) > 0 ? Number(args.dias) : sec.diasDefault || DIAS_DEFAULT;
	return { date: clinica.fechaValida(args.fecha), days: dias };
}

/** Trae las filas de una sección (sin recortar): el presupuesto se reparte después, entre las que tienen datos. */
async function leerSeccion(nombre, nv, args, ctx) {
	const sec = SECCIONES[nombre];
	if (ctx.tienePermiso && !ctx.tienePermiso(ctx.permisos, sec.permiso)) {
		return { seccion: nombre, titulo: sec.titulo, error: `Sin permiso (${sec.permiso}).` };
	}
	let query = periodoDe(sec, args);
	const pedir = (q) =>
		httpInterno.llamar({
			method: 'GET',
			path: sec.path(nv),
			query: q || undefined,
			headers: httpInterno.headersDesdeReq(ctx.req, ctx.token),
		});
	const r = await pedir(query);
	if (r.status >= 400) {
		return { seccion: nombre, titulo: sec.titulo, error: r.body?.mensaje || r.body?.message || `HTTP ${r.status}` };
	}
	let filas = resumir.recientesPrimero(resumir.filasDe(r.body));
	let fueraDePeriodo;
	// Sin fecha ni días pedidos, un período por defecto vacío no significa «sin registros»: se traen los últimos.
	if (!filas.length && query && query.days !== 'all' && !args.fecha && !args.dias) {
		const todo = await pedir({ ...query, days: 'all' });
		const filasTodo = todo.status < 400 ? resumir.recientesPrimero(resumir.filasDe(todo.body)) : [];
		if (filasTodo.length) {
			filas = filasTodo;
			fueraDePeriodo = `No hay registros en los últimos ${query.days} días; se muestran los más recientes de la internación.`;
			query = { ...query, days: 'all' };
		}
	}
	const periodo = query ? (query.days === 'all' ? 'toda la internación' : `${query.days} días hasta ${query.date}`) : 'toda la internación';
	return {
		seccion: nombre,
		titulo: sec.titulo,
		periodo,
		filas,
		aviso: filas.length ? fueraDePeriodo : `Sin registros de ${sec.titulo.toLowerCase()} (${periodo}).`,
	};
}

function presentarSecciones(leidas, total) {
	const conDatos = leidas.filter((s) => s.filas?.length);
	const pesoTotal = conDatos.reduce((n, s) => n + (SECCIONES[s.seccion].peso || 1), 0) || 1;
	return leidas.map(({ filas, ...s }) => {
		if (!filas) return s;
		if (!filas.length) return { ...s, total: 0, registros: [] };
		const presupuesto = Math.max(
			MIN_CHARS_SECCION,
			Math.floor((total * (SECCIONES[s.seccion].peso || 1)) / pesoTotal),
		);
		const sec = SECCIONES[s.seccion];
		// Con poco lugar (varias secciones), el resumen de todos los registros vale más que los últimos;
		// si los últimos no agregan texto propio (medicación, insumos…), van solo el resumen.
		const vista = resumir.presentar(
			filas,
			conDatos.length > 2 ? { ...sec, parteResumen: 0.8, soloResumen: !sec.ultimosConTexto } : sec,
			presupuesto,
		);
		const { aviso, ...resto } = s;
		const comoUsar = vista.resumen?.tendencia && sec.comoUsar;
		return { ...resto, ...vista, aviso, ...(comoUsar ? { comoUsar } : {}) };
	});
}

async function verHistoriaClinica(args, ctx) {
	const nv = parseInt(args.numeroVisita, 10);
	const pedidas = [...new Set((Array.isArray(args.secciones) ? args.secciones : [args.secciones]).map(String))];
	const validas = pedidas.filter((s) => SECCIONES[s]);
	if (!validas.length) {
		return { error: `Indicá al menos una sección: ${NOMBRES.join(', ')}.` };
	}
	const elegidas = validas.slice(0, MAX_SECCIONES);
	const leidas = await Promise.all(
		elegidas.map((s) =>
			leerSeccion(s, nv, args, ctx).catch((err) => ({
				seccion: s,
				titulo: SECCIONES[s].titulo,
				error: err.message || 'No se pudo leer',
			})),
		),
	);
	const presupuesto = resumir.presupuestoDelTurno(ctx);
	const secciones = presentarSecciones(leidas, presupuesto);
	const avisos = [];
	if (validas.length > elegidas.length) {
		avisos.push(`Se leyeron ${MAX_SECCIONES} secciones; pedí el resto (${validas.slice(MAX_SECCIONES).join(', ')}) en otra llamada.`);
	}
	const desconocidas = pedidas.filter((s) => !SECCIONES[s]);
	if (desconocidas.length) avisos.push(`Secciones que no existen: ${desconocidas.join(', ')}.`);
	resumir.recortarAlTope(secciones, presupuesto + MARGEN_TOPE);
	const out = {
		numeroVisita: nv,
		secciones,
		resumido: secciones.some((s) => s.resumido) || undefined,
		aviso: avisos.length ? avisos.join(' ') : undefined,
		link: clinica.linkSeccion(nv, SECCIONES[elegidas[0]].seccionFront),
	};
	resumir.consumirDelTurno(ctx, out);
	return out;
}

module.exports = { SECCIONES, NOMBRES, verHistoriaClinica, compactar: resumir.compactar, PRESUPUESTO_CHARS, TOPE_TOTAL };
