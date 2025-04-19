const authService = require('../services/auth.service');

const inicioSesion = async (req, res) => {
  const { username, password, sector, idsector } = req.body;
  
  try {
    console.log(`Intento de inicio de sesión con usuario: ${username}`);
    
    // Intentar autenticación SQL primero, luego recurrir a credenciales temporales si es necesario
    try {
      const usuario = await authService.autenticarUsuario(username, password);
      
      if (usuario) {
        console.log(`Inicio de sesión exitoso para usuario ${username} desde SQL Server`);
        
        // Obtener información del sector seleccionado
        let sectorInfo = null;
        
        if (idsector) {
          // Si se recibió el idsector directamente, lo usamos para obtener la descripción
          console.log(`Usando idsector proporcionado: ${idsector}`);
          
          // Consultar la descripción del sector basado en el idsector
          const sectorDesc = await authService.obtenerDescripcionSector(idsector);
          
          sectorInfo = {
            idpersonal: sector,
            idsector: idsector,
            descripcion: sectorDesc ? sectorDesc.descripcion : 'Sector Desconocido'
          };
        } else {
          // Método anterior: obtener el idsector desde el idpersonal
          console.log(`Usando método anterior con sector/idpersonal: ${sector}`);
          sectorInfo = await authService.obtenerIdSectorPorIdPersonal(sector);
        }
        
        return res.json({
          success: true,
          mensaje: 'Inicio de sesión exitoso',
          usuario: {
            id: usuario.id || 1,
            nombreUsuario: usuario.nombrered,
            nombre: usuario.nombre || 'Usuario',
            rol: usuario.rol || 'usuario',
            valorpersonal: usuario.valorpersonal || ''
          },
          sectorSeleccionado: {
            idpersonal: sector,
            idsector: sectorInfo ? sectorInfo.idsector : '',
            descripcion: sectorInfo ? sectorInfo.descripcion : ''
          },
          token: 'token-simulado',
          fuente: 'db'
        });
      }
    } catch (dbError) {
      console.error('Error consultando la base de datos:', dbError.message);
      console.log('Continuando con verificación de credenciales temporales...');
    }
    
    // Si la conexión a la base de datos falló o el usuario no existe, verificar credenciales temporales
    // if (await authService.autenticarConCredencialesTemporales(username, password)) {
    //   console.log('Inicio de sesión exitoso con credenciales temporales');
    //   return res.json({
    //     success: true,
    //     mensaje: 'Inicio de sesión exitoso (modo de contingencia)',
    //     usuario: {
    //       id: 1,
    //       nombreUsuario: 'admin',
    //       nombre: 'Administrador',
    //       rol: 'admin'
    //     },
    //     token: 'token-simulado',
    //     fuente: 'temp'
    //   });
    // }
    
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
