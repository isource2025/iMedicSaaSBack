/**
 * @deprecated Usar `requirePermiso('...')` / `requireAnyPermiso(...)`.
 * Este stub se mantiene sólo para no romper imports residuales: responde 403.
 */
const adminMiddleware = (_req, res) => {
	return res.status(403).json({
		success: false,
		mensaje: 'adminMiddleware está deprecado: usá requirePermiso con un código de la matriz',
	});
};

module.exports = adminMiddleware;
