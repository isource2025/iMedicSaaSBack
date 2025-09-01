// Usar fetch nativo disponible en Node.js moderno
require('dotenv').config();

const API_URL = process.env.API_URL || 'http://localhost:5006/api';

async function fetchGruposEtnicos() {
  try {
    const response = await fetch(`${API_URL}/grupos-etnicos`);
    
    // Verifiquemos el Content-Type
    console.log('Content-Type:', response.headers.get('content-type'));
    
    // Obtener la respuesta como texto primero
    const textResponse = await response.text();
    console.log('Respuesta como texto:\n', textResponse);
    
    // Intentar parsear como JSON para ver si es válido
    try {
      const jsonData = JSON.parse(textResponse);
      console.log('Respuesta parseada como JSON:\n', JSON.stringify(jsonData, null, 2));
      console.log('Tipo de datos:', typeof jsonData);
      console.log('Es un array:', Array.isArray(jsonData));
      
      if (Array.isArray(jsonData)) {
        console.log('Longitud del array:', jsonData.length);
        console.log('Primer elemento:', JSON.stringify(jsonData[0], null, 2));
      }
    } catch (parseError) {
      console.error('Error al parsear JSON:', parseError);
    }
  } catch (error) {
    console.error('Error al hacer la petición:', error);
  }
}

fetchGruposEtnicos();
