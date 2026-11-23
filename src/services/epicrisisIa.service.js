/**
 * Generación de epicrisis con IA — expediente clínico completo.
 *
 * Estándar de contenido (Joint Commission discharge summary + práctica AR / Ley 26.529):
 * 1. Identificación del paciente e internación
 * 2. Motivo / razón de hospitalización
 * 3. Antecedentes y hallazgos significativos / diagnósticos
 * 4. Curso hospitalario (evoluciones, interconsultas)
 * 5. Procedimientos, estudios, laboratorios y tratamientos
 * 6. Medicación e indicaciones
 * 7. Condición / disposición al egreso
 * 8. Instrucciones al paciente y seguimiento
 *
 * Fuentes: imPacientes, imVisita, imVisitaMovimiento, imHCI, imHCEvolucion,
 * indicaciones, medicación, estudios, labs, protocolos, prácticas, interconsultas,
 * controles, evolución enfermería, adjuntos (metadatos).
 *
 * Diseño anti-resumen excesivo:
 * - El texto final tiene un techo duro: imHCEpicrisis.Epicrisis es varchar(8000) y al guardar
 *   se agrega el deslinde. El prompt pide aprovechar ese espacio con datos concretos.
 * - El contexto que ve el modelo conserva el contenido real (valores de laboratorio, informes,
 *   texto de protocolos, dosis y períodos de medicación) y está en orden cronológico.
 * - Internaciones muy largas: las evoluciones se condensan por tramos (sin perder datos) antes
 *   de la redacción final, en lugar de truncarlas o descartar las más antiguas.
 */
const { executeQuery } = require('../models/db');
const admissionSearchService = require('./admissionSearch.service');
const interconsultasService = require('./interconsultas.service');
// Mismo servicio que usa la UI (esquema real imHCExamenesLabCabecera/Detalle: IdExamenLaboratorio,
// FechaEstudio, Estudio, Valor). laboratorios.service.js apunta a otro esquema que no existe en producción.
const laboratoriosService = require('./laboratorios-simple.service');
const indicacionesService = require('./indicaciones.service');
const visitaMovimientosService = require('./visitaMovimientos.service');
const botOpenai = require('./botOpenai.service');

const DISCLAIMER_IA = [
	'---',
	'DESLINDE DE RESPONSABILIDAD (asistencia por IA): Esta epicrisis fue elaborada con asistencia de inteligencia artificial a partir de datos de la historia clínica electrónica. El profesional médico interviniente declara haberla revisado, corregido y validado antes de su registro. La responsabilidad clínica y legal recae exclusivamente en el personal de salud firmante; la IA no sustituye el juicio clínico ni constituye por sí sola un acto médico.',
	'---',
].join('\n');

const SECTIONS_IA = [
	'admision',
	'hcIngreso',
	'practicas',
	'indicaciones',
	'medicamentos',
	'evoluciones',
	'estudios',
	'protocolos',
	'adjuntos',
];

/**
 * Secciones que se leen con el exportador general. Prácticas e indicaciones se cargan aparte con
 * consultas livianas: las del exportador no terminan en internaciones largas (cientos de prácticas,
 * miles de hojas de indicación) y dejaban la sección vacía tras 2 minutos de espera.
 */
const SECTIONS_EXPORT_IA = SECTIONS_IA.filter((s) => s !== 'practicas' && s !== 'indicaciones');
/** Tope por fuente: si una consulta se cuelga se sigue sin ella en vez de frenar toda la epicrisis. */
const TOPE_FUENTE_MS = 45000;

/** Columna imHCEpicrisis.Epicrisis (varchar 8000). Ver epicrisis.service.js. */
const MAX_EPICRISIS_DB = 8000;
/** Espacio real para el cuerpo: el deslinde se agrega al guardar y no puede quedar cortado. */
const MAX_CUERPO_EPICRISIS = MAX_EPICRISIS_DB - DISCLAIMER_IA.length - 2;

/** Tope global del contexto enviado al modelo. Si se supera, se reparte por sección (ver ajustarContexto). */
const MAX_CONTEXT_CHARS = 120000;
/** Total de caracteres de notas que se admite como resultado de condensar las evoluciones. */
const PRESUPUESTO_NOTAS_CHARS = 45000;
/** Si el contexto supera esto, las evoluciones se condensan por tramos antes de redactar. */
const UMBRAL_CONDENSAR_CHARS = 70000;
const TRAMO_EVOLUCIONES_CHARS = 18000;
const CONCURRENCIA_TRAMOS = 3;
const MAX_TRAMOS = 12;

/**
 * Límites por perfil. `resumen` conserva el recorte corto que usa visitaResumenIa;
 * `epicrisis` deja pasar el contenido real.
 */
const PERFIL_RESUMEN = {
	nombre: 'resumen',
	hcMax: 3,
	hcK: 1,
	evoMax: 60,
	evoChars: 700,
	icMax: 30,
	icPedidoChars: 400,
	icRespChars: 600,
	indMax: 80,
	indChars: 220,
	medMax: 60,
	estMax: 40,
	estPedidoChars: 400,
	estResChars: 600,
	labExamMax: 10,
	labParamMax: 25,
	pracMax: 40,
	protMax: 25,
	protTextoChars: 300,
	ctrlBuckets: 12,
	ctrlObsMax: 5,
	enfMax: 20,
	enfChars: 350,
	adjMax: 30,
};

const PERFIL_EPICRISIS = {
	nombre: 'epicrisis',
	hcMax: 6,
	hcK: 2,
	evoMax: Infinity,
	evoChars: 3000,
	icMax: 60,
	icPedidoChars: 800,
	icRespChars: 2500,
	indMax: 200,
	indChars: 300,
	medMax: 150,
	estMax: 80,
	estPedidoChars: 600,
	estResChars: 2500,
	labExamMax: 60,
	labParamMax: 80,
	pracMax: 100,
	protMax: 50,
	protTextoChars: 3000,
	ctrlBuckets: 45,
	ctrlObsMax: 25,
	enfMax: 40,
	enfChars: 400,
	adjMax: 40,
};

