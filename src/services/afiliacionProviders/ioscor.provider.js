const axios = require('axios');

const BASE_URL = (process.env.IOSCOR_API_URL || 'https://apiservice.ioscor.gob.ar/api/v1').replace(
	/\/$/,
	'',
);
const CONSULTA_URL = `${BASE_URL}/autorizador`;

let cachedToken = null;
let tokenTimestamp = 0;

function hasCredentials() {
	return !!(process.env.IOSCOR_API_ID && process.env.IOSCOR_API_KEY);
}

async function obtenerToken() {
	const now = Date.now();
	if (cachedToken && now - tokenTimestamp < 50 * 60 * 1000) return cachedToken;

	const tokenUrl = `${BASE_URL}/identidad/get_token?id=${process.env.IOSCOR_API_ID}&key=${process.env.IOSCOR_API_KEY}`;
	const response = await axios.post(tokenUrl, null, {
		headers: { 'Content-Type': 'application/json' },
		timeout: 12000,
	});

	if (!response.data?.token) throw new Error('Token IOSCOR inválido o ausente');
	cachedToken = response.data.token;
	tokenTimestamp = now;
	return cachedToken;
}

/**
 * @param {string|number} documento
 * @returns {Promise<{ activo: boolean, datos: object|null, error?: string, tipoError?: string }>}
 */
async function verificarAfiliado(documento) {
	if (!hasCredentials()) {
		return {
			activo: false,
			datos: null,
			error: 'Servicio IOSCOR no configurado (IOSCOR_API_ID/IOSCOR_API_KEY)',
			tipoError: 'no_configurado',
		};
	}

	const dni = String(documento || '').trim();
	if (!dni) {
		return { activo: false, datos: null, error: 'Documento vacío', tipoError: 'validacion' };
	}

	try {
		const token = await obtenerToken();
		const url = `${CONSULTA_URL}?nro=${encodeURIComponent(dni)}&call=consulta_afiliados`;
		const response = await axios.post(url, {}, {
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			timeout: 12000,
		});

		const afiliadoData = response.data?.resultado?.afiliado || {};
		const estado = afiliadoData?.estado || response.data?.resultado?.estado || null;

		if (!estado) {
			return {
				activo: false,
				datos: null,
				tipoError: response.data?.resultado !== undefined ? 'no_afiliado' : 'respuesta_invalida',
			};
		}

		const activo = String(estado).toLowerCase().includes('activ');
		return { activo, datos: afiliadoData };
	} catch (error) {
		let tipoError = 'desconocido';
		if (error.code === 'ECONNABORTED' || String(error.message || '').includes('timeout')) {
			tipoError = 'timeout';
		} else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
			tipoError = 'conectividad';
		} else if (error.response?.status >= 400) {
			tipoError = 'servidor';
		}
		return {
			activo: false,
			datos: null,
			error: error.message,
			tipoError,
		};
	}
}

module.exports = {
	code: 'IOSCOR',
	hasCredentials,
	verificarAfiliado,
};
