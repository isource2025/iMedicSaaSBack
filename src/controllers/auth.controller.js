const authService = require('../services/auth.service');
const permisosService = require('../services/permisos.service');
const empresaService = require('../services/empresa.service');
const superAdminService = require('../services/superAdmin.service');
const tenantRegistry = require('../services/tenantRegistry.service');
const { runWithTenant } = require('../context/tenantContext');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, TOKEN_EXPIRATION } = require('../config/jwt');

/**
 * Genera un token JWT con la información del usuario
 * @param {Object} userData - Datos del usuario para incluir en el token
 * @returns {string} Token JWT generado
 */
/**
 * Resuelve el rol del usuario al hacer login.
 * Prioriza el rol en imPersonal.Rol; si no hay, usa el fallback Grupo=11 → ADMIN.
 * Devuelve null si el usuario no tiene rol asignado.
 */
const resolverRol = (userData) => {
  if (userData.RolId != null) {
    return {
      id: Number(userData.RolId),
      nombre: String(userData.RolNombre || '').trim(),
      nivel: Number(userData.RolNivel || 0),
    };
  }
  // Fallback histórico: imPassword.Grupo = 11 -> admin
  if (Number(userData.Grupo) === 11) {
    return { id: 1, nombre: 'ADMIN', nivel: 100 };
  }
  return null;
};

const generarToken = (userData, idEmpresa = null) => {
  const matricula =
    userData.Matricula != null && Number(userData.Matricula) > 0
      ? Number(userData.Matricula)
      : null;
  const payload = {
    usuario: {
      id: userData.ValorPersonal,
      username: userData.NombreRed || userData.Nombrered || userData.nombrered,
      nombre: userData.Nombres,
      apellido: userData.Apellido,
      codOperador: userData.CodOperador,
      matricula, // requerido por el módulo Agenda para FK lógica con imPersonalHorarios/imTurnos
    },
    rol: resolverRol(userData),
    idEmpresa:
      idEmpresa != null && idEmpresa !== '' && Number.isFinite(Number(idEmpresa)) && Number(idEmpresa) > 0
        ? Number(idEmpresa)
        : null,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
};

const inicioSesion = async (req, res) => {
  const { username, password, sector, idSector, idEmpresa } = req.body;
  
  try {
    console.log(`Intento de inicio de sesión con usuario: ${username}`);
    
    // Intentar autenticación SQL primero, luego recurrir a credenciales temporales si es necesario
    try {
      const loginResult = await tenantRegistry.resolverLogin(username, password, idEmpresa);
      const usuario = loginResult.usuario;
      const idEmpresaSesion = loginResult.idEmpresa;

      console.log(`Inicio de sesión exitoso para usuario ${username} (empresa tenant: ${idEmpresaSesion ?? 'plataforma'})`);

      const completarLogin = async () => {
        const rolPreliminar = resolverRol(usuario);
        let esSuperAdmin =
          rolPreliminar?.nombre === 'SUPER_ADMIN' || Number(rolPreliminar?.id) === 5;
        const eximeSector = authService.eximeSeleccionSectorPorUsuario(usuario);
        // Grupo 11 / SUPER_ADMIN en auth central: mismo criterio que descubrirEmpresasLogin
        if (!esSuperAdmin && idEmpresaSesion == null) {
          try {
            esSuperAdmin = await authService.esSuperAdminPorUsername(username);
          } catch (e) {
            console.warn('[auth.login] esSuperAdminPorUsername:', e.message);
          }
        }

        let sectorInfo = null;
        if (eximeSector) {
          sectorInfo = {
            idPersonal: usuario.ValorPersonal,
            idSector: '',
            descripcion: esSuperAdmin ? 'Plataforma' : 'Administración',
          };
        } else if (!sector && !idSector) {
          const sectoresDisponibles = await authService.obtenerSectoresPorUsuarioConTenant(
            username,
            idEmpresaSesion,
          );
          if (sectoresDisponibles.length === 1) {
            const unico = sectoresDisponibles[0];
            sectorInfo = {
              idPersonal: unico.idPersonal,
              idSector: unico.idSector,
              descripcion: unico.descripcionSector || 'Sector Desconocido',
            };
          } else {
            return res.status(400).json({
              success: false,
              mensaje: 'Debe seleccionar un sector para continuar',
            });
          }
        } else if (idSector) {
          const sectorDesc = await authService.obtenerDescripcionSector(idSector);
          sectorInfo = {
            idPersonal: sector,
            idSector: idSector,
            descripcion: sectorDesc ? sectorDesc.descripcion : 'Sector Desconocido',
          };
        } else {
          sectorInfo = await authService.obtenerIdSectorPorIdPersonal(sector);
          if (!sectorInfo?.idSector) {
            return res.status(400).json({
              success: false,
              mensaje: 'Debe seleccionar un sector válido para continuar',
            });
          }
        }

        let empresaSeleccionada = null;
        let modulosEmpresa = null;
        try {
          const empresasUsuario = esSuperAdmin
            ? await authService.obtenerTodasEmpresas()
            : await authService.obtenerEmpresasPorUsuario(username, idEmpresaSesion);
          const idEmpresaNum =
            idEmpresaSesion ??
            (idEmpresa != null && idEmpresa !== '' ? Number(idEmpresa) : null);

          if (!esSuperAdmin && empresasUsuario.length > 1 && (!idEmpresaNum || !Number.isFinite(idEmpresaNum))) {
            return res.status(400).json({
              success: false,
              mensaje: 'Debe seleccionar una empresa para continuar',
            });
          }

          if (idEmpresaNum && Number.isFinite(idEmpresaNum)) {
            const permitida =
              esSuperAdmin ||
              empresasUsuario.some((e) => Number(e.idEmpresa) === idEmpresaNum);
            if (empresasUsuario.length > 0 && !permitida) {
              return res.status(403).json({
                success: false,
                mensaje: 'La empresa seleccionada no está asociada a su usuario',
              });
            }
            empresaSeleccionada = await empresaService.obtenerInfoEmpresaPorId(idEmpresaNum);
            modulosEmpresa = await superAdminService.obtenerModulosEmpresaActiva(idEmpresaNum);
          } else if (empresasUsuario.length === 1) {
            empresaSeleccionada = await empresaService.obtenerInfoEmpresaPorId(
              empresasUsuario[0].idEmpresa,
            );
            modulosEmpresa = await superAdminService.obtenerModulosEmpresaActiva(
              empresasUsuario[0].idEmpresa,
            );
          } else if (empresasUsuario.length === 0) {
            empresaSeleccionada = await empresaService.obtenerInfoEmpresa();
          }
        } catch (empErr) {
          console.error('[auth.login] Error al resolver empresa:', empErr.message);
          try {
            if (idEmpresaSesion != null) {
              empresaSeleccionada = await empresaService.obtenerInfoEmpresaPorId(idEmpresaSesion);
            } else if (!esSuperAdmin) {
              empresaSeleccionada = await empresaService.obtenerInfoEmpresa();
            }
          } catch (fallbackErr) {
            console.warn('[auth.login] Fallback empresa omitido:', fallbackErr.message);
            empresaSeleccionada = null;
            modulosEmpresa = null;
          }
        }

        const token = generarToken(usuario, idEmpresaSesion);
        const rol = rolPreliminar;

        let permisos = [];
        try {
          if (rol?.id != null) {
            permisos = await permisosService.permisosDeRol(rol.id, rol.nombre);
          }
        } catch (e) {
          console.error('[auth.login] Error al cargar permisos:', e.message);
        }

        return res.json({
          success: true,
          mensaje: 'Inicio de sesión exitoso',
          usuario: {
            idCodOperador: usuario.CodOperador,
            idValorpersonal: usuario.ValorPersonal,
            matricula:
              usuario.Matricula != null && Number(usuario.Matricula) > 0
                ? Number(usuario.Matricula)
                : null,
            nombre: usuario.Nombres,
            apellido: usuario.Apellido,
            nombreRed:
              usuario.Nombrered ||
              usuario.nombrered ||
              usuario.NombreRed ||
              String(username || '').trim() ||
              null,
          },
          rol,
          permisos,
          idEmpresa: idEmpresaSesion,
          sectorSeleccionado: {
            idPersonal: sectorInfo ? sectorInfo.idPersonal : sector,
            idSector: sectorInfo ? sectorInfo.idSector : '',
            descripcion: sectorInfo ? sectorInfo.descripcion : '',
          },
          empresaSeleccionada,
          modulosEmpresa,
          token: token,
          fuente: 'db',
        });
      };

      if (idEmpresaSesion != null) {
        return await runWithTenant(idEmpresaSesion, completarLogin);
      }
      return await completarLogin();
    } catch (dbError) {
      if (dbError.statusCode === 409 && dbError.message === 'MULTI_EMPRESA') {
        return res.status(409).json({
          success: false,
          mensaje: 'Seleccione la empresa para continuar',
          empresas: dbError.empresas || [],
        });
      }
      if (dbError.statusCode === 401 || dbError.statusCode === 400) {
        return res.status(dbError.statusCode).json({
          success: false,
          mensaje: dbError.message,
        });
      }
      console.error('Error consultando la base de datos:', dbError.message);
    }
    
    
    // Si llegamos aquí, las credenciales son inválidas
    res.status(401).json({
      success: false,
      mensaje: 'Credenciales inválidas'
    });
  } catch (error) {
    console.error('Error durante la autenticación:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error en el servidor durante la autenticación'
    });
  }
};

