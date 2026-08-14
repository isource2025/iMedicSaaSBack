const { executeQuery } = require('../models/db');
const { getTenantId } = require('../context/tenantContext');
const {
	convertirFechaClarionADate,
	convertirHoraClarionAString,
	partesFechaHoraArgentina,
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
const estudiosService = require('./estudios.service');
const epicrisisService = require('./epicrisis.service');

function normalizeLike(value) {
  return `%${String(value || '').trim().replace(/\s+/g, '%')}%`;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

const practicasNomencladorByTenant = new Map();
const practicasNomencladorPromiseByTenant = new Map();
/** Cache por tenant: imVisita.IdSucursal (algunas BDs legacy no lo tienen). */
const visitaIdSucursalByTenant = new Map();

async function visitaTieneIdSucursal() {
  const key = (() => {
    const id = getTenantId();
    return id != null ? String(id) : '_default';
  })();
  if (visitaIdSucursalByTenant.has(key)) return visitaIdSucursalByTenant.get(key);
  try {
    const rows = await executeQuery(`
      SELECT TOP 1 1 AS ok
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'imVisita'
        AND COLUMN_NAME = 'IdSucursal'
    `);
    const ok = Array.isArray(rows) && rows.length > 0;
    visitaIdSucursalByTenant.set(key, ok);
    return ok;
  } catch (_) {
    visitaIdSucursalByTenant.set(key, false);
    return false;
  }
}

function sqlCentroSaludParts(hasIdSucursal) {
  if (hasIdSucursal) {
    return {
      select: `LTRIM(RTRIM(ISNULL(suc.Descripcion, ''))) AS CentroSalud`,
      join: `LEFT JOIN dbo.Sucursales suc ON v.IdSucursal = suc.IdSucursal`,
    };
  }
  return {
    select: `CAST('' AS VARCHAR(200)) AS CentroSalud`,
    join: '',
  };
}

async function getPracticasNomencladorResolver() {
  const key = (() => {
    const id = getTenantId();
    return id != null ? String(id) : '_default';
  })();
  if (practicasNomencladorByTenant.has(key)) return practicasNomencladorByTenant.get(key);
  if (practicasNomencladorPromiseByTenant.has(key)) {
    return practicasNomencladorPromiseByTenant.get(key);
  }

  const promise = (async () => {
    try {
      const cols = await executeQuery(
        `
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VUnionModuladasNomenclador'
        `
      );
      const set = new Set((cols || []).map((r) => String(r.COLUMN_NAME || '').trim().toLowerCase()).filter(Boolean));
      if (set.size === 0) {
        practicasNomencladorByTenant.set(key, null);
        return null;
      }

      const pick = (candidates) => candidates.find((c) => set.has(c.toLowerCase())) || null;
      const codeCol = pick(['Practica', 'CodigoPractica', 'CodPractica', 'Codigo', 'IdPractica', 'Valor']);
      const descCol = pick(['DescPractica', 'DescripcionPractica', 'Descripcion', 'Prestacion', 'Denominacion', 'Detalle']);
      const resolved = codeCol && descCol ? { codeCol, descCol } : null;
      practicasNomencladorByTenant.set(key, resolved);
      return resolved;
    } catch (_) {
      practicasNomencladorByTenant.set(key, null);
      return null;
    }
  })().finally(() => {
    practicasNomencladorPromiseByTenant.delete(key);
  });

  practicasNomencladorPromiseByTenant.set(key, promise);
  return promise;
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
  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 25));
  const offset = (safePage - 1) * safeLimit;

  const labVisCol = await laboratoriosService.getLabCabeceraVisitSqlColumn().catch(() => null);
  const labCntSql = labVisCol
    ? `(SELECT COUNT(1) FROM dbo.imHCExamenesLabCabecera lab WHERE lab.${labVisCol} = v.NumeroVisita) AS CntLaboratorios`
    : `CAST(0 AS INT) AS CntLaboratorios`;

  const hasIdSucursal = await visitaTieneIdSucursal();
  const centro = sqlCentroSaludParts(hasIdSucursal);

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
      LTRIM(RTRIM(ISNULL(p.NumeroSSN, ''))) AS NumeroSSN,
      LTRIM(RTRIM(ISNULL(v.NUMEROINTERNACION, ''))) AS NumeroInternacion,
      ${centro.select},
      LTRIM(RTRIM(ISNULL(cli.RazonSocial, ''))) AS CoberturaOS,
      LTRIM(RTRIM(ISNULL(COALESCE(bed.ValorSector, v.VALORSECTOR), ''))) AS Sector,
      LTRIM(RTRIM(ISNULL(COALESCE(bed.ValorHabitacionCama, v.VALORHABITACIONCAMA), ''))) AS Habitacion,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
      CONVERT(VARCHAR(5), v.FECHAADMISIONS, 108) AS HoraAdmision,
      CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) AS FechaAdmisionDMY,
      CASE
        WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL
             AND TRY_CAST(v.FechaEgreso AS int) > 0
             AND OBJECT_ID(N'dbo.fn_ClarionDATE2SQL', N'FN') IS NOT NULL
        THEN CONVERT(VARCHAR(10), dbo.fn_ClarionDATE2SQL(v.FechaEgreso), 23)
        ELSE NULL
      END AS FechaEgreso,
      CASE
        WHEN TRY_CAST(v.HoraEgreso AS int) IS NOT NULL
             AND TRY_CAST(v.HoraEgreso AS int) > 0
             AND OBJECT_ID(N'dbo.fn_ClarionTIME2SQL', N'FN') IS NOT NULL
        THEN CONVERT(VARCHAR(5), dbo.fn_ClarionTIME2SQL(v.HoraEgreso), 108)
        ELSE NULL
      END AS HoraEgreso,
      CASE
        WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL
             AND TRY_CAST(v.FechaEgreso AS int) > 0
             AND OBJECT_ID(N'dbo.fn_ClarionDATE2SQL', N'FN') IS NOT NULL
        THEN CONVERT(VARCHAR(10), dbo.fn_ClarionDATE2SQL(v.FechaEgreso), 103)
        ELSE NULL
      END AS FechaEgresoDMY,
      v.TipoPaciente,
      v.ClasePaciente,
      tp.Descripcion AS TipoPacienteDescripcion,
      v.EstadoAmbulatorio,
      ea.Descripcion AS EstadoAmbulatorioDescripcion,
      LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) AS Diagnostico,
      LTRIM(RTRIM(ISNULL(d.Descripcion, ''))) AS DiagnosticoDescripcion,
      LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) AS ServicioHospital,
      LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) AS LocalizacionEgresado,
      COALESCE(
        NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(smEgr.Descripcion, ''))), ''), '0'),
        NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(secEgr.Descripcion, ''))), ''), '0'),
        NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(sm.Descripcion, ''))), ''), '0'),
        NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(secBed.Descripcion, ''))), ''), '0'),
        NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(secTemp.Descripcion, ''))), ''), '0'),
        CASE
          WHEN LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) IN ('', '0') THEN NULL
          ELSE NULLIF(NULLIF(LTRIM(RTRIM(v.LocalizacionEgresado)), ''), '0')
        END,
        CASE
          WHEN LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) IN ('', '0') THEN NULL
          ELSE NULLIF(NULLIF(LTRIM(RTRIM(v.ServicioHospital)), ''), '0')
        END
      ) AS ServicioEgresoDescripcion,
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
      CASE
        WHEN UPPER(LTRIM(RTRIM(COALESCE(v.ClasePaciente, '')))) = 'I'
          OR UPPER(LTRIM(RTRIM(COALESCE(tp.Descripcion, '')))) LIKE '%INTERN%'
          OR UPPER(LTRIM(RTRIM(COALESCE(ea.Descripcion, '')))) LIKE '%INTERN%'
          OR UPPER(LTRIM(RTRIM(COALESCE(v.TipoPaciente, '')))) IN ('I', 'INT', 'INTERNADO')
        THEN
          CASE
            WHEN v.FECHAADMISIONS IS NULL THEN NULL
            ELSE DATEDIFF(
              day,
              CAST(v.FECHAADMISIONS AS date),
              COALESCE(
                CASE
                  WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL
                       AND TRY_CAST(v.FechaEgreso AS int) > 0
                       AND OBJECT_ID(N'dbo.fn_ClarionDATE2SQL', N'FN') IS NOT NULL
                       AND CAST(dbo.fn_ClarionDATE2SQL(v.FechaEgreso) AS date) >= CAST(v.FECHAADMISIONS AS date)
                  THEN CAST(dbo.fn_ClarionDATE2SQL(v.FechaEgreso) AS date)
                  ELSE NULL
                END,
                CAST(GETDATE() AS date)
              )
            ) + 1
          END
        ELSE NULL
      END AS DiasInternacion,
      (SELECT COUNT(1) FROM dbo.imHCI h WHERE h.NumeroVisita = v.NumeroVisita) AS CntHistoriaClinica,
      (SELECT COUNT(1) FROM dbo.imFacpracticas fp WHERE fp.NumeroVisita = v.NumeroVisita) AS CntPracticas,
      (SELECT COUNT(1) FROM dbo.imInterIndMedicas iim WHERE iim.NumeroVisita = v.NumeroVisita) AS CntIndicaciones,
      (SELECT COUNT(1) FROM dbo.imInterCtrlMedicamento mc WHERE mc.NumeroVisita = v.NumeroVisita) AS CntMedicacion,
      /* iMedicAD: Estudios = imPedidosEstudios.IdVisita (= NumeroVisita) */
      (SELECT COUNT(1) FROM dbo.imPedidosEstudios pe WHERE pe.IdVisita = v.NumeroVisita) AS CntEstudios,
      ${labCntSql},
      /* iMedicAD: Protocolos clínicos = HCProtocolosPtes.NumeroVisita */
      (SELECT COUNT(1) FROM dbo.HCProtocolosPtes hp WHERE hp.NumeroVisita = v.NumeroVisita) AS CntProtocolos,
      (SELECT COUNT(1) FROM dbo.imHCEpicrisis ep WHERE ep.IdVisita = v.NumeroVisita) AS CntEpicrisis,
      (SELECT COUNT(1) FROM dbo.imPedidosEstudiosAdjuntos adj WHERE adj.NumeroVisita = v.NumeroVisita) AS CntAdjuntos,
      (SELECT COUNT(1) FROM dbo.imHCEvolucion ev WHERE ev.IdVisita = v.NumeroVisita) AS CntEvoluciones
    FROM imVisita v
    INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
    LEFT JOIN imTipoPaciente tp ON v.TipoPaciente = tp.Valor
    LEFT JOIN imEstadoAmbulatorio ea ON v.EstadoAmbulatorio = ea.Valor
    LEFT JOIN imDiagnosticos d ON LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) = LTRIM(RTRIM(ISNULL(d.CodigoOMS, '')))
    LEFT JOIN imClientes cli ON v.CLIENTE = cli.Valor
    ${centro.join}
    LEFT JOIN imServiciosMedicos sm ON LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) = LTRIM(RTRIM(ISNULL(sm.Valor, '')))
      AND LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) NOT IN ('', '0')
    LEFT JOIN imServiciosMedicos smEgr ON LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) = LTRIM(RTRIM(ISNULL(smEgr.Valor, '')))
      AND LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) NOT IN ('', '0')
    LEFT JOIN imSectores secEgr ON LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) = LTRIM(RTRIM(ISNULL(secEgr.Valor, '')))
      AND LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) NOT IN ('', '0')
    LEFT JOIN imSectores secTemp ON LTRIM(RTRIM(ISNULL(v.LocalizacionTemporal, ''))) = LTRIM(RTRIM(ISNULL(secTemp.Valor, '')))
      AND LTRIM(RTRIM(ISNULL(v.LocalizacionTemporal, ''))) NOT IN ('', '0')
    OUTER APPLY (
      SELECT TOP 1 hc.ValorSector, hc.ValorHabitacionCama
      FROM dbo.imHabitacionCamas hc
      WHERE hc.NumeroVisita = v.NumeroVisita
      ORDER BY
        CASE
          WHEN LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) = LTRIM(RTRIM(ISNULL(v.ValorSector, '')))
           AND LTRIM(RTRIM(ISNULL(hc.ValorHabitacionCama, ''))) = LTRIM(RTRIM(ISNULL(v.ValorHabitacionCama, '')))
          THEN 0 ELSE 1
        END,
        CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(hc.ValorEstadoCama, '')))) = 'O' THEN 0 ELSE 1 END
    ) bed
    LEFT JOIN imSectores secBed ON LTRIM(RTRIM(ISNULL(bed.ValorSector, ''))) = LTRIM(RTRIM(ISNULL(secBed.Valor, '')))
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
        CONVERT(VARCHAR(5), v.FECHAADMISIONS, 108) AS HoraAdmision,
        LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) AS Diagnostico,
        LTRIM(RTRIM(ISNULL(d.Descripcion, ''))) AS DiagnosticoDescripcion,
        LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) AS ServicioHospital,
        LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) AS LocalizacionEgresado,
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(smEgr.Descripcion, ''))), ''), '0'),
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(secEgr.Descripcion, ''))), ''), '0'),
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(sm.Descripcion, ''))), ''), '0'),
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(secBed.Descripcion, ''))), ''), '0'),
          NULLIF(NULLIF(LTRIM(RTRIM(ISNULL(secTemp.Descripcion, ''))), ''), '0'),
          CASE
            WHEN LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) IN ('', '0') THEN NULL
            ELSE NULLIF(NULLIF(LTRIM(RTRIM(v.LocalizacionEgresado)), ''), '0')
          END,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) IN ('', '0') THEN NULL
            ELSE NULLIF(NULLIF(LTRIM(RTRIM(v.ServicioHospital)), ''), '0')
          END
        ) AS ServicioEgresoDescripcion
      FROM imVisita v
      INNER JOIN imPacientes p ON v.IdPaciente = p.IdPaciente
      LEFT JOIN imDiagnosticos d ON LTRIM(RTRIM(ISNULL(v.Diagnostico, ''))) = LTRIM(RTRIM(ISNULL(d.CodigoOMS, '')))
      LEFT JOIN imServiciosMedicos sm ON LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) = LTRIM(RTRIM(ISNULL(sm.Valor, '')))
        AND LTRIM(RTRIM(ISNULL(v.ServicioHospital, ''))) NOT IN ('', '0')
      LEFT JOIN imServiciosMedicos smEgr ON LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) = LTRIM(RTRIM(ISNULL(smEgr.Valor, '')))
        AND LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) NOT IN ('', '0')
      LEFT JOIN imSectores secEgr ON LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) = LTRIM(RTRIM(ISNULL(secEgr.Valor, '')))
        AND LTRIM(RTRIM(ISNULL(v.LocalizacionEgresado, ''))) NOT IN ('', '0')
      LEFT JOIN imSectores secTemp ON LTRIM(RTRIM(ISNULL(v.LocalizacionTemporal, ''))) = LTRIM(RTRIM(ISNULL(secTemp.Valor, '')))
        AND LTRIM(RTRIM(ISNULL(v.LocalizacionTemporal, ''))) NOT IN ('', '0')
      OUTER APPLY (
        SELECT TOP 1 hc.ValorSector
        FROM dbo.imHabitacionCamas hc
        WHERE hc.NumeroVisita = v.NumeroVisita
        ORDER BY
          CASE
            WHEN LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) = LTRIM(RTRIM(ISNULL(v.ValorSector, '')))
            THEN 0 ELSE 1
          END,
          CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(hc.ValorEstadoCama, '')))) = 'O' THEN 0 ELSE 1 END
      ) bed
      LEFT JOIN imSectores secBed ON LTRIM(RTRIM(ISNULL(bed.ValorSector, ''))) = LTRIM(RTRIM(ISNULL(secBed.Valor, '')))
      WHERE v.NumeroVisita = @param0
    `,
    [{ value: numeroVisita }]
  );
  return rows?.[0] || null;
}

/** Números de visita de un paciente (más recientes primero). */
async function listarNumerosVisitaPaciente(idPaciente, limit = 100) {
  const id = Number(idPaciente);
  if (!Number.isFinite(id) || id <= 0) return [];
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 100));
  const rows = await executeQuery(
    `
      SELECT TOP (@p1) v.NumeroVisita
      FROM dbo.imVisita v
      WHERE v.IdPaciente = @p0
      ORDER BY v.FECHAADMISIONS DESC, v.NumeroVisita DESC
    `,
    [
      { value: id, type: 'Int' },
      { value: safeLimit, type: 'Int' },
    ],
  );
  return (rows || [])
    .map((r) => Number(r.NumeroVisita))
    .filter((n) => Number.isFinite(n) && n > 0);
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
		map.get(valor).push({
			nombre,
			matricula: Number(r.Matricula) || null,
			funcion: Number(r.Funcion) || null,
			funcionDescripcion: funcion || null,
			etiqueta,
		});
	}
	return map;
}

/** Solicitantes de pedidos cumplidos (estudios/IC) indexados por IdProtocolo y Valor fac. */
async function _solicitantesPedidosPorVisita(numeroVisita) {
	const rows = await executeQuery(
		`
      SELECT
        pe.IdPedido,
        pe.IdProtocolo,
        pe.ValorProfesional AS Matricula,
        LTRIM(RTRIM(ISNULL(per.ApellidoNombre, ''))) AS Nombre
      FROM dbo.imPedidosEstudios pe
      LEFT JOIN dbo.imPersonal per ON per.Matricula = pe.ValorProfesional
      WHERE pe.IdVisita = @p0 AND pe.IdProtocolo IS NOT NULL AND pe.IdProtocolo > 0
    `,
		[{ value: numeroVisita, type: 'Int' }],
	).catch(() => []);

	const byProtocolo = new Map();
	for (const r of rows || []) {
		const idProt = Number(r.IdProtocolo) || 0;
		const nombre = String(r.Nombre || '').trim();
		const matricula = Number(r.Matricula) || 0;
		if (idProt <= 0 || !nombre) continue;
		const item = { nombre, matricula: matricula > 0 ? matricula : null, idPedido: Number(r.IdPedido) || null };
		byProtocolo.set(idProt, item);
	}
	return byProtocolo;
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
	const solicitantesPorProt = await _solicitantesPedidosPorVisita(numeroVisita);

	const hasIdProtCol = await executeQuery(
		`SELECT CASE WHEN COL_LENGTH('dbo.imFacPracticas', 'IdProtocolo') IS NULL THEN 0 ELSE 1 END AS ok`,
	)
		.then((r) => Number(r?.[0]?.ok) === 1)
		.catch(() => false);

	const idProtSelect = hasIdProtCol ? 'fp.IdProtocolo,' : 'CAST(NULL AS INT) AS IdProtocolo,';

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
        fp.NroAutorizacion,
        ${idProtSelect}
        fp.Valor AS ValorFac
      FROM dbo.imFacPracticas fp
      WHERE fp.NumeroVisita = @p0
      ORDER BY fp.FechaPractica DESC, fp.HoraPracticaInicio DESC, fp.Valor DESC
    `,
		[{ value: numeroVisita, type: 'Int' }],
	);

	const profMap = await _profesionalesPorPracticas((rows || []).map((r) => r.Valor));

	return (rows || []).map((r) => {
		const valor = Number(r.Valor);
		const idProt = Number(r.IdProtocolo) || 0;
		const profFact = profMap.get(valor) || [];
		const horaPractica =
			_clarionHoraHm(r.HoraPracticaInicio) || medicoTurno?.horaSalida || null;

		const solicitante =
			(idProt > 0 && solicitantesPorProt.get(idProt)) ||
			solicitantesPorProt.get(valor) ||
			null;

		const realizadoresNombres = profFact.map((p) => p.etiqueta);
		// Fallback: médico del turno solo si no hay profesionales en la práctica
		if (!realizadoresNombres.length && medicoTurno?.nombre) {
			const solMat = solicitante?.matricula != null ? Number(solicitante.matricula) : null;
			const mismoQueSolicita =
				solMat != null && Number(medicoTurno.matricula) === solMat;
			if (!solicitante || !mismoQueSolicita) {
				realizadoresNombres.push(medicoTurno.nombre);
			}
		}

		const partes = [];
		if (solicitante?.nombre) partes.push(`Solicita: ${solicitante.nombre}`);
		if (realizadoresNombres.length) {
			partes.push(
				`${solicitante?.nombre ? 'Realizó' : 'Prof.'}: ${realizadoresNombres.join(', ')}`,
			);
		}

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
			IdProtocolo: idProt > 0 ? idProt : null,
			MatriculaMedicoTurno: medicoTurno?.matricula ?? null,
			SolicitanteNombre: solicitante?.nombre || null,
			Realizadores: realizadoresNombres,
			Profesionales: partes.join(' · '),
			ProfesionalesLista: partes,
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
    epicrisis,
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
    epicrisisService.listarPorVisita(numeroVisita).catch(() => []),
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
    epicrisis,
  };
}

