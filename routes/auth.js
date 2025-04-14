const express = require('express');
const router = express.Router();
const { sql } = require('../config/db');
const { executeQuery } = require('../models/db');

// Ruta de login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    console.log(`Intento de login con usuario: ${username}`);
    
    // Verificar credenciales contra la tabla impassword
    const query = `SELECT * FROM impassword WHERE nombrered = @p0 AND password = @p1`;
    const params = [
      { value: username },
      { value: password }
    ];
    
    try {
      const result = await executeQuery(query, params);
      
      if (result && result.length > 0) {
        const user = result[0];
        console.log(`Login exitoso para usuario ${username} desde SQL Server`);
        return res.json({
          success: true,
          message: 'Login exitoso',
          user: {
            id: user.id || 1,
            username: user.nombrered,
            name: user.nombre || 'Usuario',
            role: user.rol || 'user'
          },
          token: 'token-simulado',
          source: 'db'
        });
      }
    } catch (dbError) {
      console.error('Error consultando la base de datos:', dbError.message);
      console.log('Continuando con verificación de credenciales temporales...');
    }
    
    // Si no se pudo conectar a la base de datos o el usuario no existe, verificar credenciales temporales
    if (username === 'admin' && password === 'admin') {
      console.log('Login exitoso con credenciales temporales');
      return res.json({
        success: true,
        message: 'Login exitoso (modo de contingencia)',
        user: {
          id: 1,
          username: 'admin',
          name: 'Administrador',
          role: 'admin'
        },
        token: 'token-simulado',
        source: 'temp'
      });
    }
    
    // Si llegamos aquí, las credenciales son inválidas
    res.status(401).json({
      success: false,
      message: 'Credenciales inválidas'
    });
  } catch (error) {
    console.error('Error durante la autenticación:', error);
    res.status(500).json({
      success: false,
      message: 'Error en el servidor durante la autenticación'
    });
  }
});

module.exports = router;
