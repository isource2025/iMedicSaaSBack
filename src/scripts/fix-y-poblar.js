const { connectDB } = require('../config/database');

async function main() {
  try {
    console.log('\n🔧 Arreglando estructura de tabla y poblando datos...\n');
    
    const pool = await connectDB();

    // 1. Agregar columna AlertaCritica si no existe
    console.log('1. Verificando columna AlertaCritica...');
    try {
      await pool.request().query(`
        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = 'imHCExamenesLabDetalleConf' 
          AND COLUMN_NAME = 'AlertaCritica'
        )
        BEGIN
          ALTER TABLE imHCExamenesLabDetalleConf
          ADD AlertaCritica BIT NOT NULL DEFAULT 0;
          PRINT 'Columna AlertaCritica agregada';
        END
      `);
      console.log('✓ Columna AlertaCritica verificada\n');
    } catch (err) {
      console.log('⚠ Error al agregar columna:', err.message);
    }

    // 2. Poblar parámetros básicos
    console.log('2. Poblando parámetros de laboratorio...');
    
    const parametros = [
      // Hemograma
      { codigo: 'GB', nombre: 'Glóbulos Blancos', categoria: 'HEMOGRAMA', unidad: '/mm3', minA: 3800, maxA: 10000, critica: 1 },
      { codigo: 'GR', nombre: 'Glóbulos Rojos', categoria: 'HEMOGRAMA', unidad: '/mm3', minH: 4500000, maxH: 5800000, minM: 4000000, maxM: 5200000, critica: 0 },
      { codigo: 'HB', nombre: 'Hemoglobina', categoria: 'HEMOGRAMA', unidad: 'g/dl', minH: 13.0, maxH: 17.0, minM: 12.0, maxM: 16.0, critica: 1 },
      { codigo: 'HTO', nombre: 'Hematocrito', categoria: 'HEMOGRAMA', unidad: '%', minH: 42, maxH: 50, minM: 37, maxM: 47, critica: 0 },
      { codigo: 'PLT', nombre: 'Plaquetas', categoria: 'HEMOGRAMA', unidad: '/mm3', minA: 150000, maxA: 400000, critica: 1 },
      
      // Química Clínica
      { codigo: 'GLU', nombre: 'Glucemia', categoria: 'QUIMICA_CLINICA', unidad: 'mg/dl', minA: 70, maxA: 100, critica: 1 },
      { codigo: 'UREA', nombre: 'Uremia', categoria: 'QUIMICA_CLINICA', unidad: 'mg/dl', minA: 10, maxA: 45, critica: 0 },
      { codigo: 'CREA', nombre: 'Creatininemia', categoria: 'QUIMICA_CLINICA', unidad: 'mg/dl', minH: 0.90, maxH: 1.30, minM: 0.60, maxM: 1.10, critica: 1 },
      { codigo: 'URIC', nombre: 'Uricemia', categoria: 'QUIMICA_CLINICA', unidad: 'mg/dl', minH: 2.5, maxH: 6.0, minM: 2.0, maxM: 5.0, critica: 0 },
      
      // Ionograma
      { codigo: 'NA', nombre: 'Sodio', categoria: 'IONOGRAMA', unidad: 'meq/l', minA: 135, maxA: 145, critica: 1 },
      { codigo: 'K', nombre: 'Potasio', categoria: 'IONOGRAMA', unidad: 'meq/l', minA: 3.5, maxA: 5.3, critica: 1 },
      { codigo: 'CL', nombre: 'Cloro', categoria: 'IONOGRAMA', unidad: 'meq/l', minA: 95, maxA: 105, critica: 0 },
      
      // Hepatograma
      { codigo: 'GOT', nombre: 'GOT - AST', categoria: 'HEPATOGRAMA', unidad: 'U/l', minA: 0, maxA: 38, critica: 0 },
      { codigo: 'GPT', nombre: 'GPT - ALT', categoria: 'HEPATOGRAMA', unidad: 'U/l', minA: 0, maxA: 41, critica: 0 },
      { codigo: 'FAL', nombre: 'Fosfatasa Alcalina', categoria: 'HEPATOGRAMA', unidad: 'U/L', minA: 20, maxA: 300, critica: 0 },
      
      // Gasometría
      { codigo: 'PH', nombre: 'pH', categoria: 'GASOMETRIA', unidad: '', minA: 7.35, maxA: 7.45, critica: 1 },
      { codigo: 'PCO2', nombre: 'pCO2', categoria: 'GASOMETRIA', unidad: 'mmHg', minA: 35, maxA: 45, critica: 0 },
      { codigo: 'PO2', nombre: 'pO2', categoria: 'GASOMETRIA', unidad: 'mmHg', minA: 80, maxA: 105, critica: 1 },
    ];

    for (const p of parametros) {
      try {
        await pool.request().query(`
          IF NOT EXISTS (SELECT 1 FROM imHCExamenesLabDetalleConf WHERE CodigoParametro = '${p.codigo}')
          BEGIN
            INSERT INTO imHCExamenesLabDetalleConf 
            (CodigoParametro, NombreParametro, Categoria, UnidadMedida, 
             ValorMinimoAdulto, ValorMaximoAdulto, 
             ValorMinimoHombre, ValorMaximoHombre,
             ValorMinimoMujer, ValorMaximoMujer,
             Activo, AlertaCritica)
            VALUES 
            ('${p.codigo}', '${p.nombre}', '${p.categoria}', '${p.unidad}',
             ${p.minA || 'NULL'}, ${p.maxA || 'NULL'},
             ${p.minH || 'NULL'}, ${p.maxH || 'NULL'},
             ${p.minM || 'NULL'}, ${p.maxM || 'NULL'},
             1, ${p.critica})
          END
        `);
        console.log(`✓ ${p.nombre}`);
      } catch (err) {
        console.log(`✗ Error con ${p.nombre}:`, err.message);
      }
    }

    console.log('\n✓ Parámetros poblados exitosamente\n');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

main();
