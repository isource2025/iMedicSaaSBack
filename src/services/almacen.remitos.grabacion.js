/**
 * Grabación transaccional de remitos legacy (Clarion):
 * Cbtes_Numeracion → Transacciones → Remitos → RemitosItems → Remitos_Observa
 * → Stock + Stock_Mov → remito espejo (Tipos_Remitos.IdTipo_Generar).
 *
 * Todas las funciones reciben un sql.Transaction abierto.
 */
const { sql } = require('../models/db');

const STATUS_ANULADO = 0;
const STATUS_CONFIRMADO = 2;

/** dbo.StockCod */
const STOCK_COD = {
	REMITO_SALIDA: 9,
	ANULA_REMITO_SALIDA: 10,
	REMITO_ENTRADA: 11,
};

function req(tx) {
	return new sql.Request(tx);
}

function trim(v) {
	if (v == null) return null;
	const s = String(v).replace(/\u0000/g, '').trim();
	return s || null;
}

/**
 * Próximo número del comprobante. Toma el mayor entre Cbtes_Numeracion y
 * MAX(Remitos.NroCbte) porque la web grabó números sin avanzar la tabla.
 * La fila queda bloqueada hasta el commit (serializa usuarios concurrentes).
 */
async function reservarNumero(tx, { idEmpresa, idSucursal, tipo, grupo, letra }) {
	const r = await req(tx)
		.input('emp', sql.SmallInt, idEmpresa)
		.input('suc', sql.SmallInt, idSucursal)
		.input('tipo', sql.Char(3), tipo)
		.input('grupo', sql.SmallInt, grupo)
		.input('letra', sql.Char(1), letra)
		.query(`
      DECLARE @actual int, @existe bit = 0, @maxRem int, @nuevo int;

      SELECT @actual = NroCbte, @existe = 1
      FROM dbo.Cbtes_Numeracion WITH (UPDLOCK, HOLDLOCK)
      WHERE IdEmpresa = @emp AND IdSucursal = @suc AND Tipo_Cbte = @tipo
        AND Grupo_Cbte = @grupo AND Letra_Cbte = @letra;

      SELECT @maxRem = MAX(NroCbte)
      FROM dbo.Remitos WITH (UPDLOCK, HOLDLOCK)
      WHERE Tipo_Cbte = @tipo AND IdEmpresa = @emp AND IdSucursal = @suc
        AND Grupo_Cbte = @grupo AND Letra_Cbte = @letra;

      SET @nuevo = (CASE WHEN ISNULL(@actual, 0) > ISNULL(@maxRem, 0) THEN ISNULL(@actual, 0) ELSE ISNULL(@maxRem, 0) END) + 1;

      IF @existe = 1
        UPDATE dbo.Cbtes_Numeracion SET NroCbte = @nuevo
        WHERE IdEmpresa = @emp AND IdSucursal = @suc AND Tipo_Cbte = @tipo
          AND Grupo_Cbte = @grupo AND Letra_Cbte = @letra;
      ELSE
        INSERT INTO dbo.Cbtes_Numeracion (IdEmpresa, IdSucursal, Tipo_Cbte, Grupo_Cbte, Letra_Cbte, NroCbte)
        VALUES (@emp, @suc, @tipo, @grupo, @letra, @nuevo);

      SELECT @nuevo AS Nro;
    `);
	return r.recordset[0].Nro;
}

/** IdTransaccion no es IDENTITY: MAX + 1 con bloqueo de rango hasta el commit. */
async function reservarIdTransaccion(tx) {
	const r = await req(tx).query(`
    SELECT ISNULL((
      SELECT MAX(m) FROM (
        SELECT MAX(IdTransaccion) AS m FROM dbo.Transacciones WITH (UPDLOCK, HOLDLOCK)
        UNION ALL
        SELECT MAX(IdTransaccion) FROM dbo.Remitos WITH (UPDLOCK, HOLDLOCK)
      ) x
    ), 0) + 1 AS NextId
  `);
	return r.recordset[0].NextId;
}

