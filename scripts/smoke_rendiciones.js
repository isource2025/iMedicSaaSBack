/**
 * Prueba de humo del servicio de rendiciones contra la base local.
 * Lee rendiciones reales y crea, edita y borra una de prueba (queda borrada al final).
 * Uso: node scripts/smoke_rendiciones.js
 */
const db = require('../src/models/db');
const svc = require('../src/services/facturacion/rendiciones.service');

/** `esperado`: código HTTP del error que tiene que tirar; sin él, tiene que andar. */
const t = async (nombre, fn, esperado) => {
	const ini = Date.now();
	try {
		const r = await fn();
		console.log(`${esperado ? 'FALLA' : 'OK'} ${nombre} (${Date.now() - ini} ms)${esperado ? `: no tiró ${esperado}` : ''}`);
		return r;
	} catch (e) {
		const ok = esperado && e.statusCode === esperado;
		console.log(`${ok ? 'OK' : 'FALLA'} ${nombre} (${Date.now() - ini} ms): ${e.statusCode || ''} ${e.message}`);
		return null;
	}
};

(async () => {
	await db.executeQuery('SELECT 1 AS ok');
	const cat = await t('catalogos', () => svc.catalogos());
	console.log('   clientes', cat?.clientes.length, 'convenios', cat?.convenios.length);

	const lista = await t('listar', () => svc.listar({}));
	console.log('   ', lista?.total, JSON.stringify(lista?.resumen));
	console.log('   ', JSON.stringify(lista?.filas[0]));
	await t('listar filtrado', () => svc.listar({ q: 'internados', desde: '2025-01', hasta: '2026-12', estado: 'abierta' })).then((r) =>
		console.log('   ', r?.total),
	);
	await t('listar período inválido', () => svc.listar({ desde: '2025-13' }), 400);

	for (const id of [7032, 6978]) {
		const d = await t(`obtener ${id}`, () => svc.obtener(id));
		console.log('   ', JSON.stringify({ importes: d?.importes, detalle: d?.detalle, diferencias: d?.diferencias, vacia: d?.vacia }));
		const v = await t(`visitas ${id}`, () => svc.visitas(id, { tamPagina: 3 }));
		console.log('   ', v?.total, JSON.stringify(v?.filas[0]));
		const l = await t(`lineas ${id}`, () => svc.lineas(id, { tamPagina: 200 }));
		const estados = {};
		for (const f of l?.filas || []) estados[f.valorizacion.estado] = (estados[f.valorizacion.estado] || 0) + 1;
		console.log('   ', l?.total, JSON.stringify(estados));
		console.log('   ', JSON.stringify(l?.filas.find((f) => f.tipo.valor === 'H')));
		const f = await t(`facturas ${id}`, () => svc.facturas(id));
		console.log('   ', JSON.stringify(f));
	}
	await t('exportar', () => svc.exportar({ desde: '2026-01', hasta: '2026-12' })).then((r) => console.log('   ', r?.length));

	const ctx = { actor: 1, ip: 'smoke' };
	const nueva = await t('crear', () =>
		svc.crear({ idCliente: 2, idConvenio: 746, periodo: '2026-10', observaciones: 'PRUEBA SMOKE - BORRAR' }, ctx),
	);
	if (nueva) {
		console.log('   ', JSON.stringify({ id: nueva.id, periodo: nueva.periodo, vacia: nueva.vacia, tipo: nueva.tipoCliente }));
		await t('crear con convenio de otro cliente', () =>
			svc.crear({ idCliente: 15, idConvenio: 746, periodo: '2026-10' }, ctx),
			400,
		);
		const ed = await t('editar período', () => svc.actualizar(nueva.id, { periodo: '2026-09', observaciones: 'PRUEBA SMOKE 2' }, ctx));
		console.log('   ', ed?.periodo, ed?.observaciones);
		await t('editar cabecera con líneas', () => svc.actualizar(7032, { periodo: '2026-09' }, ctx), 409);
		await t('borrar con líneas', () => svc.eliminar(7032, ctx), 409);
		await t('borrar la de prueba', () => svc.eliminar(nueva.id, ctx));
		await t('obtener borrada', () => svc.obtener(nueva.id), 404);
	}
	process.exit(0);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
