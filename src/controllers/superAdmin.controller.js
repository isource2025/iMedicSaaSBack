const superAdminService = require('../services/superAdmin.service');

async function dashboard(req, res) {
	try {
		const data = await superAdminService.obtenerDashboard();
		res.json({ success: true, data });
	} catch (e) {
		console.error('[superAdmin.dashboard]', e);
		res.status(500).json({ success: false, mensaje: e.message });
	}
}

async function catalogos(req, res) {
	try {
		const data = await superAdminService.obtenerCatalogos();
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
}

async function catalogosEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.obtenerCatalogosTenant(id);
		res.json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 500).json({ success: false, mensaje: e.message });
	}
}

async function listarEmpresas(req, res) {
	try {
		const data = await superAdminService.listarEmpresas(req.query.q);
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
}

async function obtenerEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.obtenerEmpresaDetalle(id);
		if (!data) return res.status(404).json({ success: false, mensaje: 'Empresa no encontrada' });
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
}

async function crearEmpresa(req, res) {
	try {
		const data = await superAdminService.crearEmpresa(req.body);
		res.status(201).json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.actualizarEmpresa(id, req.body);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarConexionEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.actualizarConexionEmpresa(id, req.body);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function probarConexionEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.probarConexionEmpresa(id);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarPacks(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.actualizarPacksEmpresa(id, req.body.packs || []);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarOnboarding(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.upsertOnboarding(id, req.body);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarSuscripcion(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.upsertSuscripcion(id, req.body);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function listarUsuarios(req, res) {
	try {
		const data = await superAdminService.listarTodosUsuarios(req.query.q);
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
}

async function vincularUsuario(req, res) {
	try {
		const idEmpresa = Number(req.params.id);
		const idPersonal = Number(req.body.idPersonal);
		const data = await superAdminService.vincularUsuarioEmpresa(idEmpresa, idPersonal);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function desvincularUsuario(req, res) {
	try {
		const idEmpresa = Number(req.params.id);
		const idPersonal = Number(req.params.idPersonal);
		const data = await superAdminService.desvincularUsuarioEmpresa(idEmpresa, idPersonal);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

async function modulosEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.obtenerModulosEmpresaActiva(id);
		res.json({ success: true, data });
	} catch (e) {
		res.status(500).json({ success: false, mensaje: e.message });
	}
}

async function crearUsuario(req, res) {
	try {
		const idEmpresa = Number(req.params.id);
		const data = await superAdminService.crearUsuarioEmpresa(idEmpresa, req.body);
		res.status(201).json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarUsuario(req, res) {
	try {
		const idEmpresa = Number(req.params.id);
		const idPersonal = Number(req.params.idPersonal);
		const data = await superAdminService.actualizarUsuarioEmpresa(idEmpresa, idPersonal, req.body);
		res.json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 400).json({ success: false, mensaje: e.message });
	}
}

async function eliminarEmpresa(req, res) {
	try {
		const id = Number(req.params.id);
		const data = await superAdminService.eliminarEmpresa(id);
		res.json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 400).json({ success: false, mensaje: e.message });
	}
}

async function crearSector(req, res) {
	try {
		const data = await superAdminService.crearSector(req.body);
		res.status(201).json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 400).json({ success: false, mensaje: e.message });
	}
}

async function actualizarSector(req, res) {
	try {
		const data = await superAdminService.actualizarSector(req.params.valor, req.body);
		res.json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 400).json({ success: false, mensaje: e.message });
	}
}

async function eliminarSector(req, res) {
	try {
		const idEmpresa = Number(req.query.idEmpresa ?? req.body?.idEmpresa);
		const data = await superAdminService.eliminarSector(req.params.valor, idEmpresa);
		res.json({ success: true, data });
	} catch (e) {
		res.status(e.statusCode || 400).json({ success: false, mensaje: e.message });
	}
}

async function configPlataforma(req, res) {
	try {
		if (req.method === 'GET' || req.method === 'get') {
			const data = await superAdminService.listarConfigPlataforma();
			return res.json({ success: true, data });
		}
		const { clave, valor } = req.body;
		const data = await superAdminService.guardarConfigPlataforma(clave, valor);
		res.json({ success: true, data });
	} catch (e) {
		res.status(400).json({ success: false, mensaje: e.message });
	}
}

module.exports = {
	dashboard,
	catalogos,
	catalogosEmpresa,
	listarEmpresas,
	obtenerEmpresa,
	crearEmpresa,
	actualizarEmpresa,
	actualizarConexionEmpresa,
	probarConexionEmpresa,
	eliminarEmpresa,
	actualizarPacks,
	actualizarOnboarding,
	actualizarSuscripcion,
	listarUsuarios,
	vincularUsuario,
	desvincularUsuario,
	crearUsuario,
	actualizarUsuario,
	crearSector,
	actualizarSector,
	eliminarSector,
	modulosEmpresa,
	configPlataforma,
};
