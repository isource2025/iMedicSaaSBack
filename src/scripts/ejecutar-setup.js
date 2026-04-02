const { executeQuery } = require('../models/db');
const fs = require('fs');
const path = require('path');

async function ejecutarSetup() {
  try {
    console.log('Leyendo script SQL...');
    const sqlPath = path.join(__dirname, 'pipeline-ocr-setup.sql');
    const sqlScript = fs.readFileSync(sqlPath, 'utf8');
    
    // Dividir por GO y ejecutar cada bloque
    const bloques = sqlScript.split(/\nGO\n/i);
    
    console.log(`Ejecutando ${bloques.length} bloques SQL...\n`);
    
    for (let i = 0; i < bloques.length; i++) {
      const bloque = bloques[i].trim();
      if (bloque && !bloque.startsWith('--') && bloque.length > 0) {
        try {
          await executeQuery(bloque);
        } catch (error) {
          // Ignorar errores de PRINT y USE
          if (!error.message.includes('PRINT') && !error.message.includes('USE')) {
            console.error(`Error en bloque ${i + 1}:`, error.message);
          }
        }
      }
    }
    
    console.log('\n✓ Setup completado');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

ejecutarSetup();
