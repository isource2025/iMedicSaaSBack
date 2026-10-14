/**
 * Datos filiatorios del paciente (dbo.imPacientes) para adjuntar a la historia
 * clínica de ingreso. Usa los mismos alias que la consulta de pedidos, así el
 * front los muestra igual venga de donde venga.
 */
const { executeQuery } = require('../models/db');
const { createTenantOnce } = require('../context/tenantCache');

const txt = (value) => {
	const s = value == null ? '' : String(value).trim();
	return s === '' ? null : s;
};

/** Edad en años a partir de una fecha ISO (yyyy-mm-dd). */
function edadDesdeISO(iso) {
	const raw = txt(iso);
	if (!raw) return null;
	const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
	const hoy = new Date();
	let edad = hoy.getFullYear() - y;
	const cumplioEsteAnio =
		hoy.getMonth() + 1 > m || (hoy.getMonth() + 1 === m && hoy.getDate() >= d);
	if (!cumplioEsteAnio) edad -= 1;
	return edad >= 0 && edad < 130 ? edad : null;
}

/**
 * Columnas del paciente. Espera los alias `pac` (imPacientes), `sx` (imSexo) y
 * `cob` (imClientes) en el FROM de la consulta.
 *
 * FechaNacimiento es un día juliano de Clarion; fuera de rango se descarta.
 */
const SELECT_DATOS_PACIENTE = `
  LTRIM(RTRIM(ISNULL(pac.ApellidoyNombre, ''))) AS PacienteNombre,
  pac.NumeroDocumento AS PacienteDocumento,
  LTRIM(RTRIM(ISNULL(pac.TipoDocumento, ''))) AS PacienteTipoDocumento,
  LTRIM(RTRIM(ISNULL(pac.Sexo, ''))) AS PacienteSexo,
  LTRIM(RTRIM(ISNULL(sx.Descripcion, ''))) AS PacienteSexoDescripcion,
  LTRIM(RTRIM(ISNULL(cob.RazonSocial, ''))) AS ObraSocial,
  LTRIM(RTRIM(ISNULL(CAST(pac.NumeroSSN AS VARCHAR(40)), ''))) AS PacienteAfiliado,
  LTRIM(RTRIM(ISNULL(CAST(pac.NumeroHC AS VARCHAR(40)), ''))) AS PacienteNumeroHC,
  LTRIM(RTRIM(ISNULL(pac.Domicilio, ''))) AS PacienteDomicilio,
  pac.ValorLocalidad AS PacienteValorLocalidad,
  LTRIM(RTRIM(ISNULL(CAST(pac.TelefonoParticular AS VARCHAR(40)), ''))) AS PacienteTelefono,
  LTRIM(RTRIM(ISNULL(CAST(pac.TelefonoNegocio AS VARCHAR(40)), ''))) AS PacienteTelefonoAlternativo,
  LTRIM(RTRIM(ISNULL(pac.Mail, ''))) AS PacienteEmail,
  LTRIM(RTRIM(ISNULL(pac.EstadoCivil, ''))) AS PacienteEstadoCivilCodigo,
  pac.Ocupacion AS PacienteOcupacionCodigo,
  pac.Provincia AS PacienteProvinciaCodigo,
  LTRIM(RTRIM(ISNULL(pac.Nacionalidad, ''))) AS PacienteNacionalidadCodigo,
  CASE
    WHEN pac.FechaNacimiento IS NULL OR pac.FechaNacimiento <= 0 OR pac.FechaNacimiento > 1000000 THEN NULL
    ELSE CONVERT(varchar(10), DATEADD(day, pac.FechaNacimiento, '1800-12-28'), 23)
  END AS PacienteFechaNacimiento
`;

/** Normaliza a null los vacíos y calcula la edad sobre una fila ya leída. */
function mapDatosPaciente(row) {
	return {
		PacienteNombre: txt(row.PacienteNombre),
		PacienteDocumento: txt(row.PacienteDocumento),
		PacienteTipoDocumento: txt(row.PacienteTipoDocumento),
		PacienteSexo: txt(row.PacienteSexo),
		PacienteSexoDescripcion: txt(row.PacienteSexoDescripcion),
		ObraSocial: txt(row.ObraSocial),
		PacienteAfiliado: txt(row.PacienteAfiliado),
		PacienteNumeroHC: txt(row.PacienteNumeroHC),
		PacienteDomicilio: txt(row.PacienteDomicilio),
		PacienteValorLocalidad:
			row.PacienteValorLocalidad != null ? Number(row.PacienteValorLocalidad) : null,
		PacienteLocalidad: null,
		PacienteTelefono: txt(row.PacienteTelefono),
		PacienteTelefonoAlternativo: txt(row.PacienteTelefonoAlternativo),
		PacienteEmail: txt(row.PacienteEmail),
		PacienteFechaNacimiento: txt(row.PacienteFechaNacimiento),
		PacienteEdad: edadDesdeISO(row.PacienteFechaNacimiento),
		PacienteEstadoCivilCodigo: txt(row.PacienteEstadoCivilCodigo),
		PacienteOcupacionCodigo: txt(row.PacienteOcupacionCodigo),
		PacienteProvinciaCodigo: txt(row.PacienteProvinciaCodigo),
		PacienteNacionalidadCodigo: txt(row.PacienteNacionalidadCodigo),
		PacienteEstadoCivil: null,
		PacienteOcupacion: null,
		PacienteProvincia: null,
		PacienteNacionalidad: null,
		PacienteCodigoPostal: null,
	};
}

