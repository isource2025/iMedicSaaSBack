  /**
 * Punto de entrada principal de la aplicación
 * @module server
 */
const app = require('./app');

// Definir puerto
const PORT = process.env.PORT || 5000;

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
