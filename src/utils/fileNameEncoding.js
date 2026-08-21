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

function pathLookupCandidates(filePath) {
	if (!filePath) return [];
	const original = String(filePath);
	const repaired = decodeMultipartFilename(original);
	const dir = path.dirname(original);
	const name = path.basename(original);
	const repairedName = sanitizeWindowsFileName(name);
	const repairedDir = decodeMultipartFilename(dir);

	return uniqueNonEmpty([
		original,
		repaired,
		path.join(dir, repairedName),
		path.join(repairedDir, repairedName),
		path.join(repairedDir, name),
		legacyUnderscoreForN(original),
		legacyUnderscoreForN(repaired),
		path.join(legacyUnderscoreForN(repairedDir), legacyUnderscoreForN(repairedName)),
	]);
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

module.exports = {
	decodeMultipartFilename,
	sanitizeWindowsFileName,
	sanitizeFolderName,
	utf8FilenameForFormDataHeader,
	formDataFileOptions,
	buildVidalDest,
	pathLookupCandidates,
	fixMulterFile,
};
