/**
 * Limita las rutas que sirve un servidor de clínica a sus carpetas permitidas.
 * Se usa en file-server.js (corre en Windows); los tests inyectan path.win32.
 */
const nodePath = require('path');
const fs = require('fs');

function defaultRealpath(p) {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return null;
	}
}

/**
 * @param {string[]} roots carpetas permitidas (locales o UNC)
 * @param {{ pathImpl?: typeof nodePath, realpath?: (p: string) => string|null }} [opts]
 */
function createConfinement(roots, opts = {}) {
	const p = opts.pathImpl || nodePath;
	const realpath = opts.realpath || defaultRealpath;
	const base = [];
	for (const r of roots || []) {
		const s = String(r || '').trim();
		if (!s) continue;
		const resolved = p.resolve(s);
		base.push(resolved);
		const real = realpath(resolved);
		if (real && real !== resolved) base.push(p.resolve(real));
	}

	function under(root, target) {
		const rel = p.relative(root, target);
		return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
	}

	function insideLexical(target) {
		return base.some((root) => under(root, target));
	}

	/** true si la ruta (y su destino real, si es link/junction) queda dentro de alguna raíz. */
	function contains(candidate) {
		if (!candidate || !base.length) return false;
		const s = String(candidate);
		if (s.includes('\0')) return false;
		const target = p.resolve(s);
		if (!insideLexical(target)) return false;
		const real = realpath(target);
		return real ? insideLexical(p.resolve(real)) : true;
	}

	return { roots: base.slice(), contains };
}

/** `E:\adjuntos;\\server\Imagenes\Vidal` → lista. */
function parseRootList(raw) {
	return String(raw || '')
		.split(/[;|\n]+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

module.exports = { createConfinement, parseRootList };
