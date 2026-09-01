#!/usr/bin/env node
/**
 * Aplica scripts/sql/auditoria_hci.sql (tabla dbo.imHCIAuditoria + trigger
 * dbo.TR_imHCI_Auditoria) en la BD de todos los tenants, o de los que se
 * indiquen, y verifica que la auditoría quede funcionando.
 *
 * La auditoría es parte del esquema estándar de un tenant: registra alta,
 * modificación campo por campo y borrado de las HC, tanto de la web como del
 * Clarion. Para una BD nueva también entra por el delta de tenant
 * (scripts/sql/setup_saas_tenant_delta.sql).
 *
 *   node scripts/instalar_auditoria_hci.js --todas
 *   node scripts/instalar_auditoria_hci.js --empresas=1,100,101
 *   node scripts/instalar_auditoria_hci.js --todas --dry-run
 *   node scripts/instalar_auditoria_hci.js --empresas=1 --desinstalar
 *
 * Flags:
 *   --dry-run        muestra el SQL y no toca nada
 *   --desinstalar    borra el trigger (conserva el historial ya registrado)
 *   --sin-verificar  omite la prueba alta/modificación/borrado con rollback
 *
 * Volver a correrlo es seguro: regenera el trigger y conserva la tabla.
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
const {
	descriptorAuditoria,
	TABLA_AUDITORIA,
	TRIGGER_AUDITORIA,
} = require('../src/utils/auditoriaHci');

cargarEntorno();

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const DESINSTALAR = argv.includes('--desinstalar');
const VERIFICAR = !argv.includes('--sin-verificar') && !DESINSTALAR && !DRY_RUN;

const ARCHIVO_SQL = path.join(__dirname, 'sql', 'auditoria_hci.sql');
const USUARIO_PRUEBA = 'prueba.instalador';
const COD_PRUEBA = 99999999;

/** El SQL se genera solo desde INFORMATION_SCHEMA: va como un único batch. */
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
 * Prueba de punta a punta dentro de una transacción que se revierte: da de alta
 * una HC, la modifica, la borra y controla que la auditoría lo haya registrado
 * con el usuario web, usando el mismo formato de CONTEXT_INFO que el backend.
 * Lo único que deja es un hueco en el IDENTITY de imHCI.
 */
async function verificar(pool) {
	const tx = new sql.Transaction(pool);
	await tx.begin();
	try {
		const req = new sql.Request(tx);
		const ctx = descriptorAuditoria(
			{ usuario: { username: USUARIO_PRUEBA } },
			COD_PRUEBA,
		).replace(/'/g, "''");

		const r = await req.query(`
			DECLARE @ctx VARBINARY(128) = CONVERT(VARBINARY(128), CONVERT(VARCHAR(128), '${ctx}'));
			SET CONTEXT_INFO @ctx;

			INSERT INTO dbo.imHCI (NumeroVisita, MotivoConsulta) VALUES (0, 'PRUEBA AUDITORIA');
			DECLARE @id INT = CONVERT(INT, SCOPE_IDENTITY());

			UPDATE dbo.imHCI SET MotivoConsulta = 'PRUEBA AUDITORIA MODIFICADA' WHERE IdHCIngreso = @id;
			DELETE FROM dbo.imHCI WHERE IdHCIngreso = @id;

			SELECT Accion, Origen, Usuario, IdOperador, COUNT(*) AS filas
			FROM dbo.${TABLA_AUDITORIA}
			WHERE IdHCIngreso = @id
			GROUP BY Accion, Origen, Usuario, IdOperador
			ORDER BY Accion;

			SELECT Columna, ValorAnterior, ValorNuevo
			FROM dbo.${TABLA_AUDITORIA}
			WHERE IdHCIngreso = @id AND Accion = 'U';
		`);

		const resumen = r.recordsets[0] || [];
		const cambios = r.recordsets[1] || [];
		const acciones = new Set(resumen.map((f) => f.Accion));
		const problemas = [];

		for (const esperada of ['I', 'U', 'D']) {
			if (!acciones.has(esperada)) problemas.push(`no se registró la acción ${esperada}`);
		}
		if (resumen.some((f) => f.Origen !== 'WEB')) problemas.push('el origen no se leyó como WEB');
		if (resumen.some((f) => f.Usuario !== USUARIO_PRUEBA)) {
			problemas.push(
				`el usuario web no se leyó de CONTEXT_INFO (quedó ${JSON.stringify(resumen[0]?.Usuario)})`,
			);
		}
		if (resumen.some((f) => f.IdOperador !== COD_PRUEBA)) {
			problemas.push('el CodOperador no se leyó de CONTEXT_INFO');
		}
		const motivo = cambios.find((c) => c.Columna === 'MotivoConsulta');
		if (!motivo) problemas.push('la modificación de MotivoConsulta no quedó registrada');
		else if (motivo.ValorNuevo !== 'PRUEBA AUDITORIA MODIFICADA') {
			problemas.push('el valor nuevo de MotivoConsulta no coincide');
		}
		if (cambios.length !== 1) {
			problemas.push(`se registraron ${cambios.length} campos modificados en vez de 1`);
		}
		if (acciones.has('E')) problemas.push('el trigger registró un error interno');

		return { problemas, cambios };
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
		if (DESINSTALAR) {
			await pool
				.request()
				.query(
					`IF OBJECT_ID('dbo.${TRIGGER_AUDITORIA}', 'TR') IS NOT NULL DROP TRIGGER dbo.${TRIGGER_AUDITORIA};`,
				);
			console.log(
				`  ✓ trigger ${TRIGGER_AUDITORIA} eliminado (la tabla ${TABLA_AUDITORIA} y su historial quedan)`,
			);
			return true;
		}

		await ejecutarConMensajes(pool, leerSql());

		const estado = (
			await pool.request().query(`
				SELECT
					(SELECT COUNT(*) FROM sys.triggers
					  WHERE name = '${TRIGGER_AUDITORIA}' AND is_disabled = 0) AS activo,
					(SELECT COUNT(*) FROM dbo.${TABLA_AUDITORIA})               AS historial
			`)
		).recordset[0];
		if (!estado.activo) throw new Error(`el trigger ${TRIGGER_AUDITORIA} no quedó activo`);
		console.log(`  ✓ auditoría activa (${estado.historial} filas de historial acumuladas)`);

		if (VERIFICAR) {
			const { problemas, cambios } = await verificar(pool);
			if (problemas.length > 0) {
				console.log('  ✗ la prueba encontró problemas:');
				for (const p of problemas) console.log(`      - ${p}`);
				return false;
			}
			console.log(
				`  ✓ prueba alta/modificación/borrado OK (revertida, ${cambios.length} campo detectado)`,
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

	console.log(
		DESINSTALAR
			? 'Desinstalando auditoría de imHCI'
			: `Instalando auditoría de imHCI en ${empresas.length} empresa(s)`,
	);

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
