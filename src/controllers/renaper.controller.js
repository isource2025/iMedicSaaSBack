const renaperService = require('../services/renaper.service');
const { statusDeError, mensajeDeError } = require('../utils/httpError');
const { repararTextoClarionAnsi, repararStringsDeep } = require('../utils/clarionText');

/** Unifica variantes de nombres de campos que devuelve MSAL/RENAPER. */
function normalizePersonaForClient(raw) {
	if (!raw || typeof raw !== 'object') return raw;
	const fixed = repararStringsDeep(raw);
	const apellido = repararTextoClarionAnsi(String(fixed.apellido ?? fixed.Apellido ?? '').trim());
	const nombres = repararTextoClarionAnsi(
		String(fixed.nombres ?? fixed.Nombres ?? fixed.nombre ?? fixed.Nombre ?? '').trim(),
	);
	const idSexo = fixed.idSexo ?? fixed.IdSexo;
	let sexo = fixed.sexo ?? fixed.Sexo;
	if (!sexo && idSexo != null) {
		const n = Number(idSexo);
		if (n === 1) sexo = 'F';
		else if (n === 2) sexo = 'M';
	}
	const calle = repararTextoClarionAnsi(String(fixed.calle ?? fixed.Calle ?? '').trim());
	const numero = String(fixed.numero ?? fixed.Numero ?? '').trim();
	const piso = String(fixed.piso ?? fixed.Piso ?? '').trim();
	const depto = repararTextoClarionAnsi(
		String(fixed.departamento ?? fixed.Departamento ?? fixed.depto ?? '').trim(),
	);
	let domicilio = `${calle} ${numero}`.trim();
	if (piso) domicilio += domicilio ? ` Piso ${piso}` : `Piso ${piso}`;
	if (depto) domicilio += domicilio ? ` Dpto ${depto}` : `Dpto ${depto}`;

	return {
		...fixed,
		numeroDocumento: fixed.numeroDocumento ?? fixed.NumeroDocumento ?? null,
		apellido,
		nombres,
		calle,
		numero,
		piso,
		departamento: depto,
		domicilio: domicilio.slice(0, 120) || null,
		fechaNacimiento: fixed.fechaNacimiento ?? fixed.FechaNacimiento ?? null,
		sexo: sexo ? String(sexo).toUpperCase().slice(0, 1) : null,
		idSexo: idSexo ?? null,
		ciudad: repararTextoClarionAnsi(
			String(fixed.ciudad ?? fixed.Ciudad ?? fixed.localidad ?? fixed.Localidad ?? '').trim(),
		) || null,
		provincia: repararTextoClarionAnsi(
			String(fixed.provincia ?? fixed.Provincia ?? '').trim(),
		) || null,
		codigoPostal: fixed.codigoPostal ?? fixed.CodigoPostal ?? null,
		cuil: fixed.cuil ?? fixed.CUIL ?? fixed.cuit ?? fixed.CUIT ?? null,
		pais: fixed.pais ?? fixed.Pais ?? null,
	};
}

const getToken = async (req, res) => {
	try {
		const token = await renaperService.getToken();
		res.json({ token });
	} catch (error) {
		console.error('[RENAPER][getToken] ERROR:', error?.message);
		res.status(statusDeError(error)).json({
			success: false,
			mensaje: mensajeDeError(error, 'Error al generar el token del renaper'),
			error: error.message,
		});
	}
};

const search = async (req, res) => {
	const rawDoc = req.params.documento;
	const rawSexo = req.params.sexo; // ¡no lo parsees aún!

	// Validación básica de documento
	const NumeroDocumento = Number(String(rawDoc).trim());
	if (!Number.isFinite(NumeroDocumento)) {
		return res.status(400).json({
			success: false,
			message: 'Parámetro "documento" inválido',
			detail: { documento: rawDoc },
		});
	}

	// El sexo puede venir como "1/2" o "F/M"
	const Sexo = String(rawSexo).trim().toUpperCase();
	if (!/^(F|M|1|2)$/.test(Sexo)) {
		return res.status(400).json({
			success: false,
			message: 'Parámetro "sexo" inválido. Usa F/M o 1/2.',
			detail: { sexo: rawSexo },
		});
	}

	try {
		// consulta al servicio
		const result = await renaperService.search(NumeroDocumento, Sexo, { debug: true });

		if (!result.ok) {
			return res.status(404).json({
				success: false,
				message: 'No se encontraron datos en RENAPER',
				reason: result.reason,
				raw: result.attempts || null,
			});
		}

		const persona = normalizePersonaForClient(result.data);

		return res.json({
			success: true,
			persona,
		});
	} catch (error) {
		console.error('[RENAPER][search] ERROR:', {
			doc: NumeroDocumento,
			sexo: Sexo,
			message: error?.message,
		});

		return res.status(502).json({
			success: false,
			message: 'Error consultando RENAPER',
			detail: error?.message,
		});
	}
};

module.exports = {
	getToken,
	search,
};
