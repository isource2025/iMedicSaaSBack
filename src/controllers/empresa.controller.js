/**
 * Controlador para gestionar la información de la empresa
 */
const empresaService = require('../services/empresa.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');

const obtenerInfoEmpresa = async (req, res) => {
  try {
    const idEmpresa =
      req.idEmpresa ??
      req.auth?.idEmpresa ??
      req.query.id ??
      req.query.idEmpresa ??
      null;
    const empresaInfo = await empresaService.obtenerInfoEmpresa(idEmpresa);
    
    res.json({
      success: true,
      data: empresaInfo
    });
  } catch (error) {
    console.error('Error al obtener información de la empresa:', error);
    res.status(statusDeError(error)).json({
      success: false,
      message: 'Error al obtener información de la empresa',
      error: error.message
    });
  }
};

const idEmpresaDeSesion = (req) => req.idEmpresa ?? req.auth?.idEmpresa ?? null;

/** Logo para el header de los PDFs: cualquier usuario autenticado del tenant. */
const obtenerLogo = async (req, res) => {
  try {
    const data = await empresaService.obtenerLogoEmpresa(idEmpresaDeSesion(req));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[empresa.obtenerLogo] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al obtener el logo'),
    });
  }
};

const actualizarLogo = async (req, res) => {
  try {
    await empresaService.guardarLogoEmpresa(idEmpresaDeSesion(req), req.file?.buffer);
    res.json({ success: true, mensaje: 'Logo guardado' });
  } catch (error) {
    console.error('[empresa.actualizarLogo] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al guardar el logo'),
    });
  }
};

const eliminarLogo = async (req, res) => {
  try {
    await empresaService.eliminarLogoEmpresa(idEmpresaDeSesion(req));
    res.json({ success: true, mensaje: 'Logo eliminado' });
  } catch (error) {
    console.error('[empresa.eliminarLogo] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al eliminar el logo'),
    });
  }
};

const obtenerCatalogos = async (req, res) => {
  try {
    const data = await empresaService.obtenerCatalogosInstitucion();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[empresa.obtenerCatalogos] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al obtener los catálogos'),
    });
  }
};

const actualizarDatos = async (req, res) => {
  try {
    const data = await empresaService.actualizarDatosEmpresa(idEmpresaDeSesion(req), req.body || {});
    res.json({ success: true, data, mensaje: 'Datos de la institución actualizados' });
  } catch (error) {
    console.error('[empresa.actualizarDatos] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al guardar los datos de la institución'),
    });
  }
};

const obtenerPdfDiseno = async (req, res) => {
  try {
    const data = await empresaService.obtenerPdfDiseno(idEmpresaDeSesion(req));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[empresa.obtenerPdfDiseno] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al obtener el diseño de los PDFs'),
    });
  }
};

const guardarPdfDiseno = async (req, res) => {
  try {
    const data = await empresaService.guardarPdfDiseno(idEmpresaDeSesion(req), req.body?.diseno ?? null);
    res.json({ success: true, data, mensaje: data ? 'Diseño guardado' : 'Diseño restablecido' });
  } catch (error) {
    console.error('[empresa.guardarPdfDiseno] ERROR:', error.message);
    res.status(statusDeError(error)).json({
      success: false,
      mensaje: mensajeDeError(error, 'Error al guardar el diseño de los PDFs'),
    });
  }
};

module.exports = {
  obtenerInfoEmpresa,
  obtenerPdfDiseno,
  guardarPdfDiseno,
  obtenerCatalogos,
  actualizarDatos,
  obtenerLogo,
  actualizarLogo,
  eliminarLogo,
};
