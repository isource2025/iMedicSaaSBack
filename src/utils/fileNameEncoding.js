/**
 * Nombres de adjuntos: multer/busboy decodifican el filename del multipart
 * como latin1. UTF-8 "Ñ" (C3 91) termina como "Ã" + control U+0091 y, tras
 * el round-trip Clarion/CP1252, se ve "PEÃ?A". Reparamos mojibake y
 * preservamos ñ/Ñ/acentos en el nombre real (filename* UTF-8 al file server).
 */

const path = require('path');

const MOJIBAKE_MAP = [
	[/Ã\u0091/g, 'Ñ'],
	[/Ã\u0081/g, 'Á'],
	[/Ã\u0089/g, 'É'],
	[/Ã\u008D/g, 'Í'],
	[/Ã\u0093/g, 'Ó'],
	[/Ã\u009A/g, 'Ú'],
	[/Ã\?/g, 'Ñ'],
	[/Ã‘/g, 'Ñ'],
	[/Ã±/g, 'ñ'],
	[/Ã¡/g, 'á'],
	[/Ã©/g, 'é'],
	[/Ã­/g, 'í'],
	[/Ã³/g, 'ó'],
	[/Ãº/g, 'ú'],
	[/Ã/g, 'Á'],
	[/Ã‰/g, 'É'],
	[/Ã/g, 'Í'],
	[/Ã“/g, 'Ó'],
	[/Ãš/g, 'Ú'],
	[/Ã¼/g, 'ü'],
	[/Ãœ/g, 'Ü'],
	[/Â/g, ''],
];

function looksLikeUtf8Mojibake(s) {
	return /Ã.|Â.|PEÃ|[\u0080-\u009F]/.test(s);
}

function decodeMultipartFilename(name) {
	if (name == null) return '';
	let s = String(name);
	if (!s) return '';

	try {
		s = s.normalize('NFC');
	} catch {
		/* keep */
	}

	try {
		const decoded = Buffer.from(s, 'latin1').toString('utf8');
		if (!decoded.includes('\uFFFD') && decoded !== s) {
			if (looksLikeUtf8Mojibake(s) || /[ñÑáéíóúÁÉÍÓÚüÜ]/.test(decoded)) {
				s = decoded;
			}
		}
	} catch {
		/* keep original */
	}

	for (const [re, repl] of MOJIBAKE_MAP) {
		s = s.replace(re, repl);
	}

	try {
		return s.normalize('NFC');
	} catch {
		return s;
	}
}

/** Solo para encontrar archivos viejos guardados con _ en lugar de Ñ */
function legacyUnderscoreForN(s) {
	return String(s).replace(/[\u00D1\u00F1]/g, '_');
}

