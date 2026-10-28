/**
 * Detecta autorizaciones por nombre de rol (no por código de permiso).
 *
 * Escanea middlewares, controllers, services, utils y (opcional) el front.
 * Complementa a audit_rutas_permisos.js, que no ve lógica dentro de handlers.
 *
 * Uso:
 *   node scripts/audit_gates_rol.js
 *   node scripts/audit_gates_rol.js --json
 *   node scripts/audit_gates_rol.js --fail   # exit 1 si hay hallazgos en src/ (excl. allowlist)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
	path.join(ROOT, 'src', 'middlewares'),
	path.join(ROOT, 'src', 'controllers'),
	path.join(ROOT, 'src', 'services'),
	path.join(ROOT, 'src', 'utils'),
	path.join(ROOT, 'src', 'asistente'),
	path.join(ROOT, 'src', 'routes'),
];
const FRONT = path.join(ROOT, '..', 'iMedicSaaSFront', 'src');

/** Patrones de gate por rol (autorización). No incluye comparaciones de catálogo/seed. */
const PATRONES = [
	{ id: 'esAdminClinico', re: /\besAdminClinico\s*\(/g },
	{ id: 'esEnfermeroSesion', re: /\besEnfermeroSesion\s*\(/g },
	{ id: 'rolTieneAccesoConversaciones', re: /\brolTieneAccesoConversaciones\s*\(/g },
	{ id: 'adminMiddleware', re: /\badminMiddleware\b/g },
	{ id: 'rolNombre_ADMIN', re: /rolNombre\s*===?\s*['"]ADMIN['"]/gi },
	{ id: 'rolNombre_MEDICO', re: /rolNombre\s*===?\s*['"]MEDICO['"]/gi },
	{ id: 'rolNombre_ENFERMERO', re: /rolNombre\s*===?\s*['"]ENFERMERO['"]/gi },
	{ id: 'rolNombre_SUPER_ADMIN', re: /rolNombre\s*===?\s*['"]SUPER_ADMIN['"]/gi },
	{ id: 'nombre_rol_ADMIN', re: /nombre\s*===?\s*['"]ADMIN['"]/gi },
	{ id: 'nombre_rol_MEDICO', re: /(?:rol|Rol).*===?\s*['"]MEDICO['"]|(?:===?\s*['"]MEDICO['"].*rol)/gi },
];

/**
 * Archivos donde el check de rol es identidad de plataforma / catálogo (no ACL de clínica).
 * Se listan pero no hacen fallar --fail.
 */
const ALLOWLIST = new Set([
	'src/services/authLoginFlow.service.js',
	'src/services/auth.service.js',
	'src/services/authCentral.service.js',
	'src/services/tenantRegistry.service.js',
	'src/services/nubeTenant.service.js',
	'src/services/permisos.service.js',
	'src/services/rolesCustom.service.js',
	'src/controllers/roles.controller.js',
	'src/controllers/permisos.controller.js',
	'src/utils/authEmpresas.js',
	'src/utils/empresaModulos.js',
	'src/utils/permisos.js',
	'src/middlewares/authJwt.middleware.js',
	// Wrappers ya basados en código de permiso (no en nombre de rol):
	'src/middlewares/propietario.middleware.js',
	'src/middlewares/admin.middleware.js',
	'src/asistente/autoria.js',
]);

/** Front: helpers que delegan a códigos de la matriz. */
const ALLOWLIST_FRONT = [
	'/hooks/useUsuarioActual.ts',
	'/hooks/useMarcarIndicacionesVistasAlSalir.ts',
	'/hooks/useLoginForm.ts', // SUPER_ADMIN = identidad de plataforma
];

function listarJs(dir, acc = []) {
	if (!fs.existsSync(dir)) return acc;
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (ent.name === 'node_modules' || ent.name === '.next') continue;
			listarJs(p, acc);
		} else if (/\.(js|ts|tsx)$/.test(ent.name)) acc.push(p);
	}
	return acc;
}

function escanear(archivo) {
	const src = fs.readFileSync(archivo, 'utf8');
	const rel = path.relative(ROOT, archivo).replace(/\\/g, '/');
	const hits = [];
	for (const { id, re } of PATRONES) {
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(src))) {
			const linea = src.slice(0, m.index).split('\n').length;
			hits.push({ archivo: rel, patron: id, linea, snippet: src.slice(m.index, m.index + 60).replace(/\s+/g, ' ') });
		}
	}
	return hits;
}

function main() {
	const args = new Set(process.argv.slice(2));
	const archivos = [];
	for (const d of DIRS) listarJs(d, archivos);
	if (fs.existsSync(FRONT)) listarJs(FRONT, archivos);

	const hallazgos = [];
	for (const f of archivos) hallazgos.push(...escanear(f));

	const acl = hallazgos.filter((h) => {
		const rel = h.archivo.replace(/\\/g, '/');
		if (ALLOWLIST.has(rel)) return false;
		if (ALLOWLIST_FRONT.some((s) => rel.includes(s))) return false;
		// UI que llama al helper ya migrado a permiso:
		if (h.patron === 'esAdminClinico' && rel.includes('iMedicSaaSFront')) return false;
		if (rel.includes('permisos.js') || rel.includes('permisos.ts')) return false;
		if (rel.includes('GATES_ROL') || rel.includes('audit_gates_rol')) return false;
		if (rel.includes('SuperAdmin') || rel.includes('Sidebar.tsx')) return false; // identidad plataforma / menú SA
		return true;
	});

	if (args.has('--json')) {
		console.log(JSON.stringify({ total: hallazgos.length, acl: acl.length, hallazgos: acl }, null, 2));
		return;
	}

	console.log(`Hallazgos totales (incl. allowlist): ${hallazgos.length}`);
	console.log(`Pendientes ACL (acción requerida): ${acl.length}\n`);
	for (const h of acl) {
		console.log(`  ${h.archivo}:${h.linea}  [${h.patron}]  ${h.snippet}`);
	}

	if (args.has('--fail') && acl.length) {
		console.error(`\nQuedan ${acl.length} gates por rol. Ver docs/GATES_ROL_A_PERMISO.md`);
		process.exit(1);
	}
}

main();
