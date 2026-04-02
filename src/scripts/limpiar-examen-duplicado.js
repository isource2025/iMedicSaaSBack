const { executeQuery } = require('../models/db');

async function limpiarExamenDuplicado() {
  try {
    console.log('\n🧹 Limpiando examen duplicado ID 6...\n');

    // Eliminar detalles del examen 6
    await executeQuery(`DELETE FROM imHCExamenesLabDetalle WHERE IdExamenLaboratorio = 6`);
    console.log('✓ Detalles eliminados');

    // Eliminar cabecera del examen 6
    await executeQuery(`DELETE FROM imHCExamenesLabCabecera WHERE IdExamenLaboratorio = 6`);
    console.log('✓ Cabecera eliminada');

    // Eliminar logs OCR del examen 6
    await executeQuery(`DELETE FROM imOCRLog WHERE IdExamenLaboratorio = 6`);
    console.log('✓ Logs OCR eliminados');

    console.log('\n✅ Examen 6 eliminado completamente\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

limpiarExamenDuplicado();
