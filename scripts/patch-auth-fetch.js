/**
 * Añade Authorization a fetch() hacia la API en servicios del front.
 * Ejecutar desde repo root: node iMedicWSBack/scripts/patch-auth-fetch.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../iMedicWSFront/src');
const IMPORT_LINE = "import { apiFetch } from '@/app/utils/authFetch';";

function walk(dir, acc = []) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		const st = fs.statSync(p);
		if (st.isDirectory()) walk(p, acc);
		else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
	}
	return acc;
}

function patchFile(filePath) {
	let src = fs.readFileSync(filePath, 'utf8');
	if (!src.includes('fetch(')) return false;
	if (src.includes("from '@/app/utils/authFetch'")) return false;

	const apiPatterns = [
		'NEXT_PUBLIC_API_URL',
		'getResolvedApiBaseUrl',
		'getApiUrl',
		'getEnvApiBaseUrl',
		'BASE_URL',
		'API_URL',
		'API_BASE_URL',
		'this.apiUrl',
		'/api/',
		'`${',
	];
	const looksLikeApi =
		apiPatterns.some((p) => src.includes(p)) &&
		(src.includes('/beds') ||
			src.includes('/indicaciones') ||
			src.includes('/hci') ||
			src.includes('/adjuntos') ||
			src.includes('/evolucion') ||
			src.includes('/medicacion') ||
			src.includes('/controles') ||
			src.includes('/estudios') ||
			src.includes('/hc-ingreso') ||
			src.includes('/laboratorios') ||
			src.includes('/admin/') ||
			src.includes('/sexo') ||
			src.includes('/provincia') ||
			src.includes('/localidad') ||
			src.includes('/diagnostico') ||
			src.includes('/dadores') ||
			src.includes('/clases-paciente') ||
			src.includes('/estados-') ||
			src.includes('/disposiciones') ||
			src.includes('/parentesco') ||
			src.includes('/nacionalidad') ||
			src.includes('/idiomas') ||
			src.includes('/grupos-etnicos') ||
			src.includes('/activity') ||
			src.includes('/opcgrd') ||
			src.includes('process.env.NEXT_PUBLIC_API_URL'));

	if (!looksLikeApi) return false;

	const replaced = src.replace(/\bfetch\s*\(/g, 'apiFetch(');
	if (replaced === src) return false;

	let out = replaced;
	if (!out.includes(IMPORT_LINE)) {
		const lines = out.split('\n');
		let insertAt = 0;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.startsWith('import ') && !line.includes('{') && line.endsWith(';')) {
				insertAt = i + 1;
			} else if (line.startsWith('import ') && line.includes('{') && line.includes('}')) {
				insertAt = i + 1;
			} else if (line.startsWith('import ') && line.includes('{') && !line.includes('}')) {
				// import multilínea: insertar ANTES del bloque
				insertAt = i;
				break;
			} else if (insertAt > 0 && !line.startsWith('import ') && line.trim() && !line.startsWith('}')) {
				break;
			}
		}
		lines.splice(insertAt, 0, IMPORT_LINE);
		out = lines.join('\n');
	}

	fs.writeFileSync(filePath, out, 'utf8');
	return true;
}

const files = walk(ROOT);
let count = 0;
for (const f of files) {
	if (f.includes('authFetch.ts') || f.includes('axios.ts')) continue;
	try {
		if (patchFile(f)) {
			count++;
			console.log('patched', path.relative(ROOT, f));
		}
	} catch (e) {
		console.error('fail', f, e.message);
	}
}
console.log('Total patched:', count);
