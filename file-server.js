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
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const {
	buildVidalDest,
	fixMulterFile,
	decodeMultipartFilename,
	pathLookupCandidates,
	sanitizeWindowsFileName,
	decodeFileServerPathParam,
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

function existeArchivo(c) {
	try {
		return Boolean(c) && fs.existsSync(c) && fs.statSync(c).isFile();
	} catch {
		return false;
	}
}

const carpetasVisitaCache = new Map();

/** Solo las carpetas `166618` o `166618 APELLIDO`. No lista el disco entero. */
function carpetasDeVisita(root, visita) {
	if (!root || !/^\d+$/.test(visita)) return [];
	const key = `${root.toLowerCase()}|${visita}`;
	const prev = carpetasVisitaCache.get(key);
	if (prev && Date.now() - prev.at < 60_000) return prev.names;

	const names = [];
	const directa = path.join(root, visita);
	try {
		if (fs.existsSync(directa) && fs.statSync(directa).isDirectory()) names.push(visita);
	} catch {
		/* no es carpeta */
	}
	if (process.platform === 'win32') {
		const rootPs = String(root).replace(/'/g, "''");
		const cmd =
			`[IO.Directory]::EnumerateDirectories('${rootPs}','${visita} *') | ForEach-Object { [IO.Path]::GetFileName($_) }`;
		try {
			const out = execFileSync(
				'powershell.exe',
				['-NoProfile', '-NonInteractive', '-Command', cmd],
				{ encoding: 'utf8', windowsHide: true, timeout: 20000 },
			);
			for (const line of String(out).split(/\r?\n/)) {
				const name = line.trim();
				if (name.startsWith(`${visita} `) && !names.includes(name)) names.push(name);
			}
		} catch {
			/* sin coincidencias o disco ocupado: seguir con la carpeta exacta */
		}
	}
	carpetasVisitaCache.set(key, { at: Date.now(), names });
	return names;
}

function archivoEnCarpeta(folder, fileName, wantedLower) {
	const exact = path.join(folder, fileName);
	if (existeArchivo(exact)) return exact;
	try {
		for (const entrada of fs.readdirSync(folder, { withFileTypes: true })) {
			if (!entrada.isFile()) continue;
			if (decodeMultipartFilename(entrada.name).toLowerCase() !== wantedLower) continue;
			return path.join(folder, entrada.name);
		}
	} catch {
		/* carpeta ilegible */
	}
	return null;
}

/** Si la carpeta es `{visita} {PACIENTE}` y la ñ no coincide, busca por número de visita. */
function buscarEnCarpetaVisita(rutaPedida) {
	const base = String(rutaPedida || '');
	if (!base) return null;
	const fileName = path.basename(base);
	const parentName = path.basename(path.dirname(base));
	const m = parentName.match(/^(\d+)(?:\s|$)/);
	if (!m) return null;
	const visita = m[1];
	const roots = [];
	const seen = new Set();
	for (const r of [UPLOAD_ROOT, path.dirname(path.dirname(base))]) {
		if (!r || seen.has(r.toLowerCase())) continue;
		seen.add(r.toLowerCase());
		roots.push(r);
	}
	const wanted = decodeMultipartFilename(fileName).toLowerCase();
	for (const root of roots) {
		if (!root || !fs.existsSync(root)) continue;
		for (const name of carpetasDeVisita(root, visita)) {
			const hit = archivoEnCarpeta(path.join(root, name), fileName, wanted);
			if (hit) return hit;
		}
	}
	return null;
}

function buscarArchivo(rutaPedida) {
	const candidatos = pathLookupCandidates(rutaPedida);
	const nombre = sanitizeWindowsFileName(path.basename(rutaPedida || ''));
	candidatos.push(path.join(UPLOAD_ROOT, nombre));
	candidatos.push(path.join(UPLOAD_ROOT, path.basename(rutaPedida || '')));

	const pedida = String(rutaPedida || '').replace(/\//g, '\\');
	const esAbsoluta = /^[A-Za-z]:\\/.test(pedida) || pedida.startsWith('\\\\');
	if (pedida && !esAbsoluta) {
		candidatos.unshift(path.join(UPLOAD_ROOT, pedida));
	}
	const legacyRel = pedida.match(/^\\\\[^\\]+\\[Ii]magenes\\[^\\]+\\(.+)$/);
	if (legacyRel) {
		candidatos.unshift(path.join(UPLOAD_ROOT, legacyRel[1]));
	}

	for (const c of candidatos) {
		if (existeArchivo(c)) return c;
	}

	const porVisita = buscarEnCarpetaVisita(rutaPedida);
	if (porVisita) return porVisita;

	const buscado = decodeMultipartFilename(nombre).toLowerCase();
	const parent = path.dirname(String(rutaPedida || ''));
	const parentNorm = parent.replace(/[\\/]+$/, '').toLowerCase();
	const rootNorm = String(UPLOAD_ROOT).replace(/[\\/]+$/, '').toLowerCase();
	if (parent && parentNorm !== rootNorm) {
		const hit = archivoEnCarpeta(parent, nombre, buscado);
		if (hit) return hit;
	}
	return null;
}

function resolverRuta(rutaCruda) {
	const cruda = decodeFileServerPathParam(rutaCruda);
	const normalizada = normalizarRuta(cruda);
	return buscarArchivo(normalizada) || buscarArchivo(cruda) || buscarArchivo(String(rutaCruda || ''));
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
		encoding: 'utf8-v3',
		root: UPLOAD_ROOT,
		port: PORT,
		maxMb: Math.round(MAX_BYTES / 1024 / 1024),
		auth: TOKEN ? 'token' : 'tunnel',
		timestamp: new Date().toISOString(),
	});
});

app.get('/file', exigirToken, (req, res) => {
	const pedida = decodeFileServerPathParam(req.query.path);
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
		let destino = pedida
			? normalizarRuta(pedida)
			: buildVidalDest(
					UPLOAD_ROOT,
					req.body?.numeroVisita,
					req.body?.nombrePaciente,
					req.file.originalname,
				);

		// Ruta relativa (requisitos): anteponer el root de ESTA clínica.
		const destNorm = String(destino || '').replace(/\//g, '\\');
		const esAbsoluta = /^[A-Za-z]:\\/.test(destNorm) || destNorm.startsWith('\\\\');
		if (destino && !esAbsoluta) {
			destino = path.join(UPLOAD_ROOT, destNorm);
		}

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
	const pedida = decodeFileServerPathParam(req.query.path);
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
