const fsSync = require('fs');
const axios = require('axios');

const admissionNuevaService = require('../services/admissionNueva.service');
const { resolveCodOperador } = require('../utils/sessionIdentity');
const { statusDeError } = require('../utils/httpError');
const {
	resolveFileServerUrl,
	fileServerHeaders,
	describeFileServerError,
} = require('../utils/fileServerUrl');
const {
	pathLookupCandidates,
	fileServerFileUrl,
	contentTypeForAdjuntoFileName,
} = require('../utils/fileNameEncoding');

const FILE_SERVER_TIMEOUT_MS = Number(process.env.FILE_SERVER_TIMEOUT_MS || 180000);

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
		const data = await admissionNuevaService.requisitosPorCliente(
			cliente,
			req.query.idPaciente,
		);
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

async function ultimaVisita(req, res) {
	try {
		const idPaciente = Number(req.params.idPaciente);
		if (!Number.isFinite(idPaciente) || idPaciente <= 0) {
			return res.status(400).json({ success: false, message: 'idPaciente inválido' });
		}
		const data = await admissionNuevaService.obtenerUltimaVisita(idPaciente);
		res.json({ success: true, data });
	} catch (error) {
		console.error('Error al obtener la última visita del paciente:', error);
		fallar(res, error, 'Error al obtener la última visita del paciente');
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

/**
 * Sirve el archivo de un requisito para verlo desde el formulario. Se apoya en el
 * file server de la clínica y cae al disco local si el archivo quedó ahí por el
 * fallback de subida.
 */
async function streamArchivoRequisito(res, archivo) {
	const candidatos = pathLookupCandidates(archivo.ruta);
	const contentType = contentTypeForAdjuntoFileName(archivo.nombreArchivo);
	const cabeceras = () => {
		res.setHeader('Content-Type', contentType);
		res.setHeader(
			'Content-Disposition',
			`inline; filename="${archivo.nombreArchivo}"; filename*=UTF-8''${encodeURIComponent(
				archivo.nombreArchivo,
			)}`,
		);
		res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
	};

	try {
		const fileServerUrl = await resolveFileServerUrl();
		let respuesta = null;
		let ultimoError = null;
		for (const ruta of candidatos) {
			try {
				respuesta = await axios.get(fileServerFileUrl(fileServerUrl, ruta), {
					responseType: 'stream',
					headers: fileServerHeaders(),
					timeout: FILE_SERVER_TIMEOUT_MS,
					validateStatus: (s) => s >= 200 && s < 300,
				});
				break;
			} catch (e) {
				ultimoError = e;
			}
		}
		if (!respuesta) throw ultimoError || new Error('Archivo no encontrado');
		cabeceras();
		return respuesta.data.pipe(res);
	} catch (errorArchivo) {
		const local = candidatos.find((p) => fsSync.existsSync(p));
		if (local) {
			cabeceras();
			return fsSync.createReadStream(local).pipe(res);
		}
		console.error('No se pudo obtener el archivo del requisito:', errorArchivo.message);
		return res.status(503).json({
			success: false,
			message: describeFileServerError(errorArchivo),
		});
	}
}

async function verArchivoRequisito(req, res) {
	try {
		const archivo = await admissionNuevaService.obtenerArchivoRequisito(
			req.params.numeroVisita,
			req.params.valor,
		);
		if (!archivo) {
			return res
				.status(404)
				.json({ success: false, message: 'El requisito todavía no tiene archivo' });
		}
		return streamArchivoRequisito(res, archivo);
	} catch (error) {
		console.error('Error al ver el archivo del requisito:', error);
		fallar(res, error, 'Error al ver el archivo del requisito');
	}
}

/** Ver archivo de requisito Paciente descubierto en disco (sin NumeroVisita). */
async function verArchivoRequisitoPaciente(req, res) {
	try {
		const archivo = await admissionNuevaService.obtenerArchivoRequisitoPaciente(
			req.params.idPaciente,
			req.params.valor,
		);
		if (!archivo) {
			return res
				.status(404)
				.json({ success: false, message: 'El requisito todavía no tiene archivo' });
		}
		return streamArchivoRequisito(res, archivo);
	} catch (error) {
		console.error('Error al ver el archivo del requisito (paciente):', error);
		fallar(res, error, 'Error al ver el archivo del requisito');
	}
}

module.exports = {
	catalogos,
	requisitosCobertura,
	requisitosCatalogo,
	ultimaVisita,
	verArchivoRequisito,
	verArchivoRequisitoPaciente,
	crear,
	requisitosVisita,
	agregarRequisito,
	quitarRequisito,
	subirArchivoRequisito,
};
