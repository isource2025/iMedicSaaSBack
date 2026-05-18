const authService = require('../services/auth.service');
const permisosService = require('../services/permisos.service');
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

const generarToken = (userData) => {
  const matricula =
    userData.Matricula != null && Number(userData.Matricula) > 0
      ? Number(userData.Matricula)
      : null;
  const payload = {
    usuario: {
      id: userData.ValorPersonal,
      username: userData.NombreRed,
      nombre: userData.Nombres,
      apellido: userData.Apellido,
      codOperador: userData.CodOperador,
      matricula, // requerido por el módulo Agenda para FK lógica con imPersonalHorarios/imTurnos
    },
    rol: resolverRol(userData),
    // La fecha de emisión se incluye automáticamente (iat)
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
};

const inicioSesion = async (req, res) => {
  const { username, password, sector, idSector } = req.body;
  
  try {
    console.log(`Intento de inicio de sesión con usuario: ${username}`);
    
    // Intentar autenticación SQL primero, luego recurrir a credenciales temporales si es necesario
    try {
      const usuario = await authService.autenticarUsuario(username, password);
      console.log("Usuario autenticado: ", usuario);
      
      if (usuario) {
        console.log(`Inicio de sesión exitoso para usuario ${username} desde SQL Server`);
        
        // Obtener información del sector seleccionado
        let sectorInfo = null;
        
        if (idSector) {
          // Si se recibió el idSector directamente, lo usamos para obtener la descripción
          console.log(`Usando idSector proporcionado: ${idSector}`);
          
          // Consultar la descripción del sector basado en el idSector
          const sectorDesc = await authService.obtenerDescripcionSector(idSector);
          console.log("Sector Descripción: ", sectorDesc);
          
          sectorInfo = {
            idPersonal: sector,
            idSector: idSector,
            descripcion: sectorDesc ? sectorDesc.descripcion : 'Sector Desconocido'
          };
        } else {
          // Método anterior: obtener el idSector desde el idPersonal
          console.log(`Usando método anterior con sector/idPersonal: ${sector}`);
          sectorInfo = await authService.obtenerIdSectorPorIdPersonal(sector);
        }
        
        // Generar token JWT con la información del usuario (incluye el rol)
        const token = generarToken(usuario);
        const rol = resolverRol(usuario);

        // Cargar los permisos efectivos del rol desde BD (con caché).
        // Se devuelven en el BODY del response (no en el JWT, para no inflar
        // el token).
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
          sectorSeleccionado: {
            idPersonal: sector,
            idSector: sectorInfo ? sectorInfo.idSector : '',
            descripcion: sectorInfo ? sectorInfo.descripcion : ''
          },
          token: token,
          fuente: 'db'
        });
      }
    } catch (dbError) {
      console.error('Error consultando la base de datos:', dbError.message);
      console.log('Continuando con verificación de credenciales temporales...');
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
  
  try {
    const sectores = await authService.obtenerSectoresPorUsuario(username);
    res.json({
      success: true,
      data: sectores
    });
  } catch (error) {
    console.error(`Error al obtener sectores para usuario ${username}:`, error);
    res.status(500).json({
      success: false,
      mensaje: 'Error al obtener los sectores para el usuario'
    });
  }
};

module.exports = {
  inicioSesion,
  obtenerSectores,
  obtenerSectoresPorUsuario
};
