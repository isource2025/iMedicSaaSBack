/**
 * Compara la matriz de permisos del backend (src/utils/permisos.js) con la copia
 * del frontend (iMedicSaaSFront/src/app/utils/permisos.ts).
 *
 * Compara:
 *   - estructura: módulos, submódulos y acciones (por id, sin etiquetas);
 *   - plantillas: los permisos de cada rol.
 *
 * Uso:
 *   node scripts/check_permisos_front.js            # informa; exit 0 aunque haya diferencias
 *   node scripts/check_permisos_front.js --estricto # exit 1 si hay diferencias
 *
 * Requiere `typescript` instalado en iMedicSaaSFront (ya lo está).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONT_FILE = path.join(__dirname, '..', '..', 'iMedicSaaSFront', 'src', 'app', 'utils', 'permisos.ts');
const FRONT_TS = path.join(__dirname, '..', '..', 'iMedicSaaSFront', 'node_modules', 'typescript');

function cargarFront() {
	const ts = require(FRONT_TS);
	const src = fs.readFileSync(FRONT_FILE, 'utf8');
	const { outputText } = ts.transpileModule(src, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	});
	const modulo = { exports: {} };
	vm.runInNewContext(outputText, { module: modulo, exports: modulo.exports, require, console });
	return modulo.exports;
}

const back = require('../src/utils/permisos');
const front = cargarFront();

const problemas = [];

// Estructura
const aplanar = (mods) => {
	const set = new Set();
	for (const m of mods) for (const s of m.submodulos) for (const a of s.acciones) set.add(`${m.id}.${s.id}.${a}`);
	return set;
};
const eB = aplanar(back.MODULOS);
const eF = aplanar(front.MODULOS);
for (const c of eB) if (!eF.has(c)) problemas.push(`Estructura: '${c}' está en backend y falta en frontend`);
for (const c of eF) if (!eB.has(c)) problemas.push(`Estructura: '${c}' está en frontend y falta en backend`);

// Plantillas
const roles = new Set([...Object.keys(back.PLANTILLAS), ...Object.keys(front.PLANTILLAS)]);
for (const rol of [...roles].sort()) {
	const pB = new Set(back.PLANTILLAS[rol] || []);
	const pF = new Set(front.PLANTILLAS[rol] || []);
	for (const c of pB) if (!pF.has(c)) problemas.push(`Plantilla ${rol}: '${c}' está en backend y falta en frontend`);
	for (const c of pF) if (!pB.has(c)) problemas.push(`Plantilla ${rol}: '${c}' está en frontend y falta en backend`);
}

if (!problemas.length) {
	console.log('OK: backend y frontend tienen la misma matriz de permisos.');
} else {
	console.log(`Diferencias entre backend y frontend: ${problemas.length}`);
	for (const p of problemas) console.log('  - ' + p);
	if (process.argv.includes('--estricto')) process.exit(1);
}
