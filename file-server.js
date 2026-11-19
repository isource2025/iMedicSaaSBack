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
 *   IMEDIC_FS_PORT         puerto local (default 9012)
 *   IMEDIC_FS_ROOT         carpeta de adjuntos (default E:\adjuntos)
 *   IMEDIC_FS_EXTRA_ROOTS  otras carpetas permitidas, separadas por ";"
 *   IMEDIC_FS_SIGNING_KEY  clave de ESTA clínica para el token firmado (x-imedic-sig)
 *   IMEDIC_FS_EMPRESA_ID   si está, el token tiene que ser de esta empresa
 *   IMEDIC_FS_TOKEN        secreto compartido legado (x-imedic-token), solo transición
 *   IMEDIC_FS_CORS_ORIGINS orígenes de navegador permitidos (default: ninguno)
 *
 * Sin IMEDIC_FS_SIGNING_KEY ni IMEDIC_FS_TOKEN no sirve nada: solo /health.
 * Solo lee y escribe dentro de IMEDIC_FS_ROOT / IMEDIC_FS_EXTRA_ROOTS.
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
	namesMatchLoose,
} = require('./src/utils/fileNameEncoding');
const {
	verifyRequest,
	tokenFromRequest,
	safeEqual,
	MIN_KEY_LENGTH,
	DEFAULT_SKEW_S,
} = require('./src/utils/signedFileToken');
const { createConfinement, parseRootList } = require('./src/utils/rootConfinement');

const PORT = Number(process.env.IMEDIC_FS_PORT || process.env.FILE_SERVER_PORT || 9012);
const UPLOAD_ROOT = process.env.IMEDIC_FS_ROOT || process.env.FILE_SERVER_ROOT || 'E:\\adjuntos';
const EXTRA_ROOTS = parseRootList(process.env.IMEDIC_FS_EXTRA_ROOTS);
/** Cloudflare no deja pasar más de 100 MB por request en los planes Free/Pro. */
const MAX_BYTES = Number(process.env.IMEDIC_FS_MAX_MB || 100) * 1024 * 1024;
const TOKEN = String(process.env.IMEDIC_FS_TOKEN || '').trim();
const SIGNING_KEY = String(process.env.IMEDIC_FS_SIGNING_KEY || '').trim();
const EMPRESA_ID = String(process.env.IMEDIC_FS_EMPRESA_ID || '').trim();
const CLOCK_SKEW_S = Number(process.env.IMEDIC_FS_CLOCK_SKEW_S || DEFAULT_SKEW_S);
const CORS_ORIGINS = parseRootList(String(process.env.IMEDIC_FS_CORS_ORIGINS || '').replace(/,/g, ';'));

if (SIGNING_KEY && SIGNING_KEY.length < MIN_KEY_LENGTH) {
	console.error(`IMEDIC_FS_SIGNING_KEY tiene que tener al menos ${MIN_KEY_LENGTH} caracteres: se ignora.`);
}
const FIRMA_ACTIVA = SIGNING_KEY.length >= MIN_KEY_LENGTH;

const raices = createConfinement([UPLOAD_ROOT, ...EXTRA_ROOTS]);

