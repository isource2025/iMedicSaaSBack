/**
 * Identidad multi-tenant SaaS.
 *
 * Clave de identidad en MySQL auth:
 *   (IdEmpresa, ValorPersonal)
 *
 * - Empresa tenant (hospital): IdEmpresa = IDEMPRESA del catálogo (>0).
 *   ValorPersonal = el mismo id del SQL físico de esa empresa (sin remapear).
 * - Plataforma SaaS: IdEmpresa = 0.
 *   ValorPersonal solo en rango reservado [PLATFORM_VALOR_MIN, +∞)
 *   (superadmin, bots de plataforma, etc.). Nunca se pisan por sync físico.
 *
 * Reglas:
 * 1. El sync FÍSICO → MySQL solo escribe filas con IdEmpresa = empresa tenant.
 * 2. IdEmpresa=0 es intocable por import/sync de hospitales.
 * 3. Nombres reservados (superadmin) no se copian del físico a un tenant.
 * 4. Login de plataforma solo mira IdEmpresa=0.
 */
const PLATFORM_EMPRESA_ID = 0;
const PLATFORM_VALOR_MIN = Number(process.env.PLATFORM_VALOR_MIN || 1000000);
const SA_USER = String(process.env.SA_USER || 'superadmin').toLowerCase();
const SA_PASS = process.env.SA_PASS || 'SuperAdmin2026!';
const SA_VALOR = Math.max(
	PLATFORM_VALOR_MIN,
	Number(process.env.SA_VALOR || PLATFORM_VALOR_MIN + 1),
);

/** Usernames que nunca deben vivir en filas de tenant (solo IdEmpresa=0). */
const RESERVED_PLATFORM_USERNAMES = new Set([SA_USER, 'superadmin', 'imedic_platform']);

function toIdEmpresa(id) {
	const n = Number(id);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.trunc(n);
}

function isPlatformEmpresa(idEmpresa) {
	const n = toIdEmpresa(idEmpresa);
	return n === null || n === PLATFORM_EMPRESA_ID;
}

function isTenantEmpresa(idEmpresa) {
	const n = toIdEmpresa(idEmpresa);
	return n != null && n > 0;
}

function isPlatformValorPersonal(valorPersonal) {
	const n = Number(valorPersonal);
	return Number.isFinite(n) && n >= PLATFORM_VALOR_MIN;
}

function isReservedUsername(nombreRed) {
	const u = String(nombreRed || '')
		.trim()
		.toLowerCase();
	return !!u && RESERVED_PLATFORM_USERNAMES.has(u);
}

/**
 * Un id de personal en tenant es válido si es > 0 (igual al SQL físico).
 * ValorPersonal=0 es basura / incompleto y no se sincroniza a MySQL.
 * El rango ≥ PLATFORM_VALOR_MIN solo restringe a la plataforma (IdEmpresa=0);
 * en tenant (IdEmpresa>0) no hay colisión de IDs entre empresas.
 */
function isValidTenantPersonalId(valorPersonal) {
	const n = Number(valorPersonal);
	return Number.isFinite(n) && n > 0 && Math.trunc(n) === n;
}

/**
 * ¿Se puede copiar esta fila del físico a MySQL de la empresa emp?
 */
function canSyncPasswordRowToTenant(idEmpresa, row) {
	if (!isTenantEmpresa(idEmpresa)) return false;
	const vp = Number(row?.ValorPersonal ?? row?.valorPersonal);
	if (!isValidTenantPersonalId(vp)) return false;
	if (isReservedUsername(row?.NombreRed ?? row?.nombrered ?? row?.Nombrered)) {
		return false;
	}
	return true;
}

function canSyncPersonalRowToTenant(idEmpresa, row) {
	if (!isTenantEmpresa(idEmpresa)) return false;
	const vp = Number(row?.Valor ?? row?.valor);
	return isValidTenantPersonalId(vp);
}

module.exports = {
	PLATFORM_EMPRESA_ID,
	PLATFORM_VALOR_MIN,
	SA_USER,
	SA_PASS,
	SA_VALOR,
	RESERVED_PLATFORM_USERNAMES,
	toIdEmpresa,
	isPlatformEmpresa,
	isTenantEmpresa,
	isPlatformValorPersonal,
	isReservedUsername,
	isValidTenantPersonalId,
	canSyncPasswordRowToTenant,
	canSyncPersonalRowToTenant,
};
