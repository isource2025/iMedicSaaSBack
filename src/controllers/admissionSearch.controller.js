const admissionSearchService = require('../services/admissionSearch.service');
const agendaService = require('../services/agenda.service');
const { jsonSafe } = require('../utils/jsonSafe');
const {
  buildSelectiveExportPdf,
  buildMultiVisitExportPdf,
} = require('../services/admissionSearchExportPdf');

function publicErrorDetail(error) {
  const raw = error?.message || String(error || '');
  return String(raw).slice(0, 400);
}

function parseEvolucionSectorIds(body) {
  const raw = body?.evolucionSectorIds;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()))];
}

function parseEvolucionServicioIds(body) {
  const raw = body?.evolucionServicioIds;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

/** Bloques que usan rango de fechas cuando exportAll es false */
function sectionsRequireDateFilter(sections) {
  const NEED_DATE = new Set([
    'hcIngreso',
    'practicas',
    'indicaciones',
    'medicamentos',
    'estudios',
    'protocolos',
    'adjuntos',
    'evoluciones',
  ]);
  return sections.some((s) => NEED_DATE.has(s));
}

async function buscar(req, res) {
  try {
    const {
      dni = '',
      nombreApellido = '',
      fechaInicio = '',
      fechaFin = '',
      page = 1,
      limit = 25,
    } = req.query;

    const result = await admissionSearchService.buscarAdmisiones({
      dni,
      nombreApellido,
      fechaInicio,
      fechaFin,
      page: Number(page),
      limit: Number(limit),
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error en búsqueda integral de admisiones:', error);
    res.status(500).json({
      success: false,
      message: 'Error al buscar admisiones',
      detail: error?.message || String(error),
    });
  }
}

async function detalle(req, res) {
  try {
    const numeroVisita = Number(req.params.numeroVisita);
    if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
      return res.status(400).json({
        success: false,
        message: 'numeroVisita inválido',
      });
    }

    const payload = await admissionSearchService.exportarAdmisionCompleta(numeroVisita);
    if (!payload) {
      return res.status(404).json({
        success: false,
        message: 'Admisión no encontrada',
      });
    }

    res.json({
      success: true,
      data: jsonSafe(payload),
    });
  } catch (error) {
    console.error('Error al obtener detalle de admisión:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener detalle de admisión',
      detail: publicErrorDetail(error),
    });
  }
}

async function datosPrincipales(req, res) {
  try {
    const numeroVisita = Number(req.params.numeroVisita);
    if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
      return res.status(400).json({
        success: false,
        message: 'numeroVisita inválido',
      });
    }

    const payload = await admissionSearchService.obtenerDatosPrincipales(numeroVisita);
    if (!payload) {
      return res.status(404).json({
        success: false,
        message: 'Admisión no encontrada',
      });
    }

    res.json({ success: true, data: payload });
  } catch (error) {
    console.error('Error al obtener datos principales de admisión:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos principales de admisión',
    });
  }
}

async function actualizarDatosPrincipales(req, res) {
  try {
    const numeroVisita = Number(req.params.numeroVisita);
    if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
      return res.status(400).json({
        success: false,
        message: 'numeroVisita inválido',
      });
    }

    const payload = await admissionSearchService.actualizarDatosPrincipales(
      numeroVisita,
      req.body || {},
    );
    res.json({ success: true, data: payload });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('Error al actualizar datos principales de admisión:', error);
    res.status(status).json({
      success: false,
      message: error.message || 'Error al actualizar datos principales',
    });
  }
}

async function catalogosAdmision(req, res) {
  try {
    const clienteId = req.query.cliente != null ? Number(req.query.cliente) : null;
    const catalogos = await admissionSearchService.obtenerCatalogosAdmision(clienteId);
    res.json({ success: true, data: catalogos });
  } catch (error) {
    console.error('Error al obtener catálogos de admisión:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener catálogos de admisión',
    });
  }
}

const EXPORT_SECTIONS = new Set([
  'admision',
  'hcIngreso',
  'practicas',
  'indicaciones',
  'medicamentos',
  'evoluciones',
  'estudios',
  'protocolos',
  'adjuntos',
]);

