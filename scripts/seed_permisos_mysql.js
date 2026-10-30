/**
 * Sincroniza imPermisos + imRolPermisos en MySQL (auth central / Railway)
 * con la matriz de `src/utils/permisos.js`.
 *
 * - UPSERT todos los códigos vigentes.
 * - Por cada rol de PLANTILLAS: agrega los permisos faltantes (no borra extras
 *   legacy salvo --prune).
 *
 * Uso:
 *   node scripts/seed_permisos_mysql.js
 *   node scripts/seed_permisos_mysql.js --prune
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.railway.local', override: true });

const mysql = require('mysql2/promise');
const { PLANTILLAS, todosLosCodigos } = require('../src/utils/permisos');
const { descripcionPermiso } = (() => {
	try {
		return require('../src/utils/permisosDescripciones');
	} catch {
		return { descripcionPermiso: () => null };
	}
})();

const PRUNE = process.argv.includes('--prune');

async function main() {
	const c = await mysql.createConnection({
		host: process.env.AUTH_DB_HOST || process.env.MYSQLHOST,
		port: Number(process.env.AUTH_DB_PORT || process.env.MYSQLPORT || 3306),
		user: process.env.AUTH_DB_USER || process.env.MYSQLUSER,
		password: process.env.AUTH_DB_PASSWORD || process.env.MYSQLPASSWORD,
		database: process.env.AUTH_DB_NAME || process.env.MYSQLDATABASE,
	});

	try {
		const codigos = todosLosCodigos();
		console.log(`• Sembrando ${codigos.length} permisos en imPermisos (MySQL)…`);

		const [[maxRow]] = await c.query(`SELECT COALESCE(MAX(IdPermiso), 0) AS m FROM imPermisos`);
		let nextId = Number(maxRow.m) || 0;
		const codigoToId = new Map();

		const [existentes] = await c.query(`SELECT IdPermiso, Codigo FROM imPermisos`);
		for (const row of existentes) codigoToId.set(String(row.Codigo), Number(row.IdPermiso));

		let upserts = 0;
		for (const p of codigos) {
			const desc =
				(typeof descripcionPermiso === 'function' && descripcionPermiso(p.codigo)) || null;
			const idExistente = codigoToId.get(p.codigo);
			if (idExistente) {
				await c.execute(
					`UPDATE imPermisos
           SET Modulo = ?, Submodulo = ?, Accion = ?,
               Descripcion = COALESCE(?, Descripcion)
           WHERE IdPermiso = ?`,
					[p.modulo, p.submodulo, p.accion, desc, idExistente],
				);
			} else {
				nextId += 1;
				await c.execute(
					`INSERT INTO imPermisos (IdPermiso, Codigo, Modulo, Submodulo, Accion, Descripcion, FechaCreacion)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
					[nextId, p.codigo, p.modulo, p.submodulo, p.accion, desc],
				);
				codigoToId.set(p.codigo, nextId);
				upserts += 1;
			}
		}
		console.log(`  nuevos: ${upserts}`);

		const [roles] = await c.query(`SELECT IdRol, Nombre FROM imRoles WHERE COALESCE(Activo, 1) = 1`);
		const rolPorNombre = new Map();
		for (const r of roles) {
			rolPorNombre.set(String(r.Nombre).trim().toUpperCase(), Number(r.IdRol));
		}

		console.log(`\n• Sincronizando plantillas (${Object.keys(PLANTILLAS).length} roles)…`);
		for (const [nombreRol, lista] of Object.entries(PLANTILLAS)) {
			const idRol = rolPorNombre.get(String(nombreRol).toUpperCase());
			if (!idRol) {
				console.warn(`  ⚠ rol '${nombreRol}' no existe en imRoles`);
				continue;
			}
			const deseados = new Set();
			for (const codigo of lista) {
				const id = codigoToId.get(codigo);
				if (id) deseados.add(id);
				else console.warn(`  ⚠ código '${codigo}' sin IdPermiso`);
			}

			const [actualRows] = await c.query(
				`SELECT IdPermiso FROM imRolPermisos WHERE IdRol = ?`,
				[idRol],
			);
			const actuales = new Set(actualRows.map((r) => Number(r.IdPermiso)));
			const aAgregar = [...deseados].filter((id) => !actuales.has(id));
			const aQuitar = PRUNE ? [...actuales].filter((id) => !deseados.has(id)) : [];

			for (const idPermiso of aAgregar) {
				await c.execute(
					`INSERT INTO imRolPermisos (IdRol, IdPermiso, FechaAsignacion) VALUES (?, ?, NOW())`,
					[idRol, idPermiso],
				);
			}
			for (const idPermiso of aQuitar) {
				await c.execute(`DELETE FROM imRolPermisos WHERE IdRol = ? AND IdPermiso = ?`, [
					idRol,
					idPermiso,
				]);
			}

			console.log(
				`  ✓ ${nombreRol.padEnd(16)} total=${deseados.size} +${aAgregar.length}` +
					(PRUNE ? ` -${aQuitar.length}` : ''),
			);
		}

		const [almacen] = await c.query(
			`SELECT p.Codigo
       FROM imRolPermisos rp
       JOIN imPermisos p ON p.IdPermiso = rp.IdPermiso
       WHERE rp.IdRol = 1 AND p.Codigo LIKE 'ALMACEN%'
       ORDER BY p.Codigo`,
		);
		console.log('\nADMIN ALMACEN ahora:', almacen.map((r) => r.Codigo).join(', ') || '(ninguno)');

		const [rolesMatriz] = await c.query(
			`SELECT p.Codigo
       FROM imRolPermisos rp
       JOIN imPermisos p ON p.IdPermiso = rp.IdPermiso
       WHERE rp.IdRol = 1 AND p.Codigo LIKE 'CONFIGURACION.ROLES%'
       ORDER BY p.Codigo`,
		);
		console.log(
			'ADMIN CONFIGURACION.ROLES:',
			rolesMatriz.map((r) => r.Codigo).join(', ') || '(ninguno)',
		);
	} finally {
		await c.end();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