function limpiarTexto(v) {
	return String(v ?? '')
		.replace(/<\/?[a-z][^>]*>/gi, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function takeText(v, max = 400) {
	const s = limpiarTexto(v);
	if (!s) return '';
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

function pushIf(lines, label, value, max = 500) {
	const t = takeText(value, max);
	if (t) lines.push(`${label}: ${t}`);
}

function collectFilled(obj, keys, maxEach = 200) {
	const out = [];
	for (const k of keys) {
		const v = obj?.[k];
		const t = takeText(v, maxEach);
		if (t) out.push(`${k}=${t}`);
	}
	return out;
}

/** Fecha (Date o string ISO) → 'YYYY-MM-DD' o ''. */
function ymd(v) {
	if (v == null || v === '') return '';
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
	const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function dmy(v) {
	const y = ymd(v);
	return y ? `${y.slice(8, 10)}/${y.slice(5, 7)}/${y.slice(0, 4)}` : takeText(v, 20);
}

function hhmm(v) {
	const m = String(v ?? '').match(/(\d{1,2}):(\d{2})/);
	return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function num(v) {
	if (v == null || v === '') return NaN;
	const n = Number(String(v).replace(',', '.'));
	return Number.isFinite(n) && n > 0 ? n : NaN;
}

/**
 * Si hay más elementos que `max`, conserva el primero, el último y reparte el resto parejo
 * (en vez de descartar siempre un extremo de la internación).
 */
function muestrear(list, max) {
	const arr = Array.isArray(list) ? list : [];
	if (!Number.isFinite(max) || arr.length <= max) return arr;
	if (max <= 1) return arr.slice(-1);
	const out = [];
	const paso = (arr.length - 1) / (max - 1);
	let ultimo = -1;
	for (let i = 0; i < max; i++) {
		const idx = Math.round(i * paso);
		if (idx !== ultimo) out.push(arr[idx]);
		ultimo = idx;
	}
	return out;
}

function esVerdadero(v) {
	return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

async function obtenerPacienteEnriquecido(numeroVisita) {
	const rows = await executeQuery(
		`
    SELECT TOP 1
      v.NumeroVisita,
      v.IdPaciente,
      v.DIAGNOSTICO AS DxVisita,
      v.DIAGNOSTICOPRESUNTIVO AS DxPresuntivo,
      v.DIAGNOSTICODIFERENCIAL AS DxDiferencial,
      v.DIAGNOSTICOEGRESO AS DxEgresoVisita,
      v.OBSERVACIONES AS ObservacionesVisita,
      LTRIM(RTRIM(ISNULL(p.ApellidoyNombre, ''))) AS ApellidoYNombre,
      p.NumeroDocumento,
      p.TipoDocumento,
      p.NumeroHC,
      p.Sexo,
      p.GrupoSangre,
      p.FactorSangre,
      CONVERT(varchar(10), DATEADD(day, NULLIF(p.FechaNacimiento, 0), '1800-12-28'), 23) AS FechaNacimiento,
      CASE
        WHEN p.FechaNacimiento IS NULL OR p.FechaNacimiento = 0 THEN NULL
        ELSE DATEDIFF(
          year,
          DATEADD(day, p.FechaNacimiento, '1800-12-28'),
          GETDATE()
        )
      END AS EdadAnios,
      CONVERT(varchar(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
      CONVERT(varchar(5), v.FECHAADMISIONS, 108) AS HoraAdmision
    FROM dbo.imVisita v
    INNER JOIN dbo.imPacientes p ON v.IdPaciente = p.IdPaciente
    WHERE v.NumeroVisita = @param0
    `,
		[{ value: Number(numeroVisita) }],
	);
	return rows?.[0] || null;
}

/** Todos los controles de la internación (cronológico). Se resumen por día/tramo al armar el contexto. */
async function obtenerControlesResumen(numeroVisita) {
	try {
		return await executeQuery(
			`
      SELECT TOP 4000
        CONVERT(varchar(10), DATEADD(day, NULLIF(FechaControl, 0), '1800-12-28'), 23) AS Fecha,
        CONVERT(varchar(5), DATEADD(ms, (NULLIF(HoraControl, 0) - 1) * 10, 0), 108) AS Hora,
        Pulso, Maximo, Minimo, FrecuenciaRespiratoria, Axilar, Hgt, Saturometria, Peso, Talla,
        LTRIM(RTRIM(Observaciones)) AS Observaciones
      FROM dbo.imInterCtrlFrecuente
      WHERE NumeroVisita = @param0
      ORDER BY FechaControl ASC, HoraControl ASC
      `,
			[{ value: Number(numeroVisita) }],
		);
	} catch {
		return [];
	}
}

/** Evoluciones de enfermería de toda la internación (cronológico). */
async function obtenerEvolucionEnfermeriaResumen(numeroVisita) {
	try {
		return await executeQuery(
			`
      SELECT TOP 500
        CONVERT(varchar(10), DATEADD(day, NULLIF(FechaControl, 0), '1800-12-28'), 23) AS Fecha,
        CONVERT(varchar(5), DATEADD(ms, (NULLIF(HoraControl, 0) - 1) * 10, 0), 108) AS Hora,
        LTRIM(RTRIM(CAST(Observaciones AS nvarchar(max)))) AS Evolucion
      FROM dbo.imInterCtrlEvolucion
      WHERE NumeroVisita = @param0
      ORDER BY FechaControl ASC, HoraControl ASC
      `,
			[{ value: Number(numeroVisita) }],
		);
	} catch {
		return [];
	}
}

function buildHcBlock(hcRows, perfil = PERFIL_EPICRISIS) {
	const k = perfil.hcK || 1;
	const lines = [];
	const list = Array.isArray(hcRows) ? hcRows : [];
	if (!list.length) {
		lines.push('(sin HC de ingreso)');
		return lines.join('\n');
	}

	list.slice(0, perfil.hcMax).forEach((h, idx) => {
		lines.push(`--- HC #${idx + 1} ${h.FechaFormateada || h.Fecha || ''} ${h.HoraFormateada || ''} ---`);
		pushIf(lines, 'Profesional', h.ProfesionalNombre);
		pushIf(lines, 'Sector', h.SectorDescripcion || h.IdSector);
		pushIf(lines, 'Motivo de consulta / hospitalización', h.MotivoConsulta, 800 * k);
		pushIf(lines, 'Enfermedad actual / HPI', h.EnfermedadActual, 2000 * k);
		pushIf(lines, 'Antecedentes / mod. médica', h.ModMedica, 800 * k);
		pushIf(lines, 'Semiología', h.Semiologia, 800 * k);
		pushIf(lines, 'Impresión diagnóstica', h.IMPRESIONDIAGNOSTICA, 1500 * k);
		pushIf(lines, 'Exámenes complementarios (texto HC)', h.EXAMENCOMPLEMENTARIO, 1200 * k);
		pushIf(lines, 'Dx oftalmo/otros', h.EO_DIAGNOSTICO, 800);

		const sv = collectFilled(h, [
			'SV_GLUCEMIA',
			'SV_PA',
			'SV_FC',
			'SV_FR',
			'SV_TAX',
			'SV_IMPRESIONGENERAL',
			'SV_PESOACTUAL',
			'SV_TALLA',
			'SV_ESTADONUTRICIONAL',
		]);
		if (sv.length) lines.push(`Signos vitales ingreso: ${sv.join('; ')}`);

		const planesDx = collectFilled(
			h,
			['PD_A', 'PD_B', 'PD_C', 'PD_D', 'PD_E', 'PD_F', 'PD_G', 'PD_H', 'PD_I', 'PD_J', 'PD_K'],
			180 * k,
		);
		if (planesDx.length) lines.push(`Plan diagnóstico: ${planesDx.join(' | ')}`);

		const planesTx = [];
		for (let i = 1; i <= 15; i++) {
			const t = takeText(h[`PT_${i}`], 180 * k);
			if (t) planesTx.push(t);
		}
		if (planesTx.length) lines.push(`Plan terapéutico: ${planesTx.join(' | ')}`);

		const examBrief = collectFilled(
			h,
			[
				'PF_TEXTO',
				'SL_TEXTO',
				'C_TEXTO',
				'CU_TEXTO',
				'AR_AUSCULTACION',
				'AC_AUSCULTACION',
				'A_PALPACION',
				'A_HIGADO',
			],
			250 * k,
		);
		if (examBrief.length) lines.push(`Examen físico (extractos): ${examBrief.join(' | ')}`);
	});

	return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Consolidación de datos (los servicios devuelven filas crudas: eventos de administración,
// hojas de indicación repetidas cada día, controles cada pocas horas…)
// ---------------------------------------------------------------------------------------------

function evolucionesOrdenadas(dossier) {
	const evo = Array.isArray(dossier.evolucionesMedicas) ? dossier.evolucionesMedicas : [];
	return [...evo].sort((a, b) =>
		`${a.FechaEv || a.fechaEv || ''} ${a.HoraEv || a.horaEv || ''}`.localeCompare(
			`${b.FechaEv || b.fechaEv || ''} ${b.HoraEv || b.horaEv || ''}`,
		),
	);
}

function lineaEvolucion(e, n, maxChars) {
	const prof = takeText(
		e.ProfesionalNombreCompleto || e.profesionalNombreCompleto || e.EspecialidadDescripcion || '',
		50,
	);
	const esp = takeText(e.EspecialidadDescripcion || e.SectorDescripcion || '', 40);
	return (
		`${n}. [${dmy(e.FechaEv || e.fechaEv)} ${hhmm(e.HoraEv || e.horaEv)}] ` +
		`${prof}${esp && esp !== prof ? ` (${esp})` : ''}: ` +
		takeText(e.Evolucion || e.evolucion, maxChars)
	);
}

/**
 * Medicación: cada fila de imInterCtrlMedicamento es UNA administración. Se agrupa por fármaco
 * (cantidad de dosis, primer/último registro, dosis habitual, adicionales/diluyentes).
 */
function consolidarMedicacion(meds) {
	const map = new Map();
	for (const m of Array.isArray(meds) ? meds : []) {
		const nombre = takeText(
			m.NombreMedicamento ||
				m.DescripcionMedicamento ||
				m.Nombre ||
				m.nombre ||
				m.Medicamento ||
				m.AliasMedicamento ||
				m.Descripcion ||
				'',
			160,
		);
		if (!nombre) continue;
		const key = nombre.toLowerCase();
		const e = map.get(key) || {
			nombre,
			n: 0,
			desde: '',
			hasta: '',
			dosis: new Map(),
			adicionales: new Set(),
			obs: [],
		};
		e.n += 1;
		const f = ymd(m.FechaControl || m.FechaCarga);
		if (f) {
			if (!e.desde || f < e.desde) e.desde = f;
			if (!e.hasta || f > e.hasta) e.hasta = f;
		}
		const cant = num(m.Cantidad) || num(m.CantidadIndicada);
		if (Number.isFinite(cant)) {
			const d = `${cant} ${takeText(m.TipoUnidad, 20)}`.trim();
			e.dosis.set(d, (e.dosis.get(d) || 0) + 1);
		}
		for (const a of Array.isArray(m.adicionales) ? m.adicionales : []) {
			const an = takeText(a.NombreMedicamento || a.DescripcionMedicamento, 80);
			if (an) e.adicionales.add(an);
		}
		const obs = takeText(m.Observaciones, 150);
		if (obs && e.obs.length < 2 && !e.obs.includes(obs)) e.obs.push(obs);
		map.set(key, e);
	}
	return [...map.values()].sort(
		(a, b) => (a.desde || '9999').localeCompare(b.desde || '9999') || a.nombre.localeCompare(b.nombre),
	);
}

function lineaMedicacion(e) {
	const partes = [e.nombre];
	const dosis = [...e.dosis.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d);
	if (dosis.length) partes.push(`dosis registrada: ${dosis.join(' / ')}`);
	partes.push(`${e.n} administración(es) registrada(s)`);
	if (e.desde) {
		partes.push(e.desde === e.hasta ? `el ${dmy(e.desde)}` : `del ${dmy(e.desde)} al ${dmy(e.hasta)}`);
	}
	if (e.adicionales.size) partes.push(`con: ${[...e.adicionales].slice(0, 4).join(', ')}`);
	if (e.obs.length) partes.push(`obs: ${e.obs.join(' / ')}`);
	return partes.join(' | ');
}

/**
 * Indicaciones: la hoja se re-indica a diario (copias). Se agrupan las idénticas y se informa
 * el período en que estuvieron vigentes y si quedaron sin efecto.
 */
function consolidarIndicaciones(inds) {
	const map = new Map();
	for (const r of Array.isArray(inds) ? inds : []) {
		const desc = takeText(
			r.descripcion || r.DescripcionIndicacion || r.Indicacion || r.indicacion || r.Descripcion || '',
			300,
		);
		if (!desc) continue;
		const tipo = takeText(r.tipoDescripcion || r.tipo || r.TipoIndicacion || r.Tipo || '', 40);
		const cant = takeText(`${r.cantidad ?? ''} ${r.tipoUnidad ?? ''}`, 30);
		const frec = takeText(r.frecuencia, 40);
		const obs = takeText(r.observaciones, 200);
		const key = [tipo, desc, cant, frec, obs].join('|').toLowerCase();
		const e = map.get(key) || {
			tipo,
			desc,
			cant,
			frec,
			obs,
			orden: Number(r.ordenTipo) || 0,
			desde: '',
			hasta: '',
			expiro: '',
			hojas: 0,
			activa: false,
			hijas: new Set(),
		};
		e.hojas += 1;
		for (const f of [ymd(r.vigenteDesde), ymd(r.fechaCarga)].filter(Boolean)) {
			if (!e.desde || f < e.desde) e.desde = f;
			if (!e.hasta || f > e.hasta) e.hasta = f;
		}
		const susp = r.suspendida === true || r.estado === 'S';
		if (!susp) e.activa = true;
		const fe = ymd(r.fechaExpiro);
		if (fe && (!e.expiro || fe > e.expiro)) e.expiro = fe;
		for (const h of Array.isArray(r.indicacionesHijas) ? r.indicacionesHijas : []) {
			const hn = takeText(h.descripcion || h.medicamento || h.DescripcionIndicacion || h.AliasMedicamento, 80);
			if (hn) e.hijas.add(hn);
		}
		map.set(key, e);
	}
	return [...map.values()].sort(
		(a, b) => a.orden - b.orden || (a.desde || '9999').localeCompare(b.desde || '9999'),
	);
}

function lineaIndicacion(e, maxChars) {
	const partes = [`${e.tipo ? `[${e.tipo}] ` : ''}${takeText(e.desc, maxChars)}`];
	if (e.cant) partes.push(e.cant);
	if (e.frec) partes.push(e.frec);
	if (e.desde) partes.push(e.desde === e.hasta ? `el ${dmy(e.desde)}` : `del ${dmy(e.desde)} al ${dmy(e.hasta)}`);
	if (!e.activa) partes.push(`SIN EFECTO${e.expiro ? ` desde ${dmy(e.expiro)}` : ''}`);
	if (e.hijas.size) partes.push(`con: ${[...e.hijas].slice(0, 4).join(', ')}`);
	if (e.obs) partes.push(`obs: ${e.obs}`);
	return partes.join(' | ');
}

function lineaLaboratorio(ex, perfil) {
	const cab = [
		`[${dmy(ex.FechaExamen)} ${hhmm(ex.HoraExamen)}]`.replace(/\s+\]/, ']'),
		/^\d+$/.test(String(ex.TipoEstudio ?? '').trim())
			? `Laboratorio (tipo ${String(ex.TipoEstudio).trim()}${ex.Protocolo ? `, protocolo ${takeText(ex.Protocolo, 20)}` : ''})`
			: takeText(ex.TipoEstudio, 60),
		takeText(ex.Laboratorio, 60) ? `(${takeText(ex.Laboratorio, 60)})` : '',
		takeText(ex.Estado, 20) ? `estado=${takeText(ex.Estado, 20)}` : '',
	]
		.filter(Boolean)
		.join(' ');
	const detalles = Array.isArray(ex.detalles) ? ex.detalles : [];
	const params = detalles.slice(0, perfil.labParamMax).map((d) => {
		const nombre = takeText(d.NombreParametro, 60);
		const res = takeText(d.Resultado, 60);
		if (!nombre && !res) return '';
		const fuera = esVerdadero(d.FueraDeRango);
		const ref = fuera ? takeText(d.ValorReferencia, 40) : '';
		return (
			`${nombre}${res ? ` ${res}` : ''}${takeText(d.UnidadMedida, 20) ? ` ${takeText(d.UnidadMedida, 20)}` : ''}` +
			(fuera ? ` (FUERA DE RANGO${ref ? `, ref ${ref}` : ''})` : '')
		);
	});
	const obs = takeText(ex.Observaciones, 300);
	const cuerpo = params.filter(Boolean).join('; ');
	return `${cab}: ${cuerpo || '(sin parámetros cargados)'}${obs ? ` | Obs: ${obs}` : ''}`;
}

/**
 * Controles frecuentes → rangos por día (o por tramo de días si la internación es larga).
 * Evita mandar cientos de filas y a la vez no pierde la evolución de los signos vitales.
 */
function resumirControles(ctrl, maxBuckets) {
	const filas = (Array.isArray(ctrl) ? ctrl : []).filter((c) => ymd(c.Fecha));
	if (!filas.length) return [];
	const dias = [...new Set(filas.map((c) => ymd(c.Fecha)))].sort();
	const porTramo = Math.max(1, Math.ceil(dias.length / Math.max(1, maxBuckets)));
	const tramoDeDia = new Map();
	dias.forEach((d, i) => tramoDeDia.set(d, Math.floor(i / porTramo)));

	const grupos = new Map();
	for (const c of filas) {
		const t = tramoDeDia.get(ymd(c.Fecha));
		if (!grupos.has(t)) grupos.set(t, []);
		grupos.get(t).push(c);
	}

	const rango = (vals, dec = 0) => {
		const v = vals.filter(Number.isFinite);
		if (!v.length) return '';
		const f = (x) => (dec ? x.toFixed(dec).replace(/\.0+$/, '') : String(Math.round(x)));
		const mn = Math.min(...v);
		const mx = Math.max(...v);
		return mn === mx ? f(mn) : `${f(mn)}-${f(mx)}`;
	};

	return [...grupos.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, rows]) => {
			const fechas = rows.map((r) => ymd(r.Fecha)).sort();
			const etiqueta =
				fechas[0] === fechas[fechas.length - 1]
					? dmy(fechas[0])
					: `${dmy(fechas[0])} a ${dmy(fechas[fechas.length - 1])}`;
			const col = (k) => rows.map((r) => num(r[k]));
			const partes = [];
			const pa = `${rango(col('Maximo'))}/${rango(col('Minimo'))}`;
			if (pa !== '/') partes.push(`PA ${pa}`);
			const fc = rango(col('Pulso'));
			if (fc) partes.push(`FC ${fc}`);
			const fr = rango(col('FrecuenciaRespiratoria'));
			if (fr) partes.push(`FR ${fr}`);
			const tx = rango(col('Axilar'), 1);
			if (tx) partes.push(`Tax ${tx}`);
			const sat = rango(col('Saturometria'));
			if (sat) partes.push(`Sat ${sat}%`);
			const hgt = rango(col('Hgt'));
			if (hgt) partes.push(`HGT ${hgt}`);
			const peso = rango(col('Peso'), 1);
			if (peso) partes.push(`Peso ${peso}`);
			return `${etiqueta}: ${partes.join(' | ') || '(sin valores)'} (${rows.length} control(es))`;
		});
}

function diasInternacion(p, egreso, today) {
	const ini = ymd(p?.FechaAdmision);
	if (!ini) return null;
	const fin = ymd(egreso?.FechaEgresoISO) || ymd(egreso?.FechaEgreso) || today;
	if (!fin) return null;
	const ms = Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`);
	if (!Number.isFinite(ms) || ms < 0) return null;
	return Math.round(ms / 86400000);
}

/**
 * Arma el expediente en texto para el modelo.
 * @param {object} dossier salida de reunirExpediente
 * @param {{ perfil?: object, evolucionesTexto?: string, evolucionesTitulo?: string }} [opts]
 *   perfil: PERFIL_EPICRISIS | PERFIL_RESUMEN (por defecto el resumen corto, usado por visitaResumenIa)
 *   evolucionesTexto: si viene, reemplaza el listado crudo de evoluciones (internaciones largas condensadas)
 */
function buildContextText(dossier, opts = {}) {
	const perfil = opts.perfil || PERFIL_RESUMEN;
	const esEpicrisis = perfil.nombre === 'epicrisis';
	const lines = [];
	const p = dossier.paciente || {};
	const egreso = dossier.egreso || {};

	lines.push('=== 1. IDENTIFICACIÓN / INTERNACIÓN ===');
	pushIf(lines, 'Visita', dossier.numeroVisita);
	pushIf(lines, 'Paciente', p.ApellidoYNombre);
	pushIf(lines, 'Documento', `${p.TipoDocumento || ''} ${p.NumeroDocumento || ''}`.trim());
	pushIf(lines, 'HC', p.NumeroHC);
	pushIf(lines, 'Sexo', p.Sexo);
	pushIf(lines, 'Fecha nacimiento', p.FechaNacimiento ? dmy(p.FechaNacimiento) : '');
	pushIf(lines, 'Edad (años)', p.EdadAnios);
	pushIf(lines, 'Grupo/factor', `${p.GrupoSangre || ''} ${p.FactorSangre || ''}`.trim());
	pushIf(lines, 'Ingreso', `${p.FechaAdmision ? dmy(p.FechaAdmision) : ''} ${p.HoraAdmision || ''}`.trim());
	const dias = diasInternacion(p, egreso, dossier._today);
	if (dias != null) {
		const enCurso = !(egreso && (egreso.FechaEgresoISO || egreso.FechaEgreso));
		lines.push(`Días de internación (calculado): ${dias}${enCurso ? ' (al día de hoy; sin egreso registrado)' : ''}`);
	}
	pushIf(lines, 'Dx visita', p.DxVisita);
	pushIf(lines, 'Dx presuntivo', p.DxPresuntivo);
	pushIf(lines, 'Dx diferencial', p.DxDiferencial);
	pushIf(lines, 'Dx egreso (visita)', p.DxEgresoVisita);
	pushIf(lines, 'Observaciones visita', p.ObservacionesVisita, 600);

	lines.push('\n=== 2. EGRESO / DISPOSICIÓN ===');
	if (egreso && (egreso.FechaEgresoISO || egreso.FechaEgreso)) {
		pushIf(lines, 'Fecha egreso', dmy(egreso.FechaEgresoISO || egreso.FechaEgreso));
		pushIf(lines, 'Hora egreso', egreso.HoraEgresoISO || egreso.HoraEgreso);
		pushIf(lines, 'Disposición egreso', egreso.DisposicionEgresoDescripcion || egreso.DisposicionEgreso);
		pushIf(lines, 'Diagnóstico egreso (movimiento)', egreso.DiagnosticoDescripcion || egreso.Diagnostico, 500);
		pushIf(lines, 'Sector/cama', `${egreso.NombreSector || ''} / ${egreso.NombreCama || ''}`.trim());
	} else {
		lines.push('(sin egreso registrado aún — redactar como borrador de alta proyectada)');
	}

	const movs = (Array.isArray(dossier.movimientos) ? dossier.movimientos : [])
		.filter((m) => m && (m.FechaAdmisionISO || m.NombreSector || m.NombreCama))
		.sort((a, b) => String(ymd(a.FechaAdmisionISO)).localeCompare(String(ymd(b.FechaAdmisionISO))));
	if (esEpicrisis && movs.length > 1) {
		lines.push(`\n=== 2b. MOVIMIENTOS / TRASLADOS ENTRE SECTORES (${movs.length}) ===`);
		movs.slice(0, 30).forEach((m, i) => {
			lines.push(
				`${i + 1}. ${dmy(m.FechaAdmisionISO)} ${hhmm(m.HoraAdmisionISO)} → ` +
					`${m.FechaEgresoISO ? `${dmy(m.FechaEgresoISO)} ${hhmm(m.HoraEgresoISO)}`.trim() : 'actual'} | ` +
					`${takeText(m.NombreSector || m.ServicioHospital, 50)} / ${takeText(m.NombreCama, 30)}` +
					`${m.DisposicionEgresoDescripcion ? ` | egreso del sector: ${takeText(m.DisposicionEgresoDescripcion, 60)}` : ''}`,
			);
		});
	}

	lines.push('\n=== 3. HC INGRESO (motivo, hallazgos, planes) ===');
	lines.push(buildHcBlock(dossier.historialClinico, perfil));

	const evo = evolucionesOrdenadas(dossier);
	if (opts.evolucionesTexto) {
		lines.push(
			`\n=== 4. ${opts.evolucionesTitulo || `CURSO HOSPITALARIO — EVOLUCIONES MÉDICAS CONDENSADAS (${evo.length} originales)`} ===`,
		);
		lines.push(opts.evolucionesTexto);
	} else {
		lines.push(`\n=== 4. CURSO HOSPITALARIO — EVOLUCIONES MÉDICAS (${evo.length}, orden cronológico) ===`);
		if (!evo.length) lines.push('(sin evoluciones)');
		// Perfil corto: las más recientes. Epicrisis: todas (si es enorme se condensa por tramos antes).
		const evoUsar = Number.isFinite(perfil.evoMax) ? evo.slice(-perfil.evoMax) : evo;
		evoUsar.forEach((e, i) => lines.push(lineaEvolucion(e, i + 1, perfil.evoChars)));
	}

	const ics = [...(Array.isArray(dossier.interconsultas) ? dossier.interconsultas : [])].sort((a, b) =>
		`${a.FechaSolicitud || ''} ${a.HoraSolicitud || ''}`.localeCompare(`${b.FechaSolicitud || ''} ${b.HoraSolicitud || ''}`),
	);
	lines.push(`\n=== 5. INTERCONSULTAS (${ics.length}) ===`);
	if (!ics.length) lines.push('(sin interconsultas)');
	muestrear(ics, perfil.icMax).forEach((ic, i) => {
		lines.push(
			`${i + 1}. [${dmy(ic.FechaSolicitud)} ${hhmm(ic.HoraSolicitud)}] ` +
				`${takeText(ic.ServicioDescripcion || ic.ServicioDestino || ic.SectorReceptorNombre || ic.Especialidad || ic.SectorReceptor, 60)}` +
				`${takeText(ic.MedicoSolicitanteNombre, 50) ? ` (solicitó: ${takeText(ic.MedicoSolicitanteNombre, 50)})` : ''}`,
		);
		lines.push(
			`   Pedido: ${takeText(ic.Motivo || ic.Notas || ic.NotasObservacion || ic.motivo, perfil.icPedidoChars)}`,
		);
		const resp = takeText(ic.Respuesta || ic.TextoResultado || ic.respuesta, perfil.icRespChars);
		lines.push(`   Respuesta${ic.FechaRespuesta ? ` (${dmy(ic.FechaRespuesta)})` : ''}: ${resp || '(sin respuesta)'}`);
	});

	const ind = consolidarIndicaciones(dossier.indicaciones);
	lines.push(`\n=== 6. INDICACIONES / TRATAMIENTO (${ind.length} distintas) ===`);
	if (!ind.length) lines.push('(sin indicaciones)');
	muestrear(ind, perfil.indMax).forEach((e, i) => lines.push(`${i + 1}. ${lineaIndicacion(e, perfil.indChars)}`));

	const meds = consolidarMedicacion(dossier.medicamentos);
	lines.push(`\n=== 7. MEDICACIÓN SUMINISTRADA (por fármaco, ${meds.length}) ===`);
	if (!meds.length) lines.push('(sin medicación registrada)');
	muestrear(meds, perfil.medMax).forEach((e, i) => lines.push(`${i + 1}. ${lineaMedicacion(e)}`));

	const est = [...(Array.isArray(dossier.estudios) ? dossier.estudios : [])].sort((a, b) =>
		String(a.FechaPedido || '').localeCompare(String(b.FechaPedido || '')),
	);
	lines.push(`\n=== 8. ESTUDIOS / PEDIDOS (${est.length}) ===`);
	if (!est.length) lines.push('(sin estudios)');
	muestrear(est, perfil.estMax).forEach((e, i) => {
		const nombre =
			e.PracticaDescripcion ||
			e.Descripcion ||
			e.descripcion ||
			e.PracticaSolicitada ||
			e.Nombre ||
			e.Estudio ||
			'';
		const estado = takeText(e.EstadoResultado || e.EstadoWorkflow || e.Estado || e.estado, 40);
		lines.push(
			`${i + 1}. [${dmy(e.FechaPedido)}] ${takeText(nombre, 200)}` +
				`${estado ? ` | estado=${estado}` : ''}` +
				`${takeText(e.EstadoUrgencia, 20) ? ` | ${takeText(e.EstadoUrgencia, 20)}` : ''}`,
		);
		const pedido = takeText(e.PedidoEstudio || e.NotasObservacion || e.Notas || e.pedido, perfil.estPedidoChars);
		if (pedido) lines.push(`   Pedido: ${pedido}`);
		const resp = takeText(e.ResultadoEstudio || e.TextoResultado || e.resultado || e.Respuesta, perfil.estResChars);
		lines.push(`   Resultado${e.FechaResultado ? ` (${dmy(e.FechaResultado)})` : ''}: ${resp || '(sin resultado cargado)'}`);
	});

	const labs = [...(Array.isArray(dossier.laboratorios) ? dossier.laboratorios : [])].sort((a, b) =>
		`${ymd(a.FechaExamen)} ${hhmm(a.HoraExamen)}`.localeCompare(`${ymd(b.FechaExamen)} ${hhmm(b.HoraExamen)}`),
	);
	lines.push(`\n=== 9. LABORATORIOS / RESULTADOS (${labs.length} determinaciones, cronológico) ===`);
	if (!labs.length) lines.push('(sin laboratorios)');
	muestrear(labs, perfil.labExamMax).forEach((ex, i) => lines.push(`${i + 1}. ${lineaLaboratorio(ex, perfil)}`));

	const prac = [...(Array.isArray(dossier.practicasPaciente) ? dossier.practicasPaciente : [])].sort((a, b) =>
		`${ymd(a.FechaPractica)} ${a.HoraPracticaInicio || ''}`.localeCompare(`${ymd(b.FechaPractica)} ${b.HoraPracticaInicio || ''}`),
	);
	lines.push(`\n=== 10. PRÁCTICAS / PROCEDIMIENTOS (${prac.length}) ===`);
	if (!prac.length) lines.push('(sin prácticas)');
	muestrear(prac, perfil.pracMax).forEach((pItem, i) => {
		const nombre =
			pItem.PracticaDescripcion || pItem.Descripcion || pItem.descripcion || pItem.DescPractica || pItem.Practica || '';
		const cant = Number(pItem.CantidadPractica) > 1 ? ` x${Number(pItem.CantidadPractica)}` : '';
		const sector = takeText(pItem.SectorDescripcion, 40);
		const veces = Number(pItem.Veces) > 1 ? ` (${Number(pItem.Veces)} registros)` : '';
		const f1 = ymd(pItem.FechaPractica);
		const f2 = ymd(pItem.FechaUltimaPractica);
		const fecha = f1 && f2 && f1 !== f2 ? `${dmy(f1)} a ${dmy(f2)}` : dmy(pItem.FechaPractica);
		lines.push(
			`${i + 1}. [${fecha}] ${takeText(nombre, 200)}${cant}${veces}${sector ? ` | ${sector}` : ''}`,
		);
	});

	const prot = [...(Array.isArray(dossier.protocolos) ? dossier.protocolos : [])].sort((a, b) =>
		String(a.fechaHoraInicio || a.fecha || '').localeCompare(String(b.fechaHoraInicio || b.fecha || '')),
	);
	lines.push(`\n=== 11. PROTOCOLOS (quirúrgicos / procedimientos, ${prot.length}) ===`);
	if (!prot.length) lines.push('(sin protocolos)');
	muestrear(prot, perfil.protMax).forEach((pItem, i) => {
		const nombre =
			pItem.tipoDescripcion || pItem.tipoProtocolo || pItem.Descripcion || pItem.descripcion || pItem.Nombre || pItem.Protocolo || '';
		lines.push(
			`${i + 1}. [${dmy(pItem.fechaHoraInicio || pItem.fecha)}] ${takeText(nombre, 120) || 'Protocolo'}` +
				`${takeText(pItem.estado, 20) ? ` | estado=${takeText(pItem.estado, 20)}` : ''}` +
				`${takeText(pItem.operadorNombre, 60) ? ` | operador: ${takeText(pItem.operadorNombre, 60)}` : ''}`,
		);
		pushIf(lines, '   Dx pre', pItem.diagnosticoPreDescripcion || pItem.diagnosticoPre, 200);
		pushIf(lines, '   Dx post', pItem.diagnosticoPosDescripcion || pItem.diagnosticoPos, 200);
		pushIf(lines, '   Técnica', pItem.tecnica, perfil.protTextoChars);
		pushIf(lines, '   Descripción / informe', pItem.texto, perfil.protTextoChars);
		const pracs = (Array.isArray(pItem.practicas) ? pItem.practicas : [])
			.map((x) => takeText(x.descripcion, 100))
			.filter(Boolean);
		if (pracs.length) lines.push(`   Prácticas: ${pracs.slice(0, 12).join('; ')}`);
		const equipo = [];
		for (const pr of Array.isArray(pItem.practicas) ? pItem.practicas : []) {
			for (const prof of Array.isArray(pr.profesionales) ? pr.profesionales : []) {
				const t = `${takeText(prof.funcionNombre, 30)}: ${takeText(prof.apellidoNombre, 50)}`;
				if (prof.apellidoNombre && !equipo.includes(t)) equipo.push(t);
			}
		}
		if (equipo.length) lines.push(`   Equipo: ${equipo.slice(0, 8).join('; ')}`);
		const pm = (Array.isArray(pItem.medicamentos) ? pItem.medicamentos : [])
			.map((x) => `${takeText(x.descripcion, 60)}${x.cantidad != null ? ` x${x.cantidad}` : ''}`)
			.filter((x) => x.trim());
		if (pm.length) lines.push(`   Medicación/insumos del procedimiento: ${pm.slice(0, 10).join('; ')}`);
	});

	const ctrl = Array.isArray(dossier.controles) ? dossier.controles : [];
	// El dossier trae los controles ya ordenados cronológicamente, pero se asegura por las dudas.
	const ctrlAsc = [...ctrl].sort((a, b) =>
		`${ymd(a.Fecha)} ${a.Hora || ''}`.localeCompare(`${ymd(b.Fecha)} ${b.Hora || ''}`),
	);
	const resumenCtrl = resumirControles(ctrlAsc, perfil.ctrlBuckets);
	lines.push(`\n=== 12. CONTROLES FRECUENTES / SIGNOS VITALES (${ctrl.length} controles, rangos por día) ===`);
	if (!resumenCtrl.length) lines.push('(sin controles)');
	resumenCtrl.forEach((l, i) => lines.push(`${i + 1}. ${l}`));
	if (ctrlAsc.length) {
		const u = ctrlAsc[ctrlAsc.length - 1];
		lines.push(
			`Último control registrado [${dmy(u.Fecha)} ${hhmm(u.Hora)}]: PA ${u.Maximo || '-'}/${u.Minimo || '-'} ` +
				`FC ${u.Pulso || '-'} FR ${u.FrecuenciaRespiratoria || '-'} Tax ${u.Axilar || '-'} ` +
				`Sat ${u.Saturometria || '-'} HGT ${u.Hgt || '-'}${u.Peso ? ` Peso ${u.Peso}` : ''}`,
		);
	}
	const ctrlObs = ctrlAsc.filter((c) => takeText(c.Observaciones));
	if (ctrlObs.length) {
		lines.push('Observaciones registradas en controles:');
		muestrear(ctrlObs, perfil.ctrlObsMax).forEach((c) =>
			lines.push(`- [${dmy(c.Fecha)} ${hhmm(c.Hora)}] ${takeText(c.Observaciones, 200)}`),
		);
	}

	const enf = Array.isArray(dossier.evolucionEnfermeria) ? dossier.evolucionEnfermeria : [];
	const enfAsc = [...enf].sort((a, b) =>
		`${ymd(a.Fecha)} ${a.Hora || ''}`.localeCompare(`${ymd(b.Fecha)} ${b.Hora || ''}`),
	);
	lines.push(`\n=== 13. EVOLUCIÓN ENFERMERÍA (${enf.length}) ===`);
	if (!enf.length) lines.push('(sin evoluciones de enfermería)');
	muestrear(enfAsc, perfil.enfMax).forEach((e, i) => {
		lines.push(`${i + 1}. [${dmy(e.Fecha)} ${hhmm(e.Hora)}] ${takeText(e.Evolucion, perfil.enfChars)}`);
	});

	const adj = Array.isArray(dossier.adjuntos) ? dossier.adjuntos : [];
	lines.push(`\n=== 14. ADJUNTOS (metadatos, ${adj.length}) ===`);
	if (!adj.length) lines.push('(sin adjuntos)');
	adj.slice(0, perfil.adjMax).forEach((a, i) => {
		lines.push(
			`${i + 1}. ${takeText(a.NombreArchivo || a.nombreArchivo, 80)} ` +
				`tipo=${takeText(a.TipoImagenNombre || a.TipoArchivo, 40)} ` +
				`fecha=${takeText(a.FechaCarga, 20)}`,
		);
	});

	const text = lines.join('\n');
	if (opts.sinAjuste) return text;
	return ajustarContexto(text, MAX_CONTEXT_CHARS);
}

/**
 * Reduce una sección a un presupuesto de caracteres conservando muestras repartidas de TODA la
 * internación (primero, último y parejo en el medio) en lugar de cortar el final.
 * Un "registro" empieza en una línea "N. ..." y arrastra sus líneas de detalle.
 */
function reducirSeccion(texto, presupuesto) {
	if (texto.length <= presupuesto) return texto;
	const lineas = texto.split('\n');
	const cabecera = lineas[0];
	const items = [];
	for (const l of lineas.slice(1)) {
		// Registro nuevo: línea numerada ("12. ...") o bloque de período condensado ("--- Período ... ---").
		if (/^(\d+\. |--- )/.test(l) || !items.length) items.push([l]);
		else items[items.length - 1].push(l);
	}
	if (!items.length) return texto.slice(0, presupuesto);
	const armar = (sel) =>
		[
			cabecera,
			...sel.flat(),
			`(… ${items.length - sel.length} de ${items.length} registros omitidos por tamaño; se conservan muestras repartidas en toda la internación)`,
		].join('\n');
	const promedio = (texto.length - cabecera.length) / items.length;
	let n = Math.max(1, Math.floor((presupuesto - cabecera.length - 140) / Math.max(1, promedio)));
	let sel = muestrear(items, n);
	let out = armar(sel);
	while (out.length > presupuesto && n > 1) {
		n = Math.max(1, Math.floor(n * 0.9));
		sel = muestrear(items, n);
		out = armar(sel);
	}
	// Último recurso (un solo registro enorme): se recorta ese registro, nunca se excede el presupuesto.
	return out.length > presupuesto ? `${out.slice(0, Math.max(0, presupuesto - 20))}\n(… recortado)` : out;
}

/**
 * Si el contexto supera el tope, reparte el espacio entre secciones: las chicas quedan completas y
 * las grandes se reducen (reparto "water-filling"). Así no se pierden secciones enteras del final
 * (indicaciones, medicación, estudios, protocolos, controles) por culpa de una sección enorme.
 */
function ajustarContexto(text, limite) {
	if (text.length <= limite) return text;
	const partes = text.split(/\n\n(?==== \d)/);
	const separadores = (partes.length - 1) * 2;
	const fija = (p) => /^=== (1|2)\. /.test(p);
	const tamFijo = partes.filter(fija).reduce((s, p) => s + p.length, 0);
	let presupuesto = limite - separadores - tamFijo;
	// Peso de cada sección en el reparto: el curso hospitalario (evoluciones) es lo más valioso.
	const PESOS = { 4: 3, 5: 1, 11: 1.5 };
	const pesoDe = (p) => PESOS[(p.match(/^=== (\d+)/) || [])[1]] || 1;
	let pendientes = partes
		.map((p, i) => ({ i, tam: p.length, peso: pesoDe(p) }))
		.filter((x) => !fija(partes[x.i]));
	const asignado = new Map();
	for (;;) {
		if (!pendientes.length) break;
		const sumaPesos = pendientes.reduce((s, x) => s + x.peso, 0);
		const cuotaDe = (x) => (presupuesto * x.peso) / sumaPesos;
		const chicas = pendientes.filter((x) => x.tam <= cuotaDe(x));
		if (!chicas.length) {
			pendientes.forEach((x) => asignado.set(x.i, Math.floor(cuotaDe(x))));
			break;
		}
		const ids = new Set(chicas.map((x) => x.i));
		chicas.forEach((x) => {
			asignado.set(x.i, x.tam);
			presupuesto -= x.tam;
		});
		pendientes = pendientes.filter((x) => !ids.has(x.i));
	}
	const out = partes.map((p, i) => (fija(p) ? p : reducirSeccion(p, asignado.get(i) ?? p.length)));
	const unido = out.join('\n\n');
	return unido.length > limite ? `${unido.slice(0, limite)}\n…[truncado]` : unido;
}

function buildFallbackDraft(dossier, contextText) {
	const p = dossier.paciente || {};
	const paciente = takeText(p.ApellidoYNombre || 'paciente', 80);
	const evo = evolucionesOrdenadas(dossier);
	const ultima = evo[evo.length - 1];
	const ultimaTxt = takeText(ultima?.Evolucion || ultima?.evolucion || '', 400);

	const bloques = [
		'IDENTIFICACIÓN',
		`Paciente ${paciente}${p.EdadAnios != null ? `, ${p.EdadAnios} años` : ''}${p.Sexo ? `, sexo ${p.Sexo}` : ''}.\nInternación visita ${dossier.numeroVisita}.${p.FechaAdmision ? `\nIngreso: ${p.FechaAdmision}${p.HoraAdmision ? ` ${p.HoraAdmision}` : ''}.` : ''}`,
		'MOTIVO DE HOSPITALIZACIÓN',
		'sin dato en HC',
		'ANTECEDENTES Y DIAGNÓSTICOS',
		p.DxVisita || p.DxPresuntivo
			? `Diagnóstico de ingreso/presuntivo: ${p.DxVisita || p.DxPresuntivo}.`
			: 'sin dato en HC',
		'CURSO HOSPITALARIO',
		ultimaTxt || 'Sin evoluciones médicas en el expediente.',
		'PROCEDIMIENTOS, ESTUDIOS Y TRATAMIENTOS',
		'sin dato en HC',
		'MEDICACIÓN E INDICACIONES',
		'sin dato en HC',
		'CONDICIÓN AL EGRESO',
		'Se contempla alta hospitalaria según evolución.',
		'INSTRUCCIONES Y SEGUIMIENTO',
		'Controles ambulatorios e indicaciones de alta a completar por el profesional.',
		'[Borrador automático — revise y complete antes de guardar.]',
	];

	const epicrisis = formatearEpicrisisVisual(bloques.join('\n\n'));

	return {
		epicrisis: epicrisis.slice(0, MAX_CUERPO_EPICRISIS),
		diagnostico: String(p.DxEgresoVisita || p.DxVisita || '').slice(0, 8),
		diagnosticoText: takeText(ultimaTxt || p.ObservacionesVisita || '', 500),
		fuente: 'plantilla',
		generadoConIA: false,
		aviso: 'OPENAI_API_KEY_EPICRISIS no configurada: se generó un borrador plantilla con datos de la internación.',
		contextoChars: contextText.length,
		disclaimer: DISCLAIMER_IA,
	};
}

/**
 * Normaliza el texto de epicrisis para lectura visual por secciones.
 */
function formatearEpicrisisVisual(texto) {
	let t = String(texto || '').replace(/\r\n/g, '\n').trim();
	if (!t) return '';

	// Si el modelo escapó saltos como texto literal \\n
	if (t.includes('\\n') && (t.match(/\n/g) || []).length < 2) {
		t = t.replace(/\\n/g, '\n');
	}

	const TITULO =
		'(?:IDENTIFICACI[OÓ]N|MOTIVO(?:\\s+DE\\s+HOSPITALIZACI[OÓ]N)?|ANTECEDENTES(?:\\s+Y\\s+DIAGN[OÓ]STICOS)?|HALLAZGOS(?:\\s+SIGNIFICATIVOS)?|CURSO(?:\\s+HOSPITALARIO)?|PROCEDIMIENTOS(?:[^:\\n]{0,40})?|ESTUDIOS(?:[^:\\n]{0,40})?|TRATAMIENTOS?|MEDICACI[OÓ]N(?:[^:\\n]{0,40})?|INDICACIONES(?:[^:\\n]{0,40})?|CONDICI[OÓ]N(?:\\s+AL\\s+EGRESO)?|EGRESO|DISPOSICI[OÓ]N|INSTRUCCIONES(?:[^:\\n]{0,40})?|SEGUIMIENTO|PLAN\\s+DE\\s+ALTA)';

	// Separar bloques numerados pegados: "...texto. 2) MOTIVO: ..."
	t = t.replace(new RegExp(`\\s+(\\d{1,2}\\s*[\\)\\.]\\s*${TITULO}\\s*:?)`, 'gi'), '\n\n$1');

	// Separar títulos EN MAYÚSCULAS pegados al párrafo anterior. Es sensible a mayúsculas a propósito:
	// con contenido más detallado aparecen rótulos internos ("Estudios: ...", "Medicación: ...")
	// que no deben convertirse en títulos de sección.
	t = t.replace(new RegExp(`\\s+(${TITULO}\\s*:)`, 'g'), '\n\n$1');

	// Título (+ número opcional) en su línea; el cuerpo debajo (solo mayúsculas, ver nota arriba)
	t = t.replace(
		new RegExp(`(^|\\n)((?:\\d{1,2}\\s*[\\)\\.]\\s*)?${TITULO}\\s*:)\\s*`, 'gm'),
		'$1$2\n',
	);

	// Repegar número huérfano con el título de la línea siguiente: "1)\nIDENTIFICACIÓN:"
	t = t.replace(/(^|\n)(\d{1,2}\s*[\)\.])\s*\n+([A-ZÁÉÍÓÚÑÜ])/g, '$1$2 $3');

	t = t
		.split('\n')
		.map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return t;
}

/** Corta en un límite de párrafo/línea/oración para no dejar frases a medias. */
function cortarEnLimite(texto, limite) {
	const t = String(texto || '');
	if (t.length <= limite) return t;
	const corte = t.slice(0, limite);
	const minimo = Math.floor(limite * 0.8);
	const puntos = [corte.lastIndexOf('\n\n'), corte.lastIndexOf('\n'), corte.lastIndexOf('. ')];
	const mejor = Math.max(...puntos);
	return (mejor >= minimo ? corte.slice(0, mejor + 1) : corte).trimEnd();
}

async function reunirExpediente(numeroVisita) {
	const idVisita = Number(numeroVisita);
	const today = new Date().toISOString().slice(0, 10);

	// Cada fuente con tope de tiempo y registro de lo que falló/omitió (se informa en la respuesta).
	const fuentesOmitidas = [];
	const fuente = (nombre, factory, vacio) => {
		let timer;
		const tope = new Promise((resolve) => {
			timer = setTimeout(() => {
				fuentesOmitidas.push(`${nombre} (tiempo)`);
				resolve(vacio);
			}, TOPE_FUENTE_MS);
		});
		const real = Promise.resolve()
			.then(factory)
			.catch((e) => {
				fuentesOmitidas.push(`${nombre} (${String(e?.message || e).slice(0, 60)})`);
				return vacio;
			});
		return Promise.race([real, tope]).finally(() => clearTimeout(timer));
	};

	const [paciente, payload, interconsultas, laboratorios, movimientos, controles, evoEnf, practicas, indicaciones] =
		await Promise.all([
			obtenerPacienteEnriquecido(idVisita).catch(() => null),
			fuente(
				'expediente',
				() =>
					admissionSearchService.exportarAdmisionSelectivo(idVisita, {
						sections: SECTIONS_EXPORT_IA,
						exportAll: true,
					}),
				null,
			),
			fuente('interconsultas', () => interconsultasService.listarPorVisita(idVisita), []),
			fuente('laboratorios', () => laboratoriosService.obtenerExamenesPorVisita(idVisita), []),
			fuente('movimientos', () => visitaMovimientosService.obtenerMovimientosVisita(idVisita), []),
			fuente('controles', () => obtenerControlesResumen(idVisita), []),
			fuente('enfermeria', () => obtenerEvolucionEnfermeriaResumen(idVisita), []),
			fuente('practicas', () => admissionSearchService.obtenerPracticasResumenPorVisita(idVisita), []),
			fuente(
				'indicaciones',
				() => indicacionesService.getIndicacionesByVisita(idVisita, { incluirSuspendidas: true, sinCadena: true }),
				[],
			),
		]);

	if (!paciente && !payload) return null;

	const egreso =
		(movimientos || []).find((m) => Number(m.FechaEgreso) > 0 || m.FechaEgresoISO) ||
		(movimientos || [])[0] ||
		null;

	return {
		numeroVisita: idVisita,
		paciente: { ...(payload?.admision || {}), ...(paciente || {}) },
		egreso,
		movimientos: movimientos || [],
		historialClinico: payload?.historialClinico || [],
		evolucionesMedicas: payload?.evolucionesMedicas || [],
		indicaciones: indicaciones || [],
		medicamentos: payload?.medicamentos || [],
		estudios: payload?.estudios || [],
		protocolos: payload?.protocolos || [],
		practicasPaciente: practicas || [],
		adjuntos: payload?.adjuntos || [],
		interconsultas: interconsultas || [],
		laboratorios: laboratorios || [],
		controles: controles || [],
		evolucionEnfermeria: evoEnf || [],
		fuentesOmitidas,
		_today: today,
	};
}

// ---------------------------------------------------------------------------------------------
// Internaciones largas: condensar evoluciones por tramos (map) y redactar con las notas (reduce)
// ---------------------------------------------------------------------------------------------

/** Suma el consumo de varias llamadas para registrarlo como una sola operación. */
function crearAcumuladorUso() {
	const acc = {
		modelo: null,
		usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
		llamadas: 0,
	};
	const onUsage = (u) => {
		if (!u?.usage) return;
		acc.modelo = u.modelo || acc.modelo;
		acc.llamadas += 1;
		acc.usage.prompt_tokens += Number(u.usage.prompt_tokens) || 0;
		acc.usage.completion_tokens += Number(u.usage.completion_tokens) || 0;
		acc.usage.total_tokens += Number(u.usage.total_tokens) || 0;
		acc.usage.prompt_tokens_details.cached_tokens += Number(u.usage.prompt_tokens_details?.cached_tokens) || 0;
	};
	return { acc, onUsage };
}

/** Agrupa evoluciones consecutivas en tramos de hasta `maxChars` caracteres. */
function dividirEnTramos(items, maxChars) {
	const tramos = [];
	let actual = null;
	for (const it of items) {
		const largo = it.linea.length + 1;
		if (!actual || (actual.chars + largo > maxChars && actual.items.length)) {
			actual = { items: [], chars: 0 };
			tramos.push(actual);
		}
		actual.items.push(it);
		actual.chars += largo;
	}
	return tramos.map((t) => ({
		desde: t.items[0].fecha,
		hasta: t.items[t.items.length - 1].fecha,
		n: t.items.length,
		texto: t.items.map((i) => i.linea).join('\n'),
	}));
}

async function mapConConcurrencia(lista, concurrencia, fn) {
	const out = new Array(lista.length);
	let i = 0;
	const worker = async () => {
		while (i < lista.length) {
			const idx = i++;
			out[idx] = await fn(lista[idx], idx);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrencia, lista.length) }, worker));
	return out;
}

/**
 * Condensa las evoluciones médicas en notas por período conservando los datos concretos.
 * Si un tramo falla, se usa el texto original recortado de ese tramo (nunca se pierde el período).
 */
async function condensarEvoluciones(dossier, { apiKey, model, onUsage }) {
	const evo = evolucionesOrdenadas(dossier);
	if (!evo.length) return null;

	let items = evo.map((e, i) => ({
		fecha: ymd(e.FechaEv || e.fechaEv),
		linea: lineaEvolucion(e, i + 1, PERFIL_EPICRISIS.evoChars),
	}));
	let tramos = dividirEnTramos(items, TRAMO_EVOLUCIONES_CHARS);
	if (tramos.length > MAX_TRAMOS) {
		tramos = dividirEnTramos(items, Math.ceil(items.reduce((s, x) => s + x.linea.length + 1, 0) / MAX_TRAMOS) + 500);
	}

	let fallidos = 0;
	const notas = await mapConConcurrencia(tramos, CONCURRENCIA_TRAMOS, async (t) => {
		// El total de notas no debe pasar PRESUPUESTO_NOTAS_CHARS (si no, ocupan todo el contexto).
		const maxChars = Math.min(
			7000,
			Math.max(1500, Math.round(t.texto.length * 0.32)),
			Math.floor(PRESUPUESTO_NOTAS_CHARS / tramos.length),
		);
		try {
			const json = await botOpenai.chatJson({
				apiKey,
				model,
				onUsage,
				system: [
					'Sos un médico que prepara NOTAS DE TRABAJO para redactar la epicrisis de un paciente internado.',
					'Recibís un tramo cronológico de evoluciones médicas. Extraé TODA la información clínica concreta, en orden cronológico, una idea por línea, empezando cada línea con la fecha (dd/mm).',
					'Conservá textuales: valores y unidades, dosis, nombres de fármacos, estudios y procedimientos con su resultado/hallazgo, diagnósticos, interconsultas y su conclusión, cambios de conducta o tratamiento, complicaciones, traslados y estado clínico al comienzo y al final del tramo.',
					'Podés agrupar solo repeticiones sin información nueva (ej. "05 al 08/03: sin cambios, afebril, tolera VO"). No omitas ningún hecho clínico distinto. No interpretes ni agregues nada que no esté escrito.',
					`Máximo ${maxChars} caracteres. Respondé JSON: {"notas": "texto con saltos de línea"}.`,
				].join('\n'),
				messages: [
					{
						role: 'user',
						content: `Evoluciones del ${dmy(t.desde)} al ${dmy(t.hasta)} (${t.n} registros):\n\n${t.texto}`,
					},
				],
				temperature: 0.1,
				maxTokens: Math.ceil(maxChars / 2.3) + 300,
			});
			const txt = String(json.notas || json.texto || '').trim();
			if (!txt) throw new Error('sin notas');
			return txt;
		} catch {
			fallidos += 1;
			return t.texto
				.split('\n')
				.map((l) => takeText(l, 600))
				.join('\n');
		}
	});

	const texto = tramos
		.map((t, i) => `--- Período ${dmy(t.desde)} a ${dmy(t.hasta)} (${t.n} evoluciones) ---\n${notas[i]}`)
		.join('\n\n');
	return { texto, tramos: tramos.length, fallidos, evoluciones: evo.length };
}

// ---------------------------------------------------------------------------------------------
// Redacción final
// ---------------------------------------------------------------------------------------------

function promptSistemaEpicrisis() {
	const limite = MAX_CUERPO_EPICRISIS;
	const objetivoMin = Math.round(limite * 0.7);
	return [
		'Sos un médico de planta que redacta una EPICRISIS / RESUMEN DE ALTA hospitalaria en español argentino, para que otro profesional pueda continuar la atención del paciente SIN tener que abrir la historia clínica.',
		'',
		'OBJETIVO: una epicrisis DETALLADA y rica en datos reales del expediente, no un resumen genérico. Preferí siempre el dato concreto (fecha, valor con unidad, dosis, nombre del fármaco/estudio/procedimiento, hallazgo, resultado) a una frase general.',
		`EXTENSIÓN: el campo "epicrisis" admite como máximo ${limite} caracteres (límite del sistema; superarlo corta el final). Si el expediente tiene material suficiente, aprovechá entre ${objetivoMin} y ${limite} caracteres. Si el expediente es acotado, la extensión es proporcional, pero incluí TODO lo registrado y no rellenes ni inventes.`,
		'',
		'ESTRUCTURA OBLIGATORIA (si falta un dato, escribí "sin dato en HC" en esa sección; no inventes):',
		'IDENTIFICACIÓN — nombre, edad, sexo, documento, HC, fecha de ingreso y egreso, días de internación (usá el valor calculado del expediente), sectores/traslados.',
		'MOTIVO DE HOSPITALIZACIÓN — motivo de consulta y enfermedad actual con su cronología (inicio, síntomas, tratamientos previos).',
		'ANTECEDENTES Y DIAGNÓSTICOS — antecedentes personales y medicación habitual, hallazgos del examen físico y signos vitales al ingreso, diagnóstico de ingreso, presuntivo/diferencial y diagnóstico de egreso.',
		'CURSO HOSPITALARIO — relato CRONOLÓGICO con fechas (dd/mm) por etapas o días: cambios clínicos, conductas tomadas, complicaciones, traslados, interconsultas (servicio, motivo y conclusión) y cambios de tratamiento. No omitas eventos relevantes; en internaciones largas cubrí TODO el período de principio a fin, no solo el inicio o el final.',
		'PROCEDIMIENTOS, ESTUDIOS Y TRATAMIENTOS — cada procedimiento/protocolo (fecha, técnica, hallazgos, diagnóstico pre/post), cada estudio de imagen o complementario con fecha y conclusión del informe, laboratorio con valores y tendencia (primer y último valor, alterados con su unidad) y tratamientos instaurados.',
		'MEDICACIÓN E INDICACIONES — fármacos administrados con dosis, frecuencia y período, indicando los suspendidos; dieta, cuidados y otras indicaciones vigentes.',
		'CONDICIÓN AL EGRESO — estado clínico, últimos signos vitales y examen disponible, disposición (alta, traslado, etc.) y diagnóstico final.',
		'INSTRUCCIONES Y SEGUIMIENTO — indicaciones al alta, controles, estudios o interconsultas pendientes de resultado y pautas de alarma SOLO si figuran en el expediente.',
		'',
		'REGLAS DE CONTENIDO:',
		'- Usá SOLO información del expediente. No inventes fármacos, dosis, estudios, valores, fechas ni diagnósticos. No completes con "conocimiento general".',
		'- Copiá valores, dosis, unidades y fechas exactamente como figuran.',
		'- Prohibido escribir frases vacías como "se realizaron estudios", "recibió tratamiento" o "evolucionó favorablemente" sin decir cuáles estudios, qué tratamiento y qué mejoró.',
		'- Si hay datos contradictorios o dudosos en el expediente, indicalo en lugar de elegir uno.',
		'- Podés usar abreviaturas médicas habituales y viñetas con guion ("- ") para ganar densidad.',
		'- Datos pendientes o sin resultado cargado: mencionalos como pendientes.',
		'',
		'FORMATO VISUAL OBLIGATORIO del campo "epicrisis":',
		'- Usá saltos de línea reales dentro del string JSON (carácter newline).',
		'- Cada título de sección en MAYÚSCULAS, solo en su línea.',
		'- Después del título, el contenido en párrafo(s) o viñetas debajo.',
		'- Una línea en blanco entre secciones.',
		'- NUNCA escribas toda la epicrisis en un solo párrafo corrido.',
		'- Dentro de las secciones no escribas subtítulos en MAYÚSCULAS terminados en ":"; usá viñetas.',
		'Ejemplo de formato:',
		'IDENTIFICACIÓN\\nPaciente ...\\n\\nMOTIVO DE HOSPITALIZACIÓN\\n...\\n\\nANTECEDENTES Y DIAGNÓSTICOS\\n...',
		'',
		'Estilo: formal, clínico, denso en información.',
		'Respondé JSON con: epicrisis (texto formateado con saltos de línea), diagnostico (CIE-10 ≤8 chars o vacío), diagnosticoText (diagnóstico final en texto libre, máx. 500 caracteres).',
	].join('\n');
}

/** Si el modelo se pasó del espacio disponible, pide una versión más compacta SIN perder datos. */
async function ajustarLongitud(texto, opts) {
	const limite = MAX_CUERPO_EPICRISIS;
	if (texto.length <= limite) return { texto, ajustada: false };
	try {
		const json = await botOpenai.chatJson({
			apiKey: opts.apiKey,
			model: opts.model,
			onUsage: opts.onUsage,
			system: [
				`Compactá esta epicrisis a un máximo de ${limite} caracteres (hoy tiene ${texto.length}).`,
				'Conservá TODOS los datos clínicos concretos (fechas, valores con unidad, dosis, fármacos, estudios y resultados, procedimientos, diagnósticos). Eliminá solo redundancias, conectores y frases de relleno; podés usar abreviaturas médicas y viñetas.',
				'Mantené exactamente las mismas secciones, títulos en MAYÚSCULAS y formato con saltos de línea. No agregues información nueva.',
				'Respondé JSON: {"epicrisis": "..."}.',
			].join('\n'),
			messages: [{ role: 'user', content: texto }],
			temperature: 0.1,
			maxTokens: 4000,
		});
		const t = formatearEpicrisisVisual(String(json.epicrisis || ''));
		if (t && t.length < texto.length) return { texto: cortarEnLimite(t, limite), ajustada: true };
	} catch {
		/* se corta en un límite de párrafo más abajo */
	}
	return { texto: cortarEnLimite(texto, limite), ajustada: true };
}

async function generarBorrador(numeroVisita) {
	const idVisita = Number(numeroVisita);
	if (!Number.isFinite(idVisita) || idVisita <= 0) {
		const err = new Error('numeroVisita inválido');
		err.statusCode = 400;
		throw err;
	}

	const dossier = await reunirExpediente(idVisita);
	if (!dossier) {
		const err = new Error('No se encontró la admisión / visita');
		err.statusCode = 404;
		throw err;
	}

	let contextText = buildContextText(dossier, { perfil: PERFIL_EPICRISIS });
	// Tamaño real del expediente (sin recortes) para decidir si hay que condensar evoluciones.
	const tamanoCompleto = buildContextText(dossier, { perfil: PERFIL_EPICRISIS, sinAjuste: true }).length;

	if (!botOpenai.isEpicrisisConfigured()) {
		return buildFallbackDraft(dossier, contextText);
	}

	const { acc, onUsage } = crearAcumuladorUso();
	const apiKey = botOpenai.getEpicrisisApiKey();
	const model = botOpenai.getEpicrisisModel();
	const llamada = { apiKey, model, onUsage };
	let condensado = null;

	try {
		// Internación larga: condensar evoluciones por tramos en vez de truncar u omitir las más antiguas.
		if (tamanoCompleto > UMBRAL_CONDENSAR_CHARS && (dossier.evolucionesMedicas || []).length > 1) {
			condensado = await condensarEvoluciones(dossier, llamada);
			if (condensado) {
				contextText = buildContextText(dossier, {
					perfil: PERFIL_EPICRISIS,
					evolucionesTexto: condensado.texto,
					evolucionesTitulo: `CURSO HOSPITALARIO — NOTAS CLÍNICAS POR PERÍODO (condensadas de ${condensado.evoluciones} evoluciones, sin perder datos)`,
				});
			}
		}

		const json = await botOpenai.chatJson({
			...llamada,
			system: promptSistemaEpicrisis(),
			messages: [
				{
					role: 'user',
					content: `Redactá la epicrisis de alta con el expediente completo. Incluí los datos concretos (fechas, valores, dosis, resultados) y respetá el formato visual por secciones con saltos de línea:\n\n${contextText}`,
				},
			],
			temperature: 0.2,
			maxTokens: 4000,
		});

		const bruto = formatearEpicrisisVisual(String(json.epicrisis || json.texto || ''));
		if (!bruto) throw new Error('La IA no devolvió el texto de la epicrisis');
		const { texto: epicrisisFmt, ajustada } = await ajustarLongitud(bruto, llamada);

		return {
			epicrisis: epicrisisFmt,
			diagnostico: String(json.diagnostico || '').trim().slice(0, 8),
			diagnosticoText: String(json.diagnosticoText || json.diagnostico_texto || '')
				.trim()
				.slice(0, 8000),
			fuente: 'openai',
			generadoConIA: true,
			modelo: model,
			uso: acc.llamadas ? { modelo: acc.modelo || model, usage: acc.usage } : null,
			llamadasIa: acc.llamadas,
			contextoChars: contextText.length,
			condensado: condensado
				? { tramos: condensado.tramos, tramosFallidos: condensado.fallidos, evoluciones: condensado.evoluciones }
				: null,
			ajustadaPorLongitud: ajustada,
			fuentesOmitidas: dossier.fuentesOmitidas || [],
			disclaimer: DISCLAIMER_IA,
			aviso: 'Borrador generado con IA a partir del expediente completo. Debe ser revisado por el profesional antes de guardar.',
		};
	} catch (e) {
		const fallback = buildFallbackDraft(dossier, contextText);
		fallback.fuente = 'plantilla_fallback';
		fallback.aviso = `IA no disponible (${e.message}). Se usó borrador plantilla.`;
		fallback.uso = acc.llamadas ? { modelo: acc.modelo || model, usage: acc.usage } : null;
		return fallback;
	}
}

function asegurarDisclaimerEnTexto(texto, generadoConIA) {
	if (!generadoConIA) return String(texto || '');
	const body = String(texto || '').trim();
	if (body.includes('DESLINDE DE RESPONSABILIDAD (asistencia por IA)')) return body;
	// El deslinde nunca debe quedar cortado por el límite de la columna: se recorta el cuerpo, no el deslinde.
	return `${body.slice(0, MAX_CUERPO_EPICRISIS)}\n\n${DISCLAIMER_IA}`;
}

module.exports = {
	generarBorrador,
	reunirExpediente,
	buildContextText,
	SECTIONS_IA,
	DISCLAIMER_IA,
	asegurarDisclaimerEnTexto,
	formatearEpicrisisVisual,
	// perfiles y piezas internas (también usadas por los tests)
	PERFIL_EPICRISIS,
	PERFIL_RESUMEN,
	MAX_CUERPO_EPICRISIS,
	consolidarMedicacion,
	consolidarIndicaciones,
	resumirControles,
	dividirEnTramos,
	muestrear,
	cortarEnLimite,
	ajustarContexto,
	reducirSeccion,
};
