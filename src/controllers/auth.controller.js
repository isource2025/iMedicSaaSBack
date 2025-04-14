const authService = require('../services/auth.service');

const inicioSesion = async (req, res) => {
  const { username, password } = req.body;
  
  try {
    console.log(`Intento de inicio de sesión con usuario: ${username}`);
    
    // Intentar autenticación SQL primero, luego recurrir a credenciales temporales si es necesario
    try {
      const usuario = await authService.autenticarUsuario(username, password);
      
      if (usuario) {
        console.log(`Inicio de sesión exitoso para usuario ${username} desde SQL Server`);
        return res.json({
          success: true,
          mensaje: 'Inicio de sesión exitoso',
          usuario: {
            id: usuario.id || 1,
            nombreUsuario: usuario.nombrered,
            nombre: usuario.nombre || 'Usuario',
            rol: usuario.rol || 'usuario'
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

module.exports = {
  inicioSesion
};
