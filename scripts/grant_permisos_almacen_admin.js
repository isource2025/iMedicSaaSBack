/**
 * Siembra los códigos ALMACEN.* de `src/utils/permisos.js` en imPermisos y los
 * asigna a ADMIN y SUPER_ADMIN. A diferencia de seed_permisos.js no quita nada:
 * no toca otros roles ni borra permisos huérfanos.
 *
 * Uso:
 *   node scripts/grant_permisos_almacen_admin.js
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');
const { todosLosCodigos } = require('../src/utils/permisos');

const ROLES = ['ADMIN', 'SUPER_ADMIN'];

(async () => {
	const pool = await connectDB();
	const codigos = todosLosCodigos().filter((c) => c.modulo === 'ALMACEN');

	const ids = [];
	for (const p of codigos) {
		const r = await pool
			.request()
			.input('codigo', p.codigo)
			.input('modulo', p.modulo)
			.input('submodulo', p.submodulo)
			.input('accion', p.accion).query(`
				IF NOT EXISTS (SELECT 1 FROM dbo.imPermisos WHERE Codigo = @codigo)
					INSERT INTO dbo.imPermisos (Codigo, Modulo, Submodulo, Accion) VALUES (@codigo, @modulo, @submodulo, @accion);
				SELECT IdPermiso FROM dbo.imPermisos WHERE Codigo = @codigo;
			`);
		ids.push(r.recordset[0].IdPermiso);
	}

	for (const nombre of ROLES) {
		const rol = await pool.request().input('n', nombre).query(`SELECT IdRol FROM dbo.imRoles WHERE UPPER(Nombre) = @n`);
		const idRol = rol.recordset[0]?.IdRol;
		if (!idRol) {
			console.warn(`Rol ${nombre} no existe, salteado.`);
			continue;
		}
		let agregados = 0;
		for (const idPermiso of ids) {
			const r = await pool.request().input('idRol', idRol).input('idPermiso', idPermiso).query(`
				IF NOT EXISTS (SELECT 1 FROM dbo.imRolPermisos WHERE IdRol = @idRol AND IdPermiso = @idPermiso)
				BEGIN
					INSERT INTO dbo.imRolPermisos (IdRol, IdPermiso) VALUES (@idRol, @idPermiso);
					SELECT 1 AS nuevo;
				END
			`);
			if (r.recordset?.length) agregados++;
		}
		console.log(`✓ ${nombre} (IdRol ${idRol}): ${ids.length} permisos ALMACEN, ${agregados} nuevos`);
	}
	process.exit(0);
})().catch((e) => {
	console.error('Error:', e.message);
	process.exit(1);
});
