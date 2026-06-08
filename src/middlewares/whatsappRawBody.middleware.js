/**
 * Captura el body HTTP en crudo (stream) para validar X-Hub-Signature-256 de Meta.
 * Debe montarse ANTES de cors, express.json() y cualquier body-parser.
 */
function whatsappRawBody(req, res, next) {
	if (req.method !== 'POST') return next();

	const chunks = [];
	req.on('data', (chunk) => chunks.push(chunk));
	req.on('end', () => {
		req.rawBody = Buffer.concat(chunks);
		try {
			req.body = JSON.parse(req.rawBody.toString('utf8'));
		} catch {
			req.body = {};
		}
		next();
	});
	req.on('error', (err) => next(err));
}

module.exports = { whatsappRawBody };
