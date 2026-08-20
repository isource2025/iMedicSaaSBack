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
 */
const { executeQuery } = require('../models/db');
const admissionSearchService = require('./admissionSearch.service');
const interconsultasService = require('./interconsultas.service');
const laboratoriosService = require('./laboratorios.service');
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

const MAX_CONTEXT_CHARS = 90000;

function takeText(v, max = 400) {
	const s = String(v ?? '')
		.replace(/\s+/g, ' ')
		.trim();
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

async function obtenerControlesResumen(numeroVisita) {
	try {
		return await executeQuery(
			`
      SELECT TOP 30
        CONVERT(varchar(10), DATEADD(day, NULLIF(FechaControl, 0), '1800-12-28'), 23) AS Fecha,
        CONVERT(varchar(5), DATEADD(ms, (NULLIF(HoraControl, 0) - 1) * 10, 0), 108) AS Hora,
        Pulso, Maximo, Minimo, FrecuenciaRespiratoria, Axilar, Hgt, Saturometria, Peso, Talla,
        LTRIM(RTRIM(Observaciones)) AS Observaciones
      FROM dbo.imInterCtrlFrecuente
      WHERE NumeroVisita = @param0
      ORDER BY FechaControl DESC, HoraControl DESC
      `,
			[{ value: Number(numeroVisita) }],
		);
	} catch {
		return [];
	}
}

async function obtenerEvolucionEnfermeriaResumen(numeroVisita) {
	try {
		return await executeQuery(
			`
      SELECT TOP 20
        CONVERT(varchar(10), DATEADD(day, NULLIF(FechaControl, 0), '1800-12-28'), 23) AS Fecha,
        CONVERT(varchar(5), DATEADD(ms, (NULLIF(HoraControl, 0) - 1) * 10, 0), 108) AS Hora,
        LTRIM(RTRIM(Evolucion)) AS Evolucion
      FROM dbo.imInterCtrlEvolucion
      WHERE NumeroVisita = @param0
      ORDER BY FechaControl DESC, HoraControl DESC
      `,
			[{ value: Number(numeroVisita) }],
		);
	} catch {
		return [];
	}
}

function buildHcBlock(hcRows) {
	const lines = [];
	const list = Array.isArray(hcRows) ? hcRows : [];
	if (!list.length) {
		lines.push('(sin HC de ingreso)');
		return lines.join('\n');
	}

	list.slice(0, 3).forEach((h, idx) => {
		lines.push(`--- HC #${idx + 1} ${h.FechaFormateada || h.Fecha || ''} ${h.HoraFormateada || ''} ---`);
		pushIf(lines, 'Profesional', h.ProfesionalNombre);
		pushIf(lines, 'Sector', h.SectorDescripcion || h.IdSector);
		pushIf(lines, 'Motivo de consulta / hospitalización', h.MotivoConsulta, 800);
		pushIf(lines, 'Enfermedad actual / HPI', h.EnfermedadActual, 2000);
		pushIf(lines, 'Antecedentes / mod. médica', h.ModMedica, 800);
		pushIf(lines, 'Semiología', h.Semiologia, 800);
		pushIf(lines, 'Impresión diagnóstica', h.IMPRESIONDIAGNOSTICA, 1500);
		pushIf(lines, 'Exámenes complementarios (texto HC)', h.EXAMENCOMPLEMENTARIO, 1200);
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
			180,
		);
		if (planesDx.length) lines.push(`Plan diagnóstico: ${planesDx.join(' | ')}`);

		const planesTx = [];
		for (let i = 1; i <= 15; i++) {
			const t = takeText(h[`PT_${i}`], 180);
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
			250,
		);
		if (examBrief.length) lines.push(`Examen físico (extractos): ${examBrief.join(' | ')}`);
	});

	return lines.join('\n');
}

