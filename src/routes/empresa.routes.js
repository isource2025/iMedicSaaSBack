/**
 * Rutas para la gestión de información de la empresa
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();
const empresaController = require('../controllers/empresa.controller');
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { restoreTenantFromRequest } = require('../context/tenantContext');
const { LOGO_MAX_BYTES } = require('../services/empresa.service');

const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES },
});

/**
 * @route GET /api/empresa
 * @desc Obtener información de la empresa
 * @access Public
 */
router.get('/', empresaController.obtenerInfoEmpresa);

/** Datos institucionales editables por el admin de la clínica. */
router.put(
  '/',
  requireAuth,
  requireTenant,
  requirePermiso('CONFIGURACION.INSTITUCION.EDITAR'),
  empresaController.actualizarDatos,
);
router.get(
  '/catalogos',
  requireAuth,
  requireTenant,
  requirePermiso('CONFIGURACION.INSTITUCION.VER'),
  empresaController.obtenerCatalogos,
);

/** Diseño de los PDFs: lo leen todos los usuarios del tenant al generar un PDF. */
router.get('/pdf-diseno', requireAuth, requireTenant, empresaController.obtenerPdfDiseno);
router.put(
  '/pdf-diseno',
  requireAuth,
  requireTenant,
  requirePermiso('CONFIGURACION.INSTITUCION.EDITAR'),
  empresaController.guardarPdfDiseno,
);

/** Logo institucional (header de los PDFs). */
router.get('/logo', requireAuth, requireTenant, empresaController.obtenerLogo);
router.put(
  '/logo',
  requireAuth,
  requireTenant,
  requirePermiso('CONFIGURACION.INSTITUCION.EDITAR'),
  uploadLogo.single('archivo'),
  restoreTenantFromRequest,
  empresaController.actualizarLogo,
);
router.delete(
  '/logo',
  requireAuth,
  requireTenant,
  requirePermiso('CONFIGURACION.INSTITUCION.EDITAR'),
  empresaController.eliminarLogo,
);

module.exports = router;
