const admissionSearchService = require('../services/admissionSearch.service');
const agendaService = require('../services/agenda.service');
const visitaResumenIaService = require('../services/visitaResumenIa.service');
const { jsonSafe } = require('../utils/jsonSafe');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

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
    'interconsultas',
    'protocolos',
    'epicrisis',
    'controles',
    'dietas',
    'balanceHidrico',
    'evolucionEnfermeria',
    'insumos',
    'adjuntos',
    'evoluciones',
    'laboratorios',
    'movimientos',
  ]);
  return sections.some((s) => NEED_DATE.has(s));
}

async function buscar(req, res) {
  try {
    const {
      termino = '',
      dni = '',
      nombreApellido = '',
      fechaInicio = '',
      fechaFin = '',
      porEgreso = '',
      porIngreso = '',
      tipoAtencion = '',
      cliente = '',
      page = 1,
      limit = 25,
    } = req.query;

    const result = await admissionSearchService.buscarAdmisiones({
      termino,
      dni,
      nombreApellido,
      fechaInicio,
      fechaFin,
      porEgreso,
      porIngreso,
      tipoAtencion,
      cliente,
      page: Number(page),
      limit: Number(limit),
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error en búsqueda integral de admisiones:', error);
    res.status(statusDeError(error)).json({
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
    res.status(statusDeError(error)).json({
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
    res.status(statusDeError(error)).json({
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
    res.status(statusDeError(error)).json({
      success: false,
      message: 'Error al obtener catálogos de admisión',
    });
  }
}

async function coberturas(req, res) {
  try {
    const data = await admissionSearchService.listarCoberturas();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error al listar coberturas para búsqueda:', error);
    res.status(statusDeError(error)).json({
      success: false,
      message: 'Error al listar coberturas',
    });
  }
}

const EXPORT_SECTIONS = new Set(admissionSearchService.VISITA_SECCIONES);
async function resumenIa(req, res) {
  try {
    const data = await visitaResumenIaService.generarResumenVisita(req.params.numeroVisita);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error en resumen IA de visita:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error al generar el resumen de la visita',
    });
  }
}

/**
 * Criterios del export (secciones, período, filtro de evoluciones) desde el body.
 * Devuelve `{ error }` con el mensaje para el usuario si son inválidos.
 */
function parseCriteriosExport(body, exportAllPorDefecto) {
  const rawSections = Array.isArray(body.sections) ? body.sections : [];
  const sections = rawSections.map(String).filter((s) => EXPORT_SECTIONS.has(s));
  if (sections.length === 0) return { error: 'Seleccioná al menos un tipo de dato para exportar' };

  const exportAll = body.exportAll == null ? exportAllPorDefecto : Boolean(body.exportAll);
  const fechaInicio = body.fechaInicio != null ? String(body.fechaInicio).trim() : '';
  const fechaFin = body.fechaFin != null ? String(body.fechaFin).trim() : '';
  if (!exportAll && sectionsRequireDateFilter(sections) && !fechaInicio && !fechaFin) {
    return { error: 'Indicá fecha desde y/o hasta, o elegí "Toda la visita"' };
  }
  return {
    sections,
    exportAll,
    fechaInicio,
    fechaFin,
    evolucionServicioIds: parseEvolucionServicioIds(body),
    evolucionSectorIds: parseEvolucionSectorIds(body),
    paraPdf: true,
  };
}

/** Datos de la visita para el PDF global (lo arma el front con los mismos módulos de cada sección). */
async function exportSelectivo(req, res) {
  try {
    const numeroVisita = Number(req.params.numeroVisita);
    if (!Number.isFinite(numeroVisita) || numeroVisita <= 0) {
      return res.status(400).json({
        success: false,
        message: 'numeroVisita inválido',
      });
    }

    const criterios = parseCriteriosExport(req.body || {}, false);
    if (criterios.error) {
      return res.status(400).json({ success: false, message: criterios.error });
    }

    const payload = await admissionSearchService.exportarAdmisionSelectivo(numeroVisita, criterios);
    if (!payload) {
      return res.status(404).json({
        success: false,
        message: 'Admisión no encontrada',
      });
    }

    res.json({ success: true, data: payload });
  } catch (error) {
    if (error.code === 'NO_SECTIONS') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Error en export selectivo de admisión:', error);
    res.status(statusDeError(error)).json({
      success: false,
      message: 'Error al generar la exportación',
    });
  }
}

async function turnosActivosPaciente(req, res) {
  try {
    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
      return res.status(400).json({
        success: false,
        message: 'idPaciente inválido',
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
  coberturas,
  exportSelectivo,
  resumenIa,
  turnosActivosPaciente,
  exportGeneralPaciente,
};

async function exportGeneralPaciente(req, res) {
  try {
    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
      return res.status(400).json({
        success: false,
        message: 'idPaciente inválido',
      });
    }

    const criterios = parseCriteriosExport(req.body || {}, true);
    if (criterios.error) {
      return res.status(400).json({ success: false, message: criterios.error });
    }

    const numeros = await admissionSearchService.listarNumerosVisitaPaciente(idPaciente, 80);
    if (!numeros.length) {
      return res.status(404).json({
        success: false,
        message: 'El paciente no tiene visitas para exportar',
      });
    }

    const visitas = [];
    for (const nv of numeros) {
      const payload = await admissionSearchService.exportarAdmisionSelectivo(nv, criterios);
      if (payload) visitas.push(payload);
    }

    res.json({ success: true, data: { idPaciente, visitas } });
  } catch (error) {
    if (error.code === 'NO_SECTIONS' || error.code === 'NO_VISITS') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    console.error('Error en export general de paciente:', error);
    res.status(statusDeError(error)).json({
      success: false,
      message: 'Error al generar la exportación general',
    });
  }
}