/** Suma `delta` a Cant_Fisico / Cant_Disp; crea la fila de Stock si no existe. */
async function moverStock(tx, { idEmpresa, idSucursal, idDeposito, idProducto, delta, ahora }) {
	if (!delta) return;
	await req(tx)
		.input('emp', sql.SmallInt, idEmpresa)
		.input('suc', sql.SmallInt, idSucursal)
		.input('dep', sql.SmallInt, idDeposito)
		.input('prod', sql.Int, idProducto)
		.input('delta', sql.Decimal(18, 4), delta)
		.input('ahora', sql.DateTime, ahora)
		.query(`
      UPDATE dbo.Stock WITH (UPDLOCK, HOLDLOCK)
      SET Cant_Fisico = ISNULL(Cant_Fisico, 0) + @delta,
          Cant_Disp = ISNULL(Cant_Disp, 0) + @delta,
          Fecha = @ahora
      WHERE IdEmpresa = @emp AND IdSucursal = @suc AND IdDeposito = @dep AND IdProducto = @prod;

      IF @@ROWCOUNT = 0
        INSERT INTO dbo.Stock (
          IdProducto, IdEmpresa, IdSucursal, IdDeposito, Fecha, Ubicacion,
          Stock_Minimo, Stock_Maximo, Punto_Pedido, Cant_PendIng, Cant_EnRec,
          Cant_Fisico, Cant_Disp, Cant_Comp, Cant_Consg, Cant_Recha, Cant_Transi,
          Cant_EnRep, Cant_Desuso, Cant_FServ
        ) VALUES (
          @prod, @emp, @suc, @dep, @ahora, '',
          0, 0, 0, 0, 0,
          @delta, @delta, 0, 0, 0, 0,
          0, 0, 0
        );
    `);
}

function mueveStock(tipoRow, idStatus) {
	return Number(idStatus) === STATUS_CONFIRMADO && Number(tipoRow?.StkFisico ?? 1) === 1;
}

/**
 * Inserta Transacciones + Remitos + RemitosItems + Remitos_Observa, mueve stock
 * y registra Stock_Mov. `c.isNew=false` actualiza cabeceras en lugar de insertarlas
 * (el llamador ya revirtió stock y borró ítems).
 */
