const renaperService = require('../services/renaper.service');

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

	// El sexo puede venir como "1/2" o "F/M"; no lo fuerces a número todavía
	const Sexo = String(rawSexo).trim().toUpperCase();
	if (!/^(F|M|1|2)$/.test(Sexo)) {
		return res.status(400).json({
			success: false,
			message: 'Parámetro "sexo" inválido. Usa F/M o 1/2.',
			detail: { sexo: rawSexo },
		});
	}

	try {
		// Activa debug durante el diagnóstico; luego puedes poner false
		const data = await renaperService.search(NumeroDocumento, Sexo, { debug: true });

		// Normaliza: a veces viene { persona }, otras el objeto directo
		const persona =
			data?.persona ??
			(data && (data.apellido || data.nombres || data.numeroDocumento) ? data : null);

		if (!persona) {
			// Puede venir un mensaje de error del upstream (p.ej. descripcionError)
			return res.status(404).json({
				success: false,
				message: 'No se encontraron datos en RENAPER',
				raw: data,
			});
		}

		return res.json({ persona });
	} catch (error) {
		// Si renaperService.fetchJSON lanzó con "HTTP <code> ..." lo reexpone como 502 (bad gateway)
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
