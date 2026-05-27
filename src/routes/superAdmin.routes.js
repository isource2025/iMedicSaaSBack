const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const ctrl = require('../controllers/superAdmin.controller');

router.use(requireAuth);

router.get('/dashboard', requirePermiso('PLATAFORMA.PANEL.VER'), ctrl.dashboard);
router.get('/catalogos', requirePermiso('PLATAFORMA.PANEL.VER'), ctrl.catalogos);
router.get('/config', requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'), ctrl.configPlataforma);
router.put('/config', requirePermiso('PLATAFORMA.CONFIG.GESTIONAR'), ctrl.configPlataforma);

router.get('/empresas', requirePermiso('PLATAFORMA.EMPRESAS.VER'), ctrl.listarEmpresas);
router.post('/empresas', requirePermiso('PLATAFORMA.EMPRESAS.CREAR'), ctrl.crearEmpresa);
router.get('/empresas/:id', requirePermiso('PLATAFORMA.EMPRESAS.VER'), ctrl.obtenerEmpresa);
router.put('/empresas/:id', requirePermiso('PLATAFORMA.EMPRESAS.EDITAR'), ctrl.actualizarEmpresa);
router.put('/empresas/:id/conexion', requirePermiso('PLATAFORMA.EMPRESAS.EDITAR'), ctrl.actualizarConexionEmpresa);
router.post('/empresas/:id/conexion/probar', requirePermiso('PLATAFORMA.EMPRESAS.EDITAR'), ctrl.probarConexionEmpresa);
router.delete('/empresas/:id', requirePermiso('PLATAFORMA.EMPRESAS.EDITAR'), ctrl.eliminarEmpresa);
router.put('/empresas/:id/packs', requirePermiso('PLATAFORMA.ONBOARDING.GESTIONAR'), ctrl.actualizarPacks);
router.put('/empresas/:id/onboarding', requirePermiso('PLATAFORMA.ONBOARDING.GESTIONAR'), ctrl.actualizarOnboarding);
router.put('/empresas/:id/suscripcion', requirePermiso('PLATAFORMA.COBRANZA.GESTIONAR'), ctrl.actualizarSuscripcion);
router.get('/empresas/:id/modulos', requirePermiso('PLATAFORMA.EMPRESAS.VER'), ctrl.modulosEmpresa);
router.post('/empresas/:id/usuarios', requirePermiso('PLATAFORMA.USUARIOS.GESTIONAR'), ctrl.vincularUsuario);
router.post('/empresas/:id/usuarios/nuevo', requirePermiso('PLATAFORMA.USUARIOS.GESTIONAR'), ctrl.crearUsuario);
router.put('/empresas/:id/usuarios/:idPersonal', requirePermiso('PLATAFORMA.USUARIOS.GESTIONAR'), ctrl.actualizarUsuario);
router.delete('/empresas/:id/usuarios/:idPersonal', requirePermiso('PLATAFORMA.USUARIOS.GESTIONAR'), ctrl.desvincularUsuario);

router.post('/sectores', requirePermiso('PLATAFORMA.ONBOARDING.GESTIONAR'), ctrl.crearSector);
router.put('/sectores/:valor', requirePermiso('PLATAFORMA.ONBOARDING.GESTIONAR'), ctrl.actualizarSector);
router.delete('/sectores/:valor', requirePermiso('PLATAFORMA.ONBOARDING.GESTIONAR'), ctrl.eliminarSector);

router.get('/usuarios', requirePermiso('PLATAFORMA.USUARIOS.VER'), ctrl.listarUsuarios);

module.exports = router;