async function escribirComprobante(tx, c) {
	const status = c.idStatus;
	const sentido = c.sentido;
	const signo = sentido === 'S' ? -1 : 1;

	const reqTx = req(tx)
		.input('id', sql.Int, c.idTx)
		.input('emp', sql.SmallInt, c.idEmpresa)
		.input('suc', sql.SmallInt, c.idSucursal)
		.input('tipo', sql.Char(3), c.tipo)
		.input('grupo', sql.SmallInt, c.grupo)
		.input('letra', sql.Char(1), c.letra)
		.input('nro', sql.Int, c.nro)
		.input('empId', sql.Int, c.audUser)
		.input('desc', sql.Char(50), 'Emision de Remitos')
		.input('fecha', sql.DateTime, c.fecha)
		.input('horaD', sql.DateTime, c.fechaHora)
		.input('ahora', sql.DateTime, c.ahora)
		.input('audUser', sql.SmallInt, c.audUser);
	// Transacciones.Hora (char 8) no se escribe: Clarion guarda ahí un TIME binario.
	if (c.isNew) {
		await reqTx.query(`
      INSERT INTO dbo.Transacciones (
        IdTransaccion, IdEmpresa, IdSucursal, TipoCbte, GrupoCbte, LetraCbte, NroCbte,
        IdEmpleado, Descripcion, NroEvento, IdStatus, Fecha, Hora_D,
        Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion
      ) VALUES (
        @id, @emp, @suc, @tipo, @grupo, @letra, @nro,
        @empId, @desc, 0, 1, @fecha, @horaD,
        @ahora, @ahora, @audUser, 1
      )
    `);
	} else {
		await reqTx.query(`
      UPDATE dbo.Transacciones SET
        Fecha = @fecha, Hora_D = @horaD,
        Aud_Fecha_Date = @ahora, Aud_Hora = @ahora, Aud_Usuario = @audUser, Aud_Accion = 2
      WHERE IdTransaccion = @id
    `);
	}

	const reqH = req(tx)
		.input('id', sql.Int, c.idTx)
		.input('emp', sql.SmallInt, c.idEmpresa)
		.input('suc', sql.SmallInt, c.idSucursal)
		.input('tipo', sql.Char(3), c.tipo)
		.input('grupo', sql.SmallInt, c.grupo)
		.input('letra', sql.Char(1), c.letra)
		.input('nro', sql.Int, c.nro)
		.input('dep', sql.SmallInt, c.idDeposito)
		.input('empDest', sql.SmallInt, c.idDepositoDest != null ? c.idEmpresa : null)
		.input('sucDest', sql.SmallInt, c.idDepositoDest != null ? c.idSucursal : null)
		.input('depDest', sql.SmallInt, c.idDepositoDest)
		.input('prov', sql.Int, c.idProveedor)
		.input('cli', sql.Int, c.idCliente)
		.input('fecha', sql.DateTime, c.fecha)
		.input('orig', sql.Int, c.idTxOrig)
		.input('bultos', sql.SmallInt, c.bultos)
		.input('status', sql.SmallInt, status)
		.input('imp', sql.Decimal(18, 4), c.total)
		.input('costo', sql.Decimal(18, 4), c.costo)
		.input('ahora', sql.DateTime, c.ahora)
		.input('audUser', sql.SmallInt, c.audUser);
	if (c.isNew) {
		await reqH.query(`
      INSERT INTO dbo.Remitos (
        IdTransaccion, IdEmpresa, IdSucursal, Tipo_Cbte, Grupo_Cbte, Letra_Cbte, NroCbte,
        IdDeposito, IdEmpresaDest, IdSucursalDest, IdDepositoDest, IdProveedor, IdCliente,
        Fecha, IdFletero, Flete_Costo, IdTransaccionOrig, Bultos, IdStatus, CotizacionM2, ImporteM2,
        ImporteCosto, ImportePPP,
        Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion
      ) VALUES (
        @id, @emp, @suc, @tipo, @grupo, @letra, @nro,
        @dep, @empDest, @sucDest, @depDest, ISNULL(@prov, 0), ISNULL(@cli, 0),
        @fecha, 0, 0, ISNULL(@orig, 0), @bultos, @status, 0, 0,
        @costo, @imp,
        @ahora, @ahora, @audUser, 1
      )
    `);
	} else {
		await reqH.query(`
      UPDATE dbo.Remitos SET
        IdDeposito = @dep, IdEmpresaDest = @empDest, IdSucursalDest = @sucDest, IdDepositoDest = @depDest,
        IdProveedor = ISNULL(@prov, 0), IdCliente = ISNULL(@cli, 0), Fecha = @fecha, Bultos = @bultos, IdStatus = @status,
        ImporteCosto = @costo, ImportePPP = @imp,
        Aud_Fecha_Date = @ahora, Aud_Hora = @ahora, Aud_Usuario = @audUser, Aud_Accion = 2
      WHERE IdTransaccion = @id
    `);
	}

	const stock = mueveStock(c.tipoRow, status);
	for (let i = 0; i < c.items.length; i++) {
		const it = c.items[i];
		const renglon = i + 1;
		await req(tx)
			.input('id', sql.Int, c.idTx)
			.input('ren', sql.SmallInt, renglon)
			.input('sent', sql.Char(1), sentido)
			.input('dep', sql.SmallInt, c.idDeposito)
			.input('status', sql.SmallInt, status)
			.input('prod', sql.Int, it.IdProducto)
			.input('tipo', sql.Char(3), c.tipo)
			.input('cant', sql.Decimal(18, 4), it.Cantidad)
			.input('cantSig', sql.Decimal(18, 4), signo * Math.abs(Number(it.Cantidad) || 0))
			.input('cli', sql.Int, c.idCliente)
			.input('prov', sql.Int, c.idProveedor)
			.input('fecha', sql.DateTime, c.fecha)
			.input('unit', sql.Decimal(18, 4), it.ImporteUnitario)
			.input('tot', sql.Decimal(18, 4), it.ImporteTotal)
			.input('orig', sql.Int, c.idTxOrig)
			.input('renOrig', sql.SmallInt, it.RenglonOrig ?? null)
			.input('pac', sql.Int, it.IdPaciente)
			.input('nroInd', sql.Int, it.NroIndicacion)
			.input('desc', sql.VarChar(sql.MAX), it.DescripcionProducto)
			.input('ahora', sql.DateTime, c.ahora)
			.input('audUser', sql.SmallInt, c.audUser)
			.query(`
        INSERT INTO dbo.RemitosItems (
          IdTransaccion, Renglon, Sentido, IdDeposito, IdStatus, IdProducto, IdTipo,
          Cantidad, Cantidad_Origen, Cantidad_Fisico, Cantidad_Disp, Cantidad_Comp, Cantidad_Consg,
          IdCliente, IdProveedor, Fecha, ImporteUnitario, ImporteTotal,
          IdTransaccionOrig, RenglonOrig, DescripcionProducto, IdPaciente, NroIndicacion,
          Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion
        ) VALUES (
          @id, @ren, @sent, @dep, @status, @prod, @tipo,
          @cant, @cant, @cantSig, @cantSig, 0, 0,
          ISNULL(@cli, 0), ISNULL(@prov, 0), @fecha, @unit, @tot,
          ISNULL(@orig, 0), ISNULL(@renOrig, @ren), @desc, @pac, @nroInd,
          @ahora, @ahora, @audUser, 1
        )
      `);

		if (!stock) continue;
		const delta = signo * Math.abs(Number(it.Cantidad) || 0);
		await moverStock(tx, {
			idEmpresa: c.idEmpresa,
			idSucursal: c.idSucursal,
			idDeposito: c.idDeposito,
			idProducto: it.IdProducto,
			delta,
			ahora: c.ahora,
		});
		await req(tx)
			.input('emp', sql.SmallInt, c.idEmpresa)
			.input('suc', sql.SmallInt, c.idSucursal)
			.input('tipo', sql.Char(3), c.tipo)
			.input('grupo', sql.SmallInt, c.grupo)
			.input('letra', sql.Char(1), c.letra)
			.input('nro', sql.Int, c.nro)
			.input('ren', sql.SmallInt, renglon)
			.input('dep', sql.SmallInt, c.idDeposito)
			.input('mov', sql.Char(3), String(sentido === 'S' ? STOCK_COD.REMITO_SALIDA : STOCK_COD.REMITO_ENTRADA))
			.input('sent', sql.Char(1), sentido)
			.input('status', sql.SmallInt, status)
			.input('fecha', sql.DateTime, c.fecha)
			.input('prod', sql.Int, it.IdProducto)
			.input('uni', sql.Char(3), (trim(it.IdUnidad) || 'UN').slice(0, 3))
			.input('cant', sql.Decimal(18, 4), Math.abs(Number(it.Cantidad) || 0))
			.input('delta', sql.Decimal(18, 4), delta)
			.input('unit', sql.Decimal(18, 4), it.ImporteUnitario)
			.input('tot', sql.Decimal(18, 4), it.ImporteTotal)
			.input('ahora', sql.DateTime, c.ahora)
			.input('audUser', sql.SmallInt, c.audUser)
			.query(`
        INSERT INTO dbo.Stock_Mov (
          IdEmpresa, IdSucursal, TipoCbte, GrupoCbte, LetraCbte, NroCbte, NroRenglon,
          IdDeposito, Tipo_Mov, Sentido, IdStatus, Fecha, IdProducto, IdUnidad,
          Cantidad, Cant_PendIng, Cant_EnRec, Cant_Fisico, Cant_Disp, Cant_Comp, Cant_Consg,
          Cant_Recha, Cant_Transi, Cant_EnRep, Cant_Desuso, Cant_FServ,
          Precio, Importe_Total, Precio_PPP,
          Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion
        ) VALUES (
          @emp, @suc, @tipo, @grupo, @letra, @nro, @ren,
          @dep, @mov, @sent, @status, @fecha, @prod, @uni,
          @cant, 0, 0, @delta, @delta, 0, 0,
          0, 0, 0, 0, 0,
          @unit, @tot, @unit,
          @ahora, @ahora, @audUser, 1
        )
      `);
	}

	await req(tx).input('id', sql.Int, c.idTx).query(`DELETE FROM dbo.Remitos_Observa WHERE IdTransaccion = @id`);
	if (c.observacion) {
		await req(tx)
			.input('id', sql.Int, c.idTx)
			.input('fecha', sql.DateTime, c.fecha)
			.input('com', sql.VarChar(2000), c.observacion.slice(0, 2000))
			.input('ahora', sql.DateTime, c.ahora)
			.input('audUser', sql.SmallInt, c.audUser)
			.query(`
        INSERT INTO dbo.Remitos_Observa (IdTransaccion, Item, Fecha, Comentarios, Aud_Fecha_Date, Aud_Hora, Aud_Usuario, Aud_Accion)
        VALUES (@id, 1, @fecha, @com, @ahora, @ahora, @audUser, 1)
      `);
	}
}

