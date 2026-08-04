/**
 * Seed módulo Almacén: schema + datos del relevamiento Hospital Vidal.
 *
 * Uso:
 *   node scripts/seed_almacen.js
 *
 * Idempotente: re-ejecutable sin duplicar maestros (clave por Código/CUIT/Nro).
 */
require('dotenv').config();
const { connectDB, sql } = require('../src/config/database');
const { DDL } = (() => {
	// reutilizar DDL desde schema service si se exporta; si no, inline mínimo
	try {
		// DDL no se exporta como lista ejecutable por pool.request — replicamos ensure local
	} catch (_) {}
	return {};
})();

async function ensureSchema(pool) {
	const statements = [
		`IF OBJECT_ID('dbo.imAlmacenArticulo', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenArticulo (
    IdArticulo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo NVARCHAR(50) NOT NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    UnidadMedida NVARCHAR(50) NULL,
    StockMinimo DECIMAL(18,4) NOT NULL CONSTRAINT DF_seed_Art_SM DEFAULT (0),
    Activo BIT NOT NULL CONSTRAINT DF_seed_Art_Act DEFAULT (1),
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_seed_Art_F DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_seed_Art_Cod UNIQUE (Codigo)
  )`,
		`IF OBJECT_ID('dbo.imAlmacenProveedor', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenProveedor (
    IdProveedor INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    RazonSocial NVARCHAR(200) NOT NULL,
    CUIT NVARCHAR(20) NULL,
    Direccion NVARCHAR(200) NULL,
    Telefono NVARCHAR(50) NULL,
    Email NVARCHAR(100) NULL,
    Activo BIT NOT NULL CONSTRAINT DF_seed_Prov_Act DEFAULT (1),
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_seed_Prov_F DEFAULT (SYSUTCDATETIME())
  )`,
		`IF OBJECT_ID('dbo.imAlmacenDeposito', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenDeposito (
    IdDeposito INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Codigo NVARCHAR(20) NOT NULL,
    Nombre NVARCHAR(100) NOT NULL,
    EsPrincipal BIT NOT NULL CONSTRAINT DF_seed_Dep_P DEFAULT (0),
    Activo BIT NOT NULL CONSTRAINT DF_seed_Dep_A DEFAULT (1),
    CONSTRAINT UQ_seed_Dep_Cod UNIQUE (Codigo)
  )`,
		`IF OBJECT_ID('dbo.imAlmacenStock', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenStock (
    IdStock INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdArticulo INT NOT NULL,
    IdDeposito INT NOT NULL,
    Lote NVARCHAR(50) NOT NULL CONSTRAINT DF_seed_St_L DEFAULT (N''),
    Cantidad DECIMAL(18,4) NOT NULL CONSTRAINT DF_seed_St_C DEFAULT (0),
    FechaVencimiento DATE NULL,
    CONSTRAINT UQ_seed_Stock UNIQUE (IdArticulo, IdDeposito, Lote)
  )`,
		`IF OBJECT_ID('dbo.imAlmacenMovimiento', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenMovimiento (
    IdMovimiento INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Tipo NVARCHAR(20) NOT NULL,
    IdArticulo INT NOT NULL,
    IdDeposito INT NOT NULL,
    Lote NVARCHAR(50) NOT NULL CONSTRAINT DF_seed_Mov_L DEFAULT (N''),
    Cantidad DECIMAL(18,4) NOT NULL,
    SaldoResultante DECIMAL(18,4) NULL,
    IdDocumento INT NULL,
    TipoDocumento NVARCHAR(30) NULL,
    Observaciones NVARCHAR(500) NULL,
    Fecha DATETIME2 NOT NULL CONSTRAINT DF_seed_Mov_F DEFAULT (SYSUTCDATETIME()),
    Operador NVARCHAR(50) NULL
  )`,
		`IF OBJECT_ID('dbo.imAlmacenSolicitud', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenSolicitud (
    IdSolicitud INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroPedido NVARCHAR(50) NOT NULL,
    FechaPedido DATE NOT NULL,
    FechaEmision DATE NULL,
    Destino NVARCHAR(100) NULL,
    Justificacion NVARCHAR(500) NULL,
    Estado NVARCHAR(30) NOT NULL CONSTRAINT DF_seed_Sol_E DEFAULT (N'BORRADOR'),
    Solicitante NVARCHAR(100) NULL,
    Aprobador NVARCHAR(100) NULL,
    FechaAprobacion DATETIME2 NULL,
    CostoEstimado DECIMAL(18,2) NULL,
    Fondo NVARCHAR(50) NULL,
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_seed_Sol_F DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_seed_Sol_Nro UNIQUE (NroPedido)
  )`,
		`IF OBJECT_ID('dbo.imAlmacenSolicitudItem', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenSolicitudItem (
    IdItem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdSolicitud INT NOT NULL,
    Renglon INT NOT NULL,
    IdArticulo INT NULL,
    Codigo NVARCHAR(50) NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    Observaciones NVARCHAR(200) NULL,
    Cantidad DECIMAL(18,4) NOT NULL,
    CONSTRAINT FK_seed_SolItem FOREIGN KEY (IdSolicitud)
      REFERENCES dbo.imAlmacenSolicitud(IdSolicitud) ON DELETE CASCADE
  )`,
		`IF OBJECT_ID('dbo.imAlmacenOrden', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenOrden (
    IdOrden INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroOrden NVARCHAR(50) NOT NULL,
    IdSolicitud INT NULL,
    NroExpediente NVARCHAR(50) NULL,
    NroConcurso NVARCHAR(50) NULL,
    NroAdjudicacion NVARCHAR(50) NULL,
    NroAutorizacion NVARCHAR(50) NULL,
    TipoOperacion NVARCHAR(50) NULL,
    CondPago NVARCHAR(50) NULL,
    FechaInvitacion DATE NULL,
    LugarEntrega NVARCHAR(200) NULL,
    IdProveedor INT NULL,
    IdDeposito INT NULL,
    Estado NVARCHAR(30) NOT NULL CONSTRAINT DF_seed_Ord_E DEFAULT (N'EMITIDA'),
    Total DECIMAL(18,2) NOT NULL CONSTRAINT DF_seed_Ord_T DEFAULT (0),
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_seed_Ord_F DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_seed_Ord_Nro UNIQUE (NroOrden)
  )`,
		`IF OBJECT_ID('dbo.imAlmacenOrdenItem', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenOrdenItem (
    IdItem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdOrden INT NOT NULL,
    Renglon INT NOT NULL,
    IdArticulo INT NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    Observaciones NVARCHAR(200) NULL,
    Cantidad DECIMAL(18,4) NOT NULL,
    PrecioUnitario DECIMAL(18,4) NOT NULL CONSTRAINT DF_seed_OI_PU DEFAULT (0),
    Subtotal DECIMAL(18,2) NOT NULL CONSTRAINT DF_seed_OI_ST DEFAULT (0),
    CantidadRecibida DECIMAL(18,4) NOT NULL CONSTRAINT DF_seed_OI_CR DEFAULT (0),
    CONSTRAINT FK_seed_OrdItem FOREIGN KEY (IdOrden)
      REFERENCES dbo.imAlmacenOrden(IdOrden) ON DELETE CASCADE
  )`,
		`IF OBJECT_ID('dbo.imAlmacenActa', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenActa (
    IdActa INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NroActa NVARCHAR(50) NOT NULL,
    Fecha DATE NOT NULL,
    IdOrden INT NOT NULL,
    NroExpediente NVARCHAR(50) NULL,
    IdProveedor INT NULL,
    IdDeposito INT NOT NULL,
    Descuento DECIMAL(18,2) NOT NULL CONSTRAINT DF_seed_Acta_D DEFAULT (0),
    Total DECIMAL(18,2) NOT NULL CONSTRAINT DF_seed_Acta_T DEFAULT (0),
    NroFactura NVARCHAR(50) NULL,
    Estado NVARCHAR(30) NOT NULL CONSTRAINT DF_seed_Acta_E DEFAULT (N'CONFIRMADA'),
    Observaciones NVARCHAR(500) NULL,
    FechaAlta DATETIME2 NOT NULL CONSTRAINT DF_seed_Acta_F DEFAULT (SYSUTCDATETIME()),
    OperAlta NVARCHAR(50) NULL,
    CONSTRAINT UQ_seed_Acta_Nro UNIQUE (NroActa)
  )`,
		`IF OBJECT_ID('dbo.imAlmacenActaItem', 'U') IS NULL
  CREATE TABLE dbo.imAlmacenActaItem (
    IdItem INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    IdActa INT NOT NULL,
    Renglon INT NOT NULL,
    IdArticulo INT NULL,
    IdOrdenItem INT NULL,
    Descripcion NVARCHAR(300) NOT NULL,
    Marca NVARCHAR(100) NULL,
    Lote NVARCHAR(50) NULL,
    Cantidad DECIMAL(18,4) NOT NULL,
    PrecioUnitario DECIMAL(18,4) NOT NULL CONSTRAINT DF_seed_AI_PU DEFAULT (0),
    PrecioTotal DECIMAL(18,2) NOT NULL CONSTRAINT DF_seed_AI_PT DEFAULT (0),
    CONSTRAINT FK_seed_ActaItem FOREIGN KEY (IdActa)
      REFERENCES dbo.imAlmacenActa(IdActa) ON DELETE CASCADE
  )`,
	];

	for (const q of statements) {
		await pool.request().query(q);
	}
	console.log('✓ Schema almacén OK');
}

