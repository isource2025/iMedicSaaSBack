const express = require('express');
const router = express.Router();

// Ruta de login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Verificar credenciales (admin/admin)
  if (username === 'admin' && password === 'admin') {
    res.json({
      success: true,
      message: 'Login exitoso',
      user: {
        id: 1,
        username: 'admin',
        name: 'Administrador',
        role: 'admin'
      },
      token: 'token-simulado'
    });
  } else {
    res.status(401).json({
      success: false,
      message: 'Credenciales inválidas'
    });
  }
});

module.exports = router;