async function leerCabecera(tx, idTx) {
	const r = await req(tx).input('id', sql.Int, idTx).query(`
    SELECT r.IdTransaccion, r.IdEmpresa, r.IdSucursal, RTRIM(r.Tipo_Cbte) AS Tipo_Cbte, r.Grupo_Cbte,
           RTRIM(r.Letra_Cbte) AS Letra_Cbte, r.NroCbte, r.IdDeposito, r.IdDepositoDest, r.IdStatus,
           r.IdTransaccionOrig, RTRIM(t.Sentido) AS Sentido, t.stk_Fisico
    FROM dbo.Remitos r WITH (UPDLOCK, HOLDLOCK)
    LEFT JOIN dbo.Tipos_Remitos t ON t.IdTipo = r.Tipo_Cbte
    WHERE r.IdTransaccion = @id
  `);
	return r.recordset[0] || null;
}

/** Remito generado automáticamente a partir de `idTx` (REM espejo de un RSM). */
async function buscarEspejo(tx, idTx) {
	const r = await req(tx).input('id', sql.Int, idTx).query(`
    SELECT TOP 1 IdTransaccion FROM dbo.Remitos WITH (UPDLOCK, HOLDLOCK)
    WHERE IdTransaccionOrig = @id AND IdTransaccion <> @id AND IdStatus <> ${STATUS_ANULADO}
    ORDER BY IdTransaccion
  `);
	return r.recordset[0]?.IdTransaccion ?? null;
}

