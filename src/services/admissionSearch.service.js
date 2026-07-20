const { executeQuery } = require('../models/db');
const {
	convertirFechaClarionADate,
	convertirHoraClarionAString,
} = require('../utils/dateUtils');

/** Matrícula genérica de sistema/admin en legacy (no es médico de turno). */
const MATRICULA_SISTEMA = 999999;
const indicacionesService = require('./indicaciones.service');
const medicacionControlService = require('./medicacionControl.service');
// Usamos la versión compatible con esquema legacy/remoto (WEBDEV).
const laboratoriosService = require('./laboratorios-simple.service');
const adjuntosService = require('./adjuntos.service');
const evolucionesService = require('./evoluciones.service');
const protocolosService = require('./protocolos.service');
const { obtenerHCIngresoPorVisita } = require('./hcIngreso.service');

function normalizeLike(value) {
  return `%${String(value || '').trim().replace(/\s+/g, '%')}%`;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

let practicasNomencladorResolverPromise = null;
async function getPracticasNomencladorResolver() {
  if (practicasNomencladorResolverPromise) return practicasNomencladorResolverPromise;
  practicasNomencladorResolverPromise = (async () => {
    try {
      const cols = await executeQuery(
        `
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VUnionModuladasNomenclador'
        `
      );
      const set = new Set((cols || []).map((r) => String(r.COLUMN_NAME || '').trim().toLowerCase()).filter(Boolean));
      if (set.size === 0) return null;

      const pick = (candidates) => candidates.find((c) => set.has(c.toLowerCase())) || null;
      const codeCol = pick(['Practica', 'CodigoPractica', 'CodPractica', 'Codigo', 'IdPractica', 'Valor']);
      const descCol = pick(['DescPractica', 'DescripcionPractica', 'Descripcion', 'Prestacion', 'Denominacion', 'Detalle']);
      if (!codeCol || !descCol) return null;
      return { codeCol, descCol };
    } catch (_) {
      return null;
    }
  })();
  return practicasNomencladorResolverPromise;
}

async function buscarAdmisiones({
  dni = '',
  nombreApellido = '',
  fechaInicio = '',
  fechaFin = '',
  page = 1,
  limit = 25,
}) {
  const whereParts = [];
  const params = [];

  if (String(dni).trim()) {
    const digits = normalizeDigits(dni);
    if (digits) {
      whereParts.push(
        `REPLACE(REPLACE(REPLACE(CAST(p.NumeroDocumento AS VARCHAR(50)), '.', ''), '-', ''), ' ', '') LIKE @param${params.length}`
      );
      params.push({ value: `%${digits}%` });
    } else {
      whereParts.push(`CAST(p.NumeroDocumento AS VARCHAR(50)) LIKE @param${params.length}`);
      params.push({ value: normalizeLike(dni) });
    }
  }

  if (String(nombreApellido).trim()) {
    whereParts.push(`p.ApellidoYNombre LIKE @param${params.length}`);
    params.push({ value: normalizeLike(nombreApellido) });
  }

  if (String(fechaInicio).trim()) {
    whereParts.push(`CAST(v.FECHAADMISIONS AS DATE) >= @param${params.length}`);
    params.push({ value: fechaInicio });
  }

  if (String(fechaFin).trim()) {
    whereParts.push(`CAST(v.FECHAADMISIONS AS DATE) <= @param${params.length}`);
    params.push({ value: fechaFin });
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const labVisCol = await laboratoriosService.getLabCabeceraVisitSqlColumn().catch(() => null);
  const labCntSql = labVisCol
    ? `(SELECT COUNT(1) FROM dbo.imHCExamenesLabCabecera lab WHERE lab.${labVisCol} = v.NumeroVisita) AS CntLaboratorios`
    : `CAST(0 AS INT) AS CntLaboratorios`;

  const countQuery = `
    SELECT COUNT(1) AS total
    FROM imVisita v
    INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
    ${whereClause}
  `;

  const listQuery = `
    SELECT
      v.NumeroVisita,
      v.IdPaciente,
      p.ApellidoYNombre,
      p.NumeroDocumento,
      p.NumeroHC,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
      CONVERT(VARCHAR(5), v.FECHAADMISIONS, 108) AS HoraAdmision,
      v.TipoPaciente,
      v.ClasePaciente,
      tp.Descripcion AS TipoPacienteDescripcion,
      v.EstadoAmbulatorio,
      ea.Descripcion AS EstadoAmbulatorioDescripcion,
      CASE
        WHEN UPPER(LTRIM(RTRIM(COALESCE(v.ClasePaciente, '')))) = 'A' THEN 'Ambulatorio'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(v.ClasePaciente, '')))) = 'I' THEN 'Internado'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(tp.Descripcion, '')))) LIKE '%AMBUL%' THEN 'Ambulatorio'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(ea.Descripcion, '')))) LIKE '%AMBUL%' THEN 'Ambulatorio'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(ea.Descripcion, '')))) LIKE '%INTERN%' THEN 'Internado'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(tp.Descripcion, '')))) LIKE '%INTERN%' THEN 'Internado'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(v.TipoPaciente, '')))) IN ('A', 'AMB', 'AMBU', 'AMBULATORIO') THEN 'Ambulatorio'
        WHEN UPPER(LTRIM(RTRIM(COALESCE(v.TipoPaciente, '')))) IN ('I', 'INT', 'INTERNADO') THEN 'Internado'
        ELSE 'Sin clasificar'
      END AS TipoAtencion,
      (SELECT COUNT(1) FROM dbo.imHCI h WHERE h.NumeroVisita = v.NumeroVisita) AS CntHistoriaClinica,
      (SELECT COUNT(1) FROM dbo.imFacpracticas fp WHERE fp.NumeroVisita = v.NumeroVisita) AS CntPracticas,
      (SELECT COUNT(1) FROM dbo.imInterIndMedicas iim WHERE iim.NumeroVisita = v.NumeroVisita) AS CntIndicaciones,
      (SELECT COUNT(1) FROM dbo.imInterCtrlMedicamento mc WHERE mc.NumeroVisita = v.NumeroVisita) AS CntMedicacion,
      /* iMedicAD: Estudios = imPedidosEstudios.IdVisita (= NumeroVisita) */
      (SELECT COUNT(1) FROM dbo.imPedidosEstudios pe WHERE pe.IdVisita = v.NumeroVisita) AS CntEstudios,
      ${labCntSql},
      /* iMedicAD: Protocolos clínicos = HCProtocolosPtes.NumeroVisita */
      (SELECT COUNT(1) FROM dbo.HCProtocolosPtes hp WHERE hp.NumeroVisita = v.NumeroVisita) AS CntProtocolos,
      (SELECT COUNT(1) FROM dbo.imPedidosEstudiosAdjuntos adj WHERE adj.NumeroVisita = v.NumeroVisita) AS CntAdjuntos,
      (SELECT COUNT(1) FROM dbo.imHCEvolucion ev WHERE ev.IdVisita = v.NumeroVisita) AS CntEvoluciones
    FROM imVisita v
    INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN imTipoPaciente tp ON v.TipoPaciente = tp.Valor
    LEFT JOIN imEstadoAmbulatorio ea ON v.EstadoAmbulatorio = ea.Valor
    ${whereClause}
    ORDER BY v.FECHAADMISIONS DESC, v.NumeroVisita DESC
    OFFSET @param${params.length} ROWS FETCH NEXT @param${params.length + 1} ROWS ONLY
  `;

  const [countRows, data] = await Promise.all([
    executeQuery(countQuery, params),
    executeQuery(listQuery, [...params, { value: offset }, { value: safeLimit }]),
  ]);

  const total = Number(countRows?.[0]?.total || 0);
  return {
    data: data || [],
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 0,
    },
  };
}

async function obtenerResumenAdmision(numeroVisita) {
  const rows = await executeQuery(
    `
      SELECT TOP 1
        v.NumeroVisita,
        v.IdPaciente,
        p.ApellidoYNombre,
        p.NumeroDocumento,
        p.NumeroHC,
        CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
        CONVERT(VARCHAR(5), v.FECHAADMISIONS, 108) AS HoraAdmision
      FROM imVisita v
      INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
      WHERE v.NumeroVisita = @param0
    `,
    [{ value: numeroVisita }]
  );
  return rows?.[0] || null;
}

function _clarionFechaIso(fechaClarion) {
	const d = convertirFechaClarionADate(fechaClarion);
	return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function _clarionHoraHm(horaClarion) {
	const s = convertirHoraClarionAString(horaClarion);
	return s ? s.slice(0, 5) : null;
}

/** Una descripción por código (evita duplicados del nomenclador). */
function _sqlDescripcionPractica(nomenclador) {
	if (!nomenclador) {
		return `COALESCE(
      NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(250), fp.DescPractica))), ''),
      CONVERT(VARCHAR(50), fp.Practica)
    )`;
	}
	const { codeCol, descCol } = nomenclador;
	return `COALESCE(
    (
      SELECT TOP 1 LTRIM(RTRIM(CONVERT(VARCHAR(250), n.[${descCol}])))
      FROM dbo.VUnionModuladasNomenclador n
      WHERE LTRIM(RTRIM(CONVERT(VARCHAR(50), fp.Practica))) =
            LTRIM(RTRIM(CONVERT(VARCHAR(50), n.[${codeCol}])))
      ORDER BY
        CASE WHEN UPPER(LTRIM(RTRIM(CONVERT(VARCHAR(250), n.[${descCol}])))) LIKE '%PRE ANEST%' THEN 1 ELSE 0 END,
        LEN(LTRIM(RTRIM(CONVERT(VARCHAR(250), n.[${descCol}]))))
    ),
    NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR(250), fp.DescPractica))), ''),
    CONVERT(VARCHAR(50), fp.Practica)
  )`;
}

async function _profesionalesPorPracticas(valoresPractica) {
	const ids = [...new Set(valoresPractica.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length) return new Map();

	const params = ids.map((v, i) => ({ value: v, type: 'Int' }));
	const inList = ids.map((_, i) => `@p${i}`).join(', ');
	const rows = await executeQuery(
		`
      SELECT
        fprof.Valor,
        fprof.Matricula,
        fprof.Funcion,
        fn.Descripcion AS FuncionDescripcion,
        LTRIM(RTRIM(per.ApellidoNombre)) AS ProfesionalNombre
      FROM dbo.imFacProfesionales fprof
      LEFT JOIN dbo.imPersonal per ON per.Matricula = fprof.Matricula
      LEFT JOIN dbo.imFunciones fn ON fn.Valor = fprof.Funcion
      WHERE fprof.Valor IN (${inList})
      ORDER BY fprof.Valor, fprof.Funcion, fprof.Matricula
    `,
		params,
	);

	const map = new Map();
	for (const r of rows || []) {
		const valor = Number(r.Valor);
		if (!map.has(valor)) map.set(valor, []);
		const nombre = String(r.ProfesionalNombre || '').trim() || `Mat. ${r.Matricula}`;
		const funcion = String(r.FuncionDescripcion || '').trim();
		const etiqueta = funcion ? `${nombre} (${funcion})` : nombre;
		map.get(valor).push(etiqueta);
	}
	return map;
}

async function _medicoDelTurnoPorVisita(numeroVisita) {
	const turno = await executeQuery(
		`SELECT TOP 1 t.Profesional, t.HoraSalida, t.FechaAsignada
		 FROM dbo.imTurnos t
		 WHERE t.NumeroVisita = @p0
		 ORDER BY t.IdTurno DESC`,
		[{ value: numeroVisita, type: 'Int' }],
	);
	if (!turno.length) return null;
	const matricula = Number(turno[0].Profesional) || 0;
	if (matricula <= 0 || matricula === MATRICULA_SISTEMA) return null;
	const pers = await executeQuery(
		`SELECT TOP 1 LTRIM(RTRIM(ApellidoNombre)) AS Nombre, Matricula
		 FROM dbo.imPersonal WHERE Matricula = @p0`,
		[{ value: matricula, type: 'Int' }],
	);
	const nombre = String(pers[0]?.Nombre || '').trim();
	return {
		matricula,
		nombre: nombre || `Mat. ${matricula}`,
		horaSalida: _clarionHoraHm(turno[0].HoraSalida),
	};
}

async function obtenerPracticasPorVisita(numeroVisita) {
	const nomenclador = await getPracticasNomencladorResolver();
	const descSql = _sqlDescripcionPractica(nomenclador);
	const medicoTurno = await _medicoDelTurnoPorVisita(numeroVisita);

	const rows = await executeQuery(
		`
      SELECT
        fp.Valor,
        fp.NumeroVisita,
        fp.Practica,
        ${descSql} AS PracticaDescripcion,
        fp.TipoPractica,
        fp.CantidadPractica,
        fp.FechaPractica,
        fp.HoraPracticaInicio,
        fp.HoraPracticaFin,
        LTRIM(RTRIM(fp.ValorSector)) AS ValorSector,
        fp.Estado,
        fp.Factura,
        fp.Autorizada,
        fp.CodOperador,
        fp.NroInforme,
        fp.NroAutorizacion
      FROM dbo.imFacPracticas fp
      WHERE fp.NumeroVisita = @p0
      ORDER BY fp.FechaPractica DESC, fp.HoraPracticaInicio DESC, fp.Valor DESC
    `,
		[{ value: numeroVisita, type: 'Int' }],
	);

	const profMap = await _profesionalesPorPracticas((rows || []).map((r) => r.Valor));

	return (rows || []).map((r) => {
		const valor = Number(r.Valor);
		const profFact = profMap.get(valor) || [];
		const horaPractica =
			_clarionHoraHm(r.HoraPracticaInicio) || medicoTurno?.horaSalida || null;
		// Priorizar siempre el médico asignado al turno (imTurnos.Profesional)
		const profesionales = medicoTurno?.nombre ? [medicoTurno.nombre] : profFact;
		return {
			Valor: valor,
			NumeroVisita: Number(r.NumeroVisita),
			Practica: r.Practica,
			PracticaDescripcion: String(r.PracticaDescripcion || r.Practica || '').trim(),
			TipoPractica: r.TipoPractica != null ? String(r.TipoPractica).trim() : '',
			CantidadPractica: r.CantidadPractica,
			FechaPractica: _clarionFechaIso(r.FechaPractica),
			HoraPracticaInicio: horaPractica,
			HoraPracticaFin: _clarionHoraHm(r.HoraPracticaFin),
			ValorSector: r.ValorSector,
			Estado: r.Estado,
			Factura: r.Factura,
			Autorizada: r.Autorizada,
			CodOperador: r.CodOperador,
			NroInforme: r.NroInforme,
			NroAutorizacion: r.NroAutorizacion,
			MatriculaMedicoTurno: medicoTurno?.matricula ?? null,
			Profesionales: profesionales.join(' · '),
			ProfesionalesLista: profesionales,
		};
	});
}

async function exportarAdmisionCompleta(numeroVisita) {
  const visita = await obtenerResumenAdmision(numeroVisita);
  if (!visita) return null;

  const today = new Date().toISOString().slice(0, 10);
  const [
    historiaClinica,
    indicacionesRaw,
    practicasPaciente,
    medicamentos,
    practicasLaboratorio,
    evolucionesMedicas,
    adjuntos,
    estudios,
    protocolos,
  ] = await Promise.all([
    obtenerHCIngresoPorVisita(numeroVisita).catch(() => []),
    indicacionesService.obtenerUltimasIndicacionesPorVisita(numeroVisita, 5000).catch(() => []),
    obtenerPracticasPorVisita(numeroVisita).catch(() => []),
    medicacionControlService.obtenerMedicacionPorVisita(numeroVisita).catch(() => []),
    laboratoriosService.obtenerExamenesPorVisita(numeroVisita).catch(() => []),
    evolucionesService.obtenerEvolucionesPorVisitaYFecha(numeroVisita, today, null).catch(() => []),
    adjuntosService.getAdjuntosPorVisita(numeroVisita).catch(() => []),
    obtenerEstudiosPorVisitaAd(numeroVisita).catch(() => []),
    protocolosService.listarPorVisita(numeroVisita).catch(() => []),
  ]);
  const indicaciones = filterIndicacionesClinicas(indicacionesRaw);

  return {
    generadoEn: new Date().toISOString(),
    admision: visita,
    historialClinico: historiaClinica,
    practicasPaciente,
    practicas: {
      laboratorios: practicasLaboratorio,
      adjuntos,
    },
    medicamentos,
    indicaciones,
    evolucionesMedicas,
    estudios,
    protocolos,
  };
}

/** YYYY-MM-DD o null si no se puede inferir */
function toYmd(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  return null;
}

function inDateRange(ymd, fechaInicio, fechaFin, exportAll) {
  if (exportAll) return true;
  const ini = String(fechaInicio || '').trim();
  const fin = String(fechaFin || '').trim();
  if (!ini && !fin) return true;
  if (!ymd) return true;
  if (ini && ymd < ini) return false;
  if (fin && ymd > fin) return false;
  return true;
}

function filterHc(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => {
    const ymd = toYmd(r.FechaFormateada) || toYmd(r.Fecha);
    return inDateRange(ymd, fechaInicio, fechaFin, exportAll);
  });
}

function indicacionYmd(row) {
  return (
    toYmd(row.vigenteDesde) ||
    toYmd(row.FechaCargaISO) ||
    toYmd(row.proximo) ||
    (row.proximaAplicacion ? toYmd(String(row.proximaAplicacion).replace(/\//g, '-')) : null) ||
    (row.ultimaAplicacion ? toYmd(String(row.ultimaAplicacion).replace(/\//g, '-')) : null)
  );
}

function isControlEnfermeriaIndicacion(row) {
  const tipo = String(row?.tipo ?? row?.TipoIndicacion ?? '').trim().toUpperCase();
  return tipo === 'C';
}

function filterIndicacionesClinicas(rows) {
  return (rows || []).filter((r) => {
    const tipo = String(r?.tipo ?? r?.TipoIndicacion ?? '').trim().toUpperCase();
    // A/C = controles (asistenciales/enfermería). En aclysa no se muestran en Prácticas/Indicaciones.
    return tipo !== 'C' && tipo !== 'A';
  });
}

function filterIndicaciones(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => inDateRange(indicacionYmd(r), fechaInicio, fechaFin, exportAll));
}

function filterPracticasPaciente(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => inDateRange(toYmd(r.FechaPractica), fechaInicio, fechaFin, exportAll));
}

function filterMedicamentos(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => inDateRange(toYmd(r.FechaControl), fechaInicio, fechaFin, exportAll));
}

function filterEvoluciones(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => inDateRange(toYmd(r.FechaEv), fechaInicio, fechaFin, exportAll));
}

function getEvolucionServicioKey(row) {
  return String(
    row?.EspecialidadDescripcion ||
      row?.SectorDescripcion ||
      (row?.IdSector != null && String(row.IdSector).trim() !== '' ? `SERVICIO_${String(row.IdSector).trim()}` : '')
  )
    .trim()
    .toLowerCase();
}

function filterLabs(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => inDateRange(toYmd(r.FechaExamen), fechaInicio, fechaFin, exportAll));
}

/**
 * Paridad iMedicAD: pedidos de estudios por visita (imPedidosEstudios.IdVisita = NumeroVisita)
 * + resultados (imProtocolosResultados) + adjuntos de la visita.
 */
async function obtenerEstudiosPorVisitaAd(numeroVisita) {
  const nv = Number(numeroVisita);
  if (!Number.isFinite(nv) || nv <= 0) return [];

  const [pedidos, adjuntos] = await Promise.all([
    executeQuery(
      `
        SELECT
          pe.IdPedido,
          pe.FechaPedido,
          pe.NotasObservacion AS PedidoEstudio,
          pe.IdProtocolo,
          pe.EstadoUrgencia,
          pe.IdTipoPedido,
          pe.IdPractica,
          pe.ValorProfesional AS MatriculaSolicitante,
          LTRIM(RTRIM(ISNULL(sol.ApellidoNombre, ''))) AS MedicoSolicitanteNombre,
          LTRIM(RTRIM(ISNULL(nom.Descripcion, ''))) AS PracticaDescripcion,
          pr.IdProtocolo AS ProtocoloResultadoId,
          pr.FechaResultado,
          pr.FechaCarga,
          pr.TextoProtocolo AS ResultadoEstudio,
          pr.NroProtocolo,
          pr.Estado AS EstadoResultado,
          pr.CodOperador AS CodOperadorResultado,
          LTRIM(RTRIM(ISNULL(opRes.ApellidoNombre, ''))) AS OperadorResultadoNombre,
          fprof.Matricula AS MatriculaRealizador,
          LTRIM(RTRIM(ISNULL(realiz.ApellidoNombre, ''))) AS RealizadorNombre
        FROM dbo.imPedidosEstudios pe
        LEFT JOIN dbo.imProtocolosResultados pr ON pe.IdProtocolo = pr.IdProtocolo AND pe.IdProtocolo > 0
        LEFT JOIN dbo.imPersonal sol ON sol.Matricula = pe.ValorProfesional
        LEFT JOIN dbo.imPersonal opRes ON opRes.Valor = pr.CodOperador
        LEFT JOIN dbo.imFacPracticas fac ON fac.Valor = pe.IdProtocolo AND pe.IdProtocolo > 0
        LEFT JOIN dbo.imFacProfesionales fprof ON fprof.Valor = fac.Valor AND fprof.Funcion = 1
        LEFT JOIN dbo.imPersonal realiz ON realiz.Matricula = fprof.Matricula
        OUTER APPLY (
          SELECT TOP 1 Descripcion FROM dbo.imNomenclador WHERE IDPractica = pe.IdPractica
        ) nom
        WHERE pe.IdVisita = @param0
        ORDER BY pe.FechaPedido DESC, pe.IdPedido DESC
      `,
      [{ value: nv }],
    ).catch(() => []),
    executeQuery(
      `
        SELECT
          IdAdjunto,
          NumeroVisita,
          IdProtocolo,
          Patch,
          PatchServidor,
          Descripcion,
          Fecha
        FROM dbo.imPedidosEstudiosAdjuntos
        WHERE NumeroVisita = @param0
      `,
      [{ value: nv }],
    ).catch(() => []),
  ]);

  const adjList = adjuntos || [];
  return (pedidos || []).map((e) => {
    const idProt = e.IdProtocolo != null ? Number(e.IdProtocolo) : 0;
    const adjuntosDelEstudio = adjList.filter((adj) => {
      if (idProt > 0) return Number(adj.IdProtocolo) === idProt;
      return !adj.IdProtocolo || Number(adj.IdProtocolo) === 0;
    });
    const fechaPedido =
      e.FechaPedido instanceof Date
        ? e.FechaPedido.toISOString()
        : e.FechaPedido
          ? String(e.FechaPedido)
          : null;
    const matriculaSol =
      e.MatriculaSolicitante != null && Number(e.MatriculaSolicitante) > 0
        ? Number(e.MatriculaSolicitante)
        : null;
    const matriculaReal =
      e.MatriculaRealizador != null && Number(e.MatriculaRealizador) > 0
        ? Number(e.MatriculaRealizador)
        : null;
    return {
      id: e.IdPedido,
      IdPedido: e.IdPedido,
      fechaPedido,
      FechaPedido: fechaPedido,
      pedidoEstudio: e.PedidoEstudio || '',
      PedidoEstudio: e.PedidoEstudio || '',
      practicaDescripcion: e.PracticaDescripcion || '',
      PracticaDescripcion: e.PracticaDescripcion || '',
      idProtocolo: idProt > 0 ? idProt : null,
      IdProtocolo: idProt > 0 ? idProt : null,
      estadoUrgencia: e.EstadoUrgencia ? String(e.EstadoUrgencia).trim() : '',
      EstadoUrgencia: e.EstadoUrgencia ? String(e.EstadoUrgencia).trim() : '',
      idTipoPedido: e.IdTipoPedido != null ? Number(e.IdTipoPedido) : null,
      /* Profesionales Clarion: sin columnas nuevas */
      matriculaSolicitante: matriculaSol,
      MatriculaSolicitante: matriculaSol,
      medicoSolicitanteNombre: e.MedicoSolicitanteNombre || '',
      MedicoSolicitanteNombre: e.MedicoSolicitanteNombre || '',
      matriculaRealizador: matriculaReal,
      MatriculaRealizador: matriculaReal,
      realizadorNombre: e.RealizadorNombre || '',
      RealizadorNombre: e.RealizadorNombre || '',
      operadorResultadoNombre: e.OperadorResultadoNombre || '',
      resultadoEstudio: e.ResultadoEstudio || '',
      ResultadoEstudio: e.ResultadoEstudio || '',
      nroProtocolo: e.NroProtocolo != null ? String(e.NroProtocolo) : '',
      NroProtocolo: e.NroProtocolo != null ? String(e.NroProtocolo) : '',
      estadoResultado: e.EstadoResultado != null ? String(e.EstadoResultado) : '',
      fechaResultado: e.FechaResultado || null,
      FechaResultado: e.FechaResultado || null,
      adjuntos: adjuntosDelEstudio,
      cantidadAdjuntos: adjuntosDelEstudio.length,
    };
  });
}

function filterEstudiosAd(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => {
    const ymd = toYmd(r.fechaPedido) || toYmd(r.FechaPedido) || toYmd(r.FechaResultado);
    return inDateRange(ymd, fechaInicio, fechaFin, exportAll);
  });
}

function filterProtocolosClinicos(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => {
    const ymd = toYmd(r.Fecha) || toYmd(r.fecha);
    return inDateRange(ymd, fechaInicio, fechaFin, exportAll);
  });
}

function filterAdjuntosMeta(rows, fechaInicio, fechaFin, exportAll) {
  return (rows || []).filter((r) => {
    const ymd = toYmd(r.FechaCarga) || toYmd(r.Fecha);
    return inDateRange(ymd, fechaInicio, fechaFin, exportAll);
  });
}

function slimLabRow(ex) {
  const { detalles, totalParametros, parametrosFueraDeRango, ...rest } = ex;
  return rest;
}

/**
 * Export JSON parcial según secciones y rango de fechas (o todo).
 * @param {number} numeroVisita
 * @param {Object} opts
 * @param {string[]} opts.sections - claves: admision, hcIngreso, practicas, indicaciones, medicamentos, evoluciones, estudios, protocolos, adjuntos
 * @param {boolean} opts.exportAll
 * @param {string} [opts.fechaInicio] YYYY-MM-DD
 * @param {string} [opts.fechaFin] YYYY-MM-DD
 * @param {string[]} [opts.evolucionSectorIds] Compat legacy: IdSector a incluir (vacío = todos)
 * @param {string[]} [opts.evolucionServicioIds] Servicio a incluir (preferido; vacío = todos)
 */
async function exportarAdmisionSelectivo(numeroVisita, opts = {}) {
  const visita = await obtenerResumenAdmision(numeroVisita);
  if (!visita) return null;

  const sections = Array.isArray(opts.sections) ? opts.sections.map(String) : [];
  const exportAll = Boolean(opts.exportAll);
  const fechaInicio = String(opts.fechaInicio || '').trim();
  const fechaFin = String(opts.fechaFin || '').trim();
  const evolucionSectorIds = Array.isArray(opts.evolucionSectorIds)
    ? [...new Set(opts.evolucionSectorIds.map((x) => String(x).trim()))]
    : [];
  const evolucionServicioIds = Array.isArray(opts.evolucionServicioIds)
    ? [...new Set(opts.evolucionServicioIds.map((x) => String(x).trim().toLowerCase()).filter(Boolean))]
    : [];

  if (sections.length === 0) {
    const err = new Error('Debe seleccionar al menos un bloque para exportar');
    err.code = 'NO_SECTIONS';
    throw err;
  }

  const need = {
    hc: sections.includes('hcIngreso'),
    ind: sections.includes('indicaciones'),
    prac: sections.includes('practicas'),
    med: sections.includes('medicamentos'),
    evo: sections.includes('evoluciones'),
    est: sections.includes('estudios'),
    prot: sections.includes('protocolos'),
    adj: sections.includes('adjuntos'),
  };

  const today = new Date().toISOString().slice(0, 10);
  const [
    historiaClinica,
    indicacionesRaw,
    practicasRaw,
    medicamentos,
    evolucionesMedicas,
    adjuntos,
    estudiosRaw,
    protocolosRaw,
  ] = await Promise.all([
    need.hc ? obtenerHCIngresoPorVisita(numeroVisita).catch(() => []) : Promise.resolve([]),
    need.ind
      ? indicacionesService.obtenerUltimasIndicacionesPorVisita(numeroVisita, 5000).catch(() => [])
      : Promise.resolve([]),
    need.prac ? obtenerPracticasPorVisita(numeroVisita).catch(() => []) : Promise.resolve([]),
    need.med ? medicacionControlService.obtenerMedicacionPorVisita(numeroVisita).catch(() => []) : Promise.resolve([]),
    need.evo
      ? evolucionesService.obtenerEvolucionesPorVisitaYFecha(numeroVisita, today, null).catch(() => [])
      : Promise.resolve([]),
    need.adj ? adjuntosService.getAdjuntosPorVisita(numeroVisita).catch(() => []) : Promise.resolve([]),
    need.est ? obtenerEstudiosPorVisitaAd(numeroVisita).catch(() => []) : Promise.resolve([]),
    need.prot ? protocolosService.listarPorVisita(numeroVisita).catch(() => []) : Promise.resolve([]),
  ]);
  const indicaciones = filterIndicacionesClinicas(indicacionesRaw);

  const out = {
    generadoEn: new Date().toISOString(),
    numeroVisita,
    criterios: {
      exportAll,
      fechaInicio: exportAll ? null : fechaInicio || null,
      fechaFin: exportAll ? null : fechaFin || null,
      sections,
      evolucionServicioIds: evolucionServicioIds.length ? evolucionServicioIds : null,
      evolucionSectorIds: evolucionSectorIds.length ? evolucionSectorIds : null,
    },
  };

  if (sections.includes('admision')) {
    out.admision = visita;
  }

  if (sections.includes('hcIngreso')) {
    out.historialClinico = filterHc(historiaClinica, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('practicas')) {
    out.practicasPaciente = filterPracticasPaciente(practicasRaw, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('indicaciones')) {
    out.indicaciones = filterIndicaciones(indicaciones, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('medicamentos')) {
    out.medicamentos = filterMedicamentos(medicamentos, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('evoluciones')) {
    let ev = evolucionesMedicas || [];
    if (evolucionServicioIds.length > 0) {
      const servicioSet = new Set(evolucionServicioIds);
      ev = ev.filter((r) => servicioSet.has(getEvolucionServicioKey(r)));
    } else if (evolucionSectorIds.length > 0) {
      const sectorSet = new Set(evolucionSectorIds.map((s) => String(s)));
      ev = ev.filter((r) => sectorSet.has(String(r.IdSector ?? '').trim()));
    }
    out.evolucionesMedicas = filterEvoluciones(ev, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('estudios')) {
    out.estudios = filterEstudiosAd(estudiosRaw, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('protocolos')) {
    out.protocolos = filterProtocolosClinicos(protocolosRaw, fechaInicio, fechaFin, exportAll);
  }

  if (sections.includes('adjuntos')) {
    const meta = filterAdjuntosMeta(adjuntos, fechaInicio, fechaFin, exportAll);
    out.adjuntos = meta.map((a) => ({
      IdAdjunto: a.IdAdjunto,
      NumeroVisita: a.NumeroVisita,
      NombreArchivo: a.NombreArchivo,
      TipoArchivo: a.TipoArchivo,
      FechaCarga: a.FechaCarga,
      TipoImagenNombre: a.TipoImagenNombre,
      RutaArchivo: a.RutaArchivo,
    }));
  }

  return out;
}

module.exports = {
  buscarAdmisiones,
  obtenerPracticasPorVisita,
  exportarAdmisionCompleta,
  exportarAdmisionSelectivo,
};
