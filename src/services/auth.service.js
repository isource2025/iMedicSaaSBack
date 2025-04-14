
const { executeQuery } = require('../models/db');

const autenticarUsuario = async (username, contraseña) => {
  try {
    // Verificar credenciales contra la tabla impassword
    const consulta = `SELECT * FROM impassword WHERE nombrered = @p0 AND password = @p1`;
    const parametros = [
      { value: username },
      { value: contraseña }
    ];
    
    const resultado = await executeQuery(consulta, parametros);
    
    if (resultado && resultado.length > 0) {
      return resultado[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error al autenticar usuario:', error.message);
    throw error;
  }
};

/**
 * Autentica con credenciales temporales (contingencia)
 * @param {string} username - Nombre de usuario
 * @param {string} contraseña - Contraseña del usuario
 * @returns {Promise<boolean>} Resultado de la autenticación
 */
const autenticarConCredencialesTemporales = async (username, contraseña) => {
  // Credenciales temporales para modo de contingencia
  return username === 'admin' && contraseña === 'admin';
};

module.exports = {
  autenticarUsuario,
  autenticarConCredencialesTemporales
};