function buildContextText(dossier) {
	const lines = [];
	const p = dossier.paciente || {};
	const egreso = dossier.egreso || {};

	lines.push('=== 1. IDENTIFICACIÓN / INTERNACIÓN ===');
	pushIf(lines, 'Visita', dossier.numeroVisita);
	pushIf(lines, 'Paciente', p.ApellidoYNombre);
	pushIf(lines, 'Documento', `${p.TipoDocumento || ''} ${p.NumeroDocumento || ''}`.trim());
	pushIf(lines, 'HC', p.NumeroHC);
	pushIf(lines, 'Sexo', p.Sexo);
	pushIf(lines, 'Fecha nacimiento', p.FechaNacimiento);
	pushIf(lines, 'Edad (años)', p.EdadAnios);
	pushIf(lines, 'Grupo/factor', `${p.GrupoSangre || ''} ${p.FactorSangre || ''}`.trim());
	pushIf(lines, 'Ingreso', `${p.FechaAdmision || ''} ${p.HoraAdmision || ''}`.trim());
	pushIf(lines, 'Dx visita', p.DxVisita);
	pushIf(lines, 'Dx presuntivo', p.DxPresuntivo);
	pushIf(lines, 'Dx diferencial', p.DxDiferencial);
	pushIf(lines, 'Dx egreso (visita)', p.DxEgresoVisita);
	pushIf(lines, 'Observaciones visita', p.ObservacionesVisita, 600);

	lines.push('\n=== 2. EGRESO / DISPOSICIÓN ===');
	if (egreso && (egreso.FechaEgresoISO || egreso.FechaEgreso)) {
		pushIf(lines, 'Fecha egreso', egreso.FechaEgresoISO || egreso.FechaEgreso);
		pushIf(lines, 'Hora egreso', egreso.HoraEgresoISO || egreso.HoraEgreso);
		pushIf(lines, 'Disposición egreso', egreso.DisposicionEgreso);
		pushIf(lines, 'Diagnóstico egreso (movimiento)', egreso.Diagnostico, 500);
		pushIf(lines, 'Sector/cama', `${egreso.NombreSector || ''} / ${egreso.NombreCama || ''}`.trim());
	} else {
		lines.push('(sin egreso registrado aún — redactar como borrador de alta proyectada)');
	}

	lines.push('\n=== 3. HC INGRESO (motivo, hallazgos, planes) ===');
	lines.push(buildHcBlock(dossier.historialClinico));

	const evo = Array.isArray(dossier.evolucionesMedicas) ? dossier.evolucionesMedicas : [];
	lines.push(`\n=== 4. CURSO HOSPITALARIO — EVOLUCIONES MÉDICAS (${evo.length}) ===`);
	if (!evo.length) lines.push('(sin evoluciones)');
	evo.slice(0, 60).forEach((e, i) => {
		lines.push(
			`${i + 1}. [${e.FechaEv || e.fechaEv || ''} ${e.HoraEv || e.horaEv || ''}] ` +
				`${takeText(e.ProfesionalNombreCompleto || e.profesionalNombreCompleto || e.EspecialidadDescripcion || '', 50)} ` +
				`sec=${takeText(e.IdSector || e.idSector, 8)}: ${takeText(e.Evolucion || e.evolucion, 700)}`,
		);
	});

	const ics = Array.isArray(dossier.interconsultas) ? dossier.interconsultas : [];
	lines.push(`\n=== 5. INTERCONSULTAS (${ics.length}) ===`);
	if (!ics.length) lines.push('(sin interconsultas)');
	ics.slice(0, 30).forEach((ic, i) => {
		lines.push(
			`${i + 1}. [${ic.FechaSolicitud || ''} ${ic.HoraSolicitud || ''}] ` +
				`${takeText(ic.ServicioDestino || ic.SectorReceptor || ic.IdSectorReceptor || ic.Especialidad, 40)}`,
		);
		lines.push(`   Pedido: ${takeText(ic.Motivo || ic.Notas || ic.NotasObservacion || ic.motivo, 400)}`);
		const resp = takeText(ic.Respuesta || ic.TextoResultado || ic.respuesta, 600);
		lines.push(`   Respuesta: ${resp || '(sin respuesta)'}`);
	});

	const ind = Array.isArray(dossier.indicaciones) ? dossier.indicaciones : [];
	lines.push(`\n=== 6. INDICACIONES / TRATAMIENTO (${ind.length}) ===`);
	if (!ind.length) lines.push('(sin indicaciones)');
	ind.slice(0, 80).forEach((r, i) => {
		const desc =
			r.descripcion ||
			r.DescripcionIndicacion ||
			r.Indicacion ||
			r.indicacion ||
			r.Descripcion ||
			'';
		const tipo = r.tipo || r.TipoIndicacion || r.Tipo || '';
		lines.push(`${i + 1}. [${tipo}] ${takeText(desc, 220)}`);
		if (Array.isArray(r.indicacionesHijas)) {
			r.indicacionesHijas.slice(0, 10).forEach((h) => {
				lines.push(
					`   - ${takeText(h.descripcion || h.DescripcionIndicacion || h.AliasMedicamento, 200)}`,
				);
			});
		}
	});

	const meds = Array.isArray(dossier.medicamentos) ? dossier.medicamentos : [];
	lines.push(`\n=== 7. MEDICACIÓN SUMINISTRADA / CONTROL (${meds.length}) ===`);
	if (!meds.length) lines.push('(sin medicación registrada)');
	meds.slice(0, 60).forEach((m, i) => {
		const nombre =
			m.Nombre || m.nombre || m.Medicamento || m.Descripcion || m.AliasMedicamento || '';
		const extra = [m.Dosis, m.Via, m.Frecuencia, m.Fecha, m.Hora].filter(Boolean).join(' ');
		lines.push(`${i + 1}. ${takeText(nombre, 160)}${extra ? ` | ${takeText(extra, 80)}` : ''}`);
	});

	const est = Array.isArray(dossier.estudios) ? dossier.estudios : [];
	lines.push(`\n=== 8. ESTUDIOS / PEDIDOS (${est.length}) ===`);
	if (!est.length) lines.push('(sin estudios)');
	est.slice(0, 40).forEach((e, i) => {
		const nombre =
			e.PracticaDescripcion ||
			e.Descripcion ||
			e.descripcion ||
			e.PracticaSolicitada ||
			e.Nombre ||
			e.Estudio ||
			'';
		lines.push(
			`${i + 1}. ${takeText(nombre, 200)} | estado=${takeText(e.Estado || e.EstadoWorkflow || e.estado, 40)}`,
		);
		const pedido = takeText(e.PedidoEstudio || e.NotasObservacion || e.Notas || e.pedido, 400);
		if (pedido) lines.push(`   Pedido: ${pedido}`);
		const resp = takeText(e.ResultadoEstudio || e.TextoResultado || e.resultado || e.Respuesta, 600);
		lines.push(`   Respuesta: ${resp || '(sin respuesta)'}`);
	});

	const labs = Array.isArray(dossier.laboratorios) ? dossier.laboratorios : [];
	lines.push(`\n=== 9. LABORATORIOS / RESULTADOS (${labs.length}) ===`);
	if (!labs.length) lines.push('(sin laboratorios)');
	labs.slice(0, 50).forEach((l, i) => {
		const nombre = l.Descripcion || l.descripcion || l.Nombre || l.Examen || '';
		const res = l.Resultado || l.resultado || l.Valor || '';
		lines.push(`${i + 1}. ${takeText(nombre, 120)}${res ? ` = ${takeText(res, 120)}` : ''}`);
	});

	const prac = Array.isArray(dossier.practicasPaciente) ? dossier.practicasPaciente : [];
	lines.push(`\n=== 10. PRÁCTICAS / PROCEDIMIENTOS (${prac.length}) ===`);
	if (!prac.length) lines.push('(sin prácticas)');
	prac.slice(0, 40).forEach((pItem, i) => {
		const nombre =
			pItem.Descripcion || pItem.descripcion || pItem.DescPractica || pItem.Practica || '';
		lines.push(`${i + 1}. ${takeText(nombre, 200)}`);
	});

	const prot = Array.isArray(dossier.protocolos) ? dossier.protocolos : [];
	lines.push(`\n=== 11. PROTOCOLOS (${prot.length}) ===`);
	if (!prot.length) lines.push('(sin protocolos)');
	prot.slice(0, 25).forEach((pItem, i) => {
		const nombre = pItem.Descripcion || pItem.descripcion || pItem.Nombre || pItem.Protocolo || '';
		lines.push(`${i + 1}. ${takeText(nombre, 200)}`);
	});

	const ctrl = Array.isArray(dossier.controles) ? dossier.controles : [];
	lines.push(`\n=== 12. CONTROLES FRECUENTES (últimos ${Math.min(ctrl.length, 25)}) ===`);
	if (!ctrl.length) lines.push('(sin controles)');
	ctrl.slice(0, 25).forEach((c, i) => {
		lines.push(
			`${i + 1}. [${c.Fecha || ''} ${c.Hora || ''}] PA ${c.Maximo || '-'}/${c.Minimo || '-'} ` +
				`FC ${c.Pulso || '-'} FR ${c.FrecuenciaRespiratoria || '-'} Tax ${c.Axilar || '-'} ` +
				`Sat ${c.Saturometria || '-'} HGT ${c.Hgt || '-'} ${takeText(c.Observaciones, 80)}`,
		);
	});

	const enf = Array.isArray(dossier.evolucionEnfermeria) ? dossier.evolucionEnfermeria : [];
	lines.push(`\n=== 13. EVOLUCIÓN ENFERMERÍA (${enf.length}) ===`);
	if (!enf.length) lines.push('(sin evoluciones de enfermería)');
	enf.slice(0, 20).forEach((e, i) => {
		lines.push(`${i + 1}. [${e.Fecha || ''} ${e.Hora || ''}] ${takeText(e.Evolucion, 350)}`);
	});

	const adj = Array.isArray(dossier.adjuntos) ? dossier.adjuntos : [];
	lines.push(`\n=== 14. ADJUNTOS (metadatos, ${adj.length}) ===`);
	if (!adj.length) lines.push('(sin adjuntos)');
	adj.slice(0, 30).forEach((a, i) => {
		lines.push(
			`${i + 1}. ${takeText(a.NombreArchivo || a.nombreArchivo, 80)} ` +
				`tipo=${takeText(a.TipoImagenNombre || a.TipoArchivo, 40)} ` +
				`fecha=${takeText(a.FechaCarga, 20)}`,
		);
	});

	const text = lines.join('\n');
	return text.length > MAX_CONTEXT_CHARS ? text.slice(0, MAX_CONTEXT_CHARS) + '\n…[truncado]' : text;
}

