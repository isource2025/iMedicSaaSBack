/**
 * Middleware de "propiedad del registro" para las secciones de Internación.
 *
 * Uso: `router.put('/:id', requireAuth, requirePropietario(opcionesTabla), controller.actualizar)`
 *
 * Verifica que el usuario logueado (`req.auth.usuario.codOperador`) sea el
 * mismo que creó el registro.  Si el campo de autoría no existe en la tabla
 * (tablas legacy sin columna de autor), deja pasar (`failSafe = true` por
 * defecto) porque no podemos bloquear retroactivamente.
 *
 * Opciones:
 *   tabla        {string}  Nombre de la tabla (ej: 'imInterIndMedicas')
 *   pkCol        {string}  Columna PK (ej: 'Valor')
 *   autorCol     {string}  Columna que guarda el CodOperador del creador
 *                          (ej: 'OperadorCarga') o la Matricula (ej: 'Profecional')
 *   pkParam      {string}  Nombre del param de ruta (default: 'id')
 *   autorEsMatricula {boolean} Si true, compara contra req.matricula / JWT matricula
 *                              (imHCEvolucion.Profecional guarda matrícula, no CodOperador)
 *   failSafe     {boolean} Si es true (default), cuando NO hay columna de
 *                          autor o no hay registro deja pasar. Si es false,
 *                          bloquea ante la duda.
 */
const { executeQuery } = require('../models/db');

function resolverIdentificadorSesion(req, { autorEsMatricula }) {
	if (autorEsMatricula) {
		const mat = req.matricula ?? req.auth?.usuario?.matricula;
		const matNum = mat != null && mat !== '' ? Number(mat) : NaN;
		if (Number.isFinite(matNum) && matNum > 0) return matNum;
	}
	const cod = req.auth?.usuario?.codOperador;
	const codNum = cod != null && cod !== '' ? Number(cod) : NaN;
	if (Number.isFinite(codNum)) return codNum;
	return null;
}

function requirePropietario({
	tabla,
	pkCol,
	autorCol,
	pkParam = 'id',
	failSafe = true,
	autorEsMatricula = false,
}) {
	return async (req, res, next) => {
		try {
			const pkRaw = req.params[pkParam];
			if (!pkRaw) {
				if (failSafe) return next();
				return res.status(400).json({ success: false, mensaje: 'ID de registro requerido' });
			}

			let identificadorSesion = resolverIdentificadorSesion(req, { autorEsMatricula });

			// JWT legacy (Render) puede traer id pero no matricula: resolver desde imPersonal
			if (identificadorSesion == null && autorEsMatricula && req.valorPersonal) {
				const mRows = await executeQuery(
					'SELECT Matricula FROM dbo.imPersonal WHERE Valor = @p0',
					[{ value: Number(req.valorPersonal) }],
				);
				const m = mRows[0]?.Matricula;
				const mNum = m != null && m !== '' ? Number(m) : NaN;
				if (Number.isFinite(mNum) && mNum > 0) {
					identificadorSesion = mNum;
					req.matricula = mNum;
				}
			}

			if (identificadorSesion == null) {
				if (failSafe) return next();
				return res.status(401).json({ success: false, mensaje: 'No autenticado' });
			}

			// Leer el registro para verificar propiedad
			const rows = await executeQuery(
				`SELECT ${autorCol} AS AutorCarga FROM dbo.${tabla} WHERE ${pkCol} = @p0`,
				[{ value: Number(pkRaw) }],
			);

			if (!rows.length) {
				// Registro no existe
				if (failSafe) return next();
				return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
			}

			const autor = rows[0]?.AutorCarga;
			if (autor == null) {
				// Campo de autor nulo → failSafe decide
				if (failSafe) return next();
				return res.status(403).json({
					success: false,
					mensaje: 'No es posible verificar la propiedad del registro.',
				});
			}

			if (Number(autor) === Number(identificadorSesion)) {
				return next(); // es el autor, puede editar
			}

			// Otro usuario creó el registro → 403 legal
			return res.status(403).json({
				success: false,
				mensaje: 'Por restricciones legales, no puede modificar registros creados por otro profesional.',
				codigoError: 'REGISTRO_AJENO',
			});
		} catch (error) {
			console.error('[propietario.middleware]', error);
			if (failSafe) return next(); // ante error de BD, no bloqueamos
			return res.status(500).json({ success: false, mensaje: 'Error al verificar propiedad del registro' });
		}
	};
}

module.exports = { requirePropietario };