/**
 * Deshace el efecto en Stock del comprobante.
 * Fuente: Stock_Mov activo; si no hay (remitos grabados por Clarion), los ítems confirmados.
 * `anular=true` deja los Stock_Mov con IdStatus 0 como historial; si no, los borra.
 */
async function revertirStock(tx, cab, { anular, ahora, audUser }) {
	const keys = (r) =>
		r
			.input('emp', sql.SmallInt, cab.IdEmpresa)
			.input('suc', sql.SmallInt, cab.IdSucursal)
			.input('tipo', sql.Char(3), cab.Tipo_Cbte)
			.input('grupo', sql.SmallInt, cab.Grupo_Cbte)
			.input('letra', sql.Char(1), cab.Letra_Cbte)
			.input('nro', sql.Int, cab.NroCbte);
	const filtro = `IdEmpresa = @emp AND IdSucursal = @suc AND TipoCbte = @tipo
      AND GrupoCbte = @grupo AND LetraCbte = @letra AND NroCbte = @nro`;

	const movs = await keys(req(tx)).query(`
    SELECT IdDeposito, IdProducto, Cant_Fisico FROM dbo.Stock_Mov WITH (UPDLOCK, HOLDLOCK)
    WHERE ${filtro} AND IdStatus <> ${STATUS_ANULADO}
  `);

	if (movs.recordset.length) {
		for (const m of movs.recordset) {
			await moverStock(tx, {
				idEmpresa: cab.IdEmpresa,
				idSucursal: cab.IdSucursal,
				idDeposito: m.IdDeposito,
				idProducto: m.IdProducto,
				delta: -Number(m.Cant_Fisico || 0),
				ahora,
			});
		}
	} else if (mueveStock({ StkFisico: cab.stk_Fisico }, cab.IdStatus)) {
		const items = await req(tx).input('id', sql.Int, cab.IdTransaccion).query(`
      SELECT IdDeposito, IdProducto, Cantidad, RTRIM(Sentido) AS Sentido
      FROM dbo.RemitosItems WHERE IdTransaccion = @id AND IdStatus = ${STATUS_CONFIRMADO}
    `);
		for (const it of items.recordset) {
			const cant = Math.abs(Number(it.Cantidad) || 0);
			await moverStock(tx, {
				idEmpresa: cab.IdEmpresa,
				idSucursal: cab.IdSucursal,
				idDeposito: it.IdDeposito ?? cab.IdDeposito,
				idProducto: it.IdProducto,
				delta: it.Sentido === 'S' ? cant : -cant,
				ahora,
			});
		}
	}

	if (anular) {
		await keys(req(tx))
			.input('ahora', sql.DateTime, ahora)
			.input('audUser', sql.SmallInt, audUser)
			.query(`
        UPDATE dbo.Stock_Mov SET IdStatus = ${STATUS_ANULADO},
          Aud_Fecha_Date = @ahora, Aud_Hora = @ahora, Aud_Usuario = @audUser, Aud_Accion = 3
        WHERE ${filtro}
      `);
	} else {
		await keys(req(tx)).query(`DELETE FROM dbo.Stock_Mov WHERE ${filtro}`);
	}
}

