/**
 * @fileoverview Rutas para gestionar las operaciones CRUD de la tabla imTipoPaciente
 * @module routes/tipoPaciente.routes
 */

const express = require('express');
const router = express.Router();
const tipoPacienteController = require('../controllers/tipoPaciente.controller');

/**
 * @swagger
 * /api/tipopaciente:
 *   get:
 *     summary: Obtiene todos los tipos de paciente
 *     tags: [TipoPaciente]
 *     responses:
 *       200:
 *         description: Lista de tipos de paciente
 *       500:
 *         description: Error en el servidor
 */
router.get('/', tipoPacienteController.getTiposPaciente);

/**
 * @swagger
 * /api/tipopaciente/{valor}:
 *   get:
 *     summary: Obtiene un tipo de paciente por su valor
 *     tags: [TipoPaciente]
 *     parameters:
 *       - in: path
 *         name: valor
 *         schema:
 *           type: string
 *         required: true
 *         description: Valor del tipo de paciente
 *     responses:
 *       200:
 *         description: Tipo de paciente encontrado
 *       404:
 *         description: Tipo de paciente no encontrado
 *       500:
 *         description: Error en el servidor
 */
router.get('/:valor', tipoPacienteController.getTipoPaciente);

/**
 * @swagger
 * /api/tipopaciente:
 *   post:
 *     summary: Crea un nuevo tipo de paciente
 *     tags: [TipoPaciente]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - valor
 *               - descripcion
 *             properties:
 *               valor:
 *                 type: string
 *                 description: Valor del tipo de paciente (1 carácter)
 *               descripcion:
 *                 type: string
 *                 description: Descripción del tipo de paciente
 *     responses:
 *       201:
 *         description: Tipo de paciente creado
 *       400:
 *         description: Datos inválidos
 *       409:
 *         description: Ya existe un tipo de paciente con ese valor
 *       500:
 *         description: Error en el servidor
 */
router.post('/', tipoPacienteController.createTipoPaciente);

/**
 * @swagger
 * /api/tipopaciente/{valor}:
 *   put:
 *     summary: Actualiza un tipo de paciente existente
 *     tags: [TipoPaciente]
 *     parameters:
 *       - in: path
 *         name: valor
 *         schema:
 *           type: string
 *         required: true
 *         description: Valor del tipo de paciente
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - descripcion
 *             properties:
 *               descripcion:
 *                 type: string
 *                 description: Descripción del tipo de paciente
 *     responses:
 *       200:
 *         description: Tipo de paciente actualizado
 *       404:
 *         description: Tipo de paciente no encontrado
 *       500:
 *         description: Error en el servidor
 */
router.put('/:valor', tipoPacienteController.updateTipoPaciente);

/**
 * @swagger
 * /api/tipopaciente/{valor}:
 *   delete:
 *     summary: Elimina un tipo de paciente
 *     tags: [TipoPaciente]
 *     parameters:
 *       - in: path
 *         name: valor
 *         schema:
 *           type: string
 *         required: true
 *         description: Valor del tipo de paciente
 *     responses:
 *       200:
 *         description: Tipo de paciente eliminado
 *       404:
 *         description: Tipo de paciente no encontrado
 *       500:
 *         description: Error en el servidor
 */
router.delete('/:valor', tipoPacienteController.deleteTipoPaciente);

module.exports = router;