async function exportSelectivo(req, res) {
  try {
    const numeroVisita = Number(req.params.numeroVisita);
    if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
      return res.status(400).json({
        success: false,
        message: 'numeroVisita inv?lido',
      });
    }

    const body = req.body || {};
    const rawSections = Array.isArray(body.sections) ? body.sections : [];
    const sections = rawSections.map(String).filter((s) => EXPORT_SECTIONS.has(s));

    if (sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Seleccion? al menos un tipo de dato para exportar',
      });
    }

    const exportAll = Boolean(body.exportAll);
    const fechaInicio = body.fechaInicio != null ? String(body.fechaInicio).trim() : '';
    const fechaFin = body.fechaFin != null ? String(body.fechaFin).trim() : '';
    const evolucionSectorIds = parseEvolucionSectorIds(body);
    const evolucionServicioIds = parseEvolucionServicioIds(body);

    const needDates = sectionsRequireDateFilter(sections);
    if (!exportAll && needDates && !fechaInicio && !fechaFin) {
      return res.status(400).json({
        success: false,
        message: 'Indic? fecha desde y/o hasta, o activ? "Exportar todo"',
      });
    }

    const payload = await admissionSearchService.exportarAdmisionSelectivo(numeroVisita, {
      sections,
      exportAll,
      fechaInicio,
      fechaFin,
      evolucionServicioIds,
      evolucionSectorIds,
    });

    if (!payload) {
      return res.status(404).json({
        success: false,
        message: 'Admisi?n no encontrada',
      });
    }

    const pdfBuf = await buildSelectiveExportPdf(payload);
    const fileName = `visita_${numeroVisita}_export_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuf);
  } catch (error) {
    if (error.code === 'NO_SECTIONS') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Error en export selectivo de admisi?n:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar la exportaci?n',
    });
  }
}

async function turnosActivosPaciente(req, res) {
  try {
    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
      return res.status(400).json({
        success: false,
        message: 'idPaciente inv?lido',
      });
    }
    const data = await agendaService.buscarTurnosPorPaciente(idPaciente, { soloActivos: true });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error al listar turnos activos del paciente:', error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: error?.message || 'Error al cargar turnos activos',
    });
  }
}

module.exports = {
  buscar,
  detalle,
  datosPrincipales,
  actualizarDatosPrincipales,
  catalogosAdmision,
  exportSelectivo,
  turnosActivosPaciente,
  exportGeneralPaciente,
};

async function exportGeneralPaciente(req, res) {
  try {
    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
      return res.status(400).json({
        success: false,
        message: 'idPaciente inv?lido',
      });
    }

    const body = req.body || {};
    const rawSections = Array.isArray(body.sections) ? body.sections : [];
    const sections = rawSections.map(String).filter((s) => EXPORT_SECTIONS.has(s));
    if (sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Seleccion? al menos un tipo de dato para exportar',
      });
    }

    const exportAll = body.exportAll !== false;
    const fechaInicio = body.fechaInicio != null ? String(body.fechaInicio).trim() : '';
    const fechaFin = body.fechaFin != null ? String(body.fechaFin).trim() : '';
    const evolucionSectorIds = parseEvolucionSectorIds(body);
    const evolucionServicioIds = parseEvolucionServicioIds(body);

    const needDates = sectionsRequireDateFilter(sections);
    if (!exportAll && needDates && !fechaInicio && !fechaFin) {
      return res.status(400).json({
        success: false,
        message: 'Indic? fecha desde y/o hasta, o activ? "Exportar todo"',
      });
    }

    const visitas = await admissionSearchService.listarNumerosVisitaPaciente(idPaciente, 80);
    if (!visitas.length) {
      return res.status(404).json({
        success: false,
        message: 'El paciente no tiene visitas para exportar',
      });
    }

    const pdfBuffers = [];
    for (const nv of visitas) {
      const payload = await admissionSearchService.exportarAdmisionSelectivo(nv, {
        sections,
        exportAll,
        fechaInicio,
        fechaFin,
        evolucionServicioIds,
        evolucionSectorIds,
      });
      if (!payload) continue;
      pdfBuffers.push(await buildSelectiveExportPdf(payload));
    }

    const pdfBuf = await buildMultiVisitExportPdf(pdfBuffers);
    const fileName = `paciente_${idPaciente}_carpeta_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuf);
  } catch (error) {
    if (error.code === 'NO_SECTIONS' || error.code === 'NO_VISITS') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Error en export general de paciente:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar la exportaci?n general',
    });
  }
}
