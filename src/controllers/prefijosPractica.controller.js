/**
 * Super admin: prefijos de práctica por servicio de una empresa (imServicios.PrefijosPractica).
 * Lee y escribe en la base clínica de la empresa (la misma que usan los pedidos de estudios).
 */
const ps = require('../services/prefijosPractica.service');
const { runWithTenant } = require('../context/tenantContext');

function _idEmpresa(req) {
	const id = Number(req.params.id);
	if (!Number.isFinite(id) || id <= 0) {
		const e = new Error('idEmpresa inválido');
		e.statusCode = 400;
		throw e;
	}
	return id;
}

function _err(res, err) {
	const status = Number(err?.statusCode) || 500;
	if (status >= 500) console.error('[prefijos-practica]', err?.message || err);
	return res.status(status).json({ success: false, mensaje: err?.message || 'Error interno' });
}

/** Servicios de la empresa con sus prefijos + todos los capítulos disponibles para elegir. */
async function obtener(req, res) {
	try {
		const id = _idEmpresa(req);
		const data = await runWithTenant(id, async () => ({
			servicios: await ps.listarServicios(),
			opciones: await ps.listarOpciones(),
		}));
		return res.json({ success: true, data });
	} catch (err) {
		return _err(res, err);
	}
}

async function guardar(req, res) {
	try {
		const id = _idEmpresa(req);
		const prefijos = req.body?.prefijos;
		if (!Array.isArray(prefijos) && typeof prefijos !== 'string') {
			const e = new Error('prefijos debe ser una lista');
			e.statusCode = 400;
			throw e;
		}
		const data = await runWithTenant(id, () => ps.guardarServicio(req.params.valor, prefijos));
		console.log(
			`[prefijos-practica] empresa ${id} servicio ${data.id} -> "${data.texto}" por ${req.auth?.usuario?.nombreRed || '?'}`,
		);
		return res.json({ success: true, data });
	} catch (err) {
		return _err(res, err);
	}
}

module.exports = { obtener, guardar };