function sanitizeWindowsFileName(name) {
	const decoded = decodeMultipartFilename(name);
	const base = path.basename(decoded.replace(/\\/g, '/')) || 'archivo';
	const safe = base
		.replace(/[<>:"/\\|?*\u0000-\u001F\u007F-\u009F]/g, '_')
		.replace(/\s+/g, ' ')
		.trim();
	return safe || 'archivo';
}

function sanitizeFolderName(name) {
	const decoded = decodeMultipartFilename(name);
	return decoded
		.trim()
		.toUpperCase()
		.replace(/[\\/:*?"<>|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * HTTP headers son latin1: si pasamos "Ñ" tal cual, Node manda byte D1 y
 * PowerShell (UTF-8) lo lee mal. Mandamos los bytes UTF-8 como latin1.
 */
function utf8FilenameForFormDataHeader(name) {
	return Buffer.from(sanitizeWindowsFileName(name), 'utf8').toString('latin1');
}

function buildVidalDest(root, visita, paciente, fileName) {
	const safeFile = sanitizeWindowsFileName(fileName);
	const n = sanitizeFolderName(paciente || '');
	const v = visita != null && String(visita).trim() !== '' ? String(visita).trim() : '';
	let folder = null;
	if (v && n) folder = `${v} ${n}`;
	else if (v) folder = v;
	if (folder) return path.join(root, folder, safeFile);
	return path.join(root, safeFile);
}

function uniqueNonEmpty(values) {
	const out = [];
	const seen = new Set();
	for (const v of values) {
		if (!v || typeof v !== 'string') continue;
		if (seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out;
}

function mapLegacyDriveRoots(filePath) {
	const s = String(filePath);
	const imedicRoot =
		process.env.FILE_SERVER_ROOT ||
		process.env.IMEDIC_ADJUNTOS_ROOT ||
		'C:\\imedic\\adjuntos';
	const out = [];
	if (/^E:\\adjuntos\\/i.test(s)) {
		out.push(path.join(imedicRoot, s.slice('E:\\adjuntos\\'.length)));
	}
	if (/^D:\\adjuntos\\/i.test(s)) {
		out.push(path.join(imedicRoot, s.slice('D:\\adjuntos\\'.length)));
	}
	if (/^F:\\adjuntos\\/i.test(s)) {
		out.push(path.join(imedicRoot, s.slice('F:\\adjuntos\\'.length)));
	}
	return out;
}

/**
 * Saca el sufijo relativo de UNC Clarion legacy:
 *   \\192.168.x.x\Imagenes\Vidal\PERSONALES\…  →  PERSONALES\…
 *   \\host\Imagenes\Vida\foo.pdf               →  foo.pdf
 * No inventa un root de clínica: eso lo resuelve el file server local (UncRoot).
 * Devuelve null si la ruta no es ese patrón.
 */
function relativeFromLegacyImagenesUnc(filePath) {
	if (!filePath) return null;
	const s = String(filePath).replace(/\//g, '\\');
	const withRest = s.match(/^\\\\[^\\]+\\[Ii]magenes\\[^\\]+\\(.+)$/);
	if (withRest) return withRest[1];
	if (/^\\\\[^\\]+\\[Ii]magenes\\[^\\]+$/i.test(s)) return '';
	return null;
}

/** @deprecated usar relativeFromLegacyImagenesUnc; se mantiene el nombre por imports. */
function rewriteLegacyImagenesUnc(filePath) {
	const rel = relativeFromLegacyImagenesUnc(filePath);
	return rel == null ? filePath : rel;
}

/** Root UNC Clarion de Vidal (nunca IP). Otras clínicas no lo usan. */
const DEFAULT_VIDAL_CLARION_UNC_ROOT = '\\\\SERVER\\Imagenes\\Vidal';

function clarionUncRoot() {
	const raw = String(
		process.env.IMEDIC_CLARION_UNC_ROOT ||
			process.env.IMEDIC_FS_UNC_ROOT ||
			DEFAULT_VIDAL_CLARION_UNC_ROOT,
	).trim();
	const normalized = raw.replace(/\//g, '\\').replace(/[\\/]+$/, '');
	return normalized || DEFAULT_VIDAL_CLARION_UNC_ROOT;
}

/** Solo Vidal (u override env) usa UNC Clarion; Sarmiento y el resto no. */
function clarionUncRootForFileServerUrl(fileServerUrl) {
	const u = String(fileServerUrl || '').toLowerCase();
	if (u.includes('vidal')) return clarionUncRoot();
	if (String(process.env.IMEDIC_CLARION_UNC_ROOT || '').trim()) return clarionUncRoot();
	return null;
}

function applyPersonalesRel(rel, personales) {
	let out = String(rel || '')
		.replace(/^\\+/, '')
		.replace(/\\+/g, '\\');
	const hasPersonales = /^PERSONALES(\\|$)/i.test(out);
	if (personales === true && !hasPersonales) {
		return out ? `PERSONALES\\${out}` : 'PERSONALES';
	}
	if (personales === false && hasPersonales) {
		return out.replace(/^PERSONALES\\?/i, '');
	}
	return out;
}

/**
 * ¿La ruta ya es del árbol Clarion Imagenes\<share> (Vidal u otras)?
 */
function isImagenesClarionPath(filePath) {
	const s = String(filePath || '').replace(/\//g, '\\');
	return /^\\\\[^\\]+\\[Ii]magenes\\[^\\]+/i.test(s) || /^[A-Za-z]:\\[Ii]magenes\\[^\\]+/i.test(s);
}

/** Roots locales típicos (Sarmiento, etc.) — no reescribir a UNC Vidal. */
function isLocalAdjuntosPath(filePath) {
	const s = String(filePath || '').replace(/\//g, '\\');
	return /^[A-Za-z]:\\(?:imedic\\)?adjuntos(\\|$)/i.test(s);
}

/**
 * Extrae la parte relativa bajo Imagenes\<share> o bajo adjuntos locales.
 */
function relativeUnderImagenesOrRoot(filePath) {
	if (!filePath) return '';
	const s = String(filePath).replace(/\//g, '\\').trim();
	if (!s) return '';

	const fromUnc = relativeFromLegacyImagenesUnc(s);
	if (fromUnc != null) return String(fromUnc).replace(/^\\+/, '');

	const driveImg = s.match(/^[A-Za-z]:\\[Ii]magenes\\[^\\]+\\(.+)$/);
	if (driveImg) return driveImg[1];

	const adjuntos = s.match(/^[A-Za-z]:\\(?:imedic\\)?adjuntos\\(.+)$/i);
	if (adjuntos) return adjuntos[1];

	if (/^[A-Za-z]:\\/.test(s)) return path.basename(s);

	if (s.startsWith('\\\\')) {
		const m = s.match(/^\\\\[^\\]+\\[^\\]+\\(.+)$/);
		return m ? m[1] : path.basename(s);
	}

	return s.replace(/^\\+/, '');
}

/**
 * Ruta a persistir en Clarion (Patch / PatchDestino).
 *
 * – Vidal / Imagenes\…: \\SERVER\Imagenes\<share>\… (nunca IP)
 * – Sarmiento / C:\imedic\adjuntos\…: se deja la ruta física del file server
 *   (si opts.uncRoot está seteado, igual se reescribe a ese UNC — caso Vidal
 *   cuyo FS físico vive bajo …\adjuntos)
 * – Relativa: se deja relativa (el FS de cada clínica antepone su root)
 *
 * @param {string} filePath
 * @param {{ personales?: boolean|null, uncRoot?: string|null }} [opts]
 *   uncRoot: si se pasa (ej. Vidal), antepone ese root a rutas relativas.
 */
function toClarionStoredPath(filePath, opts = {}) {
	if (filePath == null || filePath === '') return filePath;
	const personales = opts.personales;
	const forcedRoot =
		opts.uncRoot != null && String(opts.uncRoot).trim() !== ''
			? String(opts.uncRoot).replace(/\//g, '\\').replace(/[\\/]+$/, '')
			: null;
	let s = String(filePath).replace(/\//g, '\\').trim();

	// Sarmiento / roots locales: dejar ruta física, SALVO si el caller fuerza uncRoot
	// (Vidal). Sin esto, adjuntos de internación quedaban como E:\adjuntos\… o
	// C:\imedic\adjuntos\… y Clarion no los veía (admisión sí, porque manda relativa).
	if (isLocalAdjuntosPath(s)) {
		const m = s.match(/^([A-Za-z]:\\(?:imedic\\)?adjuntos)(?:\\(.*))?$/i);
		const rest = applyPersonalesRel(m[2] || '', personales);
		if (forcedRoot) {
			return rest ? `${forcedRoot}\\${rest}` : forcedRoot;
		}
		const root = m[1];
		return rest ? `${root}\\${rest}` : root;
	}

	// UNC o unidad Imagenes\<share>\… → host SERVER, mismo share (casing Clarion).
	const unc = s.match(/^\\\\[^\\]+\\([Ii]magenes)\\([^\\]+)(\\.*)?$/);
	if (unc) {
		const rest = applyPersonalesRel((unc[3] || '').replace(/^\\+/, ''), personales);
		const shareLeaf = /^vidal$/i.test(unc[2]) ? 'Vidal' : unc[2];
		const share = `\\\\SERVER\\Imagenes\\${shareLeaf}`;
		return rest ? `${share}\\${rest}` : share;
	}
	const driveImg = s.match(/^[A-Za-z]:\\([Ii]magenes)\\([^\\]+)(\\.*)?$/);
	if (driveImg) {
		const rest = applyPersonalesRel((driveImg[3] || '').replace(/^\\+/, ''), personales);
		const shareLeaf = /^vidal$/i.test(driveImg[2]) ? 'Vidal' : driveImg[2];
		const share = `\\\\SERVER\\Imagenes\\${shareLeaf}`;
		return rest ? `${share}\\${rest}` : share;
	}

	let rel = applyPersonalesRel(relativeUnderImagenesOrRoot(s) || s.replace(/^\\+/, ''), personales);

	// Solo anteponer UNC Clarion si el caller lo pide (Vidal) o la ruta ya era Imagenes.
	const root = forcedRoot || (isImagenesClarionPath(filePath) ? clarionUncRoot() : null);
	if (root) {
		return rel ? `${root}\\${rel}` : root;
	}
	return rel;
}

function normalizeAdjuntoFilePath(rutaOriginal) {
	if (!rutaOriginal) return rutaOriginal;
	let ruta = decodeMultipartFilename(String(rutaOriginal));
	if (/^D:\\/i.test(ruta)) ruta = ruta.replace(/^D:\\/, 'E:\\');
	if (/^F:\\/i.test(ruta)) ruta = ruta.replace(/^F:\\/, 'E:\\');
	const rel = relativeFromLegacyImagenesUnc(ruta);
	if (rel != null && rel !== '') return rel;
	return ruta;
}

function questionMarkAsEnie(s) {
	return String(s)
		.replace(/PE\?A/gi, (m) => (m === m.toLowerCase() ? 'peña' : 'PEÑA'))
		.replace(/\?/g, 'Ñ');
}

function pathLookupCandidates(filePath) {
	if (!filePath) return [];
	const original = String(filePath);
	const repaired = decodeMultipartFilename(original);
	const normalized = normalizeAdjuntoFilePath(original);
	const dir = path.dirname(original);
	const name = path.basename(original);
	const repairedName = sanitizeWindowsFileName(name);
	const repairedDir = decodeMultipartFilename(dir);
	const qmark = questionMarkAsEnie(repaired);

	// Sufijo relativo (Clarion UNC / adjuntos locales) para pedir al file server
	// igual que siempre: bajo el root de la clínica, no el host \\SERVER.
	const rel =
		relativeUnderImagenesOrRoot(original) ||
		relativeFromLegacyImagenesUnc(original) ||
		relativeUnderImagenesOrRoot(repaired) ||
		'';
	const relNorm = String(rel || '')
		.replace(/^\\+/, '')
		.replace(/\\+/g, '\\');
	const localRoots = [
		'C:\\imedic\\adjuntos',
		'E:\\imagenes\\vidal',
		'E:\\Imagenes\\Vidal',
		'\\\\server\\Imagenes\\Vidal',
		'\\\\SERVER\\Imagenes\\Vidal',
	];
	const fromRel = [];
	if (relNorm) {
		fromRel.push(relNorm);
		for (const root of localRoots) {
			fromRel.push(`${root}\\${relNorm}`);
		}
	}

	return uniqueNonEmpty([
		// Preferir relativa / absoluta de clínica antes que UNC Clarion
		...fromRel,
		normalized,
		decodeMultipartFilename(normalized),
		original,
		repaired,
		relativeFromLegacyImagenesUnc(original),
		relativeFromLegacyImagenesUnc(repaired),
		qmark,
		...mapLegacyDriveRoots(original),
		...mapLegacyDriveRoots(repaired),
		...mapLegacyDriveRoots(normalized),
		path.join(dir, repairedName),
		path.join(repairedDir, repairedName),
		path.join(repairedDir, name),
		legacyUnderscoreForN(original),
		legacyUnderscoreForN(repaired),
		path.join(legacyUnderscoreForN(repairedDir), legacyUnderscoreForN(repairedName)),
		path.join(questionMarkAsEnie(repairedDir), repairedName),
	]);
}

/**
 * HttpListener (PowerShell en Sarmiento) decodifica el query como Latin-1:
 * UTF-8 "Ñ" (%C3%91) termina como "Ã" + control o "?". Doble-encode deja el
 * query en ASCII hasta UnescapeDataString / decodeURIComponent en la clínica.
 */
function fileServerFileQuery(filePath) {
	return 'path=' + encodeURIComponent(encodeURIComponent(String(filePath || '')));
}

function fileServerFileUrl(baseUrl, filePath) {
	const base = String(baseUrl || '').replace(/\/+$/, '');
	return `${base}/file?${fileServerFileQuery(filePath)}`;
}

/** Express ya decodifica una vez; si queda %XX es el doble-encode del backend. */
function decodeFileServerPathParam(raw) {
	if (raw == null) return '';
	let s = Array.isArray(raw) ? String(raw[0]) : String(raw);
	for (let i = 0; i < 2; i++) {
		if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
		try {
			s = decodeURIComponent(s);
		} catch {
			break;
		}
	}
	return s;
}

function fixMulterFile(file) {
	if (!file) return file;
	file.originalname = sanitizeWindowsFileName(file.originalname);
	return file;
}

/**
 * Content-Disposition con filename* UTF-8 (RFC 5987) para el file server PowerShell.
 * filename= es solo fallback ASCII; el nombre real va en filename*.
 */
function escapeContentDispositionFilename(name) {
	return String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formDataFileOptions(originalName, contentType) {
	const safeName = sanitizeWindowsFileName(originalName);
	const encoded = encodeURIComponent(safeName);
	const wireName = utf8FilenameForFormDataHeader(safeName);
	const escaped = escapeContentDispositionFilename(wireName);
	return {
		filename: wireName,
		contentType: contentType || 'application/octet-stream',
		header: {
			'Content-Disposition': `form-data; name="file"; filename="${escaped}"; filename*=UTF-8''${encoded}`,
		},
	};
}

const CONTENT_TYPES_ADJUNTO = {
	'.pdf': 'application/pdf',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.dcm': 'application/dicom',
	'.dicom': 'application/dicom',
	'.webm': 'video/webm',
	'.mp4': 'video/mp4',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Content-Type a partir de la extensión, para servir adjuntos inline. */
function contentTypeForAdjuntoFileName(fileName) {
	const ext = path.extname(String(fileName || '')).toLowerCase();
	return CONTENT_TYPES_ADJUNTO[ext] || 'application/octet-stream';
}

module.exports = {
	contentTypeForAdjuntoFileName,
	decodeMultipartFilename,
	sanitizeWindowsFileName,
	sanitizeFolderName,
	utf8FilenameForFormDataHeader,
	formDataFileOptions,
	buildVidalDest,
	normalizeAdjuntoFilePath,
	relativeFromLegacyImagenesUnc,
	rewriteLegacyImagenesUnc,
	clarionUncRoot,
	clarionUncRootForFileServerUrl,
	toClarionStoredPath,
	relativeUnderImagenesOrRoot,
	isLocalAdjuntosPath,
	pathLookupCandidates,
	fileServerFileQuery,
	fileServerFileUrl,
	decodeFileServerPathParam,
	fixMulterFile,
};
