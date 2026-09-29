/**
 * Auditoría estática de rutas del backend: detecta rutas sin control de
 * permisos.
 *
 * Una ruta se considera "protegida" si:
 *   - sus handlers incluyen requirePermiso / requireAnyPermiso / adminMiddleware /
 *     requireBotApiKey (directo o vía una constante definida en el archivo), o
 *   - el archivo tiene `router.use(<guardia>)` antes de definir la ruta.
 *
 * Funciona como "trinquete" (ratchet): las rutas sin protección que existían al
 * generar `audit_rutas_permisos.baseline.json` se toleran; cualquier ruta NUEVA
 * sin protección hace fallar el script (exit 1). Al ir cerrando rutas, se
 * regenera la línea base y esta sólo puede achicarse.
 *
 * Uso:
 *   node scripts/audit_rutas_permisos.js                # verifica contra la línea base
 *   node scripts/audit_rutas_permisos.js --listar       # lista todas las rutas sin protección
 *   node scripts/audit_rutas_permisos.js --actualizar   # reescribe la línea base
 */
const fs = require('fs');
const path = require('path');

const RUTAS_DIR = path.join(__dirname, '..', 'src', 'routes');
const BASELINE = path.join(__dirname, 'audit_rutas_permisos.baseline.json');
const GUARDIAS = ['requirePermiso', 'requireAnyPermiso', 'adminMiddleware', 'requireBotApiKey'];
const METODOS = ['get', 'post', 'put', 'delete', 'patch'];

/** Devuelve el texto entre paréntesis balanceados a partir de `inicio` (posición del "("). */
function extraerArgumentos(src, inicio) {
	let prof = 0;
	let comilla = null;
	for (let i = inicio; i < src.length; i++) {
		const c = src[i];
		if (comilla) {
			if (c === '\\') i++;
			else if (c === comilla) comilla = null;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') comilla = c;
		else if (c === '(') prof++;
		else if (c === ')') {
			prof--;
			if (prof === 0) return src.slice(inicio + 1, i);
		}
	}
	return src.slice(inicio + 1);
}

function analizarArchivo(archivo) {
	const src = fs.readFileSync(path.join(RUTAS_DIR, archivo), 'utf8');

	// Constantes que envuelven una guardia: const requireX = requireAnyPermiso(...)
	const alias = new Set(GUARDIAS);
	const reAlias = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(requirePermiso|requireAnyPermiso)\s*\(/g;
	for (let m; (m = reAlias.exec(src)); ) alias.add(m[1]);

	const contieneGuardia = (texto) =>
		[...alias].some((g) => new RegExp(`\\b${g}\\b`).test(texto));

	// Posición de la primera guardia a nivel de archivo: router.use(<guardia>)
	let guardiaGlobalDesde = Infinity;
	const reUse = /router\.use\s*\(/g;
	for (let m; (m = reUse.exec(src)); ) {
		const args = extraerArgumentos(src, m.index + m[0].length - 1);
		if (contieneGuardia(args)) guardiaGlobalDesde = Math.min(guardiaGlobalDesde, m.index);
	}

	const rutas = [];
	const reRuta = new RegExp(`router\\.(${METODOS.join('|')})\\s*\\(`, 'g');
	for (let m; (m = reRuta.exec(src)); ) {
		const args = extraerArgumentos(src, m.index + m[0].length - 1);
		const p = /^\s*(['"`])(.*?)\1/.exec(args);
		rutas.push({
			metodo: m[1].toUpperCase(),
			ruta: p ? p[2] : '(dinámica)',
			protegida: m.index > guardiaGlobalDesde || contieneGuardia(args),
		});
	}
	return rutas;
}

function auditar() {
	const sinProteccion = [];
	let total = 0;
	for (const f of fs.readdirSync(RUTAS_DIR).filter((x) => x.endsWith('.js')).sort()) {
		for (const r of analizarArchivo(f)) {
			total++;
			if (!r.protegida) sinProteccion.push(`${f} ${r.metodo} ${r.ruta}`);
		}
	}
	return { total, sinProteccion: sinProteccion.sort() };
}

function main() {
	const args = new Set(process.argv.slice(2));
	const { total, sinProteccion } = auditar();

	if (args.has('--listar')) {
		console.log(sinProteccion.join('\n'));
		console.log(`\n${sinProteccion.length} de ${total} rutas sin control de permisos propio.`);
		return;
	}
	if (args.has('--actualizar')) {
		fs.writeFileSync(BASELINE, JSON.stringify(sinProteccion, null, '\t') + '\n');
		console.log(`Línea base actualizada: ${sinProteccion.length} de ${total} rutas sin protección.`);
		return;
	}

	const base = fs.existsSync(BASELINE) ? new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8'))) : new Set();
	const actuales = new Set(sinProteccion);
	const nuevas = sinProteccion.filter((r) => !base.has(r));
	const cerradas = [...base].filter((r) => !actuales.has(r));

	console.log(`Rutas: ${total} | sin control propio: ${sinProteccion.length} | en línea base: ${base.size}`);
	if (cerradas.length) {
		console.log(`\nRutas ya protegidas (podés reducir la línea base con --actualizar): ${cerradas.length}`);
	}
	if (nuevas.length) {
		console.error('\nRutas NUEVAS sin control de permisos:');
		for (const r of nuevas) console.error('  - ' + r);
		console.error('\nAgregá requirePermiso(...) / requireAnyPermiso(...) a esas rutas.');
		process.exit(1);
	}
	console.log('OK: no hay rutas nuevas sin protección.');
}

main();
