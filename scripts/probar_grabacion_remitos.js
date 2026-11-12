/**
 * Prueba de punta a punta de la grabación de remitos legacy contra la BD del .env.
 * Todo corre dentro de UNA transacción que termina en ROLLBACK: no deja datos.
 *
 *   node scripts/probar_grabacion_remitos.js [IdProducto] [IdDepositoOrigen] [IdDepositoDestino]
 */
require('dotenv').config();
const { sql, connectDB } = require('../src/config/database');
const remitos = require('../src/services/almacen.remitos.service');

const ID_PRODUCTO = Number(process.argv[2]) || 6;
const DEP_ORIGEN = Number(process.argv[3]) || 1;
const DEP_DESTINO = Number(process.argv[4]) || 4;
const AUTH = { usuario: { codOperador: 15 } };

let fallas = 0;
function check(cond, msg) {
	console.log(`${cond ? '  OK ' : '  FALLA'}  ${msg}`);
	if (!cond) fallas++;
}

async function q(tx, text, inputs = {}) {
	const r = new sql.Request(tx);
	for (const [k, v] of Object.entries(inputs)) r.input(k, v);
	return (await r.query(text)).recordset;
}

async function stock(tx, dep) {
	const rows = await q(
		tx,
		`SELECT ISNULL(SUM(Cant_Fisico),0) AS f, ISNULL(SUM(Cant_Disp),0) AS d FROM dbo.Stock
     WHERE IdEmpresa = 1 AND IdSucursal = 1 AND IdDeposito = @dep AND IdProducto = @prod`,
		{ dep, prod: ID_PRODUCTO },
	);
	return Number(rows[0].f);
}

async function numeracion(tx, tipo, grupo) {
	const rows = await q(
		tx,
		`SELECT NroCbte FROM dbo.Cbtes_Numeracion WHERE IdEmpresa=1 AND IdSucursal=1 AND Tipo_Cbte=@tipo AND Grupo_Cbte=@grupo AND Letra_Cbte='X'`,
		{ tipo, grupo },
	);
	return rows[0]?.NroCbte ?? null;
}

async function remito(tx, id) {
	const [cab] = await q(tx, `SELECT * FROM dbo.Remitos WHERE IdTransaccion = @id`, { id });
	const [trx] = await q(tx, `SELECT * FROM dbo.Transacciones WHERE IdTransaccion = @id`, { id });
	const items = await q(tx, `SELECT * FROM dbo.RemitosItems WHERE IdTransaccion = @id ORDER BY Renglon`, { id });
	const movs = cab
		? await q(
				tx,
				`SELECT * FROM dbo.Stock_Mov WHERE IdEmpresa=@e AND IdSucursal=@s AND TipoCbte=@t AND GrupoCbte=@g AND LetraCbte=@l AND NroCbte=@n`,
				{ e: cab.IdEmpresa, s: cab.IdSucursal, t: cab.Tipo_Cbte, g: cab.Grupo_Cbte, l: cab.Letra_Cbte, n: cab.NroCbte },
			)
		: [];
	const [espejo] = await q(tx, `SELECT * FROM dbo.Remitos WHERE IdTransaccionOrig = @id AND IdTransaccion <> @id`, { id });
	return { cab, trx, items, movs, espejo };
}