/**
 * Obtiene todos los sectores disponibles
 * @param {Request} req - Solicitud HTTP
 * @param {Response} res - Respuesta HTTP
 */
const obtenerSectores = async (req, res) => {
  try {
    const sectores = await authService.obtenerSectores();
    res.json({
      success: true,
      data: sectores
    });
  } catch (error) {
    console.error('Error al obtener sectores:', error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los sectores'
    });
  }
};

/**
 * Obtiene los sectores disponibles para un usuario específico
 * @param {Request} req - Solicitud HTTP
 * @param {Response} res - Respuesta HTTP
 */
const obtenerSectoresPorUsuario = async (req, res) => {
  const { username } = req.params;
  const idEmpresa = req.query.idEmpresa;
  
  try {
    const eximeSector = await authService.eximeSectorPorUsername(username, idEmpresa);
    const sectores = await authService.obtenerSectoresPorUsuarioConTenant(username, idEmpresa);
    res.json({
      success: true,
      data: sectores,
      requiereSector: !eximeSector,
    });
  } catch (error) {
    console.error(`Error al obtener sectores para usuario ${username}:`, error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los sectores para el usuario',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message,
    });
  }
};

const obtenerEmpresasPorUsuario = async (req, res) => {
  const { username } = req.params;

  try {
    const { empresas, esSuperAdmin, requiereSector } = await authService.descubrirEmpresasLogin(username);
    res.json({
      success: true,
      data: empresas,
      esSuperAdmin: !!esSuperAdmin,
      requiereSector: requiereSector !== false,
    });
  } catch (error) {
    console.error(`Error al obtener empresas para usuario ${username}:`, error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener las empresas para el usuario',
      error: process.env.NODE_ENV === 'production' ? undefined : error.message,
    });
  }
};

module.exports = {
  inicioSesion,
  obtenerSectores,
  obtenerSectoresPorUsuario,
  obtenerEmpresasPorUsuario,
};