async function seed(pool) {
	// Depósito
	await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenDeposito WHERE Codigo = N'AG')
      INSERT INTO dbo.imAlmacenDeposito (Codigo, Nombre, EsPrincipal, Activo)
      VALUES (N'AG', N'Almacén General del Hospital', 1, 1);
  `);
	const dep = (
		await pool.request().query(`SELECT TOP 1 IdDeposito FROM dbo.imAlmacenDeposito WHERE Codigo = N'AG'`)
	).recordset[0];
	console.log('✓ Depósito AG id=', dep.IdDeposito);

	// Artículo (relevamiento)
	await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenArticulo WHERE Codigo = N'2.133')
      INSERT INTO dbo.imAlmacenArticulo (Codigo, Descripcion, UnidadMedida, StockMinimo, Activo, Observaciones, OperAlta)
      VALUES (N'2.133', N'Pilas medianas - UNIDAD X 1 UNIDAD', N'UNIDAD', 5, 1, N'Catálogo hospitalario seed', N'seed');
    IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenArticulo WHERE Codigo = N'1.001')
      INSERT INTO dbo.imAlmacenArticulo (Codigo, Descripcion, UnidadMedida, StockMinimo, Activo, Observaciones, OperAlta)
      VALUES (N'1.001', N'Guantes de latex talle M - CAJA X 100', N'CAJA', 2, 1, N'seed demo', N'seed');
    IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenArticulo WHERE Codigo = N'1.050')
      INSERT INTO dbo.imAlmacenArticulo (Codigo, Descripcion, UnidadMedida, StockMinimo, Activo, Observaciones, OperAlta)
      VALUES (N'1.050', N'Alcohol en gel 500ml - UNIDAD X 1', N'UNIDAD', 10, 1, N'seed demo', N'seed');
  `);
	const art = (
		await pool.request().query(`SELECT IdArticulo, Codigo FROM dbo.imAlmacenArticulo WHERE Codigo = N'2.133'`)
	).recordset[0];
	console.log('✓ Artículo 2.133 id=', art.IdArticulo);

	// Proveedor (relevamiento)
	await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.imAlmacenProveedor WHERE CUIT = N'30-71132714-9')
      INSERT INTO dbo.imAlmacenProveedor (RazonSocial, CUIT, Direccion, Activo)
      VALUES (N'PAPELERA LIBERTAD de Comerc. Libertad SRL', N'30-71132714-9', N'MORENO 960', 1);
  `);
	const prov = (
		await pool
			.request()
			.query(`SELECT IdProveedor FROM dbo.imAlmacenProveedor WHERE CUIT = N'30-71132714-9'`)
	).recordset[0];
	console.log('✓ Proveedor Papelera Libertad id=', prov.IdProveedor);

	// Solicitud listo para APROBAR (como el papel Nro 1.076)
	const nroPedido = '1.076';
	const exSol = (
		await pool
			.request()
			.input('nro', sql.NVarChar(50), nroPedido)
			.query(`SELECT IdSolicitud, Estado FROM dbo.imAlmacenSolicitud WHERE NroPedido = @nro`)
	).recordset[0];

	let idSolicitud;
	if (!exSol) {
		const ins = await pool
			.request()
			.input('nro', sql.NVarChar(50), nroPedido)
			.input('art', sql.Int, art.IdArticulo)
			.query(`
        INSERT INTO dbo.imAlmacenSolicitud
          (NroPedido, FechaPedido, FechaEmision, Destino, Justificacion, Estado, Solicitante, Fondo, CostoEstimado, Observaciones, OperAlta)
        OUTPUT INSERTED.IdSolicitud
        VALUES (@nro, '2026-07-31', '2026-07-31', N'HOSP VIDAL', N'Uso general de servicios', N'SOLICITADA',
                N'Encargado de servicio (seed)', N'CAJA_CHICA', 65000, N'Seed relevamiento', N'seed');

        DECLARE @id INT = SCOPE_IDENTITY();

        INSERT INTO dbo.imAlmacenSolicitudItem
          (IdSolicitud, Renglon, IdArticulo, Codigo, Descripcion, Observaciones, Cantidad)
        VALUES (@id, 1, @art, N'2.133', N'Pilas medianas - UNIDAD X 1 UNIDAD', N'C2', 10);

        SELECT @id AS IdSolicitud;
      `);
		// OUTPUT might not work well with multi-statement - fallback
		idSolicitud = ins.recordset?.[0]?.IdSolicitud;
		if (!idSolicitud) {
			idSolicitud = (
				await pool
					.request()
					.input('nro', sql.NVarChar(50), nroPedido)
					.query(`SELECT IdSolicitud FROM dbo.imAlmacenSolicitud WHERE NroPedido = @nro`)
			).recordset[0].IdSolicitud;
		}
		console.log('✓ Solicitud 1.076 SOLICITADA id=', idSolicitud);
	} else {
		idSolicitud = exSol.IdSolicitud;
		console.log('• Solicitud 1.076 ya existe id=', idSolicitud, 'estado=', exSol.Estado);
	}

	// Solicitud ya APROBADA para generar orden (si no existe otra demo)
	const nroAprob = '1.077';
	const exAprob = (
		await pool
			.request()
			.input('nro', sql.NVarChar(50), nroAprob)
			.query(`SELECT IdSolicitud FROM dbo.imAlmacenSolicitud WHERE NroPedido = @nro`)
	).recordset[0];
	let idSolAprob = exAprob?.IdSolicitud;
	if (!idSolAprob) {
		await pool
			.request()
			.input('art', sql.Int, art.IdArticulo)
			.query(`
        INSERT INTO dbo.imAlmacenSolicitud
          (NroPedido, FechaPedido, FechaEmision, Destino, Justificacion, Estado, Solicitante, Aprobador, FechaAprobacion, Fondo, CostoEstimado, Observaciones, OperAlta)
        VALUES (N'1.077', '2026-08-01', '2026-08-01', N'HOSP VIDAL', N'Reposición almacén', N'APROBADA',
                N'Solicitante seed', N'Dirección seed', SYSUTCDATETIME(), N'CAJA_CHICA', 65000, N'Lista para generar orden', N'seed');
        DECLARE @id INT = SCOPE_IDENTITY();
        INSERT INTO dbo.imAlmacenSolicitudItem (IdSolicitud, Renglon, IdArticulo, Codigo, Descripcion, Observaciones, Cantidad)
        VALUES (@id, 1, @art, N'2.133', N'Pilas medianas - UNIDAD X 1 UNIDAD', N'C2', 10);
      `);
		idSolAprob = (
			await pool.request().query(`SELECT IdSolicitud FROM dbo.imAlmacenSolicitud WHERE NroPedido = N'1.077'`)
		).recordset[0].IdSolicitud;
		console.log('✓ Solicitud 1.077 APROBADA id=', idSolAprob);
	} else {
		console.log('• Solicitud 1.077 ya existe id=', idSolAprob);
	}

	// Orden EMITIDA lista para recibir (como papel 1.387)
	const nroOrden = '1.387';
	const exOrd = (
		await pool
			.request()
			.input('nro', sql.NVarChar(50), nroOrden)
			.query(`SELECT IdOrden, Estado FROM dbo.imAlmacenOrden WHERE NroOrden = @nro`)
	).recordset[0];

	let idOrden = exOrd?.IdOrden;
	if (!idOrden) {
		const total = 65000;
		await pool
			.request()
			.input('sol', sql.Int, idSolAprob)
			.input('prov', sql.Int, prov.IdProveedor)
			.input('dep', sql.Int, dep.IdDeposito)
			.input('art', sql.Int, art.IdArticulo)
			.input('tot', sql.Decimal(18, 2), total)
			.query(`
        INSERT INTO dbo.imAlmacenOrden
          (NroOrden, IdSolicitud, NroExpediente, NroConcurso, NroAdjudicacion, NroAutorizacion,
           TipoOperacion, CondPago, FechaInvitacion, LugarEntrega, IdProveedor, IdDeposito,
           Estado, Total, Observaciones, OperAlta)
        VALUES (N'1.387', @sol, N'1076-31/07/2026', N'1.407', N'33.120', N'1076-',
                N'DIRECTA', N'CONTADO', '2026-08-03', N'ALMACEN GENERAL DEL HOSPITAL VIDAL',
                @prov, @dep, N'EMITIDA', @tot, N'Seed listo para acta de recepción', N'seed');

        DECLARE @id INT = SCOPE_IDENTITY();

        INSERT INTO dbo.imAlmacenOrdenItem
          (IdOrden, Renglon, IdArticulo, Descripcion, Observaciones, Cantidad, PrecioUnitario, Subtotal, CantidadRecibida)
        VALUES (@id, 1, @art, N'Pilas medianas - UNIDAD X 1 UNIDAD', N'C2', 10, 6500, 65000, 0);

        UPDATE dbo.imAlmacenSolicitud SET Estado = N'EN_COMPRA' WHERE IdSolicitud = @sol;
      `);
		idOrden = (
			await pool.request().query(`SELECT IdOrden FROM dbo.imAlmacenOrden WHERE NroOrden = N'1.387'`)
		).recordset[0].IdOrden;
		console.log('✓ Orden 1.387 EMITIDA id=', idOrden, '(lista para Recibir / Acta)');
	} else {
		console.log('• Orden 1.387 ya existe id=', idOrden, 'estado=', exOrd.Estado);
	}

	// Resumen
	const resumen = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.imAlmacenArticulo) AS Articulos,
      (SELECT COUNT(*) FROM dbo.imAlmacenProveedor) AS Proveedores,
      (SELECT COUNT(*) FROM dbo.imAlmacenSolicitud) AS Solicitudes,
      (SELECT COUNT(*) FROM dbo.imAlmacenOrden) AS Ordenes,
      (SELECT COUNT(*) FROM dbo.imAlmacenActa) AS Actas,
      (SELECT ISNULL(SUM(Cantidad),0) FROM dbo.imAlmacenStock) AS StockTotal
  `);
	console.log('\n• Resumen almacén:');
	console.table(resumen.recordset);
	console.log(`
Listo para probar:
  1. Solicitud 1.076  → estado SOLICITADA → Aprobar
  2. Solicitud 1.077  → APROBADA/EN_COMPRA
  3. Orden 1.387      → EMITIDA → botón "Recibir (acta)" → ingresa stock
  4. Artículo 2.133 / Proveedor Papelera Libertad / Depósito AG
`);
}

(async () => {
	console.log('Conectando a SQL Server…');
	const pool = await connectDB();
	console.log('✓ Conectado a', process.env.DB_NAME || process.env.DB_DATABASE);
	await ensureSchema(pool);
	await seed(pool);
	await pool.close();
	process.exit(0);
})().catch((e) => {
	console.error('Error seed almacén:', e);
	process.exit(1);
});