/**
 * Catálogo Valor → Descripcion cacheado por empresa. Si la tabla no existe en la
 * instalación queda vacío: el dato simplemente no se muestra.
 */
function catalogo(tabla) {
	return createTenantOnce(async () => {
		try {
			const rows = await executeQuery(
				`SELECT Valor, LTRIM(RTRIM(ISNULL(Descripcion, ''))) AS Nombre FROM dbo.${tabla}`,
			);
			return new Map(
				(rows || [])
					.filter((r) => r.Valor != null && txt(r.Nombre))
					.map((r) => [String(r.Valor).trim().toUpperCase(), String(r.Nombre).trim()]),
			);
		} catch (e) {
			console.warn(`[paciente] no se pudo leer ${tabla}:`, e.message || e);
			return new Map();
		}
	});
}

const estadosCiviles = catalogo('imEstadoCivil');
const ocupaciones = catalogo('imOcupacion');
const provincias = catalogo('imProvincia');
const nacionalidades = catalogo('imNacionalidad');

/**
 * Catálogo imLocalidades cacheado por empresa (valor -> nombre). Se resuelve
 * fuera de la consulta principal: la tabla es opcional y el nombre de la
 * columna varía entre instalaciones, así que un problema acá no puede voltear
 * la pantalla que lo pidió.
 */
const localidadesPorValor = createTenantOnce(async () => {
	try {
		const cols = await executeQuery(
			`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'imLocalidades'`,
		);
		const disponibles = new Set(
			(cols || []).map((c) => String(c.COLUMN_NAME || '').toLowerCase()),
		);
		const columna = ['nombrelocalidad', 'localidad', 'descripcion'].find((c) =>
			disponibles.has(c),
		);
		if (!columna || !disponibles.has('valor')) return new Map();
		const cp = disponibles.has('codigopostal')
			? "LTRIM(RTRIM(ISNULL(CAST(CodigoPostal AS VARCHAR(20)), '')))"
			: "''";

		const rows = await executeQuery(
			`SELECT Valor, LTRIM(RTRIM(ISNULL(${columna}, ''))) AS Nombre, ${cp} AS CodigoPostal FROM dbo.imLocalidades`,
		);
		return new Map(
			(rows || [])
				.filter((r) => r.Valor != null && txt(r.Nombre))
				.map((r) => [
					String(r.Valor).trim(),
					{ nombre: String(r.Nombre).trim(), cp: txt(r.CodigoPostal) },
				]),
		);
	} catch (e) {
		console.warn('[paciente] no se pudo leer imLocalidades:', e.message || e);
		return new Map();
	}
});

/**
 * Completa los nombres que en imPacientes son códigos: localidad (+ código postal),
 * estado civil, ocupación, provincia y nacionalidad.
 */
async function completarLocalidades(filas) {
	const lista = (filas || []).filter(Boolean);
	if (!lista.length) return filas || [];
	const [locs, civiles, ocup, provs, nacs] = await Promise.all([
		localidadesPorValor(),
		estadosCiviles(),
		ocupaciones(),
		provincias(),
		nacionalidades(),
	]);
	const buscar = (mapa, codigo) => (codigo != null ? mapa.get(String(codigo).trim().toUpperCase()) || null : null);
	for (const f of lista) {
		if (f.PacienteValorLocalidad != null) {
			const loc = locs.get(String(f.PacienteValorLocalidad).trim());
			f.PacienteLocalidad = loc?.nombre || null;
			f.PacienteCodigoPostal = loc?.cp && loc.cp !== '0' ? loc.cp : null;
		}
		f.PacienteEstadoCivil = buscar(civiles, f.PacienteEstadoCivilCodigo);
		f.PacienteOcupacion = buscar(ocup, f.PacienteOcupacionCodigo);
		f.PacienteProvincia = buscar(provs, f.PacienteProvinciaCodigo);
		f.PacienteNacionalidad = buscar(nacs, f.PacienteNacionalidadCodigo);
	}
	return filas;
}

module.exports = {
	SELECT_DATOS_PACIENTE,
	mapDatosPaciente,
	completarLocalidades,
	edadDesdeISO,
};
