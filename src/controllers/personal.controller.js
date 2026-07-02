/**
 * Controlador CRUD de Personal (tabla imPersonal) - sección Datos Personales.
 */
const personalService = require('../services/personal.service');

const listar = async (req, res) => {
	try {
		const { page = 1, limit = 30, search = '' } = req.query;
		const pageNum = Math.max(1, parseInt(page, 10) || 1);
		const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
		const result = await personalService.listar(pageNum, limitNum, String(search || ''));
		res.json({
			success: true,
			data: result.data,
			pagination: {
				currentPage: pageNum,
				totalPages: result.totalPages,
				totalCount: result.totalCount,
				limit: limitNum,
			},
		});
	} catch (error) {
		console.error('[personal.listar] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener el personal' });
	}
};

const obtenerPorId = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const personal = await personalService.obtenerPorId(id);
		if (!personal) {
			return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		}
		res.json({ success: true, data: personal });
	} catch (error) {
		console.error('[personal.obtenerPorId] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener el personal' });
	}
};

const obtenerProximoId = async (_req, res) => {
	try {
		const valor = await personalService.obtenerProximoValor();
		res.json({ success: true, data: { Valor: valor } });
	} catch (error) {
		console.error('[personal.obtenerProximoId] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener el próximo ID' });
	}
};

const crear = async (req, res) => {
	try {
		if (!String(req.body?.ApellidoNombre || '').trim()) {
			return res.status(400).json({
				success: false,
				mensaje: 'El campo ApellidoNombre es obligatorio',
			});
		}
		const nuevo = await personalService.crear(req.body);
		res.status(201).json({
			success: true,
			mensaje: 'Personal creado con éxito',
			data: nuevo,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.crear] ERROR:', error.message);
		res
			.status(status)
			.json({ success: false, mensaje: error.message || 'Error al crear el personal' });
	}
};

const actualizar = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		if (!String(req.body?.ApellidoNombre || '').trim()) {
			return res.status(400).json({
				success: false,
				mensaje: 'El campo ApellidoNombre es obligatorio',
			});
		}
		const actualizado = await personalService.actualizar(id, req.body);
		if (!actualizado) {
			return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		}
		res.json({
			success: true,
			mensaje: 'Personal actualizado con éxito',
			data: actualizado,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizar] ERROR:', error.message);
		res
			.status(status)
			.json({ success: false, mensaje: error.message || 'Error al actualizar el personal' });
	}
};

const eliminar = async (req, res) => {
	try {
		const id = parseInt(req.params.id, 10);
		if (!Number.isFinite(id)) {
			return res.status(400).json({ success: false, mensaje: 'ID inválido' });
		}
		const ok = await personalService.eliminar(id);
		if (!ok) {
			return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		}
		res.json({ success: true, mensaje: 'Personal eliminado con éxito' });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.eliminar] ERROR:', error.message);
		res
			.status(status)
			.json({ success: false, mensaje: error.message || 'Error al eliminar el personal' });
	}
};

// ---------- Catálogos ----------

const _catalogoHandler = (fn, label) => async (_req, res) => {
	try {
		const data = await fn();
		res.json({ success: true, data });
	} catch (error) {
		console.error(`[personal.${label}] ERROR:`, error.message);
		res
			.status(500)
			.json({ success: false, mensaje: `Error al obtener ${label}` });
	}
};

const listarEspecialidades = _catalogoHandler(
	personalService.listarEspecialidades,
	'especialidades',
);
const listarFunciones = _catalogoHandler(
	personalService.listarFunciones,
	'funciones',
);
const listarServicios = _catalogoHandler(
	personalService.listarServicios,
	'servicios',
);
const listarCategorias = _catalogoHandler(
	personalService.listarCategorias,
	'categorias',
);
const listarClases = _catalogoHandler(
	personalService.listarClases,
	'clases',
);
const listarEmpresasCatalogo = _catalogoHandler(
	personalService.listarEmpresasCatalogo,
	'empresas (catálogo)',
);

const _idInt = (req) => {
	const id = parseInt(req.params.id, 10);
	return Number.isFinite(id) ? id : null;
};

const obtenerServicioPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.obtenerServicioPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerServicioPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener servicio del personal' });
	}
};

const actualizarServicioPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.actualizarServicioPersonal(id, req.body || {});
		res.json({ success: true, mensaje: 'Servicio actualizado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarServicioPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar servicio',
		});
	}
};

const listarEmpresasPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarEmpresasPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarEmpresasPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar empresas' });
	}
};

const agregarEmpresaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.agregarEmpresaPersonal(id, req.body?.IdEmpresa);
		res.status(201).json({ success: true, mensaje: 'Empresa asociada', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.agregarEmpresaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al asociar empresa',
		});
	}
};

const quitarEmpresaPersonal = async (req, res) => {
	const id = _idInt(req);
	const idEmpresa = parseInt(req.params.idEmpresa, 10);
	if (id == null || !Number.isFinite(idEmpresa)) {
		return res.status(400).json({ success: false, mensaje: 'Parámetros inválidos' });
	}
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.quitarEmpresaPersonal(id, idEmpresa);
		res.json({ success: true, mensaje: 'Empresa quitada', data });
	} catch (error) {
		console.error('[personal.quitarEmpresaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al quitar empresa' });
	}
};

const obtenerFirmaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.obtenerFirmaPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerFirmaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener firma' });
	}
};

const actualizarFirmaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		if (!req.file?.buffer) {
			return res.status(400).json({
				success: false,
				mensaje: 'Adjunte una imagen (campo archivo)',
			});
		}
		await personalService.actualizarFirmaPersonal(id, req.file.buffer);
		res.json({ success: true, mensaje: 'Firma guardada' });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarFirmaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al guardar firma',
		});
	}
};

const eliminarFirmaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		await personalService.eliminarFirmaPersonal(id);
		res.json({ success: true, mensaje: 'Firma eliminada' });
	} catch (error) {
		console.error('[personal.eliminarFirmaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al eliminar firma' });
	}
};

const listarSectoresPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarSectoresPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarSectoresPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar sectores' });
	}
};

const agregarSectorPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.agregarSectorPersonal(id, req.body?.idSector);
		res.status(201).json({ success: true, mensaje: 'Sector asignado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.agregarSectorPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al asignar sector',
		});
	}
};

const quitarSectorPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		let idSector = req.query?.idSector || req.body?.idSector;
		if (Array.isArray(idSector)) idSector = idSector[0];
		if (!idSector) {
			return res.status(400).json({ success: false, mensaje: 'idSector es obligatorio' });
		}
		const data = await personalService.quitarSectorPersonal(id, idSector);
		res.json({ success: true, mensaje: 'Sector quitado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.quitarSectorPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al quitar sector',
		});
	}
};

const listarCodigosFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.listarCodigosFacturacionPersonal(id);
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.listarCodigosFacturacionPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al listar códigos de facturación' });
	}
};

const crearCodigoFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.crearCodigoFacturacionPersonal(id, req.body || {});
		res.status(201).json({ success: true, mensaje: 'Código agregado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.crearCodigoFacturacionPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al crear código',
		});
	}
};

const actualizarCodigoFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.actualizarCodigoFacturacionPersonal(id, req.body || {});
		res.json({ success: true, mensaje: 'Código actualizado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarCodigoFacturacionPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar código',
		});
	}
};

const eliminarCodigoFacturacionPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		let ca = req.query?.CodigoAsociacion || req.body?.CodigoAsociacion;
		if (Array.isArray(ca)) ca = ca[0];
		if (!ca) {
			return res.status(400).json({ success: false, mensaje: 'CodigoAsociacion es obligatorio' });
		}
		const data = await personalService.eliminarCodigoFacturacionPersonal(id, ca);
		res.json({ success: true, mensaje: 'Código eliminado', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.eliminarCodigoFacturacionPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al eliminar código',
		});
	}
};

const actualizarAdicionalesPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const p = await personalService.obtenerPorId(id);
		if (!p) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		const data = await personalService.actualizarAdicionalesPersonal(id, req.body || {});
		res.json({ success: true, mensaje: 'Datos adicionales actualizados', data });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarAdicionalesPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar datos adicionales',
		});
	}
};

const obtenerCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const data = await personalService.obtenerCuentaPersonal(id);
		if (!data) return res.status(404).json({ success: false, mensaje: 'Personal no encontrado' });
		res.json({ success: true, data });
	} catch (error) {
		console.error('[personal.obtenerCuentaPersonal] ERROR:', error.message);
		res.status(500).json({ success: false, mensaje: 'Error al obtener la cuenta de acceso' });
	}
};

const crearCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	const { nombreRed, password, codOperador } = req.body || {};
	if (!String(nombreRed || '').trim()) {
		return res.status(400).json({ success: false, mensaje: 'El nombre de usuario es obligatorio' });
	}
	if (!String(password || '').trim() || String(password).trim().length < 4) {
		return res.status(400).json({
			success: false,
			mensaje: 'La contraseña debe tener al menos 4 caracteres',
		});
	}
	try {
		const data = await personalService.crearCuentaPersonal(id, {
			nombreRed,
			password,
			codOperador,
		});
		res.status(201).json({
			success: true,
			mensaje: 'Cuenta de acceso creada correctamente',
			data,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.crearCuentaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al crear la cuenta de acceso',
		});
	}
};

const actualizarCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	try {
		const data = await personalService.actualizarCuentaPersonal(id, req.body || {});
		res.json({
			success: true,
			mensaje: 'Cuenta de acceso actualizada',
			data,
		});
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.actualizarCuentaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al actualizar la cuenta de acceso',
		});
	}
};

const cambiarPasswordCuentaPersonal = async (req, res) => {
	const id = _idInt(req);
	if (id == null) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
	const { password } = req.body || {};
	if (!password) {
		return res.status(400).json({ success: false, mensaje: 'La contraseña es requerida' });
	}
	try {
		await personalService.cambiarPasswordCuentaPersonal(id, password);
		res.json({ success: true, mensaje: 'Contraseña actualizada correctamente' });
	} catch (error) {
		const status = error.statusCode || 500;
		console.error('[personal.cambiarPasswordCuentaPersonal] ERROR:', error.message);
		res.status(status).json({
			success: false,
			mensaje: error.message || 'Error al cambiar la contraseña',
		});
	}
};

module.exports = {
	listar,
	obtenerPorId,
	obtenerProximoId,
	crear,
	actualizar,
	eliminar,
	listarEspecialidades,
	listarFunciones,
	listarServicios,
	listarCategorias,
	listarClases,
	listarEmpresasCatalogo,
	obtenerServicioPersonal,
	actualizarServicioPersonal,
	listarEmpresasPersonal,
	agregarEmpresaPersonal,
	quitarEmpresaPersonal,
	obtenerFirmaPersonal,
	actualizarFirmaPersonal,
	eliminarFirmaPersonal,
	listarSectoresPersonal,
	agregarSectorPersonal,
	quitarSectorPersonal,
	listarCodigosFacturacionPersonal,
	crearCodigoFacturacionPersonal,
	actualizarCodigoFacturacionPersonal,
	eliminarCodigoFacturacionPersonal,
	actualizarAdicionalesPersonal,
	obtenerCuentaPersonal,
	crearCuentaPersonal,
	actualizarCuentaPersonal,
	cambiarPasswordCuentaPersonal,
};