(async () => {
	const pool = await connectDB();
	const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
	const grupo = Number(hoy.slice(0, 4));
	const [cli] = (await pool.request().query(`SELECT TOP 1 IdCliente FROM dbo.Clientes ORDER BY IdCliente DESC`)).recordset;
	const [prov] = (await pool.request().query(`SELECT TOP 1 IDPROVEEDOR AS Id FROM dbo.PROVEEDORES ORDER BY IDPROVEEDOR`)).recordset;

	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const ini = { o: await stock(tx, DEP_ORIGEN), d: await stock(tx, DEP_DESTINO) };
		const numIni = {
			REM: await numeracion(tx, 'REM', grupo),
			RSM: await numeracion(tx, 'RSM', grupo),
		};
		console.log(`Producto ${ID_PRODUCTO} · stock inicial dep ${DEP_ORIGEN}=${ini.o} dep ${DEP_DESTINO}=${ini.d}`);
		console.log(`Numeración inicial ${grupo}:`, numIni);

		console.log('\n1) REM entrada x3 con hora 10:15');
		const rem = await remitos.crear(
			{
				TipoCbte: 'REM',
				IdDeposito: DEP_ORIGEN,
				IdProveedor: prov.Id,
				Fecha: hoy,
				Hora: '10:15',
				Observaciones: 'prueba automatizada',
				items: [{ IdProducto: ID_PRODUCTO, Cantidad: 3, ImporteUnitario: 10 }],
			},
			AUTH,
			{ transaction: tx },
		);
		let r = await remito(tx, rem.IdTransaccion);
		check(!!r.cab && !!r.trx, 'Remitos + Transacciones insertados');
		check(r.cab.IdStatus === 2 && r.items.every((i) => i.IdStatus === 2), 'Cabecera e ítems CONFIRMADOS (IdStatus 2)');
		check(r.trx.Hora_D && r.trx.Hora_D.toISOString().slice(11, 16) === '10:15', `Transacciones.Hora_D = ${r.trx.Hora_D?.toISOString()}`);
		check(r.cab.Fecha.toISOString().slice(11, 19) === '00:00:00', 'Remitos.Fecha sin hora (como Clarion)');
		check(r.cab.Aud_Usuario === 15, 'Aud_Usuario del operador');
		check(r.movs.length === 1 && Number(r.movs[0].Cant_Fisico) === 3, 'Stock_Mov +3');
		check((await stock(tx, DEP_ORIGEN)) === ini.o + 3, 'Stock origen +3');
		check(
			(await numeracion(tx, 'REM', grupo)) === r.cab.NroCbte && r.cab.NroCbte > (numIni.REM || 0),
			`Cbtes_Numeracion REM avanzó a ${r.cab.NroCbte}`,
		);
		const obs = await q(tx, `SELECT * FROM dbo.Remitos_Observa WHERE IdTransaccion=@id`, { id: rem.IdTransaccion });
		check(obs.length === 1, 'Remitos_Observa grabada');

		console.log(`\n2) RSM salida a servicio x2 (dep ${DEP_ORIGEN} → ${DEP_DESTINO})`);
		const rsm = await remitos.crear(
			{
				TipoCbte: 'RSM',
				IdDeposito: DEP_ORIGEN,
				IdDepositoDest: DEP_DESTINO,
				Fecha: hoy,
				Hora: '11:30',
				items: [{ IdProducto: ID_PRODUCTO, Cantidad: 2, ImporteUnitario: 10 }],
			},
			AUTH,
			{ transaction: tx },
		);
		r = await remito(tx, rsm.IdTransaccion);
		const it0 = r.items[0];
		check(it0.Sentido === 'S', 'Ítem RSM sentido S');
		check(Number(it0.Cantidad) === 2 && Number(it0.Cantidad_Fisico) === -2 && Number(it0.Cantidad_Disp) === -2, 'Ítem de salida: Cantidad 2, Cantidad_Fisico/Disp -2 (como Clarion)');
		check(it0.RenglonOrig === 1 && it0.IdTransaccionOrig === 0 && it0.IdCliente === 0 && it0.IdProveedor === 0, 'Ítem: RenglonOrig = renglón y ceros en vez de NULL');
		check(
			r.cab.IdTransaccionOrig === 0 && r.cab.IdProveedor === 0 && r.cab.IdCliente === 0 && r.cab.IdFletero === 0 && Number(r.cab.Flete_Costo) === 0,
			'Cabecera: ceros en vez de NULL (IdTransaccionOrig, proveedor, cliente, flete)',
		);
		check(r.trx.IdEmpleado === 15 && r.trx.Aud_Usuario === 15, 'Transacciones.IdEmpleado y Aud_Usuario del operador');
		check(!r.espejo, 'RSM ya no genera REM espejo');
		check((await stock(tx, DEP_ORIGEN)) === ini.o + 1, 'Stock origen 3-2 = +1');
		check((await stock(tx, DEP_DESTINO)) === ini.d, 'Stock destino sin cambios');

		console.log('\n3) Editar RSM: cantidad 2 → 5');
		await remitos.actualizar(
			rsm.IdTransaccion,
			{
				TipoCbte: 'RSM',
				IdDeposito: DEP_ORIGEN,
				IdDepositoDest: DEP_DESTINO,
				Fecha: hoy,
				Hora: '11:45',
				items: [{ IdProducto: ID_PRODUCTO, Cantidad: 5, ImporteUnitario: 10 }],
			},
			AUTH,
			{ transaction: tx },
		);
		const r2 = await remito(tx, rsm.IdTransaccion);
		check(r2.cab.NroCbte === r.cab.NroCbte, 'Conserva el número');
		check(!r2.espejo, 'Editar no crea espejo');
		check(Number(r2.items[0].Cantidad_Fisico) === -5, 'Ítem editado con Cantidad_Fisico -5');
		check(r2.movs.length === 1 && Number(r2.movs[0].Cant_Fisico) === -5, 'Stock_Mov reescrito (-5)');
		check((await stock(tx, DEP_ORIGEN)) === ini.o - 2, 'Stock origen 3-5 = -2');
		check((await stock(tx, DEP_DESTINO)) === ini.d, 'Stock destino sin cambios');

		console.log('\n4) Anular RSM');
		await remitos.anular(rsm.IdTransaccion, AUTH, { transaction: tx });
		const r3 = await remito(tx, rsm.IdTransaccion);
		check(r3.cab.IdStatus === 0 && r3.items.every((i) => i.IdStatus === 0), 'RSM anulado (cabecera e ítems)');
		check(r3.movs.every((m) => m.IdStatus === 0), 'Stock_Mov quedan como historial con IdStatus 0');
		check((await stock(tx, DEP_ORIGEN)) === ini.o + 3, 'Stock origen vuelve a +3');
		check((await stock(tx, DEP_DESTINO)) === ini.d, 'Stock destino vuelve al inicial');

		console.log('\n5) RSP salida a paciente x1');
		const rsp = await remitos.crear(
			{
				TipoCbte: 'RSP',
				IdDeposito: DEP_ORIGEN,
				IdCliente: cli.IdCliente,
				Fecha: hoy,
				items: [{ IdProducto: ID_PRODUCTO, Cantidad: 1, ImporteUnitario: 10 }],
			},
			AUTH,
			{ transaction: tx },
		);
		const r5 = await remito(tx, rsp.IdTransaccion);
		check(r5.items[0].IdCliente === cli.IdCliente, 'Ítem RSP con IdCliente');
		check(Number(r5.items[0].Cantidad_Fisico) === -1, 'Ítem RSP con Cantidad_Fisico -1');
		check(!r5.espejo, 'RSP no genera espejo');
		check((await stock(tx, DEP_ORIGEN)) === ini.o + 2, 'Stock origen +3-1 = +2');

		console.log('\n6) Anular REM y RSP');
		await remitos.anular(rem.IdTransaccion, AUTH, { transaction: tx });
		await remitos.anular(rsp.IdTransaccion, AUTH, { transaction: tx });
		check((await stock(tx, DEP_ORIGEN)) === ini.o, 'Stock origen vuelve al inicial');

		let rechazo = null;
		try {
			await remitos.anular(rem.IdTransaccion, AUTH, { transaction: tx });
		} catch (e) {
			rechazo = e.message;
		}
		check(!!rechazo, `Anular dos veces se rechaza ("${rechazo}")`);
	} finally {
		await tx.rollback();
	}

	console.log(`\nROLLBACK hecho. ${fallas ? `${fallas} verificación(es) fallaron` : 'Todas las verificaciones OK'}`);
	process.exit(fallas ? 1 : 0);
})().catch((e) => {
	console.error('ERROR', e);
	process.exit(1);
});
