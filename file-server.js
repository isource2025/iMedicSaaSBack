/**
 * File server de adjuntos de una clínica.
 *
 * Corre en la PC de la clínica y guarda los archivos en el disco de esa
 * clínica. Escucha SOLO en 127.0.0.1: la única puerta de entrada es el túnel
 * de Cloudflare (files-<clinica>.imedic.com.ar), así no hay que abrir puertos
 * en el router.
 *
 *   Cloudflare ──► cloudflared (servicio) ──► 127.0.0.1:9012 ──► E:\adjuntos
 *
 * Se instala como servicio con scripts/tunnel/Instalar-Clinica.ps1.
 *
 * Variables (scripts/tunnel/clinica.env):
 *   IMEDIC_FS_PORT    puerto local (default 9012)
 *   IMEDIC_FS_ROOT    carpeta de adjuntos (default E:\adjuntos)
 *   IMEDIC_FS_TOKEN   si está seteado, exige el header x-imedic-token
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
	buildVidalDest,
	fixMulterFile,
	decodeMultipartFilename,
	pathLookupCandidates,
	sanitizeWindowsFileName,
} = require('./src/utils/fileNameEncoding');

const PORT = Number(process.env.IMEDIC_FS_PORT || process.env.FILE_SERVER_PORT || 9012);
const UPLOAD_ROOT = process.env.IMEDIC_FS_ROOT || process.env.FILE_SERVER_ROOT || 'E:\\adjuntos';
/** Cloudflare no deja pasar más de 100 MB por request en los planes Free/Pro. */
const MAX_BYTES = Number(process.env.IMEDIC_FS_MAX_MB || 100) * 1024 * 1024;
const TOKEN = String(process.env.IMEDIC_FS_TOKEN || '').trim();

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const upload = multer({
	dest: path.join(process.cwd(), '.tmp-uploads'),
	limits: { fileSize: MAX_BYTES },
});

