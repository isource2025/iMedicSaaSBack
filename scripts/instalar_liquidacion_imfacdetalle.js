#!/usr/bin/env node
/**
 * Aplica scripts/sql/liquidacion_imfacdetalle.sql (columna
 * dbo.imFacDetalle.ImporteLiquidado + tablas dbo.imFacLiquidacionImport y
 * dbo.imFacLiquidacionImportDetalle) en la BD de todos los tenants, o de los
 * que se indiquen, y verifica que la columna quede escribible.
 *
 * ImporteLiquidado es lo que la obra social liquidó al profesional: lo carga la
 * pantalla de Facturación > Liquidaciones importando el Excel de la liquidación
 * y se muestra en la columna "Liquidado" de Mi Producción. Para una BD nueva
 * también entra por el delta de tenant (scripts/sql/setup_saas_tenant_delta.sql).
 *
 *   node scripts/instalar_liquidacion_imfacdetalle.js --todas
 *   node scripts/instalar_liquidacion_imfacdetalle.js --empresas=1,100,101
 *   node scripts/instalar_liquidacion_imfacdetalle.js --todas --dry-run
 *
 * Flags:
 *   --dry-run        muestra el SQL y no toca nada
 *   --sin-verificar  omite la prueba de escritura (que corre y se revierte)
 *
 * Volver a correrlo es seguro: no toca lo que ya existe. No hay desinstalación
 * automática a propósito: borrar la columna perdería los importes liquidados.
 */
const fs = require('fs');
const path = require('path');
const {
	sql,
	cargarEntorno,
	obtenerEmpresas,
	conectar,
	parsearEmpresas,
} = require('./lib/tenantSql');

cargarEntorno();

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERIFICAR = !argv.includes('--sin-verificar') && !DRY_RUN;

const ARCHIVO_SQL = path.join(__dirname, 'sql', 'liquidacion_imfacdetalle.sql');
const USUARIO_PRUEBA = 'prueba.instalador';

/** El SQL usa dinámico para el ALTER: va como un único batch. */
const leerSql = () => fs.readFileSync(ARCHIVO_SQL, 'utf8');

/** Ejecuta mostrando los PRINT del script. */
async function ejecutarConMensajes(pool, texto) {
	const req = pool.request();
	req.on('info', (info) => {
		if (info.message) console.log(`    ${info.message}`);
	});
	return req.query(texto);
}

/**
 * Prueba de escritura dentro de una transacción que se revierte: marca el
 * importe liquidado de una fila real de imFacDetalle, registra una importación
 * de una fila y controla que se pueda leer todo de vuelta. No deja nada.
 */
async function verificar(pool) {
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const req = new sql.Request(tx);
		const r = await req.query(`
			DECLARE @id INT = (SELECT MIN(IDDETALLE) FROM dbo.imFacDetalle);
			IF @id IS NULL
			BEGIN
				SELECT CONVERT(BIT, 1) AS vacia;
				RETURN;
			END

			UPDATE dbo.imFacDetalle SET ImporteLiquidado = 12345.67 WHERE IDDETALLE = @id;

			INSERT INTO dbo.imFacLiquidacionImport (Archivo, Usuario, FilasArchivo, FilasAplicadas, ImporteAplicado)
			VALUES ('prueba-instalador.xlsx', '${USUARIO_PRUEBA}', 1, 1, 12345.67);
			DECLARE @idImport INT = CONVERT(INT, SCOPE_IDENTITY());

			INSERT INTO dbo.imFacLiquidacionImportDetalle
				(IdImport, FilaExcel, IdPrestacion, ImporteExcel, IdDetalle, ImporteNuevo, Estado)
			VALUES (@idImport, 1, 0, 12345.67, @id, 12345.67, 'APLICADO');

			SELECT
				CONVERT(BIT, 0)                                  AS vacia,
				(SELECT ImporteLiquidado FROM dbo.imFacDetalle
				  WHERE IDDETALLE = @id)                         AS liquidado,
				(SELECT COUNT(*) FROM dbo.imFacLiquidacionImportDetalle
				  WHERE IdImport = @idImport)                    AS detalle;
		`);

		const fila = (r.recordsets[r.recordsets.length - 1] || [])[0] || {};
		const problemas = [];

		if (fila.vacia) return { problemas: [], vacia: true };
		if (Number(fila.liquidado) !== 12345.67) {
			problemas.push(
				`ImporteLiquidado no se pudo leer de vuelta (quedó ${JSON.stringify(fila.liquidado)})`,
			);
		}
		if (Number(fila.detalle) !== 1) problemas.push('el detalle de la importación no se registró');

		return { problemas, vacia: false };
	} finally {
		// Siempre: la prueba no debe persistir.
		await tx.rollback();
	}
}

async function procesarEmpresa(empresa) {
	console.log(`\n=== ${empresa.DESCRIPCION} (empresa ${empresa.IDEMPRESA}) / ${empresa.DbName} ===`);

	let pool;
	try {
		pool = await conectar(empresa);
	} catch (e) {
		console.log(`  ✗ sin conexión: ${e.message}`);
		return false;
	}

	try {
		const facturacion = (
			await pool.request().query(`SELECT OBJECT_ID('dbo.imFacDetalle', 'U') AS id`)
		).recordset[0].id;
		if (!facturacion) {
			console.log('  – sin dbo.imFacDetalle: la BD no factura, no aplica');
			return true;
		}

		await ejecutarConMensajes(pool, leerSql());

		const estado = (
			await pool.request().query(`
				SELECT
					COL_LENGTH('dbo.imFacDetalle', 'ImporteLiquidado')       AS columna,
					(SELECT COUNT(*) FROM dbo.imFacDetalle
					  WHERE ImporteLiquidado IS NOT NULL)                   AS liquidadas,
					(SELECT COUNT(*) FROM dbo.imFacLiquidacionImport)        AS importaciones
			`)
		).recordset[0];
		if (!estado.columna) throw new Error('ImporteLiquidado no quedó en dbo.imFacDetalle');
		console.log(
			`  ✓ esquema OK (${estado.liquidadas} prestación/es con importe liquidado, ` +
				`${estado.importaciones} importación/es registrada/s)`,
		);

		if (VERIFICAR) {
			const { problemas, vacia } = await verificar(pool);
			if (problemas.length > 0) {
				console.log('  ✗ la prueba de escritura encontró problemas:');
				for (const p of problemas) console.log(`      - ${p}`);
				return false;
			}
			console.log(
				vacia
					? '  – imFacDetalle está vacía: no había fila para la prueba de escritura'
					: '  ✓ prueba de escritura OK (revertida)',
			);
		}
		return true;
	} catch (e) {
		console.log(`  ✗ ${e.message}`);
		return false;
	} finally {
		await pool.close();
	}
}

(async () => {
	const ids = parsearEmpresas(argv);
	if (ids === null) {
		console.error('Falta --todas o --empresas=1,100,101. Ver el encabezado del script.');
		process.exit(2);
	}

	if (DRY_RUN) {
		console.log(leerSql());
		process.exit(0);
	}

	const empresas = await obtenerEmpresas(ids);
	if (empresas.length === 0) throw new Error('no encontré empresas con esos ids');

	console.log(`Instalando el importe liquidado en ${empresas.length} empresa(s)`);

	let ok = 0;
	for (const empresa of empresas) {
		if (await procesarEmpresa(empresa)) ok++;
	}

	console.log(`\n${ok}/${empresas.length} empresa(s) OK`);
	process.exit(ok === empresas.length ? 0 : 1);
})().catch((e) => {
	console.error('✗', e.message);
	process.exit(2);
});
