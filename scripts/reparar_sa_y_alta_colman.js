/**
 * Repara superadmin de plataforma y da de alta "Clinica Colman" con todos los packs.
 * Uso:
 *   node scripts/reparar_sa_y_alta_colman.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Conexión pública Railway (local no resuelve MYSQLHOST interno)
const publicUrl = process.env.MYSQL_PUBLIC_URL || '';
if (publicUrl.startsWith('mysql://')) {
	try {
		const u = new URL(publicUrl);
		process.env.AUTH_DB_HOST = u.hostname;
		process.env.AUTH_DB_PORT = u.port || '3306';
		process.env.AUTH_DB_USER = decodeURIComponent(u.username);
		process.env.AUTH_DB_PASSWORD = decodeURIComponent(u.password);
		process.env.AUTH_DB_NAME = (u.pathname || '/railway').replace(/^\//, '') || 'railway';
	} catch (e) {
		console.warn('No se pudo parsear MYSQL_PUBLIC_URL:', e.message);
	}
}

process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';
process.env.SA_USER = process.env.SA_USER || 'superadmin';
process.env.SA_PASS = process.env.SA_PASS || 'SuperAdmin2026!';

const { ensureSuperAdmin } = require('../src/services/ensureSuperAdmin.service');
const { getAuthCentralPool, isAuthCentralEnabled } = require('../src/config/authCentralDb');
const superAdminService = require('../src/services/superAdmin.service');
const authCentral = require('../src/services/authCentral.service');

async function main() {
	console.log('=== Reparar SuperAdmin + Alta Clinica Colman ===\n');
	console.log('AUTH enabled:', isAuthCentralEnabled());
	console.log('SA_USER:', process.env.SA_USER);
	console.log('SA_PASS:', process.env.SA_PASS);

	const repair = await ensureSuperAdmin();
	console.log('\n[ensureSuperAdmin]', JSON.stringify(repair, null, 2));

	const pool = await getAuthCentralPool();

	// Verificar login plataforma
	const usuario = await authCentral.autenticarPlataforma(
		process.env.SA_USER,
		process.env.SA_PASS,
	);
	console.log('\n[login plataforma]', usuario
		? { ok: true, IdEmpresa: usuario.IdEmpresa, Rol: usuario.RolNombre || usuario.PersonalRol, Grupo: usuario.Grupo, Valor: usuario.ValorPersonal }
		: { ok: false });

	if (!usuario) {
		console.error('No se pudo autenticar superadmin. Abortando alta.');
		process.exit(2);
	}

	// ¿Ya existe Clinica Colman?
	const [exist] = await pool.query(
		`SELECT IDEMPRESA, DESCRIPCION FROM Empresas
     WHERE LOWER(TRIM(DESCRIPCION)) LIKE '%colman%'`,
	);
	if (exist.length) {
		console.log('\nClinica Colman ya existe:', exist);
		const id = Number(exist[0].IDEMPRESA);
		await superAdminService.actualizarPacksEmpresa(id, [
			'AGENDA',
			'INTERNACION',
			'FACTURACION',
			'ALMACEN',
		]);
		console.log('Packs actualizados a todos los módulos.');
		const detalle = await superAdminService.obtenerEmpresaDetalle(id);
		console.log(JSON.stringify({
			id: detalle.id,
			descripcion: detalle.descripcion,
			packs: detalle.packs,
			usuarios: (detalle.usuarios || []).map((u) => ({
				id: u.idPersonal,
				user: u.nombreRed,
				rol: u.rolNombre || u.idRol,
			})),
		}, null, 2));
		await pool.end().catch(() => {});
		return;
	}

	console.log('\nCreando Clinica Colman...');
	const alta = await superAdminService.crearEmpresaAlta({
		descripcion: 'Clinica Colman',
		cuit: '',
		email: 'admin@clinicacolman.com',
		tipoServidor: 'NUBE',
		plan: 'STARTER',
		packs: ['AGENDA', 'INTERNACION', 'FACTURACION', 'ALMACEN'],
		sector: { valor: 'GEN', descripcion: 'General', ambInt: 'A' },
		admin: {
			nombreRed: 'admin.colman',
			password: 'ColmanAdmin2027!',
			apellido: 'Colman',
			nombres: 'Administrador',
			numeroDocumento: '30000001',
			idRol: 1,
		},
	});

	console.log('\n══════════════════════════════════════════');
	console.log('  Empresa creada');
	console.log('══════════════════════════════════════════');
	console.log('  IdEmpresa:   ', alta.id);
	console.log('  Descripción: ', alta.descripcion);
	console.log('  Packs:       ', alta.packs);
	console.log('  Admin:        admin.colman / ColmanAdmin2027!');
	console.log('══════════════════════════════════════════');
	console.log('\n  SuperAdmin:  superadmin / SuperAdmin2026!');
	console.log('══════════════════════════════════════════\n');

	await pool.end().catch(() => {});
}

main().catch((e) => {
	console.error('Error:', e.message || e);
	if (e.stack) console.error(e.stack);
	process.exit(1);
});
