/**
 * Prueba de punta a punta de Productos / Stock / Proveedores dentro de UNA
 * transacción que termina en ROLLBACK (no deja datos).
 *
 * Uso: node scripts/probar_almacen_crud.js [IdDeposito]
 */
require('dotenv').config();
const { connectDB, sql } = require('../src/config/database');

let ok = 0;
let fallas = 0;
function check(cond, msg, extra) {
	if (cond) {
		ok++;
		console.log(`  ✓ ${msg}`);
	} else {
		fallas++;
		console.log(`  ✗ ${msg}`, extra !== undefined ? JSON.stringify(extra) : '');
	}
}
async function esperaError(fn, patron, msg) {
	try {
		await fn();
		check(false, `${msg} (no falló)`);
	} catch (e) {
		check(patron.test(e.message), `${msg} → "${e.message}"`);
	}
}

(async () => {
	const idDeposito = Number(process.argv[2] || 1);
	const pool = await connectDB();
	const tx = new sql.Transaction(pool);
	await tx.begin();

	// Todo lo que pase por pool.request() / enTransaccion corre en `tx`, serializado.
	let cola = Promise.resolve();
	pool.request = () => {
		const r = new sql.Request(tx);
		const q = r.query.bind(r);
		r.query = (s) => {
			const p = cola.then(() => q(s));
			cola = p.catch(() => {});
			return p;
		};
		return r;
	};
	const comun = require('../src/services/almacen.comun');
	comun.enTransaccion = async (fn) => fn(tx);

	const productos = require('../src/services/almacen.productos.service');
	const existencias = require('../src/services/almacen.existencias.service');
	const proveedores = require('../src/services/almacen.proveedores.service');
	const auth = { usuario: { codOperador: 1 } };

	try {
		console.log('\n# Esquema');
		const cols = await pool.request().query(`
      SELECT TABLE_NAME t, COLUMN_NAME c, CHARACTER_MAXIMUM_LENGTH l FROM INFORMATION_SCHEMA.COLUMNS
      WHERE (TABLE_NAME = 'Stock' AND COLUMN_NAME = 'Ubicacion')
         OR (TABLE_NAME IN ('Compras', 'CtaCte_Prov') AND COLUMN_NAME = 'IdProveedor')`);
		const has = (t, c) => cols.recordset.find((x) => x.t === t && x.c === c);
		check(has('Stock', 'Ubicacion'), `Stock.Ubicacion largo ${has('Stock', 'Ubicacion')?.l}`);
		check(has('Compras', 'IdProveedor'), 'Compras.IdProveedor existe');
		check(has('CtaCte_Prov', 'IdProveedor'), 'CtaCte_Prov.IdProveedor existe');

		console.log('\n# Lecturas');
		const rp = await productos.resumen();
		check(rp.total > 0 && rp.porRubro.length > 0, `productos.resumen total=${rp.total} conStock=${rp.conStock}`);
		const lp = await productos.listar({ estado: 'activos', stock: 'con', pageSize: 5, orden: 'stock' });
		check(lp.items.length > 0 && lp.items[0].StockTotal > 0, `productos.listar con stock → ${lp.total}`);
		const re = await existencias.resumen({});
		check(re.filas > 0 && re.porDeposito.length > 0, `existencias.resumen filas=${re.filas} unidades=${re.unidades}`);
		const le = await existencias.listar({ estado: 'con', orden: 'critico', pageSize: 5 });
		check(le.items.every((x) => x.CantFisico > 0), `existencias.listar estado=con → ${le.total}`);
		const mv = await existencias.movimientos({ pageSize: 5 });
		check(Array.isArray(mv.items) && mv.dias === 90, `existencias.movimientos ${mv.items.length} (hasMore=${mv.hasMore})`);
		const rv = await proveedores.resumen();
		check(rv.total > 0, `proveedores.resumen total=${rv.total} activos=${rv.pctActivos}%`);
		const lv = await proveedores.listar({ orden: 'actividad', pageSize: 5 });
		check(lv.items.length > 0, `proveedores.listar actividad → ${lv.items[0]?.Descripcion} (${lv.items[0]?.Remitos} remitos)`);
		const cv = await proveedores.catalogos();
		check(cv.estados.length === 3 && cv.tipos.length > 0, `proveedores.catalogos estados=${cv.estados.length} tipos=${cv.tipos.length}`);

		console.log('\n# Producto: alta / edición / catálogos');
		const nuevo = await productos.crear({ Descripcion: 'PRUEBA CRUD ALMACEN', IdUnidad: 'UN', PrecioVenta: 150, PrecioCosto: 100 }, auth);
		check(nuevo.IdProducto > 0 && nuevo.Activo, `crear producto #${nuevo.IdProducto}`);
		const editado = await productos.actualizar(nuevo.IdProducto, { Descripcion: 'PRUEBA CRUD EDITADA', CBarra: '7790001112223' }, auth);
		check(editado.Descripcion === 'PRUEBA CRUD EDITADA' && editado.CBarra === '7790001112223', 'actualizar producto');
		const aud = await pool.request().query(`SELECT Aud_Usuario FROM dbo.Productos WHERE IdProducto = ${nuevo.IdProducto}`);
		check(aud.recordset[0].Aud_Usuario === 1, 'Aud_Usuario grabado');
		const anterior = await productos.guardarFoto(nuevo.IdProducto, 'productos/0/prueba.jpg', auth);
		const conFoto = await productos.obtener(nuevo.IdProducto);
		check(anterior == null && conFoto.TieneFoto, 'guardarFoto');
		const marca = await productos.guardarCatalogo('marcas', { Descripcion: 'MARCA PRUEBA CRUD' });
		check(marca.id > 0, `catálogo marcas alta #${marca.id}`);
		await productos.guardarCatalogo('marcas', { Descripcion: 'MARCA PRUEBA 2' }, marca.id);
		await productos.eliminarCatalogo('marcas', marca.id);
		check(true, 'catálogo marcas edición y baja');
		await esperaError(() => productos.eliminarCatalogo('rubros', 2), /lo usan/, 'no borra rubro en uso');

		console.log('\n# Stock: alta / parámetros / ajustes / baja');
		const k = { IdProducto: nuevo.IdProducto, IdDeposito: idDeposito, IdEmpresa: 1, IdSucursal: 1 };
		await esperaError(
			() => existencias.crear({ ...k, StockMinimo: 10, StockMaximo: 5 }, auth),
			/mínimo no puede superar/,
			'valida min <= max',
		);
		const alta = await existencias.crear({ ...k, Ubicacion: 'EST-A1', StockMinimo: 5, StockMaximo: 50, PuntoPedido: 10, CantidadInicial: 20 }, auth);
		check(alta.CantFisico === 20 && alta.ajuste?.Comprobante?.startsWith('AJU'), `alta con stock inicial → ${alta.ajuste?.Comprobante}`);
		check(alta.estado === 'ok' && alta.nivelPct === 40, `estado=${alta.estado} nivel=${alta.nivelPct}%`);
		await esperaError(() => existencias.crear({ ...k }, auth), /ya está dado de alta/, 'no duplica alta');
		const par = await existencias.actualizar(k, { PuntoPedido: 25, Ubicacion: 'EST-B2' });
		check(par.PuntoPedido === 25 && par.Ubicacion === 'EST-B2' && par.estado === 'reponer', `parámetros → estado=${par.estado}`);
		const aj1 = await existencias.ajustar({ ...k, Modo: 'delta', Cantidad: -17, Motivo: 'Rotura' }, auth);
		check(aj1.CantFisico === 3 && aj1.estado === 'bajo', `ajuste -17 → ${aj1.CantFisico} (${aj1.estado})`);
		const aj2 = await existencias.ajustar({ ...k, Modo: 'conteo', Cantidad: 60, Motivo: 'Inventario' }, auth);
		check(aj2.CantFisico === 60 && aj2.ajuste.delta === 57 && aj2.estado === 'exceso', `conteo 60 → delta ${aj2.ajuste.delta} (${aj2.estado})`);
		await esperaError(() => existencias.ajustar({ ...k, Cantidad: -100, Motivo: 'x' }, auth), /negativo/, 'no deja negativo');
		await esperaError(() => existencias.ajustar({ ...k, Cantidad: 1 }, auth), /motivo/, 'exige motivo');
		const movs = await pool.request().query(`
      SELECT m.Tipo_Mov, m.Sentido, m.Cant_Fisico, m.NroCbte, RTRIM(t.Descripcion) AS D
      FROM dbo.Stock_Mov m
      JOIN dbo.Transacciones t ON t.TipoCbte = m.TipoCbte AND t.GrupoCbte = m.GrupoCbte AND t.NroCbte = m.NroCbte
        AND t.LetraCbte = m.LetraCbte AND t.IdEmpresa = m.IdEmpresa AND t.IdSucursal = m.IdSucursal
      WHERE m.TipoCbte = 'AJU' AND m.IdProducto = ${nuevo.IdProducto} ORDER BY m.NroCbte`);
		const tipos = movs.recordset.map((m) => `${String(m.Tipo_Mov).trim()}${m.Sentido}${Number(m.Cant_Fisico)}`);
		check(tipos.join(',') === '7E20,6S-17,5E57', `Stock_Mov + Transacciones: ${tipos.join(',')}`);
		check(movs.recordset[1]?.D === 'Rotura', 'motivo en Transacciones.Descripcion');
		const nros = movs.recordset.map((m) => m.NroCbte);
		check(nros[1] === nros[0] + 1 && nros[2] === nros[1] + 1, `numeración AJU correlativa ${nros.join(',')}`);
		const cbte = await pool.request().query(`SELECT NroCbte FROM dbo.Cbtes_Numeracion WHERE Tipo_Cbte = 'AJU' AND IdEmpresa = 1 AND IdSucursal = 1 AND Grupo_Cbte = YEAR(GETDATE())`);
		check(cbte.recordset[0]?.NroCbte === nros[2], 'Cbtes_Numeracion avanzó');
		const kardex = await existencias.movimientos({ idProducto: nuevo.IdProducto });
		check(kardex.items.length === 3 && kardex.items[0].Concepto === 'Inventario', `kardex ${kardex.items.length} movimientos`);
		await esperaError(() => existencias.eliminar(k), /Tiene existencias/, 'no quita con existencias');

		const fichaP = await productos.ficha(nuevo.IdProducto);
		check(fichaP.stock.length === 1 && fichaP.movimientos.length === 3, 'ficha de producto');

		console.log('\n# Proveedor: alta / edición / hijos / baja');
		await esperaError(() => proveedores.crear({ Descripcion: 'X', Cuit: '20123456780' }, auth), /CUIT no es válido/, 'valida CUIT');
		const prov = await proveedores.crear(
			{
				Descripcion: 'PROVEEDOR PRUEBA CRUD',
				NombreFantasia: 'PRUEBA',
				Cuit: '30-71234567-1',
				IdTipoIva: 1,
				Email: 'compras@prueba.com',
				Calle: 'JUJUY',
				CalleNro: 100,
				telefonos: [{ Tipo: 'T', Numero: '3794-123456' }],
				contactos: [{ Contacto: 'ANA', Cargo: 'VENTAS', Email: 'ana@prueba.com' }],
				productos: [{ IdProducto: nuevo.IdProducto, CodProveedor: 'P-01', PrecioRef: 99.5, PlazoEntrega: 3 }],
				NuevaObservacion: 'Alta de prueba',
			},
			auth,
		).catch(async (e) => {
			// El CUIT de ejemplo puede no cerrar el dígito: generamos uno válido.
			if (!/CUIT/.test(e.message)) throw e;
			const base = '3071234567';
			for (let d = 0; d <= 9; d++) {
				if (proveedores.cuitValido(base + d)) {
					return proveedores.crear(
						{
							Descripcion: 'PROVEEDOR PRUEBA CRUD',
							Cuit: base + d,
							telefonos: [{ Tipo: 'T', Numero: '3794-123456' }],
							contactos: [{ Contacto: 'ANA', Cargo: 'VENTAS' }],
							productos: [{ IdProducto: nuevo.IdProducto, CodProveedor: 'P-01', PrecioRef: 99.5 }],
							NuevaObservacion: 'Alta de prueba',
						},
						auth,
					);
				}
			}
			throw e;
		});
		check(prov.IdProveedor > 0 && prov.IdStatus === 1, `crear proveedor #${prov.IdProveedor} CUIT ${prov.CuitFmt}`);
		check(prov.telefonos.length === 1 && prov.contactos.length === 1 && prov.productos.length === 1 && prov.observaciones.length === 1, 'hijos grabados');
		await esperaError(() => proveedores.crear({ Descripcion: 'DUP', Cuit: prov.Cuit }, auth), /Ya existe el proveedor/, 'CUIT único');
		const provEd = await proveedores.actualizar(prov.IdProveedor, { ...prov, Descripcion: 'PROVEEDOR EDITADO', telefonos: [], productos: prov.productos }, auth);
		check(provEd.Descripcion === 'PROVEEDOR EDITADO' && provEd.telefonos.length === 0 && provEd.productos.length === 1, 'actualizar proveedor y reemplazar hijos');
		const fichaP2 = await productos.ficha(nuevo.IdProducto);
		check(fichaP2.proveedores.length === 1 && fichaP2.proveedores[0].PrecioRef === 99.5, 'producto ve a su proveedor');
		const susp = await proveedores.cambiarEstado(prov.IdProveedor, 2, auth);
		check(susp.IdStatus === 2, 'suspender proveedor');
		const delProv = await proveedores.eliminar(prov.IdProveedor, auth);
		check(delProv.modo === 'eliminado', 'eliminar proveedor sin movimientos');

		const conRem = lv.items.find((x) => x.Remitos > 0);
		if (conRem) {
			const baja = await proveedores.eliminar(conRem.IdProveedor, auth);
			check(baja.modo === 'baja' && baja.proveedor.IdStatus === 3, `proveedor con remitos → baja (#${conRem.IdProveedor})`);
		}

		console.log('\n# Producto: baja / eliminación');
		const bajaProd = await productos.eliminar(nuevo.IdProducto, auth);
		check(bajaProd.modo === 'baja' && bajaProd.producto.Activo === false, 'producto con movimientos → baja');
		const react = await productos.cambiarEstado(nuevo.IdProducto, true, auth);
		check(react.Activo, 'reactivar producto');
		const limpio = await productos.crear({ Descripcion: 'PRUEBA SIN USO' }, auth);
		const delLimpio = await productos.eliminar(limpio.IdProducto, auth);
		check(delLimpio.modo === 'eliminado', 'producto sin uso → eliminado');

		// Stock: dejarlo en 0 y quitarlo
		await existencias.ajustar({ ...k, Modo: 'conteo', Cantidad: 0, Motivo: 'Cierre prueba' }, auth);
		await existencias.eliminar(k);
		const queda = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.Stock WHERE IdProducto = ${nuevo.IdProducto}`);
		check(queda.recordset[0].n === 0, 'quitar del depósito con stock 0');
	} catch (e) {
		fallas++;
		console.error('\n✗ Error inesperado:', e.message, e.stack);
	} finally {
		await tx.rollback();
		console.log(`\nROLLBACK hecho. ${ok} ok, ${fallas} fallas.`);
		process.exit(fallas ? 1 : 0);
	}
})();
