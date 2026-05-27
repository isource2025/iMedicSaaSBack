/**
 * Crea o actualiza un usuario de prueba SUPER_ADMIN para testear la plataforma.
 *
 * Uso (desde iMedicWSBack):
 *   node scripts/crear_super_admin_test.js
 *
 * Variables opcionales:
 *   SA_USER=superadmin
 *   SA_PASS=SuperAdmin2026!
 *
 * Requisitos previos:
 *   1) Ejecutar scripts/sql/setup_super_admin.sql (rol IdRol=5)
 *   2) node scripts/seed_permisos.js (permisos PLATAFORMA en BD)
 */
require('dotenv').config();
const { connectDB } = require('../src/config/database');
const usersService = require('../src/services/users.service');
const rolesService = require('../src/services/roles.service');

const NOMBRE_RED = process.env.SA_USER || 'superadmin';
const PASSWORD = process.env.SA_PASS || 'SuperAdmin2026!';
const ID_ROL_SUPER = 5;

async function asegurarFichaPersonal(pool, valorPersonal) {
	const check = await pool
		.request()
		.input('v', valorPersonal)
		.query(`SELECT Valor FROM dbo.imPersonal WHERE Valor = @v`);
	if (check.recordset.length) return;

	await pool.request().input('v', valorPersonal).query(`
    INSERT INTO dbo.imPersonal (
      Valor, Matricula, MatriculaNacional, TipoDocumento, Numero,
      ApellidoNombre, Domicilio, ValorLocalidad, Provincia, Nacionalidad,
      FechaNacimiento, Sexo, EstadoCivil, Telefono,
      ValorEspecialidad, ValorFunciones, ValorServicio, ValorCategoria,
      ValorClase, LugarTrabajo, LugarCobro, NumeroSocio,
      ConvenioFacturacion, IdEspecialidadME, Estado
    ) VALUES (
      @v, @v, NULL, 'DNI', 90000001,
      'Super, Admin Plataforma', NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, 1
    )
  `);
}

async function asegurarRolSuperAdmin(pool) {
	await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.imRoles WHERE IdRol = 5)
      INSERT INTO dbo.imRoles (IdRol, Nombre, Descripcion, Nivel, Activo)
      VALUES (5, 'SUPER_ADMIN', 'Administrador de plataforma (multi-empresa)', 200, 1);
    ELSE
      UPDATE dbo.imRoles SET Nombre = 'SUPER_ADMIN', Nivel = 200, Activo = 1 WHERE IdRol = 5;
  `);
	console.log('• Rol SUPER_ADMIN (IdRol=5) verificado en imRoles.');
}

(async () => {
	const pool = await connectDB();
	await asegurarRolSuperAdmin(pool);

	const existente = await pool
		.request()
		.input('user', NOMBRE_RED)
		.query(`
      SELECT TOP 1 ValorPersonal, NombreRed
      FROM dbo.imPassword
      WHERE UPPER(RTRIM(LTRIM(NombreRed))) = UPPER(RTRIM(LTRIM(@user)))
    `);

	let valorPersonal;

	if (existente.recordset.length) {
		valorPersonal = Number(existente.recordset[0].ValorPersonal);
		await usersService.cambiarPassword(valorPersonal, PASSWORD);
		console.log(`• Usuario existente "${NOMBRE_RED}" — contraseña actualizada.`);
	} else {
		const creado = await usersService.crearUsuario({
			codOperador: 'SA',
			apellido: 'Super',
			nombres: 'Admin',
			nombreRed: NOMBRE_RED,
			password: PASSWORD,
			numeroDocumento: '90000001',
			legajo: '900001',
		});
		valorPersonal = Number(creado.valorPersonal ?? creado.ValorPersonal);
		console.log(`• Usuario "${NOMBRE_RED}" creado (ValorPersonal=${valorPersonal}).`);
	}

	await asegurarFichaPersonal(pool, valorPersonal);
	await rolesService.asignarRolAPersonal(valorPersonal, ID_ROL_SUPER);

	const rol = await rolesService.obtenerRolPorId(ID_ROL_SUPER);

	console.log('\n══════════════════════════════════════════');
	console.log('  Super Admin de prueba listo');
	console.log('══════════════════════════════════════════');
	console.log(`  Usuario:     ${NOMBRE_RED}`);
	console.log(`  Contraseña:  ${PASSWORD}`);
	console.log(`  Rol:         ${rol?.Nombre || 'SUPER_ADMIN'} (IdRol=${ID_ROL_SUPER})`);
	console.log(`  Id personal: ${valorPersonal}`);
	console.log('══════════════════════════════════════════');
	console.log('\nIniciá sesión en el front y abrí /dashboard/super-admin\n');

	process.exit(0);
})().catch((e) => {
	console.error('Error:', e.message || e);
	process.exit(1);
});
