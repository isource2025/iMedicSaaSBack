const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authJwt.middleware');
const { requirePermiso } = require('../middlewares/requirePermiso.middleware');
const { requireTenant } = require('../middlewares/requireTenant.middleware');
const ctrl = require('../controllers/agendaConfig.controller');
const agendaCtrl = require('../controllers/agenda.controller');
const racCtrl = require('../controllers/agendaRac.controller');
const agendaAdjCtrl = require('../controllers/agendaAdjuntos.controller');
const turneroCtrl = require('../controllers/turnero.controller');

router.use(requireAuth, requireTenant);

// Catálogos (cualquier usuario autenticado con acceso a TURNOS)
router.get('/catalogos', requirePermiso('TURNOS'), ctrl.obtenerCatalogos);

// Disponibilidad global por fecha (médicos con cupo libre)
router.get(
	'/disponibilidad',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.obtenerDisponibilidad,
);

// Profesionales con agenda configurada (sin depender de la fecha)
router.get(
	'/profesionales',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.listarProfesionales,
);

// RAC de enfermería por turno
router.get(
	'/turnos/:idTurno/detalle',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.obtenerDetalleAtencion,
);
router.get(
	'/turnos/:idTurno/rac',
	requirePermiso('TURNOS.AGENDA.VER'),
	racCtrl.obtenerRac,
);
router.post(
	'/turnos/:idTurno/rac/controles',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	racCtrl.crearControl,
);
router.delete(
	'/turnos/:idTurno/rac/controles/:valor',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	racCtrl.eliminarControl,
);
router.post(
	'/turnos/:idTurno/rac/medicacion',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	racCtrl.crearMedicacion,
);
router.delete(
	'/turnos/:idTurno/rac/medicacion/:idCtrlMedica',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	racCtrl.eliminarMedicacion,
);
router.patch(
	'/turnos/:idTurno/rac/triage',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	racCtrl.actualizarTriage,
);

// Adjuntos por turno (agenda, pre-cierre)
router.get(
	'/turnos/:idTurno/adjuntos',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaAdjCtrl.listarAdjuntosTurno,
);
router.post(
	'/turnos/:idTurno/adjuntos',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	agendaAdjCtrl.uploadMiddleware,
	agendaAdjCtrl.subirAdjuntoTurno,
);

// Búsqueda CIE-10 (para cierre de turno)
router.get(
	'/diagnosticos/buscar',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.buscarDiagnosticos,
);

// Búsqueda clientes/coberturas (para cierre de turno)
router.get(
	'/clientes/buscar',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.buscarClientes,
);

// Búsqueda tipos pedidos/estudios (procedimientos y solicitudes)
router.get(
	'/tipos-pedidos-estudios/buscar',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.buscarTiposPedidosEstudios,
);

// Sectores/servicios receptores para pedidos de estudios
router.get(
	'/sectores-receptor-estudios',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.listarSectoresReceptorEstudios,
);

// Turnos históricos de un paciente (búsqueda en agenda)
router.get(
	'/turnos-por-paciente',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.buscarTurnosPorPaciente,
);

// Horarios — configuración semanal del médico
router.get(
	'/horarios/:matricula',
	requirePermiso('TURNOS.CONFIGURACION.VER'),
	ctrl.obtenerHorarios,
);
router.put(
	'/horarios/:matricula',
	requirePermiso('TURNOS.CONFIGURACION.EDITAR'),
	ctrl.reemplazarHorarios,
);

// No-horarios (ausencias)
router.get(
	'/no-horarios/:matricula',
	requirePermiso('TURNOS.EXCEPCIONES.VER'),
	ctrl.listarNoHorarios,
);
router.post(
	'/no-horarios/:matricula',
	requirePermiso('TURNOS.EXCEPCIONES.CREAR'),
	ctrl.crearNoHorario,
);
router.put(
	'/no-horarios/:matricula',
	requirePermiso('TURNOS.EXCEPCIONES.EDITAR'),
	ctrl.actualizarNoHorario,
);
router.delete(
	'/no-horarios/:matricula',
	requirePermiso('TURNOS.EXCEPCIONES.ELIMINAR'),
	ctrl.eliminarNoHorario,
);

// Agenda operativa (slots / turnos) — rutas con :matricula al final
router.get(
	'/:matricula/dias-agenda',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.obtenerDiasConAgenda,
);
router.get(
	'/:matricula/slots',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.obtenerSlots,
);
router.get(
	'/:matricula/resumen',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.obtenerResumen,
);
router.get(
	'/:matricula/turnos',
	requirePermiso('TURNOS.AGENDA.VER'),
	agendaCtrl.listarTurnos,
);
router.post(
	'/:matricula/turnos',
	requirePermiso('TURNOS.AGENDA.CREAR'),
	agendaCtrl.asignarTurno,
);
router.patch(
	'/:matricula/turnos/:idTurno',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	agendaCtrl.actualizarTurno,
);
router.patch(
	'/:matricula/turnos/:idTurno/cancelar',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	agendaCtrl.cancelarTurno,
);
router.patch(
	'/:matricula/turnos/:idTurno/llegada',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	agendaCtrl.marcarLlegada,
);
router.patch(
	'/:matricula/turnos/:idTurno/ingreso',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	agendaCtrl.marcarIngreso,
);
router.post(
	'/:matricula/turnos/:idTurno/llamar',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	turneroCtrl.llamarTurno,
);
router.patch(
	'/:matricula/turnos/:idTurno/cerrar',
	requirePermiso('TURNOS.AGENDA.EDITAR'),
	agendaCtrl.cerrarTurno,
);
router.delete(
	'/:matricula/turnos/:idTurno',
	requirePermiso('TURNOS.AGENDA.ELIMINAR'),
	agendaCtrl.borrarTurno,
);

module.exports = router;
