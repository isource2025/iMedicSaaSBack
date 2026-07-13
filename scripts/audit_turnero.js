/**
 * Verifica tablas, pantalla, display público y opcionalmente un llamado de prueba.
 * Uso: node scripts/audit_turnero.js
 *      node scripts/audit_turnero.js --llamar=12345
 */
require('dotenv').config();
const { runWithTenant } = require('../src/context/tenantContext');
const turneroService = require('../src/services/turnero.service');
const tokenIndex = require('../src/services/turneroTokenIndex.service');

const idEmpresa = Number(process.env.BOT_EMPRESA_ID || process.env.TURNERO_EMPRESA_ID || 1);
const llamarArg = process.argv.find((a) => a.startsWith('--llamar='));
const idTurnoLlamar = llamarArg ? Number(llamarArg.split('=')[1]) : null;

async function main() {
	console.log(`\n── Audit turnero (empresa ${idEmpresa}) ──\n`);

	const admin = await runWithTenant(idEmpresa, () => turneroService.getAdminState());
	console.log('✓ Pantalla:', admin.nombre);
	console.log('  Token:', admin.publicToken);
	console.log('  URL local: http://localhost:3001/display/' + admin.publicToken);

	const todas = await runWithTenant(idEmpresa, () => turneroService.listarPantallas());
	console.log(`✓ Pantallas activas: ${todas.length}`);
	todas.forEach((p) => {
		console.log(`  · ${p.nombre} (${p.sectoresResumen}) → /display/${p.publicToken}`);
	});

	const resolved = await tokenIndex.resolveEmpresaByToken(admin.publicToken);
	console.log(resolved === idEmpresa ? '✓ Token index OK' : `⚠ Token index → empresa ${resolved}`);

	const display = await turneroService.obtenerDisplayPorToken(admin.publicToken);
	console.log('✓ Display público OK');
	console.log('  Empresa:', display.empresa.nombre);
	console.log('  Llamados hoy:', display.llamados.length);
	console.log('  Médicos hoy:', display.medicosHoy?.length ?? 0);

	const urlInfo = await runWithTenant(idEmpresa, () => turneroService.getDisplayUrl());
	console.log('✓ GET /turnero/url OK →', urlInfo.displayPath);
	if (urlInfo.pantallas?.length) {
		console.log(`  Pantallas en agenda: ${urlInfo.pantallas.length}`);
	}

	if (idTurnoLlamar && Number.isFinite(idTurnoLlamar)) {
		const llamado = await runWithTenant(idEmpresa, () =>
			turneroService.registrarLlamado({
				matricula: 0,
				idTurno: idTurnoLlamar,
				porIdTurno: true,
			}),
		);
		console.log('✓ Llamado de prueba:', llamado.paciente, '| cons.', llamado.consultorio || '-');
	}

	console.log('\nListo. Abrí la URL en el navegador y probá desde la agenda.\n');
	process.exit(0);
}

main().catch((e) => {
	console.error('❌', e.message);
	process.exit(1);
});
