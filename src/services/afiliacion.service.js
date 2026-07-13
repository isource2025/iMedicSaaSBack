const { executeQuery } = require('../models/db');
const ioscorProvider = require('./afiliacionProviders/ioscor.provider');

const PROVIDERS = {
	IOSCOR: ioscorProvider,
};

function flagOn(value) {
	if (value == null) return false;
	const s = String(value).trim().toUpperCase();
	return s === '1' || s === 'S' || s === 'Y' || s === 'T' || s === 'TRUE' || s === 'SI';
}

function resolveProviderCode(apiValidacion) {
	const code = String(apiValidacion || '').trim().toUpperCase();
	return code || null;
}

async function getClientesConApiValidacion() {
	const rows = await executeQuery(`
    SELECT
      Valor,
      RazonSocial,
      NroAfiliadoDocumento,
      APIValidacionPaciente
    FROM imClientes
    WHERE APIValidacionPaciente IS NOT NULL
      AND LTRIM(RTRIM(CAST(APIValidacionPaciente AS VARCHAR(80)))) <> ''
    ORDER BY Valor
  `);
	return rows || [];
}

/**
 * Busca en paralelo todas las OS con APIValidacionPaciente y devuelve matches activos.
 * @param {string|number} documento
 */
async function validarAfiliadoPorDocumento(documento) {
	const dni = String(documento || '').replace(/\D/g, '');
	if (!dni) {
		return { documento: null, matches: [], message: 'Documento inválido' };
	}

	const clientes = await getClientesConApiValidacion();
	if (!clientes.length) {
		return {
			documento: dni,
			matches: [],
			message: 'No hay obras sociales con API de validación configurada',
		};
	}

	const checks = await Promise.all(
		clientes.map(async (cli) => {
			const providerCode = resolveProviderCode(cli.APIValidacionPaciente);
			const provider = providerCode ? PROVIDERS[providerCode] : null;
			if (!provider) {
				return {
					valor: cli.Valor,
					razonSocial: cli.RazonSocial,
					provider: providerCode,
					activo: false,
					omitido: true,
					motivo: `Proveedor no implementado: ${providerCode}`,
				};
			}

			const result = await provider.verificarAfiliado(dni);
			if (!result.activo) {
				return {
					valor: cli.Valor,
					razonSocial: cli.RazonSocial,
					provider: providerCode,
					activo: false,
					motivo: result.tipoError || result.error || 'inactivo',
				};
			}

			const nroEsDocumento = flagOn(cli.NroAfiliadoDocumento);
			const nAfiliado = nroEsDocumento
				? dni
				: String(
						result.datos?.nro_afiliado ||
							result.datos?.numero_afiliado ||
							result.datos?.nro_documento ||
							dni,
					);

			return {
				valor: cli.Valor,
				razonSocial: cli.RazonSocial,
				provider: providerCode,
				activo: true,
				nAfiliado,
				nroAfiliadoEsDocumento: nroEsDocumento,
				datos: {
					nombre: result.datos?.nombre || null,
					estado: result.datos?.estado || null,
					tipo: result.datos?.tipo || null,
				},
			};
		}),
	);

	const matches = checks.filter((c) => c.activo);
	return {
		documento: dni,
		matches,
		// Primera OS activa para autofill del formulario (comportamiento Renaper)
		primary: matches[0] || null,
		checks,
	};
}

module.exports = {
	validarAfiliadoPorDocumento,
	getClientesConApiValidacion,
	flagOn,
};
