/**
 * Sembrado idempotente de imPermisos / imRolPermisos a partir de
 * la matriz declarada en `src/utils/permisos.js`.
 *
 * Pasos:
 *   1) Ejecuta `scripts/sql/setup_permisos.sql` (CREATE TABLE si faltan).
 *   2) UPSERT cada permiso en imPermisos (clave única: Codigo).
 *   3) Por cada rol declarado en PLANTILLAS, sincroniza imRolPermisos:
 *      agrega los faltantes y elimina los que ya no están en la plantilla.
 *
 * Uso:
 *   node scripts/seed_permisos.js
 */
const fs = require('fs');
const path = require('path');
const { connectDB } = require('../src/config/database');
const { MODULOS, PLANTILLAS, todosLosCodigos } = require('../src/utils/permisos');

async function ejecutarSqlSetup(pool) {
	const sqlPath = path.join(__dirname, 'sql', 'setup_permisos.sql');
	const sql = fs.readFileSync(sqlPath, 'utf8');
	const batches = sql
		.split(/^\s*GO\s*$/gim)
		.map((b) => b.trim())
		.filter((b) => b.length);
	for (const batch of batches) {
		await pool.request().query(batch);
	}
	console.log('• imPermisos / imRolPermisos disponibles.');
}

/** UPSERT de un permiso (no duplica gracias al UNIQUE en Codigo). */
async function upsertPermiso(pool, { codigo, modulo, submodulo, accion, descripcion }) {
	const r = await pool
		.request()
		.input('codigo', codigo)
		.input('modulo', modulo)
		.input('submodulo', submodulo)
		.input('accion', accion)
		.input('descripcion', descripcion || null)
		.query(`
			IF NOT EXISTS (SELECT 1 FROM dbo.imPermisos WHERE Codigo = @codigo)
				INSERT INTO dbo.imPermisos (Codigo, Modulo, Submodulo, Accion, Descripcion)
				VALUES (@codigo, @modulo, @submodulo, @accion, @descripcion);
			ELSE
				UPDATE dbo.imPermisos
				SET Modulo = @modulo, Submodulo = @submodulo, Accion = @accion,
				    Descripcion = COALESCE(@descripcion, Descripcion)
				WHERE Codigo = @codigo;
			SELECT IdPermiso FROM dbo.imPermisos WHERE Codigo = @codigo;
		`);
	return r.recordset[0]?.IdPermiso;
}

/** Devuelve { Nombre -> IdRol } leyendo dbo.imRoles. */
async function leerRoles(pool) {
	const r = await pool.request().query(`SELECT IdRol, Nombre FROM dbo.imRoles WHERE Activo = 1`);
	const map = new Map();
	for (const row of r.recordset) {
		map.set(String(row.Nombre).toUpperCase().trim(), Number(row.IdRol));
	}
	return map;
}

async function sincronizarRolPermisos(pool, idRol, idsDeseados) {
	// Cargar set actual
	const cur = await pool.request().input('idRol', idRol).query(
		`SELECT IdPermiso FROM dbo.imRolPermisos WHERE IdRol = @idRol`,
	);
	const actuales = new Set(cur.recordset.map((r) => Number(r.IdPermiso)));
	const deseados = new Set(idsDeseados.map((n) => Number(n)));

	// Calcular diferencias
	const aAgregar = [...deseados].filter((id) => !actuales.has(id));
	const aQuitar = [...actuales].filter((id) => !deseados.has(id));

	for (const idPermiso of aAgregar) {
		await pool.request()
			.input('idRol', idRol)
			.input('idPermiso', idPermiso)
			.query(`INSERT INTO dbo.imRolPermisos (IdRol, IdPermiso) VALUES (@idRol, @idPermiso)`);
	}
	for (const idPermiso of aQuitar) {
		await pool.request()
			.input('idRol', idRol)
			.input('idPermiso', idPermiso)
			.query(`DELETE FROM dbo.imRolPermisos WHERE IdRol = @idRol AND IdPermiso = @idPermiso`);
	}

	return { agregados: aAgregar.length, quitados: aQuitar.length, total: deseados.size };
}

(async () => {
	const pool = await connectDB();

	// 1) Setup SQL
	await ejecutarSqlSetup(pool);

	// 2) Upsert de todos los códigos declarados
	const codigos = todosLosCodigos();
	console.log(`\n• Sembrando ${codigos.length} permisos en imPermisos…`);
	const codigoToId = new Map();
	for (const p of codigos) {
		const id = await upsertPermiso(pool, p);
		codigoToId.set(p.codigo, id);
	}

	// 3) Limpieza: eliminar permisos huérfanos (que ya no están en MODULOS)
	const setVigentes = new Set(codigos.map((c) => c.codigo));
	const all = await pool.request().query(`SELECT IdPermiso, Codigo FROM dbo.imPermisos`);
	const huerfanos = all.recordset.filter((r) => !setVigentes.has(String(r.Codigo)));
	if (huerfanos.length) {
		console.log(`• Limpiando ${huerfanos.length} permisos huérfanos:`);
		for (const h of huerfanos) {
			console.log(`    - ${h.Codigo}`);
			await pool.request().input('id', h.IdPermiso).query(`
				DELETE FROM dbo.imRolPermisos WHERE IdPermiso = @id;
				DELETE FROM dbo.imPermisos WHERE IdPermiso = @id;
			`);
		}
	}

	// 4) Sincronizar plantillas por rol
	const roles = await leerRoles(pool);
	console.log(`\n• Sincronizando plantillas para ${Object.keys(PLANTILLAS).length} roles…`);
	for (const [nombreRol, lista] of Object.entries(PLANTILLAS)) {
		const idRol = roles.get(nombreRol.toUpperCase());
		if (!idRol) {
			console.warn(`   ⚠️  Rol '${nombreRol}' no existe en imRoles, salteando.`);
			continue;
		}
		const ids = [];
		for (const codigo of lista) {
			const id = codigoToId.get(codigo);
			if (id) ids.push(id);
			else console.warn(`   ⚠️  Código '${codigo}' no existe en imPermisos (rol ${nombreRol}).`);
		}
		const out = await sincronizarRolPermisos(pool, idRol, ids);
		console.log(`   ✓ ${nombreRol.padEnd(16)}  total=${out.total}  +${out.agregados}  -${out.quitados}`);
	}

	// 5) Resumen final
	console.log('\n• Resumen:');
	const resumen = await pool.request().query(`
		SELECT r.IdRol, r.Nombre AS Rol, COUNT(rp.IdPermiso) AS Permisos
		FROM dbo.imRoles r
		LEFT JOIN dbo.imRolPermisos rp ON rp.IdRol = r.IdRol
		GROUP BY r.IdRol, r.Nombre
		ORDER BY r.IdRol;
	`);
	console.table(resumen.recordset);

	process.exit(0);
})().catch((e) => {
	console.error('Error fatal:', e);
	process.exit(1);
});
