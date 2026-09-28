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

async function getClientePorValor(valor) {
	const rows = await executeQuery(
		`
    SELECT TOP 1
      Valor,
      RazonSocial,
      NroAfiliadoDocumento,
      APIValidacionPaciente
    FROM imClientes
    WHERE Valor = @p0
  `,
		[{ value: valor }],
	);
	return rows?.[0] || null;
}

/**
 * Consulta la actividad de un número (documento o nº de afiliado) en una OS.
 * @param {object} cli fila de imClientes
 * @param {string} nro
 */
async function verificarEnCliente(cli, nro) {
	const providerCode = resolveProviderCode(cli.APIValidacionPaciente);
	const provider = providerCode ? PROVIDERS[providerCode] : null;
	const nroEsDocumento = flagOn(cli.NroAfiliadoDocumento);
	const base = {
		valor: cli.Valor,
		razonSocial: cli.RazonSocial,
		provider: providerCode,
		nroAfiliadoEsDocumento: nroEsDocumento,
	};

	if (!provider) {
		return {
			...base,
			activo: false,
			omitido: true,
			motivo: `Proveedor no implementado: ${providerCode}`,
		};
	}

	const result = await provider.verificarAfiliado(nro);
	if (!result.activo) {
		return {
			...base,
			activo: false,
			motivo: result.tipoError || result.error || 'inactivo',
			datos: result.datos
				? { nombre: result.datos.nombre || null, estado: result.datos.estado || null }
				: null,
		};
	}

	const nAfiliado = nroEsDocumento
		? nro
		: String(
				result.datos?.nro_afiliado ||
					result.datos?.numero_afiliado ||
					result.datos?.nro_documento ||
					nro,
			);

	return {
		...base,
		activo: true,
		nAfiliado,
		datos: {
			nombre: result.datos?.nombre || null,
			estado: result.datos?.estado || null,
			tipo: result.datos?.tipo || null,
		},
	};
}

/**
 * Busca en paralelo en las OS con APIValidacionPaciente cuyo nº de afiliado es el documento.
 * @param {string|number} documento
 */
async function validarAfiliadoPorDocumento(documento) {
	const dni = String(documento || '').replace(/\D/g, '');
	if (!dni) {
		return { documento: null, matches: [], primary: null, message: 'Documento inválido' };
	}

	const clientes = (await getClientesConApiValidacion()).filter((c) =>
		flagOn(c.NroAfiliadoDocumento),
	);
	if (!clientes.length) {
		return {
			documento: dni,
			matches: [],
			primary: null,
			message: 'No hay obras sociales que validen por documento',
		};
	}

	const checks = await Promise.all(clientes.map((cli) => verificarEnCliente(cli, dni)));
	const matches = checks.filter((c) => c.activo);
	return {
		documento: dni,
		matches,
		// Solo se autocompleta si hay una única OS activa; con varias el usuario elige
		primary: matches.length === 1 ? matches[0] : null,
		checks,
	};
}

/**
 * Valida un nº de afiliado en una OS puntual.
 * @param {string|number} valorCobertura imClientes.Valor
 * @param {string} nroAfiliado
 */
async function validarAfiliadoEnCobertura(valorCobertura, nroAfiliado) {
	const nro = String(nroAfiliado || '').trim();
	if (!nro) {
		const e = new Error('Número de afiliado requerido');
		e.statusCode = 400;
		throw e;
	}
	const cli = await getClientePorValor(valorCobertura);
	if (!cli) {
		const e = new Error('Obra social inexistente');
		e.statusCode = 404;
		throw e;
	}
	if (!resolveProviderCode(cli.APIValidacionPaciente)) {
		const e = new Error('La obra social no tiene API de validación configurada');
		e.statusCode = 400;
		throw e;
	}
	return verificarEnCliente(cli, nro);
}

module.exports = {
	validarAfiliadoPorDocumento,
	validarAfiliadoEnCobertura,
	getClientesConApiValidacion,
	flagOn,
};