const app = express();
app.disable('x-powered-by');
if (CORS_ORIGINS.length) app.use(cors({ origin: CORS_ORIGINS }));
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
		return Boolean(c) && raices.contains(c) && fs.existsSync(c) && fs.statSync(c).isFile();
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
	if (!raices.contains(folder)) return null;
	const exact = path.join(folder, fileName);
	if (existeArchivo(exact)) return exact;
	try {
		for (const entrada of fs.readdirSync(folder, { withFileTypes: true })) {
			if (!entrada.isFile()) continue;
			const nombre = decodeMultipartFilename(entrada.name);
			if (nombre.toLowerCase() === wantedLower) {
				return path.join(folder, entrada.name);
			}
			// GÓMEZ (SQL) ↔ GOMEZ (disco), misma lógica que pathLookupCandidates
			if (namesMatchLoose(nombre, wantedLower) || namesMatchLoose(nombre, fileName)) {
				return path.join(folder, entrada.name);
			}
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
	for (const r of [UPLOAD_ROOT, ...EXTRA_ROOTS, path.dirname(path.dirname(base))]) {
		if (!r || seen.has(r.toLowerCase()) || !raices.contains(r)) continue;
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
		for (const r of EXTRA_ROOTS) candidatos.push(path.join(r, pedida));
		candidatos.unshift(path.join(UPLOAD_ROOT, pedida));
	}
	const legacyRel = pedida.match(/^\\\\[^\\]+\\[Ii]magenes\\[^\\]+\\(.+)$/);
	if (legacyRel) {
		for (const r of EXTRA_ROOTS) candidatos.push(path.join(r, legacyRel[1]));
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
	const hit =
		buscarArchivo(normalizada) || buscarArchivo(cruda) || buscarArchivo(String(rutaCruda || ''));
	return hit && raices.contains(hit) ? hit : null;
}

function modoAuth() {
	if (FIRMA_ACTIVA && TOKEN) return 'firma+token-legado';
	if (FIRMA_ACTIVA) return 'firma';
	if (TOKEN) return 'token-legado';
	return 'sin-configurar';
}

/** @returns {{ ok: boolean, motivo?: string }} */
function autenticar(req) {
	const firma = tokenFromRequest(req.headers, req.originalUrl);
	let motivoFirma = '';
	if (firma && FIRMA_ACTIVA) {
		const r = verifyRequest({
			token: firma,
			key: SIGNING_KEY,
			method: req.method,
			url: req.originalUrl,
			skewS: CLOCK_SKEW_S,
			idEmpresaEsperada: EMPRESA_ID,
		});
		if (r.ok) return { ok: true };
		motivoFirma = r.motivo;
	}
	if (TOKEN && safeEqual(String(req.headers['x-imedic-token'] || '').trim(), TOKEN)) {
		if (motivoFirma) console.warn(`[auth] firma rechazada (${motivoFirma}); se aceptó el token legado`);
		return { ok: true };
	}
	return { ok: false, motivo: motivoFirma || (firma ? 'firma-sin-clave' : 'sin-credencial') };
}

function exigirToken(req, res, next) {
	if (!FIRMA_ACTIVA && !TOKEN) {
		return res.status(503).json({
			success: false,
			error:
				'File server sin credenciales: configure IMEDIC_FS_SIGNING_KEY (Instalar-Clinica.ps1) y reinicie el servicio.',
		});
	}
	const r = autenticar(req);
	if (r.ok) return next();
	console.warn(`[auth] 401 ${req.method} ${req.path} (${r.motivo})`);
	return res.status(401).json({ success: false, error: 'Token inválido', motivo: r.motivo });
}

app.get(['/', '/health'], (req, res) => {
	const body = {
		success: true,
		ok: true,
		status: 'ok',
		encoding: 'utf8-v3',
		security: 'v1',
		maxMb: Math.round(MAX_BYTES / 1024 / 1024),
		auth: modoAuth(),
		timestamp: new Date().toISOString(),
		epoch: Math.floor(Date.now() / 1000),
	};
	if ((FIRMA_ACTIVA || TOKEN) && autenticar(req).ok) {
		body.root = UPLOAD_ROOT;
		body.extraRoots = EXTRA_ROOTS;
		body.port = PORT;
	}
	res.json(body);
});

app.get('/file', exigirToken, (req, res) => {
	const pedida = decodeFileServerPathParam(req.query.path);
	if (!pedida) {
		return res.status(400).json({ success: false, error: 'Parámetro path es requerido' });
	}

	const encontrada = resolverRuta(pedida);
	if (!encontrada) {
		const literal = normalizarRuta(pedida);
		if (literal && !raices.contains(literal) && fs.existsSync(literal)) {
			console.error(
				`[file] bloqueado, fuera de las carpetas permitidas: ${literal} (si es legítimo, agregar su carpeta a IMEDIC_FS_EXTRA_ROOTS)`,
			);
		}
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
		const esAbsoluta =
			path.isAbsolute(String(destino || '')) || /^[A-Za-z]:\\/.test(destNorm) || destNorm.startsWith('\\\\');
		if (destino && !esAbsoluta) {
			destino = path.join(UPLOAD_ROOT, destNorm);
		}
		if (!destino || !raices.contains(destino)) {
			fs.promises.unlink(req.file.path).catch(() => {});
			console.warn(`[upload] destino fuera de las carpetas permitidas: ${destino}`);
			return res.status(400).json({
				success: false,
				error: 'Destino fuera de la carpeta de adjuntos de la clínica',
			});
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
	if (EXTRA_ROOTS.length) console.log(`  extra:    ${EXTRA_ROOTS.join('; ')}`);
	console.log(`  auth:     ${modoAuth()}`);
	if (!FIRMA_ACTIVA && !TOKEN) {
		console.error('  ATENCIÓN: sin IMEDIC_FS_SIGNING_KEY ni IMEDIC_FS_TOKEN no se sirve ningún archivo.');
	}
});
