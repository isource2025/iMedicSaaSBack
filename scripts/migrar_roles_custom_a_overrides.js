#!/usr/bin/env node
/**
 * Fase 3/4/5 — migrar asignaciones de roles custom → sistema + overrides.
 * NO borra roles ni tablas.
 *
 *   node scripts/migrar_roles_custom_a_overrides.js --inventario [--empresa 103]
 *   node scripts/migrar_roles_custom_a_overrides.js --dry-run --empresa 102
 *   node scripts/migrar_roles_custom_a_overrides.js --aplicar --empresa 102 --confirmo-migracion
 *   node scripts/migrar_roles_custom_a_overrides.js --aplicar --empresa 102 --limite 5 --confirmo-migracion
 *   node scripts/migrar_roles_custom_a_overrides.js --verificar --empresa 102
 *   node scripts/migrar_roles_custom_a_overrides.js --deprecacion
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Cargar módulos primero (authCentralDb vuelve a leer .env y puede dejar AUTH_DB_ENABLED=0)
const migrar = require('../src/services/migrarRolesCustom.service');
const personalPermisos = require('../src/services/personalPermisos.service');

/** Después del require: fuerza AUTH_DB_* desde la URL pública (isAuthCentralEnabled lee env en cada call). */
(function bootstrapAuthDesdeUrl() {
	const uri = process.env.ESQUEMA_DB_URL || process.env.MYSQL_PUBLIC_URL;
	if (!uri) return;
	try {
		const u = new URL(uri);
		process.env.AUTH_DB_ENABLED = '1';
		process.env.AUTH_DB_HOST = u.hostname;
		process.env.AUTH_DB_PORT = u.port || '3306';
		process.env.AUTH_DB_USER = decodeURIComponent(u.username || '');
		process.env.AUTH_DB_PASSWORD = decodeURIComponent(u.password || '');
		process.env.AUTH_DB_NAME = (u.pathname || '').replace(/^\//, '').split('?')[0];
		process.env.AUTH_DB_SSL = '1';
		delete process.env.LOCAL_DEV_ONLY;
	} catch (e) {
		console.warn('No se pudo parsear MYSQL_PUBLIC_URL:', e.message);
	}
})();

const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const valorDe = (f) => {
	const i = args.indexOf(f);
	return i >= 0 ? args[i + 1] : undefined;
};

function salir(msg, codigo = 1) {
	console.error(msg);
	process.exit(codigo);
}

function resumenPlan(p) {
	const antes = p.rolesAntes.map((r) => `${r.nombre}${r.esCustom ? '*' : ''}`).join(', ');
	const despues = p.rolesDespues.map((r) => `${r.nombre}${r.esPrincipal ? ' (P)' : ''}`).join(', ');
	return `  #${p.valor} ${p.nombre || ''}
    antes: ${antes}
    despues: ${despues}
    overrides: +${p.grants.length} / −${p.denies.length}  efectivos: ${p.efectivosPrevios.length}→${p.efectivosNuevos.length}${
		p.permisosConservados ? '' : '  ⚠ DIFF'
	}`;
}

(async () => {
	await personalPermisos.asegurarTabla();

	if (tiene('--deprecacion')) {
		const d = await migrar.inventarioDeprecacion();
		console.log(JSON.stringify(d, null, 2));
		process.exit(0);
	}

	const idEmpresa = Number(valorDe('--empresa'));

	if (tiene('--inventario')) {
		if (Number.isFinite(idEmpresa) && idEmpresa > 0) {
			const inv = await migrar.inventariarEmpresa(idEmpresa);
			console.log(
				`Empresa ${inv.idEmpresa}: ${inv.personasConCustom} con custom (${inv.personasSoloCustom} solo-custom), ${inv.rolesCustomActivos} roles, planes=${inv.planes.length}, sinConservar=${inv.sinConservarPermisos}`,
			);
			inv.planes.slice(0, 15).forEach((p) => console.log(resumenPlan(p)));
			if (inv.planes.length > 15) console.log(`  … +${inv.planes.length - 15} más`);
		} else {
			const d = await migrar.inventarioDeprecacion();
			for (const e of d.rolesCustomPorEmpresa) {
				const inv = await migrar.inventariarEmpresa(e.idEmpresa);
				console.log(
					`Empresa ${e.idEmpresa}: roles=${e.roles} personasCustom=${inv.personasConCustom} solo=${inv.personasSoloCustom} planes=${inv.planes.length}`,
				);
			}
			console.log(`Asignaciones custom pendientes (global): ${d.asignacionesCustomPendientes}`);
		}
		process.exit(0);
	}

	if (!Number.isFinite(idEmpresa) || idEmpresa <= 0) {
		salir('Indicá --empresa <id> (o usá --inventario / --deprecacion)');
	}

	if (tiene('--verificar')) {
		const g = await migrar.verificarGates(idEmpresa);
		console.log(JSON.stringify(g, null, 2));
		process.exit(g.ok ? 0 : 1);
	}

	const inv = await migrar.inventariarEmpresa(idEmpresa);
	console.log(
		`Empresa ${idEmpresa}: ${inv.planes.length} personas a migrar (${inv.personasSoloCustom} solo-custom). Diffs no idénticos: ${inv.sinConservarPermisos}`,
	);

	if (tiene('--dry-run') || (!tiene('--aplicar') && !tiene('--verificar'))) {
		inv.planes.forEach((p) => console.log(resumenPlan(p)));
		console.log('\nDry-run: no se escribió nada. Para aplicar: --aplicar --empresa N --confirmo-migracion');
		process.exit(0);
	}

	if (tiene('--aplicar')) {
		if (!tiene('--confirmo-migracion')) {
			salir('Agregá --confirmo-migracion para escribir (reasigna roles + overrides; no borra plantillas).');
		}
		const limite = Number(valorDe('--limite'));
		const r = await migrar.aplicarInventario(idEmpresa, inv, {
			limite: Number.isFinite(limite) && limite > 0 ? limite : Infinity,
		});
		console.log(`Aplicados: ${r.aplicados.length}. Errores: ${r.errores.length}`);
		r.errores.forEach((e) => console.error(`  #${e.valor}: ${e.mensaje}`));
		const g = await migrar.verificarGates(idEmpresa);
		console.log('Gates:', JSON.stringify(g));
		process.exit(r.errores.length ? 1 : 0);
	}
})().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
