/**
 * Middleware para proteger rutas de administración
 * Por ahora es un middleware hardcodeado que siempre permite el acceso
 * En una implementación real, verificaría tokens JWT y roles de usuario
 */
const adminMiddleware = (req, res, next) => {
  console.log('Middleware de administración ejecutado');
  
  // Por ahora, simplemente permitimos el acceso a todos
  // En una implementación real, verificaríamos el token JWT y el rol de administrador
  
  // Ejemplo de cómo sería la verificación:
  // 1. Obtener el token del encabezado de autorización
  // const authHeader = req.headers.authorization;
  // if (!authHeader || !authHeader.startsWith('Bearer ')) {
  //   return res.status(401).json({
  //     success: false,
  //     message: 'No autorizado: Token no proporcionado'
  //   });
  // }
  
  // 2. Verificar el token y extraer el payload
  // const token = authHeader.split(' ')[1];
  // try {
  //   const decoded = jwt.verify(token, process.env.JWT_SECRET);
  //   
  //   // 3. Verificar si el usuario tiene rol de administrador
  //   if (decoded.role !== 'admin') {
  //     return res.status(403).json({
  //       success: false,
  //       message: 'Prohibido: Se requiere rol de administrador'
  //     });
  //   }
  //   
  //   // 4. Adjuntar la información del usuario al objeto de solicitud
  //   req.user = decoded;
  //   
  //   // 5. Continuar con la siguiente función de middleware
  //   next();
  // } catch (error) {
  //   return res.status(401).json({
  //     success: false,
  //     message: 'No autorizado: Token inválido'
  //   });
  // }
  
  // Por ahora, simplemente continuamos
  next();
};

module.exports = adminMiddleware;