/** YYYY-MM-DD o null si no se puede inferir */
function toYmd(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
          LTRIM(RTRIM(ISNULL(
            NULLIF(LTRIM(RTRIM(ISNULL(tp.DescPractica, ''))), ''),
            nom.Descripcion
          ))) AS PracticaDescripcion,
          pr.IdProtocolo AS ProtocoloResultadoId,
          pr.FechaResultado,
          pr.FechaCarga,
          pr.TextoProtocolo AS ResultadoEstudio,
          pr.NroProtocolo,
          pr.Estado AS EstadoResultado,
          pr.CodOperador AS CodOperadorResultado,
          LTRIM(RTRIM(ISNULL(opRes.ApellidoNombre, ''))) AS OperadorResultadoNombre,
          fprof.Matricula AS MatriculaRealizador,
          LTRIM(RTRIM(ISNULL(realiz.ApellidoNombre, ''))) AS RealizadorNombre,
          toma.Matricula AS MatriculaToma,
          LTRIM(RTRIM(ISNULL(tomaPer.ApellidoNombre, ''))) AS NombreToma
        FROM dbo.imPedidosEstudios pe
        LEFT JOIN dbo.imProtocolosResultados pr ON pe.IdProtocolo = pr.IdProtocolo AND pe.IdProtocolo > 0
        LEFT JOIN dbo.imPersonal sol ON sol.Matricula = pe.ValorProfesional
        LEFT JOIN dbo.imPersonal opRes ON opRes.Valor = pr.CodOperador
        LEFT JOIN dbo.imFacPracticas fac ON pe.IdProtocolo > 0 AND (
          fac.IdProtocolo = pe.IdProtocolo OR fac.Valor = pe.IdProtocolo
        )
        LEFT JOIN dbo.imFacProfesionales fprof ON fprof.Valor = fac.Valor AND fprof.Funcion = 1
        LEFT JOIN dbo.imPersonal realiz ON realiz.Matricula = fprof.Matricula
        LEFT JOIN dbo.imPedidosEstudiosToma toma ON toma.IdPedido = pe.IdPedido
        LEFT JOIN dbo.imPersonal tomaPer ON tomaPer.Matricula = toma.Matricula
        OUTER APPLY (
          SELECT TOP 1 LTRIM(RTRIM(ISNULL(t.DescPractica, ''))) AS DescPractica
          FROM dbo.imTiposPedidosEstudios t
          WHERE (ISNULL(pe.IdPractica, 0) > 0 AND t.IdPractica = pe.IdPractica)
             OR (ISNULL(pe.IdTipoPedido, 0) > 0 AND t.IdTipoPedido = pe.IdTipoPedido)
          ORDER BY
            CASE WHEN ISNULL(pe.IdPractica, 0) > 0 AND t.IdPractica = pe.IdPractica THEN 0 ELSE 1 END,
            CASE WHEN ISNULL(pe.IdTipoPedido, 0) > 0 AND t.IdTipoPedido = pe.IdTipoPedido THEN 0 ELSE 1 END
        ) tp
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
    const fechaPedido = (() => {
      let d = null;
      if (e.FechaPedido instanceof Date && !Number.isNaN(e.FechaPedido.getTime())) {
        d = e.FechaPedido;
      } else if (e.FechaPedido) {
        const t = Date.parse(String(e.FechaPedido));
        if (Number.isFinite(t)) d = new Date(t);
      }
      if (!d) return e.FechaPedido ? String(e.FechaPedido) : null;
      const p = partesFechaHoraArgentina(d);
      return `${p.fecha} ${p.horaCorta}`;
    })();
    const matriculaSol =
      e.MatriculaSolicitante != null && Number(e.MatriculaSolicitante) > 0
        ? Number(e.MatriculaSolicitante)
        : null;
    const matriculaReal =
      e.MatriculaRealizador != null && Number(e.MatriculaRealizador) > 0
        ? Number(e.MatriculaRealizador)
        : e.MatriculaToma != null && Number(e.MatriculaToma) > 0
          ? Number(e.MatriculaToma)
          : null;
    const quienHizo =
      String(e.RealizadorNombre || '').trim() ||
      String(e.NombreToma || '').trim() ||
      String(e.OperadorResultadoNombre || '').trim() ||
      '';
    const resultadoPlain = estudiosService.rtfToPlain(e.ResultadoEstudio || '');
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
      realizadorNombre: quienHizo,
      RealizadorNombre: quienHizo,
      operadorResultadoNombre: e.OperadorResultadoNombre || '',
      resultadoEstudio: resultadoPlain,
      ResultadoEstudio: resultadoPlain,
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

function filterEpicrisis(rows, fechaInicio, fechaFin, exportAll) {
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
 * @param {string[]} opts.sections - claves: admision, hcIngreso, practicas, indicaciones, medicamentos, evoluciones, estudios, protocolos, epicrisis, adjuntos
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
    epi: sections.includes('epicrisis'),
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
    epicrisisRaw,
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
    need.epi ? epicrisisService.listarPorVisita(numeroVisita).catch(() => []) : Promise.resolve([]),
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

  if (sections.includes('epicrisis')) {
    out.epicrisis = filterEpicrisis(epicrisisRaw, fechaInicio, fechaFin, exportAll);
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

function _trimStr(v, maxLen) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}

function _toIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _toIntOrZero(v) {
  const n = _toIntOrNull(v);
  return n == null ? 0 : n;
}

/**
 * Datos principales de admisión (captura legacy) + catálogos para el modal.
 */
async function obtenerDatosPrincipales(numeroVisita) {
  const nv = Number(numeroVisita);
  if (!Number.isFinite(nv) || nv <= 0) return null;

  const hasIdSucursal = await visitaTieneIdSucursal();
  const centro = sqlCentroSaludParts(hasIdSucursal);

  const rows = await executeQuery(
    `
      SELECT TOP 1
        v.NUMEROVISITA AS NumeroVisita,
        v.IDPACIENTE AS IdPaciente,
        p.ApellidoYNombre,
        p.NumeroDocumento,
        p.NumeroHC,
        LTRIM(RTRIM(ISNULL(p.NumeroSSN, ''))) AS NumeroSSN,
        CONVERT(VARCHAR(10), v.FECHAADMISIONS, 23) AS FechaAdmision,
        CONVERT(VARCHAR(5), v.FECHAADMISIONS, 108) AS HoraAdmision,
        CONVERT(VARCHAR(10), v.FECHAADMISIONS, 103) AS FechaAdmisionDMY,
        LTRIM(RTRIM(ISNULL(v.CLASEPACIENTE, ''))) AS ClasePaciente,
        cp.Descripcion AS ClasePacienteDescripcion,
        LTRIM(RTRIM(ISNULL(v.NUMEROINTERNACION, ''))) AS NumeroInternacion,
        LTRIM(RTRIM(ISNULL(v.TIPOADMISION, ''))) AS TipoAdmision,
        ta.Descripcion AS TipoAdmisionDescripcion,
        v.IdLugarEpisodio,
        le.Descripcion AS LugarEpisodioDescripcion,
        v.ORIGENADMISION AS OrigenAdmision,
        oa.Descripcion AS OrigenAdmisionDescripcion,
        LTRIM(RTRIM(ISNULL(v.DIAGNOSTICO, ''))) AS Diagnostico,
        LTRIM(RTRIM(ISNULL(d.Descripcion, ''))) AS DiagnosticoDescripcion,
        LTRIM(RTRIM(ISNULL(v.ESTADOAMBULATORIO, ''))) AS EstadoAmbulatorio,
        ea.Descripcion AS EstadoAmbulatorioDescripcion,
        v.DOCTORADMISOR AS DoctorAdmisor,
        LTRIM(RTRIM(ISNULL(docAdm.ApellidoNombre, ''))) AS DoctorAdmisorNombre,
        v.CLIENTE AS Cliente,
        LTRIM(RTRIM(ISNULL(cli.RazonSocial, ''))) AS CoberturaOS,
        v.CONTRATO AS Contrato,
        LTRIM(RTRIM(ISNULL(conv.Descripcion, ''))) AS ContratoDescripcion,
        v.DOCTORASISTIENDO AS DoctorAsistiendo,
        LTRIM(RTRIM(ISNULL(docAsis.ApellidoNombre, ''))) AS DoctorAsistiendoNombre,
        LTRIM(RTRIM(ISNULL(v.TIPOPACIENTE, ''))) AS TipoPaciente,
        tp.Descripcion AS TipoPacienteDescripcion,
        v.DOCTORCONSULTOR AS DoctorCabecera,
        LTRIM(RTRIM(ISNULL(docCab.ApellidoNombre, ''))) AS DoctorCabeceraNombre,
        LTRIM(RTRIM(ISNULL(COALESCE(bed.ValorSector, v.VALORSECTOR), ''))) AS Sector,
        LTRIM(RTRIM(ISNULL(COALESCE(bed.ValorHabitacionCama, v.VALORHABITACIONCAMA), ''))) AS Habitacion,
        LTRIM(RTRIM(ISNULL(sec.Descripcion, ''))) AS SectorDescripcion,
        LTRIM(RTRIM(ISNULL(v.SERVICIOHOSPITAL, ''))) AS ServicioHospital,
        LTRIM(RTRIM(ISNULL(sm.Descripcion, ''))) AS ServicioHospitalDescripcion,
        v.FECHAEGRESO AS FechaEgresoClarion,
        v.HORAEGRESO AS HoraEgresoClarion,
        CASE
          WHEN TRY_CAST(v.FechaEgreso AS int) IS NOT NULL AND TRY_CAST(v.FechaEgreso AS int) > 0
               AND OBJECT_ID(N'dbo.fn_ClarionDATE2SQL', N'FN') IS NOT NULL
          THEN CONVERT(VARCHAR(10), dbo.fn_ClarionDATE2SQL(v.FechaEgreso), 23)
          ELSE NULL
        END AS FechaEgreso,
        CASE
          WHEN TRY_CAST(v.HoraEgreso AS int) IS NOT NULL AND TRY_CAST(v.HoraEgreso AS int) > 0
               AND OBJECT_ID(N'dbo.fn_ClarionTIME2SQL', N'FN') IS NOT NULL
          THEN CONVERT(VARCHAR(5), dbo.fn_ClarionTIME2SQL(v.HoraEgreso), 108)
          ELSE NULL
        END AS HoraEgreso,
        v.DISPOSICIONEGRESO AS DisposicionEgreso,
        LTRIM(RTRIM(ISNULL(v.DIAGNOSTICOEGRESO, ''))) AS DiagnosticoEgreso,
        v.OperadorEgreso,
        CASE
          WHEN v.OperadorEgreso IS NULL OR TRY_CAST(v.OperadorEgreso AS int) IS NULL OR TRY_CAST(v.OperadorEgreso AS int) <= 0
          THEN ''
          ELSE LTRIM(RTRIM(
            CONCAT(
              NULLIF(LTRIM(RTRIM(ISNULL(pwEgr.Apellido, ''))), ''),
              CASE
                WHEN NULLIF(LTRIM(RTRIM(ISNULL(pwEgr.Apellido, ''))), '') IS NOT NULL
                     AND NULLIF(LTRIM(RTRIM(ISNULL(pwEgr.Nombres, ''))), '') IS NOT NULL
                THEN ', '
                ELSE ''
              END,
              NULLIF(LTRIM(RTRIM(ISNULL(pwEgr.Nombres, ''))), '')
            )
          ))
        END AS OperadorEgresoNombre,
        ${centro.select}
      FROM dbo.imVisita v
      INNER JOIN dbo.imPacientes p ON v.IDPACIENTE = p.IdPaciente
      LEFT JOIN dbo.imClasePaciente cp ON LTRIM(RTRIM(ISNULL(v.CLASEPACIENTE, ''))) = LTRIM(RTRIM(ISNULL(cp.Valor, '')))
      LEFT JOIN dbo.imTipoAdmision ta ON LTRIM(RTRIM(ISNULL(v.TIPOADMISION, ''))) = LTRIM(RTRIM(ISNULL(ta.Valor, '')))
      LEFT JOIN dbo.imLugarEpisodio le ON v.IdLugarEpisodio = le.IdLugarEpisodio
      LEFT JOIN dbo.imOrigenAdmision oa ON v.ORIGENADMISION = oa.Valor
      LEFT JOIN dbo.imDiagnosticos d ON LTRIM(RTRIM(ISNULL(v.DIAGNOSTICO, ''))) = LTRIM(RTRIM(ISNULL(d.CodigoOMS, '')))
      LEFT JOIN dbo.imEstadoAmbulatorio ea ON LTRIM(RTRIM(ISNULL(v.ESTADOAMBULATORIO, ''))) = LTRIM(RTRIM(ISNULL(ea.Valor, '')))
      LEFT JOIN dbo.imPersonal docAdm ON v.DOCTORADMISOR = docAdm.Valor
      LEFT JOIN dbo.imPersonal docAsis ON v.DOCTORASISTIENDO = docAsis.Valor
      LEFT JOIN dbo.imPersonal docCab ON v.DOCTORCONSULTOR = docCab.Valor
      LEFT JOIN dbo.imClientes cli ON v.CLIENTE = cli.Valor
      LEFT JOIN dbo.imClientesConvenios conv
        ON conv.Valor = v.CLIENTE AND conv.Codigo = v.CONTRATO
      LEFT JOIN dbo.imTipoPaciente tp ON LTRIM(RTRIM(ISNULL(v.TIPOPACIENTE, ''))) = LTRIM(RTRIM(ISNULL(tp.Valor, '')))
      LEFT JOIN dbo.imServiciosMedicos sm ON LTRIM(RTRIM(ISNULL(v.SERVICIOHOSPITAL, ''))) = LTRIM(RTRIM(ISNULL(sm.Valor, '')))
      LEFT JOIN dbo.imPassword pwEgr ON pwEgr.CodOperador = TRY_CAST(v.OperadorEgreso AS int)
      ${centro.join}
      OUTER APPLY (
        SELECT TOP 1 hc.ValorSector, hc.ValorHabitacionCama
        FROM dbo.imHabitacionCamas hc
        WHERE hc.NumeroVisita = v.NUMEROVISITA
        ORDER BY
          CASE
            WHEN LTRIM(RTRIM(ISNULL(hc.ValorSector, ''))) = LTRIM(RTRIM(ISNULL(v.VALORSECTOR, '')))
             AND LTRIM(RTRIM(ISNULL(hc.ValorHabitacionCama, ''))) = LTRIM(RTRIM(ISNULL(v.VALORHABITACIONCAMA, '')))
            THEN 0 ELSE 1
          END,
          CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(hc.ValorEstadoCama, '')))) = 'O' THEN 0 ELSE 1 END
      ) bed
      LEFT JOIN dbo.imSectores sec ON LTRIM(RTRIM(ISNULL(COALESCE(bed.ValorSector, v.VALORSECTOR), ''))) = LTRIM(RTRIM(ISNULL(sec.Valor, '')))
      WHERE v.NUMEROVISITA = @param0
    `,
    [{ value: nv }],
  );

  const visita = rows?.[0] || null;
  if (!visita) return null;

  const catalogos = await obtenerCatalogosAdmision(visita.Cliente);

  return { visita, catalogos };
}

async function obtenerCatalogosAdmision(clienteId) {
  const cli = _toIntOrNull(clienteId);
  const [
    clasesPaciente,
    tiposAdmision,
    tiposPaciente,
    estadosAmbulatorios,
    lugaresEpisodio,
    origenesAdmision,
    convenios,
  ] = await Promise.all([
    executeQuery(`SELECT Valor, Descripcion FROM dbo.imClasePaciente ORDER BY Descripcion`).catch(() => []),
    executeQuery(`SELECT Valor, Descripcion FROM dbo.imTipoAdmision ORDER BY Descripcion`).catch(() => []),
    executeQuery(`SELECT Valor, Descripcion FROM dbo.imTipoPaciente ORDER BY Descripcion`).catch(() => []),
    executeQuery(`SELECT Valor, Descripcion FROM dbo.imEstadoAmbulatorio ORDER BY Descripcion`).catch(() => []),
    executeQuery(`SELECT IdLugarEpisodio AS Valor, Descripcion FROM dbo.imLugarEpisodio ORDER BY Descripcion`).catch(() => []),
    executeQuery(`SELECT Valor, Descripcion FROM dbo.imOrigenAdmision ORDER BY Descripcion`).catch(() => []),
    cli != null && cli > 0
      ? executeQuery(
          `
            SELECT Codigo AS Valor, Descripcion
            FROM dbo.imClientesConvenios
            WHERE Valor = @param0
            ORDER BY Codigo
          `,
          [{ value: cli }],
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  return {
    clasesPaciente: clasesPaciente || [],
    tiposAdmision: tiposAdmision || [],
    tiposPaciente: tiposPaciente || [],
    estadosAmbulatorios: estadosAmbulatorios || [],
    lugaresEpisodio: lugaresEpisodio || [],
    origenesAdmision: origenesAdmision || [],
    convenios: convenios || [],
  };
}

/**
 * Actualiza campos de "Datos Principales" en imVisita.
 */
async function actualizarDatosPrincipales(numeroVisita, body = {}) {
  const nv = Number(numeroVisita);
  if (!Number.isFinite(nv) || nv <= 0) {
    const err = new Error('numeroVisita inválido');
    err.statusCode = 400;
    throw err;
  }

  const existing = await executeQuery(
    `SELECT TOP 1 NUMEROVISITA, FECHAADMISIONS FROM dbo.imVisita WHERE NUMEROVISITA = @param0`,
    [{ value: nv }],
  );
  if (!existing?.length) {
    const err = new Error('Admisión no encontrada');
    err.statusCode = 404;
    throw err;
  }

  let fechaAdmision = existing[0].FECHAADMISIONS;
  const fechaStr = _trimStr(body.fechaAdmision);
  const horaStr = _trimStr(body.horaAdmision);
  if (fechaStr) {
    const hm = horaStr && /^\d{1,2}:\d{2}/.test(horaStr) ? horaStr.slice(0, 5) : '00:00';
    const parsed = new Date(`${fechaStr}T${hm}:00`);
    if (!Number.isNaN(parsed.getTime())) {
      fechaAdmision = parsed;
    }
  }

  const clasePaciente = _trimStr(body.clasePaciente, 1) || ' ';
  const tipoAdmision = _trimStr(body.tipoAdmision, 1) || ' ';
  const tipoPaciente = _trimStr(body.tipoPaciente, 1) || null;
  const numeroInternacion = _trimStr(body.numeroInternacion, 40);
  const diagnostico = _trimStr(body.diagnostico, 8) || '';
  const estadoAmbulatorio = _trimStr(body.estadoAmbulatorio, 2) || '';
  const idLugarEpisodio = _toIntOrNull(body.idLugarEpisodio);
  const origenAdmision = _toIntOrZero(body.origenAdmision);
  const doctorAdmisor = _toIntOrZero(body.doctorAdmisor);
  const doctorAsistiendo = _toIntOrZero(body.doctorAsistiendo);
  const doctorCabecera = _toIntOrNull(body.doctorCabecera);
  const cliente = _toIntOrZero(body.cliente);
  const contrato = _toIntOrZero(body.contrato);

  await executeQuery(
    `
      UPDATE dbo.imVisita
      SET
        FECHAADMISIONS = @param1,
        CLASEPACIENTE = @param2,
        TIPOADMISION = @param3,
        TIPOPACIENTE = @param4,
        NUMEROINTERNACION = @param5,
        DIAGNOSTICO = @param6,
        ESTADOAMBULATORIO = @param7,
        IdLugarEpisodio = @param8,
        ORIGENADMISION = @param9,
        DOCTORADMISOR = @param10,
        DOCTORASISTIENDO = @param11,
        DOCTORCONSULTOR = @param12,
        CLIENTE = @param13,
        CONTRATO = @param14
      WHERE NUMEROVISITA = @param0
    `,
    [
      { value: nv, type: 'Int' },
      { value: fechaAdmision, type: 'DateTime' },
      { value: clasePaciente, type: 'VarChar' },
      { value: tipoAdmision, type: 'VarChar' },
      { value: tipoPaciente, type: 'VarChar' },
      { value: numeroInternacion, type: 'VarChar' },
      { value: diagnostico.padEnd(8, ' ').slice(0, 8), type: 'VarChar' },
      { value: estadoAmbulatorio, type: 'VarChar' },
      { value: idLugarEpisodio, type: 'Int' },
      { value: origenAdmision, type: 'Int' },
      { value: doctorAdmisor, type: 'Int' },
      { value: doctorAsistiendo, type: 'Int' },
      { value: doctorCabecera, type: 'Int' },
      { value: cliente, type: 'Int' },
      { value: contrato, type: 'Int' },
    ],
  );

  return obtenerDatosPrincipales(nv);
}

module.exports = {
  buscarAdmisiones,
  obtenerPracticasPorVisita,
  exportarAdmisionCompleta,
  exportarAdmisionSelectivo,
  listarNumerosVisitaPaciente,
  obtenerDatosPrincipales,
  actualizarDatosPrincipales,
  obtenerCatalogosAdmision,
};
