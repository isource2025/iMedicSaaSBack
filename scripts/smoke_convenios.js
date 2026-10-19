/**
 * Prueba de humo del servicio de convenios contra la BD local.
 * Duplica un convenio chico, ejercita guardado en lote y ajuste sobre la copia y la borra al final.
 * Uso: node scripts/smoke_convenios.js
 */
const db = require('../src/models/db');
const svc = require('../src/services/facturacion/convenios.service');

const t0 = () => Date.now();
const paso = async (titulo, fn) => {
	const ini = t0();
	try {
		const r = await fn();
		console.log(`OK  ${titulo} (${Date.now() - ini} ms)`);
		return r;
	} catch (e) {
		console.log(`ERR ${titulo}: ${e.message}${e.detalles ? ` ${JSON.stringify(e.detalles)}` : ''}`);
		throw e;
	}
};
const esperaError = async (titulo, fn, status) => {
	try {
		await fn();
		console.log(`ERR ${titulo}: no falló`);
	} catch (e) {
		const ok = Number(e.statusCode) === status;
		console.log(`${ok ? 'OK ' : 'ERR'} ${titulo} → ${e.statusCode} ${e.message}`);
	}
};

(async () => {
	let copia = null;
	await db.executeQuery('SELECT 1 AS ok');
	try {
		const cat = await paso('catalogos', () => svc.catalogos());
		console.log('   ', cat.obrasSociales.length, 'OS,', cat.letras.length, 'letras,', cat.funciones.length, 'funciones');

		const lista = await paso('listar', () => svc.listar({}));
		console.log('   ', lista.total, 'convenios, resumen', JSON.stringify(lista.resumen));
		console.log('   ', JSON.stringify(lista.filas[0]));
		await paso('listar filtrado', () => svc.listar({ q: 'osde', estado: 'vigente' }));

		const [chico] = await db.executeQuery(
			`SELECT TOP 1 c.Codigo FROM dbo.imClientesConvenios c
			 WHERE EXISTS (SELECT 1 FROM dbo.imClientesConvNomenc n WHERE n.ValorConvenio = c.Codigo)
			   AND (SELECT COUNT(*) FROM dbo.imClientesConvNomenc n WHERE n.ValorConvenio = c.Codigo) < 300
			 ORDER BY c.Codigo DESC`,
		);
		const origen = chico.Codigo;
		const det = await paso(`obtener ${origen}`, () => svc.obtener(origen));
		console.log('   ', JSON.stringify(det.conteos));
		const uso = await paso('uso', () => svc.uso(origen));
		console.log('   ', JSON.stringify(uso.map((u) => [u.id, u.cantidad])));

		const nom = await paso('pestaña nomenclador', () => svc.listarPestana(origen, 'nomenclador', { tamPagina: 5 }));
		console.log('   ', nom.total, 'filas; porFuncion', JSON.stringify(nom.porFuncion), JSON.stringify(nom.filas[0]));
		await paso('pestaña nomenclador q', () => svc.listarPestana(origen, 'nomenclador', { q: 'consulta' }));
		for (const p of ['valores', 'moduladas', 'vademecum', 'genericos', 'categorias', 'complejidad']) {
			await paso(`pestaña ${p}`, () => svc.listarPestana(origen, p, {}));
		}
		const busq = await paso('buscar nomenclador', () => svc.buscarEnCatalogo('nomenclador', '420101'));
		console.log('   ', JSON.stringify(busq.slice(0, 2)));
		await paso('buscar vademecum', () => svc.buscarEnCatalogo('vademecum', 'ibupro'));

		const dup = await paso('duplicar (+10%)', () =>
			svc.duplicar(origen, { descripcion: 'PRUEBA SMOKE', vigenciaDesde: '2026-01-01', ajustePorcentaje: 10 }, {}),
		);
		copia = dup.codigo;
		console.log('   ', copia, JSON.stringify(dup.copiadas));

		const lote = await paso('alta nomenclador', () =>
			svc.guardarLote(copia, 'nomenclador', { altas: [{ Desde: 420101, Hasta: 420101, Funcion: 0, TipoValor: '$', Valor: 1234.5, Ambulatorio: 1, Internacion: 0 }] }, {}),
		);
		console.log('   ', JSON.stringify(lote));
		const nueva = (await svc.listarPestana(copia, 'nomenclador', { q: '420101' })).filas.find((f) => f.Valor === 1234.5);
		console.log('    descripción completada desde catálogo:', nueva?.Descripcion);

		await esperaError('alta duplicada', () =>
			svc.guardarLote(copia, 'nomenclador', { altas: [{ Desde: 420101, Hasta: 420101, Funcion: 0, Valor: 1, Ambulatorio: 1, Internacion: 0 }] }, {}),
		409);
		await paso('cambio', () =>
			svc.guardarLote(copia, 'nomenclador', { cambios: [{ ...nueva, Valor: 99 }] }, {}),
		);
		await esperaError('cambio sobre fila borrada', async () => {
			await svc.guardarLote(copia, 'nomenclador', { bajas: [nueva._id] }, {});
			await svc.guardarLote(copia, 'nomenclador', { cambios: [{ ...nueva, Valor: 5 }] }, {});
		}, 409);

		await paso('valores alta/baja por clave', async () => {
			const letra = cat.letras[0].valor;
			const actuales = (await svc.listarPestana(copia, 'valores')).filas;
			const existe = actuales.find((f) => f.ValorLetra === letra && f.Ambulatorio === 0 && f.Internacion === 0);
			await svc.guardarLote(copia, 'valores', { bajas: existe ? [existe._id] : [], altas: [{ ValorLetra: letra, ValorGaleno: 10, Ambulatorio: 0, Internacion: 0 }] }, {});
			const otra = (await svc.listarPestana(copia, 'valores')).filas.find((f) => f.ValorLetra === letra && f.Ambulatorio === 0 && f.Internacion === 0);
			await svc.guardarLote(copia, 'valores', { cambios: [{ ...otra, ValorGastos: 7 }] }, {});
		});

		await paso('genéricos: alta, cambio y baja sin tocar el vademécum', async () => {
			const vadAntes = (await svc.listarPestana(copia, 'vademecum')).total;
			await svc.guardarLote(copia, 'genericos', { altas: [{ Descripcion: 'GENERICO SMOKE', TipoValor: '$', Valor: 10.555, Ambulatorio: 1, Internacion: 1 }] }, {});
			const g = (await svc.listarPestana(copia, 'genericos', { q: 'GENERICO SMOKE' })).filas[0];
			if (!g || g.Troquel !== 0 || g.Valor !== 10.56) throw new Error(`genérico mal guardado: ${JSON.stringify(g)}`);
			await svc.guardarLote(copia, 'genericos', { cambios: [{ ...g, Valor: 20 }] }, {});
			await svc.guardarLote(copia, 'genericos', { bajas: [g._id] }, {});
			const vadDespues = (await svc.listarPestana(copia, 'vademecum')).total;
			if (vadAntes !== vadDespues) throw new Error(`el vademécum cambió: ${vadAntes} → ${vadDespues}`);
		});
		await paso('categorías: alta, repetida, cambio y baja', async () => {
			const categoria = cat.categorias[0].valor;
			await svc.guardarLote(copia, 'categorias', { altas: [{ ValorCategoria: categoria, Desde: 0, Hasta: 0, Funcion: 0, TipoValor: '%', Valor: 15, Ambulatorio: 1, Internacion: 1 }] }, {});
			const f = (await svc.listarPestana(copia, 'categorias')).filas.find((x) => x.ValorCategoria === categoria);
			if (!f || f.Valor !== 15) throw new Error(`categoría mal guardada: ${JSON.stringify(f)}`);
			await esperaError('categoría repetida', () =>
				svc.guardarLote(copia, 'categorias', { altas: [{ ValorCategoria: categoria, Valor: 1 }] }, {}),
			409);
			await svc.guardarLote(copia, 'categorias', { cambios: [{ ...f, Valor: 20 }] }, {});
			await svc.guardarLote(copia, 'categorias', { bajas: [f._id] }, {});
		});
		await esperaError('vademécum con troquel 0', () =>
			svc.guardarLote(copia, 'vademecum', { altas: [{ Troquel: 0, Descripcion: 'X', Valor: 1, Ambulatorio: 1, Internacion: 1 }] }, {}),
		400);

		const prev = await paso('preview ajuste 5%', () => svc.previsualizarAjuste(copia, { porcentaje: 5 }));
		console.log('   ', JSON.stringify(prev.pestanas.map((x) => [x.pestana, x.filas, x.desbordan, x.muestra[0]])));
		const prevF = await paso('preview ajuste función 0', () => svc.previsualizarAjuste(copia, { porcentaje: 5, funcion: 0 }));
		console.log('   ', JSON.stringify(prevF.pestanas.map((x) => [x.pestana, x.aplica, x.filas])));
		const antes = (await svc.listarPestana(copia, 'valores')).filas.find((f) => f.ValorGaleno > 0);
		const aj = await paso('aplicar ajuste', () => svc.aplicarAjuste(copia, { porcentaje: 5, pestanas: ['nomenclador', 'valores'] }, {}));
		const despues = (await svc.listarPestana(copia, 'valores')).filas.find((f) => f._id === antes._id);
		console.log('   ', JSON.stringify(aj.pestanas), 'galeno', antes.ValorGaleno, '→', despues.ValorGaleno);

		await paso('actualizar cabecera', () => svc.actualizar(copia, { ...dup.cabecera, Descripcion: 'PRUEBA SMOKE 2', VigenciaHasta: '2026-12-31' }, {}));
		await esperaError('vigencia invertida', () => svc.actualizar(copia, { ...dup.cabecera, VigenciaHasta: '2025-01-01' }, {}), 400);

		const exp = await paso('exportar', () => svc.exportar(copia));
		console.log('   ', JSON.stringify(Object.fromEntries(Object.entries(exp.pestanas).map(([k, v]) => [k, v.length]))));

		const mant = await paso('reporte mantenimiento', () => svc.reporteMantenimiento());
		console.log('   ', JSON.stringify(mant.huerfanas.map((h) => [h.pestana, h.filas])), 'pxc', mant.practicasXConvenioHuerfanas, 'dup', mant.duplicadosNomenclador.length, 'inv', mant.rangosInvertidos.length, 'vacios', mant.conveniosVacios.length);
	} finally {
		if (copia) {
			for (const t of ['imClientesConvValores', 'imClientesConvNomenc', 'imClientesConvModuladas', 'imClientesConvVadem', 'imClientesConvComplejidad']) {
				await db.executeQuery(`DELETE FROM dbo.${t} WHERE ValorConvenio = @p0`, [{ value: copia, type: 'Int' }]);
			}
			await db.executeQuery(`DELETE FROM dbo.imPracticasXConvenios WHERE IdConvenio = @p0`, [{ value: copia, type: 'Int' }]);
			await db.executeQuery(`DELETE FROM dbo.imClientesConvenios WHERE Codigo = @p0`, [{ value: copia, type: 'Int' }]);
			console.log('limpieza: convenio de prueba', copia, 'borrado');
		}
		process.exit(0);
	}
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
