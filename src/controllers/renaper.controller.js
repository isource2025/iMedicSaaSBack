const renaperService = require('../services/renaper.service');

/** Unifica variantes de nombres de campos que devuelve MSAL/RENAPER. */
function normalizePersonaForClient(raw) {
	if (!raw || typeof raw !== 'object') return raw;
	const apellido = String(raw.apellido ?? raw.Apellido ?? '').trim();
	const nombres = String(
		raw.nombres ?? raw.Nombres ?? raw.nombre ?? raw.Nombre ?? '',
	).trim();
	const idSexo = raw.idSexo ?? raw.IdSexo;
	let sexo = raw.sexo ?? raw.Sexo;
	if (!sexo && idSexo != null) {
		const n = Number(idSexo);
		if (n === 1) sexo = 'F';
		else if (n === 2) sexo = 'M';
	}
	const calle = String(raw.calle ?? raw.Calle ?? '').trim();
	const numero = String(raw.numero ?? raw.Numero ?? '').trim();
	const piso = String(raw.piso ?? raw.Piso ?? '').trim();
	const depto = String(raw.departamento ?? raw.Departamento ?? raw.depto ?? '').trim();
	let domicilio = `${calle} ${numero}`.trim();
	if (piso) domicilio += domicilio ? ` Piso ${piso}` : `Piso ${piso}`;
	if (depto) domicilio += domicilio ? ` Dpto ${depto}` : `Dpto ${depto}`;

	return {
		...raw,
		numeroDocumento: raw.numeroDocumento ?? raw.NumeroDocumento ?? null,
		apellido,
		nombres,
		calle,
		numero,
		piso,
		departamento: depto,
		domicilio: domicilio.slice(0, 120) || null,
		fechaNacimiento: raw.fechaNacimiento ?? raw.FechaNacimiento ?? null,
		sexo: sexo ? String(sexo).toUpperCase().slice(0, 1) : null,
		idSexo: idSexo ?? null,
		ciudad: raw.ciudad ?? raw.Ciudad ?? raw.localidad ?? raw.Localidad ?? null,
		provincia: raw.provincia ?? raw.Provincia ?? null,
		codigoPostal: raw.codigoPostal ?? raw.CodigoPostal ?? null,
		cuil: raw.cuil ?? raw.CUIL ?? raw.cuit ?? raw.CUIT ?? null,
		pais: raw.pais ?? raw.Pais ?? null,
	};
}

const getToken = async (req, res) => {
	try {
		const token = await renaperService.getToken();
		res.json({ token });
	} catch (error) {
		console.error('[RENAPER][getToken] ERROR:', error?.message);
		res.status(500).json({
			success: false,
			mensaje: 'Error al generar el token del renaper',
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
