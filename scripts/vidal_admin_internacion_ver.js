/**
 * Vidal: asegura VER de Internación (clínica médica + enfermería) en todos los
 * roles administrativos (sistema ADMINISTRATIVO + personalizados con RolBase
 * ADMINISTRATIVO si existen en esta DB).
 *
 * Uso (contra la SQL de Vidal / iSource):
 *   node scripts/vidal_admin_internacion_ver.js
 *   node scripts/vidal_admin_internacion_ver.js --dry-run
 */
require('dotenv').config();

const { connectDB } = require('../src/config/database');
const { PLANTILLAS } = require('../src/utils/permisos');

const DRY = process.argv.includes('--dry-run');

const VER_INTERNACION = (PLANTILLAS.ADMINISTRATIVO || []).filter(
	(c) => typeof c === 'string' && c.startsWith('INTERNACION.') && c.endsWith('.VER'),
);

async function upsertPermiso(pool, codigo) {
	const parts = String(codigo).split('.');
	const modulo = parts[0] || null;
	const submodulo = parts[1] || null;
	const accion = parts[2] || null;
	const r = await pool
		.request()
		.input('codigo', codigo)
		.input('modulo', modulo)
		.input('submodulo', submodulo)
		.input('accion', accion)
		.query(`
			IF NOT EXISTS (SELECT 1 FROM dbo.imPermisos WHERE Codigo = @codigo)
				INSERT INTO dbo.imPermisos (Codigo, Modulo, Submodulo, Accion, Descripcion)
				VALUES (@codigo, @modulo, @submodulo, @accion, @codigo);
			SELECT IdPermiso, Codigo FROM dbo.imPermisos WHERE Codigo = @codigo;
		`);
	return r.recordset[0];
}

async function rolesAdministrativos(pool) {
	const r = await pool.request().query(`
		SELECT IdRol, Nombre
		FROM dbo.imRoles
		WHERE Activo = 1
		  AND (
		    UPPER(LTRIM(RTRIM(Nombre))) = 'ADMINISTRATIVO'
		    OR UPPER(LTRIM(RTRIM(Nombre))) LIKE '%ADMINISTRATIV%'
		  )
		ORDER BY IdRol;
	`);
	// RolBase solo existe en auth central MySQL; en SQL del hospital filtramos por nombre.
	return r.recordset.map((row) => ({
		idRol: Number(row.IdRol),
		nombre: String(row.Nombre || '').trim(),
	}));
}

async function main() {
	if (!VER_INTERNACION.length) {
		throw new Error('La plantilla ADMINISTRATIVO no tiene INTERNACION.*.VER');
	}
	console.log(
		`• Códigos VER a asegurar (${VER_INTERNACION.length}):\n  ${VER_INTERNACION.join('\n  ')}`,
	);
	if (DRY) console.log('• Modo dry-run: no se escribe.');

	const pool = await connectDB();
	const roles = await rolesAdministrativos(pool);
	if (!roles.length) {
		console.warn('⚠ No hay roles administrativos en imRoles');
		process.exit(0);
	}
	console.log(
		`\n• Roles destino (${roles.length}): ${roles.map((r) => `${r.idRol}:${r.nombre}`).join(', ')}`,
	);

	const codigoToId = new Map();
	for (const codigo of VER_INTERNACION) {
		const row = await upsertPermiso(pool, codigo);
		codigoToId.set(codigo, Number(row.IdPermiso));
	}

	for (const rol of roles) {
		let agregados = 0;
		for (const codigo of VER_INTERNACION) {
			const idPermiso = codigoToId.get(codigo);
			const cur = await pool
				.request()
				.input('idRol', rol.idRol)
				.input('idPermiso', idPermiso)
				.query(
					`SELECT 1 AS ok FROM dbo.imRolPermisos WHERE IdRol = @idRol AND IdPermiso = @idPermiso`,
				);
			if (cur.recordset.length) continue;
			agregados += 1;
			if (!DRY) {
				await pool
					.request()
					.input('idRol', rol.idRol)
					.input('idPermiso', idPermiso)
					.query(
						`INSERT INTO dbo.imRolPermisos (IdRol, IdPermiso) VALUES (@idRol, @idPermiso)`,
					);
			}
		}
		console.log(`  ✓ ${rol.nombre.padEnd(24)} +${agregados} VER internación`);
	}

	const check = await pool.request().query(`
		SELECT r.Nombre, p.Codigo
		FROM dbo.imRoles r
		INNER JOIN dbo.imRolPermisos rp ON rp.IdRol = r.IdRol
		INNER JOIN dbo.imPermisos p ON p.IdPermiso = rp.IdPermiso
		WHERE r.Activo = 1
		  AND UPPER(LTRIM(RTRIM(r.Nombre))) = 'ADMINISTRATIVO'
		  AND p.Codigo LIKE 'INTERNACION.%.VER'
		ORDER BY p.Codigo;
	`);
	console.log('\n• ADMINISTRATIVO INTERNACION.*.VER ahora:');
	for (const row of check.recordset) console.log(`  - ${row.Codigo}`);

	process.exit(0);
}

main().catch((e) => {
	console.error('Error:', e.message || e);
	process.exit(1);
});