function buildFallbackDraft(dossier, contextText) {
	const p = dossier.paciente || {};
	const paciente = takeText(p.ApellidoYNombre || 'paciente', 80);
	const evo = Array.isArray(dossier.evolucionesMedicas) ? dossier.evolucionesMedicas : [];
	const ultima = evo[0];
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
		epicrisis: epicrisis.slice(0, 7500),
		diagnostico: String(p.DxEgresoVisita || p.DxVisita || '').slice(0, 8),
		diagnosticoText: takeText(ultimaTxt || p.ObservacionesVisita || '', 500),
		fuente: 'plantilla',
		generadoConIA: false,
		aviso: 'OPENAI_API_KEY no configurada: se generó un borrador plantilla con datos de la internación.',
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

	// Separar títulos en mayúsculas sin número, pegados al párrafo anterior
	t = t.replace(new RegExp(`\\s+(${TITULO}\\s*:)`, 'gi'), '\n\n$1');

	// Título (+ número opcional) en su línea; el cuerpo debajo
	t = t.replace(
		new RegExp(`(^|\\n)((?:\\d{1,2}\\s*[\\)\\.]\\s*)?${TITULO}\\s*:)\\s*`, 'gim'),
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

async function reunirExpediente(numeroVisita) {
	const idVisita = Number(numeroVisita);
	const today = new Date().toISOString().slice(0, 10);

	const [paciente, payload, interconsultas, laboratorios, movimientos, controles, evoEnf] =
		await Promise.all([
			obtenerPacienteEnriquecido(idVisita).catch(() => null),
			admissionSearchService
				.exportarAdmisionSelectivo(idVisita, { sections: SECTIONS_IA, exportAll: true })
				.catch(() => null),
			interconsultasService.listarPorVisita(idVisita).catch(() => []),
			laboratoriosService.obtenerExamenesPorVisita(idVisita).catch(() => []),
			visitaMovimientosService.obtenerMovimientosVisita(idVisita).catch(() => []),
			obtenerControlesResumen(idVisita),
			obtenerEvolucionEnfermeriaResumen(idVisita),
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
		historialClinico: payload?.historialClinico || [],
		evolucionesMedicas: payload?.evolucionesMedicas || [],
		indicaciones: payload?.indicaciones || [],
		medicamentos: payload?.medicamentos || [],
		estudios: payload?.estudios || [],
		protocolos: payload?.protocolos || [],
		practicasPaciente: payload?.practicasPaciente || [],
		adjuntos: payload?.adjuntos || [],
		interconsultas: interconsultas || [],
		laboratorios: laboratorios || [],
		controles: controles || [],
		evolucionEnfermeria: evoEnf || [],
		_today: today,
	};
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

	const contextText = buildContextText(dossier);

	if (!botOpenai.isConfigured()) {
		return buildFallbackDraft(dossier, contextText);
	}

	const system = [
		'Sos un médico de planta que redacta una EPICRISIS / RESUMEN DE ALTA hospitalaria en español argentino.',
		'Estructura obligatoria (si falta un dato, escribí "sin dato en HC" en esa sección; no inventes):',
		'IDENTIFICACIÓN',
		'MOTIVO DE HOSPITALIZACIÓN',
		'ANTECEDENTES Y DIAGNÓSTICOS',
		'CURSO HOSPITALARIO',
		'PROCEDIMIENTOS, ESTUDIOS Y TRATAMIENTOS',
		'MEDICACIÓN E INDICACIONES',
		'CONDICIÓN AL EGRESO',
		'INSTRUCCIONES Y SEGUIMIENTO',
		'FORMATO VISUAL OBLIGATORIO del campo "epicrisis":',
		'- Usá saltos de línea reales dentro del string JSON (carácter newline).',
		'- Cada título de sección en MAYÚSCULAS, solo en su línea.',
		'- Después del título, el contenido en párrafo(s) debajo.',
		'- Una línea en blanco entre secciones.',
		'- NUNCA escribas toda la epicrisis en un solo párrafo corrido.',
		'Ejemplo de formato:',
		'IDENTIFICACIÓN\\nPaciente ...\\n\\nMOTIVO DE HOSPITALIZACIÓN\\n...\\n\\nANTECEDENTES Y DIAGNÓSTICOS\\n...',
		'Usá SOLO la información del expediente. No inventes fármacos, estudios, fechas ni diagnósticos.',
		'Estilo: formal, conciso, clínico.',
		'Respondé JSON con: epicrisis (texto formateado con saltos de línea, máx ~4500 chars), diagnostico (CIE-10 ≤8 chars o vacío), diagnosticoText (dx libre).',
	].join('\n');

	try {
		const json = await botOpenai.chatJson({
			system,
			messages: [
				{
					role: 'user',
					content: `Redactá la epicrisis de alta con el expediente completo. Respetá el formato visual por secciones con saltos de línea:\n\n${contextText}`,
				},
			],
			temperature: 0.25,
			maxTokens: 2800,
		});

		const epicrisisFmt = formatearEpicrisisVisual(
			String(json.epicrisis || json.texto || ''),
		).slice(0, 7500);

		return {
			epicrisis: epicrisisFmt,
			diagnostico: String(json.diagnostico || '').trim().slice(0, 8),
			diagnosticoText: String(json.diagnosticoText || json.diagnostico_texto || '')
				.trim()
				.slice(0, 8000),
			fuente: 'openai',
			generadoConIA: true,
			modelo: botOpenai.getModel(),
			contextoChars: contextText.length,
			disclaimer: DISCLAIMER_IA,
			aviso: 'Borrador generado con IA a partir del expediente completo. Debe ser revisado por el profesional antes de guardar.',
		};
	} catch (e) {
		const fallback = buildFallbackDraft(dossier, contextText);
		fallback.fuente = 'plantilla_fallback';
		fallback.aviso = `IA no disponible (${e.message}). Se usó borrador plantilla.`;
		return fallback;
	}
}

function asegurarDisclaimerEnTexto(texto, generadoConIA) {
	if (!generadoConIA) return String(texto || '');
	const body = String(texto || '').trim();
	if (body.includes('DESLINDE DE RESPONSABILIDAD (asistencia por IA)')) return body;
	const combined = `${body}\n\n${DISCLAIMER_IA}`;
	return combined.slice(0, 8000);
}

module.exports = {
	generarBorrador,
	SECTIONS_IA,
	DISCLAIMER_IA,
	asegurarDisclaimerEnTexto,
	formatearEpicrisisVisual,
};