/** Suma (signo=1) o descuenta (signo=-1) lo entregado en imInterIndMedicas. */
async function ajustarEntregaIndicaciones(tx, items, { signo, fechaIso }) {
	for (const it of items || []) {
		const nro = Number(it.NroIndicacion);
		if (!Number.isFinite(nro) || nro <= 0) continue;
		const cant = Math.abs(Number(it.Cantidad) || 0);
		if (!cant) continue;
		await req(tx)
			.input('nro', sql.Int, nro)
			.input('cant', sql.Real, signo * cant)
			.input('fecha', sql.Date, signo > 0 ? fechaIso : null)
			.query(`
        UPDATE dbo.imInterIndMedicas
        SET CantidadEntregada = CASE WHEN ISNULL(CantidadEntregada, 0) + @cant < 0 THEN 0
                                     ELSE ISNULL(CantidadEntregada, 0) + @cant END,
            ParaFechaEntrega = COALESCE(@fecha, ParaFechaEntrega)
        WHERE NroIndicacion = @nro AND ISNULL(NroAdicional, 0) = 0
      `);
	}
}

async function leerItemsIndicaciones(tx, idTx) {
	const r = await req(tx).input('id', sql.Int, idTx).query(`
    SELECT NroIndicacion, Cantidad FROM dbo.RemitosItems
    WHERE IdTransaccion = @id AND NroIndicacion > 0
  `);
	return r.recordset;
}

async function marcarAnulado(tx, idTx, { ahora, audUser }) {
	await req(tx)
		.input('id', sql.Int, idTx)
		.input('ahora', sql.DateTime, ahora)
		.input('audUser', sql.SmallInt, audUser)
		.query(`
      UPDATE dbo.Remitos SET IdStatus = ${STATUS_ANULADO},
        Aud_Fecha_Date = @ahora, Aud_Hora = @ahora, Aud_Usuario = @audUser, Aud_Accion = 3
      WHERE IdTransaccion = @id;
      UPDATE dbo.RemitosItems SET IdStatus = ${STATUS_ANULADO},
        Aud_Fecha_Date = @ahora, Aud_Hora = @ahora, Aud_Usuario = @audUser, Aud_Accion = 3
      WHERE IdTransaccion = @id;
      UPDATE dbo.Transacciones SET
        Aud_Fecha_Date = @ahora, Aud_Hora = @ahora, Aud_Usuario = @audUser, Aud_Accion = 3
      WHERE IdTransaccion = @id;
    `);
}

module.exports = {
	STATUS_ANULADO,
	STATUS_CONFIRMADO,
	moverStock,
	reservarNumero,
	reservarIdTransaccion,
	escribirComprobante,
	leerCabecera,
	buscarEspejo,
	revertirStock,
	ajustarEntregaIndicaciones,
	leerItemsIndicaciones,
	marcarAnulado,
};
