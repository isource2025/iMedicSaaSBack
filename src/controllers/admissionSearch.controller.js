const admissionSearchService = require('../services/admissionSearch.service');
const { buildSelectiveExportPdf } = require('../services/admissionSearchExportPdf');

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
      data: payload,
    });
  } catch (error) {
    console.error('Error al obtener detalle de admisión:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener detalle de admisión',
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
        message: 'numeroVisita inválido',
      });
    }

    const body = req.body || {};
    const rawSections = Array.isArray(body.sections) ? body.sections : [];
    const sections = rawSections.map(String).filter((s) => EXPORT_SECTIONS.has(s));

    if (sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Seleccioná al menos un tipo de dato para exportar',
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
        message: 'Indicá fecha desde y/o hasta, o activá "Exportar todo"',
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
        message: 'Admisión no encontrada',
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
    console.error('Error en export selectivo de admisión:', error);
    res.status(500).json({
      success: false,
      message: 'Error al generar la exportación',
    });
  }
}

module.exports = {
  buscar,
  detalle,
  exportSelectivo,
};