const MIME_POR_EXT = {
	'.pdf': 'application/pdf',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.dcm': 'application/dicom',
	'.dicom': 'application/dicom',
	'.webm': 'video/webm',
	'.mp4': 'video/mp4',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xls': 'application/vnd.ms-excel',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Las bases viejas guardaron rutas con D:\ y F:\ que hoy son E:\. */
function normalizarRuta(ruta) {
	if (!ruta) return ruta;
	let r = decodeMultipartFilename(String(ruta));
	if (/^D:\\/i.test(r)) r = r.replace(/^D:\\/i, 'E:\\');
	if (/^F:\\/i.test(r)) r = r.replace(/^F:\\/i, 'E:\\');
	return r;
}

/**
 * Ubica el archivo probando las variantes de nombre que dejaron las versiones
 * anteriores (mojibake de la Ñ, guión bajo en lugar de Ñ, otra raíz de disco).
 */
function buscarArchivo(rutaPedida) {
	const candidatos = pathLookupCandidates(rutaPedida);
	const nombre = sanitizeWindowsFileName(path.basename(rutaPedida || ''));
	candidatos.push(path.join(UPLOAD_ROOT, nombre));
	candidatos.push(path.join(UPLOAD_ROOT, path.basename(rutaPedida || '')));

	for (const c of candidatos) {
		if (!c) continue;
		try {
			if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
		} catch {
			/* siguiente candidato */
		}
	}

	// Último recurso: comparar por nombre normalizado dentro de la carpeta.
	const buscado = decodeMultipartFilename(nombre).toLowerCase();
	for (const carpeta of [path.dirname(rutaPedida || ''), UPLOAD_ROOT]) {
		if (!carpeta || !fs.existsSync(carpeta)) continue;
		try {
			for (const entrada of fs.readdirSync(carpeta)) {
				const full = path.join(carpeta, entrada);
				if (!fs.statSync(full).isFile()) continue;
				if (decodeMultipartFilename(entrada).toLowerCase() === buscado) return full;
			}
		} catch {
			/* carpeta ilegible */
		}
	}
	return null;
}

function resolverRuta(rutaCruda) {
	const normalizada = normalizarRuta(rutaCruda);
	return buscarArchivo(normalizada) || buscarArchivo(rutaCruda);
}

/** Con IMEDIC_FS_TOKEN vacío no valida nada: la protección es el túnel. */
function exigirToken(req, res, next) {
	if (!TOKEN) return next();
	const enviado = String(req.headers['x-imedic-token'] || '').trim();
	if (enviado && enviado === TOKEN) return next();
	return res.status(401).json({ success: false, error: 'Token inválido' });
}

app.get(['/', '/health'], (req, res) => {
	res.json({
		success: true,
		ok: true,
		status: 'ok',
		encoding: 'utf8-v2',
		root: UPLOAD_ROOT,
		port: PORT,
		maxMb: Math.round(MAX_BYTES / 1024 / 1024),
		auth: TOKEN ? 'token' : 'tunnel',
		timestamp: new Date().toISOString(),
	});
});

app.get('/file', exigirToken, (req, res) => {
	const pedida = req.query.path;
	if (!pedida) {
		return res.status(400).json({ success: false, error: 'Parámetro path es requerido' });
	}

	const encontrada = resolverRuta(pedida);
	if (!encontrada) {
		console.error(`[file] no encontrado: ${pedida}`);
		return res
			.status(404)
			.json({ success: false, error: 'Archivo no encontrado', path: normalizarRuta(pedida) });
	}

	const ext = path.extname(encontrada).toLowerCase();
	res.setHeader('Content-Type', MIME_POR_EXT[ext] || 'application/octet-stream');
	res.setHeader(
		'Content-Disposition',
		`inline; filename*=UTF-8''${encodeURIComponent(path.basename(encontrada))}`,
	);

	const stream = fs.createReadStream(encontrada);
	stream.on('error', (e) => {
		console.error(`[file] error al leer ${encontrada}:`, e.message);
		if (!res.headersSent) res.status(500).json({ success: false, error: 'Error al leer' });
	});
	stream.pipe(res);
});

app.post('/upload', exigirToken, upload.single('file'), (req, res) => {
	if (!req.file) {
		return res.status(400).json({ success: false, error: 'Archivo requerido (field: file)' });
	}

	try {
		fixMulterFile(req.file);

		const pedida = String(req.body?.path || '').trim();
		const destino = pedida
			? normalizarRuta(pedida)
			: buildVidalDest(
					UPLOAD_ROOT,
					req.body?.numeroVisita,
					req.body?.nombrePaciente,
					req.file.originalname,
				);

		fs.mkdirSync(path.dirname(destino), { recursive: true });
		// rename falla entre volúmenes distintos (tmp en C:, adjuntos en E:).
		try {
			fs.renameSync(req.file.path, destino);
		} catch (e) {
			if (e.code !== 'EXDEV') throw e;
			fs.copyFileSync(req.file.path, destino);
			fs.unlinkSync(req.file.path);
		}

		console.log(`[upload] ${destino}`);
		return res.status(201).json({
			success: true,
			ok: true,
			path: destino,
			filePath: destino,
			originalName: req.file.originalname,
			size: req.file.size,
		});
	} catch (error) {
		fs.promises.unlink(req.file.path).catch(() => {});
		console.error('[upload] error:', error.message);
		return res
			.status(500)
			.json({ success: false, error: 'Error al subir archivo', details: error.message });
	}
});

app.delete('/file', exigirToken, (req, res) => {
	const pedida = req.query.path;
	if (!pedida) {
		return res.status(400).json({ success: false, error: 'Parámetro path es requerido' });
	}

	const encontrada = resolverRuta(pedida);
	if (!encontrada) {
		return res.status(404).json({ success: false, error: 'Archivo no encontrado' });
	}

	try {
		fs.unlinkSync(encontrada);
		console.log(`[delete] ${encontrada}`);
		return res.json({ success: true, path: encontrada, filePath: encontrada });
	} catch (error) {
		console.error('[delete] error:', error.message);
		return res
			.status(500)
			.json({ success: false, error: 'Error al eliminar archivo', details: error.message });
	}
});

app.use((err, req, res, next) => {
	if (!err) return next();
	if (err.code === 'LIMIT_FILE_SIZE') {
		return res.status(413).json({
			success: false,
			error: `El archivo supera los ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
		});
	}
	console.error('[file-server] error:', err.message);
	return res.status(500).json({ success: false, error: err.message });
});

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Solo loopback: desde afuera se llega únicamente por el túnel de Cloudflare.
app.listen(PORT, '127.0.0.1', () => {
	console.log(`file server de adjuntos escuchando en http://127.0.0.1:${PORT}`);
	console.log(`  carpeta:  ${UPLOAD_ROOT}`);
	console.log(`  máximo:   ${Math.round(MAX_BYTES / 1024 / 1024)} MB por archivo`);
	console.log(`  auth:     ${TOKEN ? 'token (x-imedic-token)' : 'solo túnel'}`);
});
