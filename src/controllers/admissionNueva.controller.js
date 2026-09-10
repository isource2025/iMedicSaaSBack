const admissionNuevaService = require('../services/admissionNueva.service');
const { resolveCodOperador } = require('../utils/sessionIdentity');
const { statusDeError } = require('../utils/httpError');

function fallar(res, error, mensajePorDefecto) {
	const status = error?.statusCode || statusDeError(error);
	res.status(status).json({
		success: false,
		message: error?.message || mensajePorDefecto,
	});
}

async function catalogos(req, res) {
	try {
		const cliente = req.query.cliente != null ? Number(req.query.cliente) : null;
		const data = await admissionNuevaService.obtenerCatalogos(cliente);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al obtener catálogos de nueva admisión:', error);
		fallar(res, error, 'Error al obtener catálogos de admisión');
	}
}

async function requisitosCobertura(req, res) {
	try {
		const cliente = Number(req.params.cliente);
		if (!Number.isFinite(cliente) || cliente < 0) {
			return res.status(400).json({ success: false, message: 'cliente inválido' });
		}
		const data = await admissionNuevaService.requisitosPorCliente(cliente);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al obtener requisitos de la cobertura:', error);
		fallar(res, error, 'Error al obtener requisitos de la cobertura');
	}
}

async function requisitosCatalogo(req, res) {
	try {
		const data = await admissionNuevaService.listarRequisitos();
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al listar requisitos:', error);
		fallar(res, error, 'Error al listar requisitos');
	}
}

async function crear(req, res) {
	try {
		const data = await admissionNuevaService.crearAdmision(req.body || {}, {
			codOperador: resolveCodOperador(req),
		});
		res.status(201).json({ success: true, data });
	} catch (error) {
		console.error('Error al crear la admisión:', error);
		fallar(res, error, 'Error al crear la admisión');
	}
}

async function requisitosVisita(req, res) {
	try {
		const data = await admissionNuevaService.listarRequisitosVisita(req.params.numeroVisita);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al listar requisitos de la visita:', error);
		fallar(res, error, 'Error al listar requisitos de la visita');
	}
}

async function agregarRequisito(req, res) {
	try {
		const data = await admissionNuevaService.agregarRequisito(
			req.params.numeroVisita,
			req.body?.valor,
			req.body?.idPaciente,
		);
		res.status(201).json({ success: true, data });
	} catch (error) {
		console.error('Error al agregar el requisito:', error);
		fallar(res, error, 'Error al agregar el requisito');
	}
}

async function quitarRequisito(req, res) {
	try {
		const data = await admissionNuevaService.quitarRequisito(
			req.params.numeroVisita,
			req.params.valor,
		);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al quitar el requisito:', error);
		fallar(res, error, 'Error al quitar el requisito');
	}
}

async function subirArchivoRequisito(req, res) {
	try {
		if (!req.file) {
			return res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
		}
		const data = await admissionNuevaService.adjuntarArchivoRequisito(
			req.params.numeroVisita,
			req.params.valor,
			req.file,
			{ codOperador: resolveCodOperador(req) },
		);
		res.status(201).json({ success: true, data });
	} catch (error) {
		console.error('Error al subir el archivo del requisito:', error);
		fallar(res, error, 'Error al subir el archivo del requisito');
	}
}

module.exports = {
	catalogos,
	requisitosCobertura,
	requisitosCatalogo,
	crear,
	requisitosVisita,
	agregarRequisito,
	quitarRequisito,
	subirArchivoRequisito,
};
