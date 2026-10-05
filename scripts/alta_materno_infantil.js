/**
 * Alta de "SANATORIO MATERNO INFANTIL" (Güemes) con todos los packs y SQL propio.
 * Uso:
 *   node scripts/alta_materno_infantil.js            → solo verifica (no escribe)
 *   node scripts/alta_materno_infantil.js --aplicar  → crea la empresa
 *
 * Requiere en el entorno: GUEMES_DB_PASSWORD y GUEMES_ADMIN_PASSWORD.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.railway.local'), override: true });

process.env.LOCAL_DEV_ONLY = '0';
process.env.AUTH_DB_ENABLED = '1';

const { decrypt } = require('../src/utils/dbCrypto');
const { getAuthCentralPool } = require('../src/config/authCentralDb');
const superAdminService = require('../src/services/superAdmin.service');
const { testTenantConnection } = require('../src/config/tenantDb');

const APLICAR = process.argv.includes('--aplicar');
const DESCRIPCION = 'SANATORIO MATERNO INFANTIL';

const CONEXION = {
	dbServer: 'smaterno.no-ip.org',
	dbPort: 1433,
	dbInstance: null,
	dbName: 'iSource',
	dbUser: 'sa',
	dbPassword: process.env.GUEMES_DB_PASSWORD,
};

async function main() {
	if (!CONEXION.dbPassword || !process.env.GUEMES_ADMIN_PASSWORD) {
		throw new Error('Faltan GUEMES_DB_PASSWORD / GUEMES_ADMIN_PASSWORD');
	}

	const pool = await getAuthCentralPool();

	const [ref] = await pool.query('SELECT DbPasswordEnc FROM Empresas WHERE IDEMPRESA = 102');
	let descifra = false;
	try {
		descifra = ref[0]?.DbPasswordEnc ? decrypt(ref[0].DbPasswordEnc) != null : false;
	} catch {
		descifra = false;
	}
	console.log('Clave de cifrado coincide con producción (descifra Colman):', descifra);
	if (!descifra) throw new Error('La clave local no descifra contraseñas de producción: no se guarda nada');

	const [exist] = await pool.query(
		"SELECT IDEMPRESA, DESCRIPCION FROM Empresas WHERE UPPER(TRIM(DESCRIPCION)) LIKE '%MATERNO%'",
	);
	if (exist.length) {
		console.log('Ya existe:', exist);
		const t = await testTenantConnection(Number(exist[0].IDEMPRESA));
		console.log('Conexión SQL:', t);
		return;
	}

	if (!APLICAR) {
		console.log('\nVerificación OK. Ejecutá con --aplicar para crear la empresa.');
		return;
	}

	const alta = await superAdminService.crearEmpresaAlta({
		descripcion: DESCRIPCION,
		cuit: '',
		email: '',
		tipoServidor: 'FISICO',
		plan: 'STARTER',
		packs: ['AGENDA', 'INTERNACION', 'FACTURACION', 'ALMACEN'],
		conexion: CONEXION,
		sector: { valor: 'GEN', descripcion: 'General', ambInt: 'A' },
		admin: {
			nombreRed: 'adminguemes',
			password: process.env.GUEMES_ADMIN_PASSWORD,
			apellido: 'Materno Infantil',
			nombres: 'Administrador',
			numeroDocumento: '',
			idRol: 1,
		},
	});

	console.log('\nEmpresa creada:', { id: alta.id, descripcion: alta.descripcion, packs: alta.packs });
	const t = await testTenantConnection(Number(alta.id));
	console.log('Conexión SQL:', t);
	if (alta.checklist) console.log('Checklist:', JSON.stringify(alta.checklist, null, 2));
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error('Error:', e.message || e);
		process.exit(1);
	});
