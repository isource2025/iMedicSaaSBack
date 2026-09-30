#!/usr/bin/env node
/**
 * Instalación EXPLÍCITA del esquema de roles personalizados (base central).
 * El servidor nunca modifica el esquema por su cuenta: se hace sólo con este script.
 *
 *   node scripts/esquema_roles.js                          estado actual (sólo lectura)
 *   node scripts/esquema_roles.js --simular                qué haría, sin ejecutar (sólo lectura)
 *   node scripts/esquema_roles.js --aplicar --confirmo-respaldo
 *   node scripts/esquema_roles.js --revertir --confirmo-respaldo
 *   node scripts/esquema_roles.js --empresas               empresas con la función habilitada
 *   node scripts/esquema_roles.js --habilitar-empresa 102 --confirmo-respaldo
 *   node scripts/esquema_roles.js --deshabilitar-empresa 102 --confirmo-respaldo
 *
 * Conexión: ESQUEMA_DB_URL, o MYSQL_PUBLIC_URL (.env). Opcional `--esperar-base <nombre>`
 * aborta si la base conectada no es la esperada.
 *
 * Es idempotente: si se corta a mitad, volver a correrlo continúa donde quedó.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const schema = require('../src/services/rolesCustomSchema.service');
const featureFlags = require('../src/services/featureFlags.service');

const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const valorDe = (f) => {
	const i = args.indexOf(f);
	return i >= 0 ? args[i + 1] : undefined;
};

const escribe = tiene('--aplicar') || tiene('--revertir') || tiene('--habilitar-empresa') || tiene('--deshabilitar-empresa');

function salir(msg, codigo = 1) {
	console.error(msg);
	process.exit(codigo);
}

function mostrarPasos(pasos) {
	for (const p of pasos) {
		const marca = p.aplicado ? '[ya aplicado]' : '[PENDIENTE]   ';
		console.log(`  ${marca} ${p.descripcion || p.id}`);
	}
}

(async () => {
	const uri = process.env.ESQUEMA_DB_URL || process.env.MYSQL_PUBLIC_URL;
	if (!uri) salir('Falta ESQUEMA_DB_URL o MYSQL_PUBLIC_URL en el entorno/.env', 2);

	const conn = await mysql.createConnection({ uri, connectTimeout: 20000 });
	const consultar = async (sql, params = []) => (await conn.query(sql, params))[0];

	try {
		const [{ base }] = await consultar('SELECT DATABASE() AS base');
		const esperada = valorDe('--esperar-base');
		if (esperada && esperada !== base) salir(`Base conectada "${base}" distinta de la esperada "${esperada}". Se aborta.`, 2);

		if (escribe && !tiene('--confirmo-respaldo')) {
			salir('Esta operación modifica la base. Hacé un respaldo y repetí con --confirmo-respaldo.', 2);
		}
		if (!escribe) await conn.query('SET SESSION TRANSACTION READ ONLY');

		console.log(`Base central: ${base}  (modo: ${escribe ? 'ESCRITURA' : 'solo lectura'})\n`);

		if (tiene('--habilitar-empresa') || tiene('--deshabilitar-empresa')) {
			const activar = tiene('--habilitar-empresa');
			const idEmpresa = Number(valorDe(activar ? '--habilitar-empresa' : '--deshabilitar-empresa'));
			if (!Number.isInteger(idEmpresa) || idEmpresa <= 0) salir('Indicá un número de empresa válido.', 2);

			const diag = await schema.diagnosticar(consultar);
			if (!diag.instalado) salir('El esquema no está instalado. Corré primero --aplicar.', 1);
			const empresa = await consultar('SELECT 1 AS ok FROM Empresas WHERE IDEMPRESA = ? LIMIT 1', [idEmpresa]);
			if (!empresa.length) salir(`La empresa ${idEmpresa} no existe.`, 1);

			await featureFlags.establecer(idEmpresa, featureFlags.FLAG_ROLES_PERSONALIZADOS, activar, { consultar });
			console.log(`Roles personalizados ${activar ? 'HABILITADOS' : 'DESHABILITADOS'} para la empresa ${idEmpresa}.`);
			console.log('(Las instancias lo toman en hasta ~30 segundos.)');
			return;
		}

		if (tiene('--empresas')) {
			const existe = await consultar(
				`SELECT 1 AS ok FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imFeatureFlags'`,
			);
			if (!existe.length) return console.log('imFeatureFlags todavía no existe: ninguna empresa habilitada.');
			const lista = await featureFlags.empresasHabilitadas(featureFlags.FLAG_ROLES_PERSONALIZADOS, { consultar });
			return console.log(lista.length ? `Empresas habilitadas: ${lista.join(', ')}` : 'Ninguna empresa habilitada.');
		}

		if (tiene('--revertir')) {
			const r = await schema.revertir(consultar);
			console.log('Reversa aplicada:');
			r.ejecutados.forEach((id) => console.log('  - ' + id));
			if (!r.ejecutados.length) console.log('  (no había nada que revertir)');
			return;
		}

		if (tiene('--aplicar')) {
			const r = await schema.aplicar(consultar);
			console.log('Instalación aplicada:');
			r.ejecutados.forEach((id) => console.log('  + ' + id));
			if (!r.ejecutados.length) console.log('  (ya estaba todo instalado)');
			const diag = await schema.diagnosticar(consultar);
			console.log(`\nVerificación: esquema ${diag.instalado ? 'INSTALADO' : 'INCOMPLETO'}`);
			if (!diag.instalado) process.exit(1);
			return;
		}

		// Estado / simulación (sólo lectura)
		const problemas = await schema.precondiciones(consultar);
		if (problemas.length) {
			console.log('Precondiciones NO cumplidas:');
			problemas.forEach((p) => console.log('  - ' + p));
			process.exit(1);
		}
		const diag = await schema.diagnosticar(consultar);
		console.log(`Roles en imRoles: ${diag.rolesTotal}  (personalizados: ${diag.rolesPersonalizados})`);
		console.log(`Esquema: ${diag.instalado ? 'INSTALADO' : 'NO instalado'}\n`);
		mostrarPasos(diag.pasos);
		if (tiene('--simular')) {
			console.log('\nSimulación: estos pasos PENDIENTES se ejecutarían en orden con --aplicar --confirmo-respaldo:');
			diag.pasos.filter((p) => !p.aplicado).forEach((p) => console.log(`\n-- ${p.descripcion}\n${p.sql}`));
		}
	} finally {
		await conn.end();
	}
})().catch((e) => {
	console.error('ERROR:', e.message);
	process.exit(1);
});
